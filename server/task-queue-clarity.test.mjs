import assert from 'node:assert/strict';
import test from 'node:test';

import { scheduleSource as workerSchedule } from '../workers/site-discovery/src/source-scheduler.js';
import { mergeObserved } from './competitor-monitor-domain.mjs';
import { validateJob } from './domain.mjs';
import { validateEnrichment } from './enrichment-jobs.mjs';
import { validateInsight } from './insight-jobs.mjs';
import { normalizeProduct } from './product-jobs.mjs';
import { enrichPublicProduct } from './product-public-enrichment.mjs';
import { fetchPublicPage } from './safe-web.mjs';
import { scheduleSource, sourceLane } from './source-scheduler.mjs';
import { estimateTask } from './task-estimate.mjs';
import { taskCollections, taskOverview } from './task-overview.mjs';
import { researchDraft } from './task-research.mjs';
import { decorateSocialTasks } from './task-social-progress.mjs';
import {
  fetchWestmonthSavedPrice,
  westmonthPrice,
} from './westmonth-price.mjs';
import {
  openSession,
  sealSession,
  sessionToken,
  westmonthSessionAction,
} from './westmonth-session.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
test('source serialization is shared with bundled worker while other sources proceed', async () => {
  const entered = deferred();
  const hold = deferred();
  const order = [];
  const first = scheduleSource(
    'qa-source',
    async () => {
      order.push('first');
      entered.resolve();
      await hold.promise;
    },
    { intervalMs: 0 },
  );
  await entered.promise;
  const second = workerSchedule('qa-source', async () => order.push('second'), {
    intervalMs: 0,
  });
  await scheduleSource('qa-other', async () => order.push('other'), {
    intervalMs: 0,
  });
  assert.deepEqual(order, ['first', 'other']);
  hold.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'other', 'second']);
  await assert.rejects(
    scheduleSource(
      'qa-source',
      async () => {
        throw Error('fail');
      },
      { intervalMs: 0 },
    ),
  );
  await scheduleSource('qa-source', async () => order.push('after failure'), {
    intervalMs: 0,
  });
});
test('429 preserves a common cooldown without replay', async () => {
  let calls = 0;
  await assert.rejects(
    scheduleSource(
      'qa-rate',
      async () => {
        calls++;
        throw Object.assign(Error('limited'), {
          status: 429,
          retryAfterSeconds: 120,
        });
      },
      { intervalMs: 0 },
    ),
  );
  assert.equal(calls, 1);
  assert.ok(sourceLane('qa-rate').nextAt >= Date.now() + 119000);
});
test('overall progress distinguishes processed, success, stopped remainder and unknown billing', () => {
  const job = {
    status: 'partial',
    input: { kind: 'products', records: [{}, {}, {}] },
    checkpoint: {
      siteWork: [
        { status: 'completed' },
        { status: 'partial' },
        { status: 'retry_wait' },
      ],
    },
  };
  const result = taskOverview(job, {});
  assert.deepEqual(
    [
      result.total,
      result.processed,
      result.succeeded,
      result.failed,
      result.remaining,
    ],
    [3, 2, 1, 1, 1],
  );
  assert.match(result.outcome, /未完成/);
  assert.equal(result.percent, 67);
  const generic = taskOverview(
    {
      status: 'partial',
      input: { records: [{}, {}, {}] },
      checkpoint: { index: 2, failures: 1, unknownCharges: 1 },
    },
    {},
  );
  assert.equal(generic.succeeded, null);
  assert.match(generic.reason, /未确认/);
  const rows = taskCollections(
    {
      status: 'partial',
      input: { records: [{ term: 'one' }, { term: 'two' }] },
      checkpoint: { index: 1 },
    },
    {},
    [{ step: 'platform:0:detail', status: 'done' }],
  );
  assert.equal(rows[0].executions.length, 1);
  assert.equal(rows[1].status, 'not_started');
});
test('research draft preserves resource route and exact selections without secrets', () => {
  const draft = researchDraft({
    input: {
      kind: 'platform_products',
      resourceDiscovery: true,
      apiKey: 'never-copy',
      resourcePlan: {
        routeId: 'website-public',
        mode: 'urls',
        market: 'VN',
        urls: ['https://brand.test/products/1'],
        websiteDomain: 'brand.test',
        budget: { requests: 4 },
      },
    },
    checkpoint: {},
  });
  assert.equal(draft.path, '/products');
  assert.equal(draft.input.urls, 'https://brand.test/products/1');
  assert.equal(draft.input.resourceDiscovery, true);
  assert.equal(draft.input.apiKey, undefined);
  const keyword = researchDraft({
    input: {
      seeds: ['fish oil'],
      markets: ['US'],
      sources: ['semrush'],
      socialTrends: {
        sources: ['tiktok'],
        maxRequests: 1,
        budgetAcknowledged: true,
      },
    },
    checkpoint: { keywords: [{ id: '1', term: 'fish oil', market: 'US' }] },
  });
  assert.equal(keyword.input.socialTrends.budgetAcknowledged, false);
  assert.equal(keyword.previous.keywords[0].term, 'fish oil');
});
test('estimates are ranges with waiting separate, and include social pages', () => {
  const basic = estimateTask({ limit: 5, seeds: ['oil'], markets: ['US'] });
  const social = estimateTask({
    limit: 5,
    seeds: ['oil'],
    markets: ['US'],
    socialTrends: { sources: ['tiktok'], maxRequests: 20, maxPages: 3 },
  });
  assert.ok(social.maxSeconds > basic.maxSeconds);
  assert.ok(social.maxSeconds > social.minSeconds);
  assert.match(social.note, /排队等待另计/);
});
test('discount prices never use guide/base, zero, ambiguous currency or invalid grouping', () => {
  assert.equal(
    westmonthPrice({
      member_price: '1,234.50',
      price_currency: 'cny',
      guide_price: 9999,
    }).price,
    1234.5,
  );
  for (const row of [
    { member_price: 0, price_currency: 'USD' },
    { member_price: '', price_currency: 'USD' },
    { member_price: '12,34', price_currency: 'USD' },
    { guide_price: 40, base_price: 30, price_currency: 'USD' },
    { member_price: 10, price_currency: '¥' },
  ])
    assert.deepEqual(westmonthPrice(row), {});
  const site = {
    id: 'VN-westmonth.com',
    market: 'VN',
    domain: 'westmonth.com',
  };
  const item = normalizeProduct(
    {
      title: 'QA',
      url: 'https://www.westmonth.com/products/123',
      collectionFields: ['title', 'image'],
      catalogEvidenceUrl:
        'https://api-x.westmonth.com/product-center/shop/products/load-list?page=1',
      catalogProductMetrics: { member_price: 12, price_currency: 'CNY' },
    },
    site,
  );
  assert.equal(item.price, 12);
  assert.deepEqual(item.collectionFields, ['title', 'image', 'price']);
  const merged = mergeObserved(
    { ...item, price: 10, reviewed: true, favorite: true },
    item,
    '2026-10-28T00:00:00Z',
  );
  assert.equal(merged.price, 12);
  assert.equal(merged.favorite, true);
});
test('price completion uses only exact product IDs from the original bounded catalog page', async () => {
  const product = {
    id: 'qa',
    market: 'VN',
    evidenceUrl: 'https://www.westmonth.com/products/123',
    catalogEvidenceUrl:
      'https://api-x.westmonth.com/product-center/shop/products/load-list?page=1&pagesize=60&source=rankings',
  };
  let calls = 0;
  const fetchPage = async (url) => {
    calls++;
    return {
      url,
      html: JSON.stringify(
        url.includes('/detail')
          ? {
              code: 0,
              data: {
                id: 123,
                month_sale: 3000,
                onsale_at: '2026-10-01 00:00:00',
              },
            }
          : {
              code: 0,
              data: {
                data: [
                  { product_id: 124, member_price: 1, price_currency: 'CNY' },
                  { product_id: 123, member_price: 22, price_currency: 'CNY' },
                ],
              },
            },
      ),
    };
  };
  const result = await enrichPublicProduct(
    { product },
    { fetchPage, maxRequests: 2, now: Date.parse('2026-10-28T00:00:00Z') },
  );
  assert.equal(calls, 2);
  assert.equal(result.patch.price, 22);
  assert.equal(result.patch.publicDataEvidence.price.status, 'observed');
  assert.deepEqual(
    await fetchWestmonthSavedPrice(product, async () => ({
      html: JSON.stringify({
        code: 0,
        data: {
          data: [{ product_id: 124, member_price: 1, price_currency: 'CNY' }],
        },
      }),
    })),
    {},
  );
});
test('session is encrypted, admin-only and never returned; validation stores no credentials in errors', async () => {
  const secret = Buffer.alloc(32, 9).toString('base64');
  const token = 'qa.synthetic.token';
  let saved = {};
  const encrypted = sealSession(token, secret);
  assert.equal(openSession(encrypted, secret), token);
  assert.ok(!JSON.stringify(encrypted).includes(token));
  assert.throws(() => sessionToken('bad\nheader'));
  assert.throws(() =>
    openSession(
      { ...encrypted, tag: Buffer.alloc(16).toString('base64') },
      secret,
    ),
  );
  const io = {
    secret,
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
    probe: async (value) => {
      assert.equal(value, token);
      return true;
    },
  };
  await assert.rejects(
    westmonthSessionAction(
      { action: 'server_westmonth_session_save', accessToken: token },
      { role: 'researcher' },
      io,
    ),
    /管理员/,
  );
  const result = await westmonthSessionAction(
    {
      action: 'server_westmonth_session_save',
      accessToken: token,
      enabled: true,
    },
    { role: 'admin' },
    io,
  );
  assert.equal(result.configured, true);
  assert.ok(!JSON.stringify(result).includes(token));
  const checked = await westmonthSessionAction(
    { action: 'server_westmonth_session_check' },
    { role: 'admin' },
    io,
  );
  assert.equal(checked.status, 'price_available');
  await westmonthSessionAction(
    { action: 'server_westmonth_session_save', clear: true },
    { role: 'admin' },
    io,
  );
  assert.equal(saved.token, undefined);
});
test('session authorization is refused for another host, HTTP or redirect-following requests before network access', async () => {
  for (const url of [
    'https://evil.test/path',
    'http://api-x.westmonth.com/product-center/shop/products/detail',
    'https://api-x.westmonth.com/other',
  ])
    await assert.rejects(
      fetchPublicPage(url, 0, ['application/json'], {
        westmonthAuthorization: 'Bearer qa.token',
        manualRedirect: true,
      }),
      /官方商品接口/,
    );
  await assert.rejects(
    fetchPublicPage(
      'https://api-x.westmonth.com/product-center/shop/products/detail',
      0,
      ['application/json'],
      { westmonthAuthorization: 'Bearer qa.token' },
    ),
    /禁止跟随跳转/,
  );
});

