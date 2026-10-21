import assert from 'node:assert/strict';
import test from 'node:test';

import { jobProgress, trendNeedsRetry } from './job-progress.mjs';
import { collectTrendPart } from './trend-provider.mjs';
import {
  initializeTrendQueue,
  nextTrendPart,
  refreshTrendCheckpoint,
  retryDelay,
  runTrendJob,
  TREND_WINDOW,
} from './trend-queue.mjs';

test('new submissions collect comparison history while existing queues keep their saved steps', () => {
  const checkpoint = {
    keywords: [
      {
        term: 'a',
        market: 'US',
        series: [10],
        trendPoints: [{ date: '2026-10-01', value: 10 }],
      },
    ],
  };
  assert.equal(
    initializeTrendQueue(checkpoint, 1000).trendWork[0].annual.status,
    'done',
  );
  const next = initializeTrendQueue(checkpoint, 1000, 2);
  assert.equal(next.trendWork[0].annual.status, 'pending');
  assert.deepEqual(initializeTrendQueue(next, 2000, 2), next);
});

test('annual comparison collection preserves two-year history in one request and keeps the visible one-year curve', async () => {
  let calls = 0;
  const at = Date.parse('2026-10-20T00:00:00Z');
  const history = Array.from({ length: 106 }, (_, i) => ({
    date: new Date(at - (106 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
    value: 50,
  }));
  const fetcher = async (_terms, _market, period, options) => {
    calls++;
    assert.equal(period, '2024-10-12 2026-10-20');
    assert.equal(options.includeInsights, true);
    return [
      {
        points: history,
        resolution: 'week',
        collectedAt: new Date(at).toISOString(),
      },
    ];
  };
  const result = await collectTrendPart(
    {
      keywords: ['a'],
      markets: ['US'],
      trendPhase: 'annual',
      trendComparisonVersion: 2,
    },
    fetcher,
    at,
  );
  assert.equal(calls, 1);
  assert.equal(result.historyPoints.length, 106);
  assert.ok(result.points.length >= 52 && result.points.length <= 54);
  assert.equal(result.status, 'success');
  let legacyPeriod;
  await collectTrendPart(
    { keywords: ['a'], markets: ['US'], trendPhase: 'annual' },
    async (_a, _b, p, options) => {
      legacyPeriod = p;
      assert.equal(options.includeInsights, true);
      return [{ points: [], resolution: 'week' }];
    },
    at,
  );
  assert.equal(legacyPeriod, 'today 12-m');
});

function harness(terms = ['a', 'b']) {
  let clock = Date.now();
  let gate = {};
  let saved;
  const records = new Map();
  const requests = [];
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
    ...(req.trendPhase === 'annual'
      ? {
          regions: [{ code: 'US-CA', name: 'California', value: 100 }],
          relatedTop: [
            { query: 'creatine benefits', value: 100, formattedValue: '100' },
          ],
          relatedRising: [
            {
              query: 'creatine gummies',
              value: 120,
              formattedValue: '+120%',
            },
          ],
          insightsStatus: 'collected',
          insightsMessage: '',
        }
      : {}),
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
    600_000,
  );
  assert.equal(
    retryDelay(2, 0, () => 0),
    300_000,
  );
  assert.ok(retryDelay(1, 600, () => 0.5) > 600_000);
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
  assert.equal(h.gate.until, h.now + 180_000);
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
  assert.equal(h.saved.checkpoint.keywords[0].trendRegions[0].code, 'US-CA');
  assert.equal(
    h.saved.checkpoint.keywords[0].trendRelatedRising[0].query,
    'creatine gummies',
  );
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
  const got = await collectTrendPart(request, async (k, m, period, options) => {
    periods.push(period);
    assert.equal(options.includeInsights, false);
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

test('new queue persists comparison history and calculates30-day growth without refetching annual after resume', async () => {
  const h = harness(['a']);
  h.job.input.trendComparisonVersion = 2;
  const end = Math.floor(h.now / 86_400_000) * 86_400_000;
  const point = (count, step, value) =>
    Array.from({ length: count }, (_, i) => ({
      date: new Date(end - (count - i) * step * 86_400_000)
        .toISOString()
        .slice(0, 10),
      value: typeof value === 'function' ? value(i) : value,
    }));
  const history = point(106, 7, 40);
  h.io.collect = async (_job, key, req) => {
    h.requests.push({ key, req });
    return {
      ...h.result(req),
      points:
        req.trendPhase === 'annual'
          ? history.slice(-53)
          : point(60, 1, (i) => (i < 30 ? 40 : 60)),
      ...(req.trendPhase === 'annual'
        ? { historyPoints: history, period: 'synthetic-two-year-range' }
        : {}),
    };
  };
  await runTrendJob(h.job, h.io);
  assert.equal(h.records.get('a').trendHistoryPoints.length, 106);
  assert.equal(h.requests[0].req.trendComparisonVersion, 2);
  h.advance();
  await runTrendJob(h.saved, h.io);
  assert.equal(h.records.get('a').growth, 50);
  assert.equal(
    h.requests.filter((r) => r.req.trendPhase === 'annual').length,
    1,
  );
  assert.equal(h.saved.status, 'awaiting_review');
});
