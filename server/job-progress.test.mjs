import assert from 'node:assert/strict';
import test from 'node:test';
import {
  jobProgress,
  rateLimitDelay,
  runnableJob,
  retryRecords,
  trendNeedsRetry,
} from './job-progress.mjs';
import { runJob } from './runner.mjs';

test('retry selection uses latest saved records and excludes successful zero-baseline results', () => {
  const old = ['failed', 'daily', 'zero', 'fixed'].map((term) => ({
    term,
    market: 'US',
  }));
  const current = [
    { term: 'FAILED', market: 'US', series: [] },
    {
      term: 'daily',
      market: 'US',
      series: [10],
      trendDailyMessage: 'HTTP 429 查询失败',
    },
    {
      term: 'zero',
      market: 'US',
      series: [0],
      trendDailyMessage: '此前28天均值为0',
    },
    { term: 'fixed', market: 'US', series: [20] },
    { term: 'other', market: 'US', series: [] },
    { term: 'failed', market: 'MX', series: [] },
  ];
  assert.deepEqual(
    retryRecords(old, current).map((record) => record.term),
    ['FAILED', 'daily'],
  );
});

function fixture() {
  return {
    id: 'mock-job',
    status: 'running',
    created_at: '2026-10-16T00:00:00Z',
    updated_at: '2026-10-16T01:00:00Z',
    input: {
      seeds: ['creatine'],
      markets: ['US'],
      sources: ['sorftime'],
      depth: 1,
      limit: 3,
      sorftimeRequestLimit: 1,
    },
    checkpoint: {},
  };
}
test('queued supplementation exposes the full accepted list before the runner initializes', () => {
  const job = fixture();
  job.status = 'queued';
  job.input.seeds = [];
  job.input.sources = ['semrush'];
  job.input.limit = 34;
  job.input.existingRecords = Array.from({ length: 34 }, (_, i) => ({
    id: `id-${i}`,
    term: `creatine ${i}`,
    market: 'US',
    series: [],
  }));
  const p = jobProgress(job);
  assert.equal(p.discovered, 34);
  assert.equal(p.total, 34);
  assert.equal(p.target, 34);
  assert.equal(p.rows.length, 34);
  assert.equal(p.phase, 'queued');
});
test('historical partial tasks expose actual coverage, rate limits and terminal state', () => {
  const job = fixture();
  job.status = 'partial';
  job.checkpoint = {
    discoveryIndex: 1,
    trendIndex: 2,
    keywords: [
      {
        id: 'a',
        term: 'a',
        market: 'US',
        series: [0, 10],
        trendDailyPoints: [{ value: 10 }],
      },
      {
        id: 'b',
        term: 'b',
        market: 'US',
        series: [],
        trendMessage: 'HTTP 429',
      },
    ],
  };
  const p = jobProgress(job);
  assert.equal(p.terminal, true);
  assert.equal(p.percent, 100);
  assert.equal(p.annualAvailable, 1);
  assert.equal(p.dailyAvailable, 1);
  assert.equal(p.failed, 1);
  assert.equal(p.limited, 1);
  assert.equal(p.shortfall, 1);
});
test('zero heat and zero baseline are data outcomes, not failed requests', () => {
  const job = fixture();
  job.status = 'awaiting_review';
  job.checkpoint = {
    trendIndex: 1,
    keywords: [
      {
        term: 'zero',
        market: 'US',
        series: [0, 0],
        growth: null,
        trendDailyPoints: [{ value: 0 }],
        trendDailyMessage: '此前28天均值为0，无法计算百分比变化',
      },
    ],
  };
  assert.equal(jobProgress(job).failed, 0);
  assert.equal(jobProgress(job).noSignal, 1);
  assert.equal(trendNeedsRetry(job.checkpoint.keywords[0]), false);
});
test('waiting jobs keep real progress and queue can select other runnable jobs', () => {
  const job = fixture();
  job.checkpoint = {
    discoveryComplete: true,
    trendIndex: 0,
    nextRunAt: 200000,
    waitReason: 'rate_limit',
    rateLimitRetries: 1,
    keywords: [
      { term: 'wait', market: 'US', series: [], trendMessage: 'HTTP 429' },
    ],
  };
  const p = jobProgress(job, undefined, 100000);
  assert.equal(p.phase, 'waiting');
  assert.equal(p.processed, 0);
  assert.equal(p.rows[0].status, 'retrying');
  assert.equal(p.failed, 0);
  assert.equal(runnableJob([job], 100000), undefined);
  const next = fixture();
  assert.equal(runnableJob([job, next], 100000), next);
  assert.equal(rateLimitDelay(1), 60000);
  assert.equal(rateLimitDelay(3), 300000);
  assert.equal(rateLimitDelay(1, 180), 180000);
});

function harness() {
  let clock = 1_000_000,
    gate = {},
    saved;
  const requests = [];
  const records = new Map();
  const io = {
    now: () => clock,
    checkCancelled: async () => {},
    saveKeyword: async (record) =>
      records.set(record.term, structuredClone(record)),
    saveCheckpoint: async (job, cp, status = 'running') => {
      saved = structuredClone({
        ...job,
        checkpoint: cp,
        status,
        updated_at: new Date(clock).toISOString(),
      });
    },
    usage: async () => ({
      confirmed: requests.some((x) => x.step.startsWith('discover')) ? 1 : 0,
      reserved: 0,
    }),
    getGate: async () => gate,
    setGate: async (value) => {
      gate = value;
    },
    collect: async (job, step, request) => {
      requests.push({ step, request });
      if (step.startsWith('discover'))
        return {
          generatedAt: new Date(clock).toISOString(),
          suggestions: [
            {
              items: [{ term: 'creatine gummies', source: 'Sorftime' }],
              sources: [],
            },
          ],
        };
      return {
        generatedAt: new Date(clock).toISOString(),
        trends: [
          {
            keyword: request.keywords[0],
            market: 'US',
            series: [],
            message: 'Google Trends探索接口返回HTTP 429',
            retryAfterSeconds: 90,
          },
        ],
      };
    },
  };
  return {
    io,
    requests,
    records,
    get saved() {
      return saved;
    },
    advance: () => {
      clock = Number(saved.checkpoint.nextRunAt) + 1;
    },
  };
}
test('discovery hands trends to the independent queue without collecting them inline', async () => {
  const h = harness();
  await runJob(fixture(), h.io);
  assert.equal(h.saved.status, 'running');
  assert.equal(h.saved.checkpoint.trendQueueVersion, 1);
  assert.equal(h.saved.checkpoint.discoveryComplete, true);
  assert.equal(h.saved.checkpoint.keywords.length, 2);
  assert.equal(h.requests.length, 1);
  assert.ok(h.requests[0].step.startsWith('discover'));
  assert.equal(h.saved.checkpoint.trendWork.length, 2);
});