test('reresearch contracts remain accepted for keyword, enrichment and consumer insight', () => {
  const keyword = validateJob({
    seeds: ['omega 3'],
    markets: ['VN'],
    sources: ['semrush'],
    limit: 10,
  });
  assert.deepEqual(
    validateJob(researchDraft({ input: keyword, checkpoint: {} }).input),
    keyword,
  );
  for (const input of [
    { kind: 'metrics', keywordIds: ['qa'], maxSites: 5 },
    { kind: 'sites', keywordIds: ['qa'], maxSites: 3 },
  ])
    assert.deepEqual(
      validateEnrichment(researchDraft({ input, checkpoint: {} }).input),
      input,
    );
  const insight = validateInsight({
    kind: 'consumer_research',
    market: 'VN',
    sourceKind: 'reddit_search',
    query: 'synthetic',
    maxPages: 1,
    maxRequests: 2,
    limit: 20,
  });
  assert.deepEqual(
    validateInsight(researchDraft({ input: insight, checkpoint: {} }).input),
    insight,
  );
});
test('discovery request indices are separate from result rows and preserve request timestamps', () => {
  const rows = taskCollections(
    { input: {}, checkpoint: {} },
    {
      progress: {
        rows: [{ id: 'word1', term: 'result1', status: 'collected' }],
      },
    },
    [
      {
        step: 'sem-discover:0',
        status: 'failed',
        error: 'HTTP 429',
        timing: { startedAt: '2026-10-28T01:00:00Z' },
      },
      { step: 'trend-v2:0:annual:1', status: 'done' },
    ],
  );
  assert.equal(rows[0].id, 'shared-execution');
  assert.equal(rows[0].executions[0].at, '2026-10-28T01:00:00Z');
  assert.match(rows[0].executions[0].message, /限流/);
  assert.equal(rows[1].executions[0].step, 'trend-v2:0:annual:1');
});
test('social child work prevents parent from appearing complete and exposes stopped reason', async () => {
  const job = {
    id: 'parent',
    input: { socialTrends: { sources: ['tiktok'] } },
    checkpoint: {
      keywords: [{ id: 'word', term: 'oil', market: 'VN' }],
      socialTrendDispatch: { day: '2026-10-28', accepted: 1 },
    },
  };
  const work = {
    keywordId: 'word',
    term: 'oil',
    market: 'VN',
    source: 'tiktok',
    page: 1,
    status: 'pending',
  };
  const connection = {
    query: async (sql) => ({
      rows: sql.includes('name IN')
        ? [{ name: 'keyword-trends:run:2026-10-28', value: { work: [work] } }]
        : [],
    }),
  };
  const task = {
    cloudJobId: 'parent',
    status: 'completed',
    overview: { total: 1, processed: 1, failed: 0, succeeded: 1, reason: '' },
    collections: [],
  };
  let result = (await decorateSocialTasks([task], [job], connection))[0];
  assert.equal(result.status, 'running');
  assert.equal(result.overview.percent, 50);
  assert.equal(result.collections.length, 1);
  Object.assign(work, { status: 'partial', reason: '达到分页上限' });
  result = (await decorateSocialTasks([task], [job], connection))[0];
  assert.equal(result.status, 'partial');
  assert.match(result.overview.reason, /分页上限/);
  assert.equal(result.overview.percent, 100);
});
test('a slow session probe never restores a removed session', async () => {
  const entered = deferred();
  const secret = Buffer.alloc(32, 7).toString('base64');
  const wait = deferred();
  let saved = { token: sealSession('qa.token', secret), enabled: true };
  const io = {
    secret,
    read: async () => saved,
    write: async (v) => {
      saved = v;
    },
    probe: async () => {
      entered.resolve();
      await wait.promise;
      return true;
    },
  };
  const check = westmonthSessionAction(
    { action: 'server_westmonth_session_check' },
    { role: 'admin' },
    io,
  );
  await entered.promise;
  await westmonthSessionAction(
    { action: 'server_westmonth_session_save', clear: true },
    { role: 'admin' },
    io,
  );
  wait.resolve();
  await check;
  assert.equal(saved.token, undefined);
});

