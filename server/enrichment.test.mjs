import test from 'node:test';
import assert from 'node:assert/strict';
import { runEnrichment, validateEnrichment } from './enrichment-jobs.mjs';
import {
  csvRows,
  reportRows,
  rowMetrics,
  mcpPayload,
} from './semrush-reports.mjs';
import { runJob, jobTasks } from './runner.mjs';
import { runTrendJob } from './trend-queue.mjs';
import { assessKeyword } from './model.js';
import { validateJob } from './domain.mjs';

test('one supplementation job refreshes Semrush and Trends without expansion or repeating metrics after a cooldown', async () => {
  const at = new Date().toISOString();
  const points = Array.from({ length: 53 }, (_, i) => ({
    date: new Date(Date.now() - (52 - i) * 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    value: 50,
  }));
  const r = {
    id: 'existing',
    term: 'creatine gummies',
    market: 'US',
    category: '运动营养',
    source: 'Google 联想词',
    series: [],
    siteIds: ['saved-site'],
    productIds: [],
    favorite: true,
    reviewStatus: 'selected',
    reviewNote: '保留人工决定',
  };
  const j = {
    id: 'unified',
    status: 'queued',
    created_at: at,
    input: validateJob({
      seeds: [],
      markets: ['US'],
      sources: ['semrush'],
      limit: 1,
      existingRecords: [r],
    }),
    checkpoint: {},
  };
  let now = Date.now(),
    gate = { until: now + 60000 },
    saved;
  const calls = [];
  const io = {
    now: () => now,
    checkCancelled: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    getGate: async () => gate,
    setGate: async (value) => {
      gate = value;
    },
    saveKeyword: async (record) => record,
    patchCollection: async () => {},
    saveCheckpoint: async (job, cp, status = 'running') => {
      saved = structuredClone({ ...job, checkpoint: cp, status });
    },
    collect: async (_job, step, request) => {
      calls.push({ step, request });
      if (step.startsWith('sem-metric'))
        return {
          complete: true,
          metrics: {
            market: 'US',
            source: 'Semrush MCP',
            collectedAt: at,
            monthlySearchVolume: 60500,
            difficulty: 29,
          },
          apiUnits: 0,
        };
      if (step.startsWith('trend'))
        return {
          status: 'success',
          phase: request.trendPhase,
          keyword: r.term,
          market: 'US',
          points,
          resolution: request.trendPhase === 'daily' ? 'day' : 'week',
          collectedAt: at,
          message: '已采集',
        };
      throw new Error('补齐任务不应扩词或抓站点');
    },
  };
  await runJob(j, io);
  assert.deepEqual(
    calls.map((c) => c.step),
    ['sem-metric:0'],
  );
  assert.equal(saved.checkpoint.metricIndex, 1);
  now = gate.until + 1;
  await runTrendJob(saved, io);
  now = gate.until + 1;
  await runTrendJob(saved, io);
  assert.deepEqual(
    calls.map((c) => c.step),
    ['sem-metric:0', 'trend-v2:0:annual:1', 'trend-v2:0:daily:1'],
  );
  assert.equal(saved.status, 'awaiting_review');
  assert.equal(assessKeyword(saved.checkpoint.keywords[0]).status, 'rated');
  assert.deepEqual(saved.checkpoint.keywords[0].siteIds, ['saved-site']);
  assert.equal(saved.checkpoint.keywords[0].reviewStatus, 'selected');
  assert.equal(saved.checkpoint.keywords[0].reviewNote, '保留人工决定');
  assert.match(jobTasks(saved)[0].title, /数据补齐与重评/);
});

const record = (id = 'a') => ({
  id,
  term: `creatine gummies ${id}`,
  market: 'US',
  reviewStatus: 'selected',
  category: '运动营养',
  source: 'Google 联想词',
  series: [],
  growth: null,
  siteIds: [],
  productIds: [],
});
const job = (records, kind = 'sites', checkpoint = {}) => ({
  id: 'job',
  input: {
    kind,
    records,
    keywordIds: records.map((r) => r.id),
    markets: ['US'],
    maxSites: 2,
  },
  checkpoint,
});
function harness(records) {
  const changes = [],
    sites = [],
    saves = [],
    calls = [];
  return {
    changes,
    sites,
    saves,
    calls,
    io: {
      readKeyword: async (id) => records.find((r) => r.id === id),
      patchCollection: async (...args) => changes.push(args),
      saveSite: async (s) => sites.push(s),
      saveCheckpoint: async (_j, cp, status = 'running') =>
        saves.push({ cp: structuredClone(cp), status }),
      isCancelled: async () => false,
      collect: async (_j, step, request) => {
        calls.push({ step, request });
        return {
          groups: [
            {
              keyword: request.keywords[0],
              market: 'US',
              coverage: { searchResults: 3, candidateDomains: 3 },
              sites: [
                {
                  id: 'site-a',
                  domain: 'a.example',
                  products: [{ id: 'must-not-save' }],
                },
              ],
            },
          ],
        };
      },
    },
  };
}
test('accepts 100 selected words but rejects invalid targets and unsupported kinds', () => {
  assert.equal(
    validateEnrichment({
      kind: 'sites',
      keywordIds: Array.from({ length: 100 }, (_, i) => String(i)),
      maxSites: 10,
    }).keywordIds.length,
    100,
  );
  for (const input of [
    { kind: 'sites', keywordIds: [] },
    { kind: 'sites', keywordIds: ['x'], maxSites: 11 },
    { kind: 'oops', keywordIds: ['x'] },
  ])
    assert.throws(() => validateEnrichment(input));
});
test('site collection is real source only, journals per word, preserves products for a later phase', async () => {
  const records = [record()];
  const h = harness(records);
  await runEnrichment(job(records), h.io);
  assert.deepEqual(h.calls[0].request.sources, ['site_discovery']);
  assert.equal(h.calls[0].request.sorftimeRequestLimit, 0);
  assert.equal(h.sites.length, 1);
  assert.equal(h.sites[0].products, undefined);
  const result = h.changes.at(-1);
  assert.equal(result[2].status, 'partial');
  assert.deepEqual(result[3].siteIds, ['site-a']);
  assert.match(result[2].message, /1\/2/);
  assert.equal(h.saves.at(-1).status, 'partial');
});
test('queue resumes at cursor and processes all 100 without repeating committed words', async () => {
  const records = Array.from({ length: 100 }, (_, i) => record(String(i)));
  const h = harness(records);
  await runEnrichment(job(records, 'sites', { index: 99 }), h.io);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].step, 'sites:99');
  assert.equal(h.saves.at(-1).cp.index, 100);
  const full = harness(records);
  await runEnrichment(job(records), full.io);
  assert.equal(full.calls.length, 100);
  assert.equal(new Set(full.calls.map((c) => c.step)).size, 100);
});
test('empty verified results are not labelled completed; unselected words never issue requests', async () => {
  const records = [record(), { ...record('b'), reviewStatus: 'pending' }];
  const h = harness(records);
  h.io.collect = async (_j, _step, r) => ({
    groups: [{ keyword: r.keywords[0], market: 'US', sites: [] }],
  });
  await runEnrichment(job(records), h.io);
  assert.equal(h.changes.find((c) => c[2].status === 'empty')[2].count, 0);
  assert.ok(h.changes.some((c) => c[0] === 'b' && c[2].status === 'cancelled'));
});
test('cancellation during fetch retains obtained sites and never reports success', async () => {
  const records = [record(), record('b')];
  const h = harness(records);
  let checked = 0;
  h.io.isCancelled = async () => ++checked > 1;
  await runEnrichment(job(records), h.io);
  assert.equal(h.calls.length, 1);
  assert.equal(h.sites.length, 1);
  assert.equal(h.changes.at(-1)[2].status, 'cancelled');
  assert.equal(h.saves.at(-1).status, 'cancelled');
});
test('Semrush failure stops subsequent paid queries and marks every remaining term explicitly', async () => {
  const records = [record(), record('b')];
  const h = harness(records);
  let calls = 0;
  h.io.collect = async () => {
    calls++;
    throw new Error('Semrush HTTP 403: permission');
  };
  await runEnrichment(job(records, 'metrics'), h.io);
  assert.equal(calls, 1);
  assert.equal(h.changes.filter((c) => c[2].status === 'failed').length, 2);
  assert.equal(h.saves.at(-1).status, 'partial');
});
test('partial Semrush fields stay partial instead of claiming all scoring evidence is complete', async () => {
  const records = [record()];
  const h = harness(records);
  h.io.collect = async () => ({
    metrics: { market: 'US', source: 'Semrush', monthlySearchVolume: 100 },
    complete: false,
  });
  await runEnrichment(job(records, 'metrics'), h.io);
  assert.equal(h.changes.at(-1)[2].status, 'partial');
  assert.equal(h.saves.at(-1).status, 'partial');
});
test('official CSV header maps KD accurately, while advertising competition and blank intent stay distinct', () => {
  const [row] = reportRows({
    data: 'Keyword;Search Volume;Keyword Difficulty Index;CPC;Competition;Intent\ncreatine gummies;60500;29;2.36;1;\n',
  });
  const metrics = rowMetrics(row, 'US', '2026-10-16');
  assert.equal(metrics.monthlySearchVolume, 60500);
  assert.equal(metrics.difficulty, 29);
  assert.equal(metrics.advertisingCompetition, 1);
  assert.equal(metrics.intent, undefined);
  assert.equal(
    rowMetrics(
      {
        'Search Volume': '',
        'Keyword Difficulty Index': '-',
        Competition: '0.9',
      },
      'US',
      '2026-10-16',
    ).difficulty,
    undefined,
  );
  assert.equal(
    csvRows('Keyword;Search Volume\n"gut; health";0')[0].Keyword,
    'gut; health',
  );
  assert.throws(
    () =>
      mcpPayload({
        isError: true,
        content: [{ type: 'text', text: 'denied' }],
      }),
    /denied/,
  );
});
test('research pipeline merges Semrush and free suggestions with hard limit, then supplements metrics before trends', async () => {
  const j = {
    id: 'job',
    input: {
      seeds: ['creatine gummies'],
      markets: ['US'],
      sources: ['semrush', 'google_autocomplete'],
      limit: 3,
      depth: 1,
    },
    checkpoint: {},
  };
  const calls = [],
    saved = [],
    patches = [];
  let checkpoint;
  await runJob(j, {
    collect: async (_j, step, r) => {
      calls.push({ step, r });
      if (step.startsWith('sem-discover'))
        return {
          generatedAt: '2026-10-16',
          suggestions: [
            {
              items: [
                { term: 'creatine gummy', source: 'Semrush phrase_related' },
              ],
            },
          ],
        };
      if (step.startsWith('discover'))
        return {
          generatedAt: '2026-10-16',
          suggestions: [
            {
              items: [
                { term: 'creatine gummy', source: 'Google 联想词' },
                {
                  term: 'creatine gummies sugar free',
                  source: 'Google 联想词',
                },
                { term: 'overflow', source: 'Google 联想词' },
              ],
            },
          ],
        };
      return {
        metrics: {
          market: 'US',
          source: 'Semrush',
          collectedAt: '2026-10-16',
          monthlySearchVolume: 1000,
          difficulty: 30,
        },
        apiUnits: 10,
      };
    },
    saveKeyword: async (r) => saved.push(structuredClone(r)),
    patchCollection: async (...a) => patches.push(a),
    saveCheckpoint: async (_j, cp) => {
      checkpoint = structuredClone(cp);
    },
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    checkCancelled: async () => {},
    getGate: async () => ({ until: Date.now() + 60000 }),
    setGate: async () => {},
  });
  assert.equal(checkpoint.keywords.length, 3);
  assert.equal(checkpoint.metricIndex, 3);
  assert.equal(calls.filter((c) => c.step.startsWith('sem-metric')).length, 3);
  assert.equal(patches.filter((p) => p[2].status === 'completed').length, 3);
  assert.match(
    checkpoint.keywords.find((k) => k.term === 'creatine gummy').source,
    /Semrush.*Google/,
  );
  assert.ok(calls.every((c) => !c.r.sources.includes('site_discovery')));
});
test('v2 scoring requires volume and trends, KD alone completes competition, no Similarweb placeholder required', () => {
  const at = new Date().toISOString();
  const points = Array.from({ length: 53 }, (_, i) => ({
    date: new Date(Date.now() - (52 - i) * 7 * 86400000)
      .toISOString()
      .slice(0, 10),
    value: 50,
  }));
  const k = {
    ...record(),
    trendCollectedAt: at,
    trendPoints: points,
    metrics: {
      market: 'US',
      source: 'Semrush MCP',
      collectedAt: at,
      monthlySearchVolume: 60500,
      difficulty: 29,
    },
  };
  const a = assessKeyword(k);
  assert.equal(a.version, 'keyword-research-v2.0');
  assert.equal(a.coverage, 100);
  assert.equal(a.status, 'rated');
  assert.equal(a.dimensions.find((d) => d.key === 'competition').score, 71);
  assert.equal(assessKeyword({ ...k, metrics: undefined }).score, null);
  assert.equal(
    assessKeyword({ ...k, metrics: { ...k.metrics, monthlySearchVolume: 0 } })
      .score <= 49,
    true,
  );
  assert.equal(
    assessKeyword({ ...k, metrics: { ...k.metrics, market: 'VN' } }).score,
    null,
  );
  assert.equal(
    assessKeyword({ ...k, trendPoints: [{ date: at, value: 100 }] }).score,
    null,
  );
  assert.equal(
    assessKeyword({ ...k, trendCollectedAt: '2020-01-01' }).score,
    null,
  );
  assert.equal(
    assessKeyword({
      ...k,
      metrics: {
        ...k.metrics,
        difficulty: undefined,
        advertisingCompetition: 0.1,
      },
    }).dimensions.find((d) => d.key === 'competition').score,
    null,
  );
});
test('site tasks appear as site stage without keyword progress assumptions', () => {
  const t = jobTasks({
    ...job([record()]),
    status: 'queued',
    created_at: new Date(),
  })[0];
  assert.equal(t.stage, 'sites');
  assert.match(t.title, /独立站/);
  assert.equal(t.progress, undefined);
});
