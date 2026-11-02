import assert from 'node:assert/strict';
import test from 'node:test';
import {
  initializeTrendQueue,
  nextTrendPart,
  refreshTrendCheckpoint,
  retryDelay,
  runTrendJob,
  TREND_WINDOW,
} from './trend-queue.mjs';
import { collectTrendPart } from './trend-provider.mjs';
import { jobProgress, trendNeedsRetry } from './job-progress.mjs';

function harness(terms = ['a', 'b']) {
  let clock = Date.now(),
    gate = {},
    saved;
  const requests = [],
    records = new Map();
  const job = {
    id: 'test',
    status: 'running',
    input: {
      existingRecords: [],
      sources: ['semrush'],
      limit: terms.length,
      seeds: [],
      markets: ['US'],
    },
    checkpoint: initializeTrendQueue(
      {
        metricIndex: terms.length,
        semUnits: 100,
        keywords: terms.map((term) => ({
          id: term,
          term,
          market: 'US',
          series: [],
        })),
        logs: [],
      },
      clock,
    ),
  };
  const result = (req) => ({
    status: 'success',
    phase: req.trendPhase,
    market: 'US',
    keyword: req.keywords[0],
    points: [{ date: '2026-10-01', value: 20 }],
    resolution: req.trendPhase === 'daily' ? 'day' : 'week',
    collectedAt: new Date(clock).toISOString(),
    message: '',
    sourceUrl: 'https://trends.google.com/',
  });
  const io = {
    now: () => clock,
    random: () => 0,
    checkCancelled: async () => {},
    getGate: async () => gate,
    setGate: async (v) => {
      gate = v;
    },
    saveKeyword: async (r) => {
      records.set(r.term, structuredClone(r));
      return r;
    },
    saveCheckpoint: async (j, cp, status = 'running') => {
      saved = structuredClone({ ...j, checkpoint: cp, status });
    },
    collect: async (j, key, req) => {
      requests.push({ key, req });
      return result(req);
    },
  };
  return {
    job,
    io,
    result,
    requests,
    records,
    get saved() {
      return saved;
    },
    get gate() {
      return gate;
    },
    get now() {
      return clock;
    },
    advance: (ms) => {
      clock +=
        ms ??
        Math.max(
          1,
          (saved?.checkpoint.nextRunAt || gate.until || clock) - clock + 1,
        );
    },
  };
}
test('Retry-After is a minimum; jitter never causes an early request', () => {
  assert.equal(
    retryDelay(1, 600, () => 0),
    600000,
  );
  assert.equal(
    retryDelay(2, 0, () => 0),
    300000,
  );
  assert.ok(retryDelay(1, 600, () => 0.5) > 600000);
  assert.ok(Number.isFinite(retryDelay(1, Infinity)));
});
test('429 queues only the failed step; no request during provider cooldown; other pending work advances first', async () => {
  const h = harness();
  let first = true;
  h.io.collect = async (j, key, req) => {
    h.requests.push({ key, req });
    if (first) {
      first = false;
      return {
        status: 'error',
        message: 'HTTP 429',
        httpStatus: 429,
        retryAfterSeconds: 180,
      };
    }
    return h.result(req);
  };
  await runTrendJob(h.job, h.io);
  assert.equal(h.saved.status, 'running');
  assert.equal(h.saved.checkpoint.trendWork[0].annual.status, 'retry_wait');
  assert.equal(h.saved.checkpoint.waitReason, 'rate_limit');
  assert.equal(h.gate.until, h.now + 180000);
  await runTrendJob(h.saved, h.io);
  assert.equal(h.requests.length, 1);
  h.advance();
  await runTrendJob(h.saved, h.io);
  assert.equal(h.requests[1].req.trendPhase, 'daily');
  assert.equal(h.requests[1].req.keywords[0], 'a');
  const p = jobProgress(h.saved, undefined, h.now);
  assert.equal(p.retryPending, 1);
  assert.equal(p.notStarted, 1);
  assert.equal(p.terminal, false);
  assert.equal(p.retryLimit, 5);
});
test('network failure does not pause provider and later words finish while first word waits', async () => {
  const h = harness();
  h.io.collect = async (j, key, req) => {
    h.requests.push({ key, req });
    if (req.keywords[0] === 'a' && req.trendPhase === 'annual')
      throw new Error('fetch failed');
    return h.result(req);
  };
  await runTrendJob(h.job, h.io);
  assert.equal(h.gate.until, undefined);
  for (let i = 0; i < 4; i++) {
    h.advance();
    await runTrendJob(h.saved, h.io);
  }
  assert.equal(h.saved.checkpoint.trendWork[1].daily.status, 'done');
  assert.ok(h.saved.checkpoint.trendWork[0].annual.attempts >= 1);
});
test('successful annual series is not fetched again after daily retry or process restart', async () => {
  const h = harness(['a']);
  let daily = 0;
  h.io.collect = async (j, key, req) => {
    h.requests.push({ key, req });
    if (req.trendPhase === 'daily' && daily++ === 0)
      return { status: 'error', message: 'HTTP 503', httpStatus: 503 };
    return h.result(req);
  };
  await runTrendJob(h.job, h.io);
  h.advance();
  await runTrendJob(h.saved, h.io);
  assert.equal(h.saved.checkpoint.trendWork[0].daily.status, 'retry_wait');
  assert.equal(h.saved.checkpoint.keywords[0].series.length, 1);
  h.advance();
  await runTrendJob(structuredClone(h.saved), h.io);
  assert.equal(h.saved.status, 'awaiting_review');
  assert.equal(h.saved.checkpoint.semUnits, 100);
  assert.equal(
    h.requests.filter((r) => r.req.trendPhase === 'annual').length,
    1,
  );
  assert.equal(trendNeedsRetry(h.saved.checkpoint.keywords[0]), false);
  assert.equal(jobProgress(h.saved).succeeded, 1);
});
test('persisted running attempt reuses its request journal key after restart', async () => {
  const h = harness(['a']);
  const cp = h.job.checkpoint;
  Object.assign(cp.trendWork[0].annual, { status: 'running', attempts: 1 });
  await runTrendJob(h.job, h.io);
  assert.equal(h.requests[0].key, 'trend-v2:0:annual:1');
  assert.equal(h.saved.checkpoint.trendWork[0].annual.attempts, 1);
});
test('max five automatic retries leads to manual attention while retaining the other period', async () => {
  const h = harness(['a']);
  h.io.collect = async (j, key, req) => {
    h.requests.push({ key, req });
    if (req.trendPhase === 'annual')
      return { status: 'error', message: 'HTTP 503', httpStatus: 503 };
    return h.result(req);
  };
  await runTrendJob(h.job, h.io);
  for (let i = 0; i < 8 && h.saved.status === 'running'; i++) {
    h.advance();
    await runTrendJob(h.saved, h.io);
  }
  assert.equal(h.saved.status, 'partial');
  assert.equal(h.saved.checkpoint.trendWork[0].annual.attempts, 6);
  assert.equal(
    h.requests.filter((r) => r.req.trendPhase === 'daily').length,
    1,
  );
  assert.equal(jobProgress(h.saved).needsAttention, 1);
});
test('24 hour expiry is terminal and makes no further request', async () => {
  const h = harness();
  h.advance(TREND_WINDOW + 1);
  await runTrendJob(h.job, h.io);
  assert.equal(h.requests.length, 0);
  assert.equal(h.saved.status, 'partial');
  assert.equal(h.saved.checkpoint.trendAttention, 2);
});
test('migrating the existing 100-word task preserves 12 completed words and all paid metrics', () => {
  const cp = {
    trendIndex: 12,
    metricIndex: 100,
    semUnits: 1520,
    rateLimitRetries: 4,
    keywords: Array.from({ length: 100 }, (_, i) => ({
      term: `word${i}`,
      market: 'US',
      series: i < 12 ? [10] : [],
      trendDailyPoints: i < 12 ? [{ date: '2026-10-01', value: 10 }] : [],
      trendMessage: i === 12 ? 'HTTP 429' : '',
    })),
    finishedAt: 'old',
  };
  const migrated = initializeTrendQueue(cp, 1000);
  assert.equal(cp.finishedAt, 'old');
  assert.equal(migrated.finishedAt, undefined);
  assert.equal(migrated.semUnits, 1520);
  assert.equal(migrated.metricIndex, 100);
  assert.equal(
    migrated.trendWork.filter(
      (w) => w.annual.status === 'done' && w.daily.status === 'done',
    ).length,
    12,
  );
  assert.equal(nextTrendPart(migrated, 1000).index, 12);
  assert.equal(nextTrendPart(migrated, 1000).phase, 'daily');
  refreshTrendCheckpoint(migrated, {}, 1000);
  assert.equal(migrated.trendIndex, 12);
});
test('provider makes one period request, excludes partial days and preserves 429 metadata', async () => {
  const request = { keywords: ['a'], markets: ['US'], trendPhase: 'daily' };
  const periods = [];
  const got = await collectTrendPart(request, async (k, m, period) => {
    periods.push(period);
    return [
      {
        points: [
          { date: '2026-10-01', value: 10 },
          { date: '2026-10-02', value: 20, isPartial: true },
        ],
        resolution: 'day',
      },
    ];
  });
  assert.deepEqual(periods, ['today 3-m']);
  assert.equal(got.points.length, 1);
  const limited = await collectTrendPart(request, async () => {
    throw Object.assign(new Error('HTTP 429'), {
      status: 429,
      retryAfterSeconds: 600,
    });
  });
  assert.equal(limited.httpStatus, 429);
  assert.equal(limited.retryAfterSeconds, 600);
});
test('zero or empty real responses finish without retry; wrong resolution needs manual attention', async () => {
  const h = harness(['zero']);
  h.io.collect = async (j, key, req) => ({
    ...h.result(req),
    points: [],
    status: 'empty',
  });
  await runTrendJob(h.job, h.io);
  h.advance();
  await runTrendJob(h.saved, h.io);
  assert.equal(h.saved.status, 'awaiting_review');
  assert.equal(trendNeedsRetry(h.saved.checkpoint.keywords[0]), false);
  const bad = await collectTrendPart(
    { keywords: ['a'], markets: ['US'], trendPhase: 'daily' },
    async () => [
      { points: [{ date: '2026-10-01', value: 1 }], resolution: 'week' },
    ],
  );
  assert.equal(bad.status, 'error');
});