test('repeat category lookup retains its exact action and budget; unknown kinds cannot submit keyword work', () => {
  const draft = researchDraft({
    input: {
      kind: 'platform_products',
      resourceCategories: true,
      routeId: 'amazon-sorftime',
      provider: 'sorftime',
      platform: 'amazon',
      market: 'US',
      query: 'vitamins',
      parentId: 'health',
      parentReceiptId: 'receipt-1',
    },
    checkpoint: {},
  });
  assert.equal(draft.action, 'server_product_resource_categories');
  assert.equal(draft.input.routeId, 'amazon-sorftime');
  assert.equal(draft.input.parentReceiptId, 'receipt-1');
  assert.deepEqual(draft.input.budget, { requests: 5, sorftimeCalls: 1 });
  assert.throws(
    () => researchDraft({ input: { kind: 'unknown_historical_kind' } }),
    /暂不支持/,
  );
});
test('Semrush site and resource journal steps attach to the exact work item and preserve stopping state', async () => {
  const sites = taskCollections(
    { input: { records: [{ term: 'one' }, { term: 'two' }] }, checkpoint: {} },
    {},
    [{ step: 'sem-sites:1:2', status: 'done' }],
  );
  assert.equal(sites[0].executions.length, 0);
  assert.equal(sites[1].executions.length, 1);
  const { createHash } = await import('node:crypto');
  const work = {
    routeId: 'website-public',
    provider: 'public_web',
    op: 'public_page',
    url: 'https://brand.test/products/1',
    page: 1,
  };
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        work.routeId,
        work.provider,
        work.op,
        work.term,
        work.category?.id,
        work.url,
        work.domain,
        work.page,
        work.cursor,
        work.productId,
      ]),
    )
    .digest('hex');
  const rows = taskCollections(
    {
      status: 'partial',
      input: { resourceDiscovery: true },
      checkpoint: {
        work: [work],
        index: 1,
        stopReasons: [{ key, status: 'unknown', message: '实际扣费未确认' }],
      },
    },
    {},
    [{ step: 'resource:' + key, status: 'failed', error: '未知扣费' }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'unknown');
  assert.equal(rows[0].executions.length, 1);
  assert.match(rows[0].message, /未确认/);
});

