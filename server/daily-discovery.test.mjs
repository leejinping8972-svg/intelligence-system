/* eslint-disable vitest/no-import-node-test -- Standalone backend tests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultDailyPlan,
  validateDailyPlan,
  beijingTime,
  buildDailyRun,
  advanceDailyRun,
  stopPendingDailyWork,
  dailySubmission,
} from './daily-discovery-domain.mjs';
import {
  discoveryDecision,
  observeDiscovery,
  protectDiscoveryEdit,
} from './discovery-newness.mjs';
import { runMarketJob } from './market-jobs.mjs';
import { runPlatformProducts } from './platform-products-jobs.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';
const now = Date.parse('2026-10-20T04:00:00Z');
const keyword = (id = 'word', market = 'US') => ({
  id,
  term: `qa fiber ${id}`,
  market,
  reviewStatus: 'selected',
  dataNature: 'collected',
});
const plan = (patch = {}) =>
  validateDailyPlan({
    ...defaultDailyPlan,
    enabled: true,
    budgetAcknowledged: true,
    ...patch,
  });
const run = (patch, words = [keyword()]) =>
  buildDailyRun(plan(patch), words, now);
const product = (patch = {}) => ({
  id: 'p',
  market: 'US',
  firstSeenAt: '2026-10-20T01:00:00Z',
  sourceMetrics: { collectedAt: '2026-10-20T01:00:00Z' },
  ...patch,
});
const listing = (date, patch = {}) => ({
  date,
  provider: 'Sorftime',
  platform: 'Amazon',
  market: 'US',
  collectedAt: '2026-10-20T01:00:00Z',
  evidenceUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  ...patch,
});

test('plan defaults off, finite budgets, explicit acknowledgement, validation and fixed Beijing time', () => {
  assert.equal(defaultDailyPlan.enabled, false);
  assert.throws(() => validateDailyPlan({ enabled: true }), /确认/);
  for (const patch of [
    { maxPages: 0 },
    { time: '24:00' },
    { providers: [] },
    { markets: ['ALL'] },
    { enabled: 'yes' },
  ])
    assert.throws(() => plan(patch));
  assert.deepEqual(beijingTime(Date.parse('2026-10-19T16:00:00Z')), {
    day: '2026-10-20',
    time: '00:00',
  });
});
test('dynamic selection excludes demo, unselected and other markets; VN never uses Amazon', () => {
  const result = run({ markets: ['VN'] }, [
    keyword(),
    keyword('v', 'VN'),
    { ...keyword('x', 'VN'), reviewStatus: 'excluded' },
    { ...keyword('d', 'VN'), dataNature: 'demo' },
  ]);
  assert.equal(result.selectedCount, 1);
  assert.deepEqual(result.work[1].providers, ['semrush']);
  assert.equal(
    run({ markets: ['VN'], providers: ['sorftime'] }, [keyword('v', 'VN')])
      .work[1].status,
    'skipped',
  );
});
test('daily request IDs survive reconfiguration and change on next date, remain separated by kind and market word', () => {
  const a = run({}),
    b = run({ maxAds: 30 });
  assert.deepEqual(
    a.work.map((e) => e.requestId),
    b.work.map((e) => e.requestId),
  );
  const next = buildDailyRun(plan(), [keyword()], now + 86_400_000);
  assert.notEqual(a.work[0].requestId, next.work[0].requestId);
  assert.notEqual(a.work[0].requestId, a.work[1].requestId);
  assert.match(
    a.work[0].requestId,
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/,
  );
});
test('legacy daily request budgets cannot omit selected keywords', () => {
  const result = run(
    { adRequestBudget: 1, productRequestBudget: 3, semrushUnitBudget: 320 },
    [keyword('1'), keyword('2'), keyword('3')],
  );
  assert.deepEqual(result.reserved, { ads: 3, products: 9, semrush: 960 });
  assert.equal(result.work.filter((e) => e.status === 'skipped').length, 0);
  assert.ok(
    result.work
      .every((e) => e.status === 'pending' && !e.reason),
  );
});
test('daily product requests disable unbounded details and trends; ad query sees active and inactive results', () => {
  const result = run({});
  const ad = dailySubmission(result, result.work[0]),
    p = dailySubmission(result, result.work[1]);
  assert.equal(ad.adStatus, 'ALL');
  assert.equal(p.completeAll, false);
  assert.equal(p.enrich, false);
  assert.equal(p.trend, false);
  assert.equal(p.maxRequests, undefined);
  assert.equal(p.maxProducts, 20);
  assert.equal(p.semrushUnitLimit, 0);
});
test('daily scheduling ignores legacy Semrush unit budgets while retaining unit estimates', () => {
  const result = run({ semrushUnitBudget: 1 }, [keyword('1'), keyword('2'), keyword('3')]);
  assert.equal(result.work.filter((entry) => entry.status === 'pending').length, 6);
  assert.equal(result.reserved.semrush, 960);
  assert.equal(result.plan.semrushUnitBudget, 0);
});
function memory() {
  const jobs = new Map(),
    submitted = [];
  return {
    jobs,
    submitted,
    keyword: async () => keyword(),
    findRequest: async (id) =>
      [...jobs.values()].find((j) => j.request_id === id),
    job: async (id) => jobs.get(id),
    submit: async (kind, input) => {
      const value = {
        id: `${submitted.length}`,
        request_id: input.requestId,
        kind,
        status: 'queued',
        checkpoint: { logs: [] },
      };
      submitted.push(input);
      jobs.set(value.id, value);
      return value;
    },
  };
}
test('only one scheduled child is queued at a time and repeated ticks reuse persisted work', async () => {
  const result = run({}),
    io = memory();
  await advanceDailyRun(result, io, now);
  await advanceDailyRun(result, io, now + 1);
  assert.equal(io.submitted.length, 1);
  io.jobs.get('0').status = 'completed';
  await advanceDailyRun(result, io, now + 2);
  assert.equal(io.submitted.length, 2);
  assert.equal(result.work[0].status, 'completed');
});
test('crash after child insertion but before run save recovers request ID without resubmission', async () => {
  const result = run({}),
    io = memory();
  await io.submit('ads', dailySubmission(result, result.work[0]));
  await advanceDailyRun(result, io, now);
  assert.equal(io.submitted.length, 1);
  assert.equal(result.work[0].jobId, '0');
});
test('pausing pending work recovers a child inserted before a crash and skips only steps that were never submitted', async () => {
  const result = run({}),
    io = memory();
  await io.submit('ads', dailySubmission(result, result.work[0]));
  await stopPendingDailyWork(result, io, '计划已暂停');
  assert.equal(result.work[0].jobId, '0');
  assert.equal(result.work[0].status, 'queued');
  assert.equal(result.work[1].status, 'skipped');
  assert.equal(io.submitted.length, 1);
});
test('selection changes and old pending dates issue no requests', async () => {
  for (const patch of [
    undefined,
    { ...keyword(), reviewStatus: 'excluded' },
    { ...keyword(), term: 'changed' },
  ]) {
    const result = run({}),
      io = { ...memory(), keyword: async () => patch };
    await advanceDailyRun(result, io, now);
    assert.equal(result.work[0].status, 'skipped');
    assert.equal(io.submitted.length, 0);
  }
  const result = run({}),
    io = memory();
  await advanceDailyRun(result, io, now + 86_400_000);
  assert.ok(result.work.every((e) => e.status === 'skipped'));
  assert.equal(io.submitted.length, 0);
});
test('overlapping manual jobs retry after cooldown with the same request ID', async () => {
  const result = run({}),
    io = memory();
  let calls = 0;
  io.submit = async () => {
    calls++;
    throw new Error('这些关键词已有平台商品任务，请等待完成');
  };
  // Restrict this test to one channel to inspect cooldown precisely.
  result.work = [result.work[1]];
  await advanceDailyRun(result, io, now);
  await advanceDailyRun(result, io, now + 20_000);
  assert.equal(calls, 1);
  assert.equal(result.work[0].status, 'pending');
  await advanceDailyRun(result, io, now + 60_000);
  assert.equal(calls, 2);
});
test('unknown charges and provider rate limits stop the rest of the affected daily channel', async () => {
  for (const checkpoint of [
    { unknownCharges: 1, logs: [] },
    { logs: ['HTTP429 source limit'] },
  ]) {
    const result = run({}, [keyword('1'), keyword('2')]),
      io = memory();
    io.keyword = async (id) => keyword(id);
    await advanceDailyRun(result, io, now);
    io.jobs.get('0').status = 'partial';
    io.jobs.get('0').checkpoint = checkpoint;
    await advanceDailyRun(result, io, now + 1);
    assert.equal(
      result.work.filter((e) => e.kind === 'ads' && e.status === 'skipped')
        .length,
      1,
    );
    assert.equal(io.submitted.length, 2); // Other channel may proceed.
  }
});
test('first observation is stable; repeated days and journal/cache replays do not reset it or duplicate days', () => {
  const first = observeDiscovery(undefined, product(), 'product', now);
  const replay = observeDiscovery(first, product(), 'product', now);
  assert.deepEqual(replay.discovery.observationDays, ['2026-10-20']);
  const later = observeDiscovery(
    replay,
    product({
      firstSeenAt: '2026-10-21T01:00:00Z',
      sourceMetrics: { collectedAt: '2026-10-21T01:00:00Z' },
    }),
    'product',
    now + 86_400_000,
  );
  assert.equal(later.firstSeenAt, first.firstSeenAt);
  assert.equal(later.discovery.lastSeenAt, '2026-10-21T01:00:00Z');
  assert.deepEqual(later.discovery.observationDays, [
    '2026-10-20',
    '2026-10-21',
  ]);
  assert.deepEqual(
    observeDiscovery(later, { favorite: true }, 'product', now + 2 * 86_400_000)
      .discovery,
    later.discovery,
  );
});
test('newness is independent from discovery; old and recent listings and unknown dates remain distinct', () => {
  assert.equal(discoveryDecision(product(), 'product', now).isNew, null);
  const old = discoveryDecision(
    product({ decisionData: { listing: listing('2025-01-01') } }),
    'product',
    now,
  );
  assert.equal(old.isNew, false);
  assert.equal(old.recentDiscovery, true);
  assert.equal(
    discoveryDecision(
      product({ decisionData: { listing: listing('2026-10-01') } }),
      'product',
      now,
    ).isNew,
    true,
  );
});
test('invalid dates, missing/wrong provenance, future observations and untrusted links cannot prove newness', () => {
  for (const value of [
    listing('2026-02-30'),
    listing('2026-10-21'),
    listing('2026-10-01', { market: 'MX' }),
    listing('2026-10-01', { evidenceUrl: '' }),
    listing('2026-10-01', { evidenceUrl: 'javascript:alert(1)' }),
    listing('2026-10-01', { collectedAt: '2026-10-21T00:00:00Z' }),
  ])
    assert.equal(
      discoveryDecision(
        product({ decisionData: { listing: value } }),
        'product',
        now,
      ).isNew,
      null,
    );
  assert.equal(
    discoveryDecision(product({ firstSeenAt: undefined }), 'product', now)
      .recentDiscovery,
    false,
  );
  assert.equal(
    discoveryDecision(product({ firstSeenAt: '2026-10-21' }), 'product', now)
      .recentDiscovery,
    false,
  );
});
test('ads use source start date, age dynamically, and retain explicit unknowns', () => {
  const ad = {
    source: 'Meta',
    evidenceUrl: 'https://facebook.com/ads/library/?id=123',
    startDate: '2026-10-19',
    firstSeenAt: '2026-10-20',
    lastCollectedAt: '2026-10-20T01:00:00Z',
  };
  assert.equal(discoveryDecision(ad, 'ad', now).isNew, true);
  assert.equal(discoveryDecision(ad, 'ad', now + 10 * 86_400_000).isNew, false);
  assert.equal(
    discoveryDecision({ ...ad, startDate: undefined }, 'ad', now).isNew,
    null,
  );
});
test('stale browser saves preserve server observations and dates; fabricated observations on import are ignored', () => {
  const original = observeDiscovery(undefined, product(), 'product', now);
  const incoming = protectDiscoveryEdit(original, {
    ...original,
    firstSeenAt: '2026-10-21',
    discovery: { firstSeenAt: 'forged' },
    favorite: true,
  });
  assert.equal(incoming.firstSeenAt, original.firstSeenAt);
  assert.deepEqual(incoming.discovery, original.discovery);
  assert.equal(incoming.favorite, true);
  assert.equal(
    protectDiscoveryEdit(undefined, { discovery: { forged: true } }).discovery,
    undefined,
  );
});
test('daily ads collect no extra landing pages, website metrics or other paid sources', async () => {
  const input = {
    ...dailySubmission(run({}), run({}).work[0]),
    discoveryOnly: true,
    records: [keyword()],
    markets: ['US'],
  };
  const job = { id: 'job', input, checkpoint: {} },
    requests = [],
    saved = [];
  await runMarketJob(job, {
    readKeyword: async () => keyword(),
    isCancelled: async () => false,
    readDoc: async () => undefined,
    mergeBusiness: async (key, value) => saved.push([key, value]),
    patchCollection: async () => {},
    saveCheckpoint: async (_j, cp, status) => {
      job.checkpoint = structuredClone(cp);
      job.status = status;
    },
    collect: async (_j, _step, request) => {
      requests.push(request.sources);
      return {
        ads: [
          {
            id: 'a',
            landingUrls: ['https://example.com/product'],
            firstSeenAt: '2026-10-20',
            lastCollectedAt: '2026-10-20',
          },
        ],
        creditsCharged: 1,
      };
    },
    verifyAdSite: async () => {
      throw new Error('Landing not allowed');
    },
  });
  assert.deepEqual(requests, [['ads']]);
  assert.equal(saved[0][0], 'ads:a');
  assert.equal(job.status, 'completed');
});
test('queued daily platform search stops after keyword deselection without any provider request', async () => {
  const result = run({}),
    input = {
      ...dailySubmission(result, result.work[1]),
      kind: 'platform_products',
      seeds: [keyword().term],
      keywordRecords: [keyword()],
      discoveryDay: result.day,
    };
  const job = { id: 'j', input, checkpoint: {} };
  await runPlatformProducts(job, {
    readKeyword: async () => ({ ...keyword(), reviewStatus: 'excluded' }),
    isCancelled: async () => false,
    collect: async () => {
      throw new Error('Provider request forbidden');
    },
    saveCheckpoint: async (_j, cp, status) => {
      job.checkpoint = cp;
      job.status = status;
    },
  });
  assert.equal(job.status, 'cancelled');
  assert.equal(job.checkpoint.requests, 0);
});
test('daily discovery caches within a date and refreshes next date, keeping uncertain requests in original journal', async () => {
  const records = new Map();
  let calls = 0;
  const overrides = {
    cache: {
      read: async (n) => records.get(n),
      write: async (n, v) => records.set(n, v),
    },
    collectorEnv: async () => ({}),
    readSorftimeToken: async () => 'synthetic-only',
    connectSorftime: async () => ({
      tools: [{ name: 'product_search_from_name' }],
      call: async () => {
        calls++;
        return { structuredContent: { data: [] } };
      },
    }),
  };
  // Adapter RPC shape mirrors real MCP without opening a connection.
  overrides.connectSorftime = async () => ({
    tools: [
      {
        name: 'product_search_from_name',
        inputSchema: {
          properties: {
            name: {},
            query_type: {},
            page: {},
            amz_site: { enum: ['US'] },
          },
        },
      },
    ],
    rpc: async () => {
      calls++;
      return { structuredContent: { data: [] } };
    },
  });
  const request = {
    provider: 'sorftime',
    op: 'search',
    market: 'US',
    term: 'qa fiber',
    page: 1,
    limit: 10,
    discoveryDay: '2026-10-20',
  };
  await platformProductRequest(request, overrides);
  await platformProductRequest(request, overrides);
  assert.equal(calls, 1);
  await platformProductRequest(
    { ...request, discoveryDay: '2026-10-21' },
    overrides,
  );
  assert.equal(calls, 2);
});