test('persona tasks expose exact saved acquisition and unknown billing without copying source errors', async () => {
  const { personaTaskProgress } = await import('./task-persona-progress.mjs');
  const study = {
    status: 'partial',
    reuseFrozen: true,
    plan: { sources: ['products'], budget: { requests: 3, credits: 3 } },
    queries: [
      { id: 'one', query: 'one query' },
      { id: 'two', query: 'two query' },
    ],
    journal: [
      {
        key: 'one:products',
        source: 'products',
        status: 'unknown',
        message: 'secret-must-not-leak',
      },
    ],
  };
  const progress = personaTaskProgress(study);
  assert.equal(progress.total, 3);
  assert.equal(progress.failed, 2);
  assert.equal(progress.unknownCharges, 1);
  assert.ok(!JSON.stringify(progress).includes('secret-must-not-leak'));
  const job = {
    status: 'partial',
    input: { kind: 'persona_research' },
    checkpoint: { personaProgress: progress },
  };
  assert.equal(taskOverview(job, {}).total, 3);
  assert.equal(taskCollections(job, {}).length, 3);
  const reused = personaTaskProgress({
    ...study,
    plan: { ...study.plan, budget: { requests: 0, credits: 0 } },
    journal: [],
  });
  assert.equal(reused.total, 1);
  assert.equal(reused.succeeded, 1);
  assert.match(reused.reason, /审核/);
});

test('in-flight persona requests remain running until their result becomes unknown', async () => {
  const { personaTaskProgress } = await import('./task-persona-progress.mjs');
  const study = {
    status: 'running',
    reuseFrozen: true,
    queries: [{ id: 'one', query: 'query' }],
    plan: { sources: ['products'], budget: { requests: 1, credits: 1 } },
    journal: [{ key: 'one:products', source: 'products', status: 'reserved' }],
  };
  const progress = personaTaskProgress(study);
  assert.equal(progress.rows[1].status, 'running');
  assert.equal(progress.rows[1].executions[0].status, 'started');
  assert.match(progress.rows[1].message, /等待来源响应/);
  assert.match(progress.rows[1].executions[0].message, /等待来源响应/);
  assert.equal(progress.unknownCharges, 0);
  assert.equal(progress.failed, 0);
  const stopped = personaTaskProgress({ ...study, status: 'partial' });
  assert.equal(stopped.rows[1].status, 'unknown');
  assert.equal(stopped.unknownCharges, 1);
  assert.match(stopped.rows[1].executions[0].message, /未确认/);
});
