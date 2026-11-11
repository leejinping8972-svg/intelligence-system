import assert from 'node:assert/strict';
import test from 'node:test';
import { runProductWatch } from './product-watch-store.mjs';
import { discoveryDay } from './discovery-monitor-domain.mjs';

const p = {
  id: 'US-monthly-synthetic',
  market: 'US',
  sourceMarket: 'US',
  sourcePlatform: 'Amazon',
  sourceProductId: 'B012345678',
  newProductClassifications: [{ type: 'regular_new' }],
  collectionFields: ['price'],
  price: 10,
};
function fixture() {
  const documents = new Map();
  const calls = [];
  let failedAmount = false;
  let empty = false;
  let cancel = false;
  let metricValues = { SalesVolume: 123, SalesAmount: 456 };
  const io = {
    pool: { query: async () => ({ rows: [{ cancelled: cancel }] }) },
    read: async (key) => documents.get(key),
    readProduct: async () => p,
    upsertProduct: async () => {},
    putDocument: async (_, key, value) =>
      documents.set(key, structuredClone(value)),
    saveCheckpoint: async (_, checkpoint, status) => ({ checkpoint, status }),
    collect: async (_, step, req) => {
      calls.push(step);
      if (step.includes(':detail:')) return { product: p };
      if (step.includes(':daily:'))
        return { dailySales: [{ date: '2026-11-09', value: 2 }] };
      if (failedAmount && req.monthlyMetric === 'SalesAmount')
        throw new Error('outcome unknown');
      return {
        monthlyTrend: {
          metric: req.monthlyMetric,
          currency: req.monthlyMetric === 'SalesAmount' ? 'USD' : null,
          points: empty
            ? []
            : [{ date: '2026-10', value: metricValues[req.monthlyMetric] }],
          collectedAt: new Date(io.now()).toISOString(),
        },
      };
    },
    now: () => Date.parse('2026-11-10T01:00:00+08:00'),
  };
  const job = (monthlyHistory) => ({
    id: `job-${discoveryDay(io.now())}`,
    input: {
      market: 'US',
      day: discoveryDay(io.now()),
      ...(monthlyHistory === undefined ? {} : { monthlyHistory }),
    },
    checkpoint: {
      pending: [p.id],
      index: 0,
      calls: 0,
      succeeded: 0,
      failures: [],
      logs: [],
    },
  });
  return {
    documents,
    calls,
    io,
    job,
    values: (values) => {
      metricValues = values;
    },
    fail: (value = true) => {
      failedAmount = value;
    },
    cancel: () => {
      cancel = true;
    },
    empty: () => {
      empty = true;
    },
  };
}
test('legacy enabled jobs save both monthly metrics, seven-day cache suppresses calls and restart is idempotent', async () => {
  const f = fixture();
  const first = await runProductWatch(f.job(true), f.io);
  assert.equal(first.checkpoint.succeeded, 1);
  assert.equal(f.calls.length, 4);
  assert.equal(
    f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends.SalesAmount
      .currency,
    'USD',
  );
  await runProductWatch(f.job(true), f.io);
  assert.equal(f.calls.length, 4);
  f.io.now = () => Date.parse('2026-11-11T01:00:00+08:00');
  await runProductWatch(f.job(true), f.io);
  assert.equal(f.calls.length, 6);
  f.io.now = () => Date.parse('2026-11-17T01:00:00+08:00');
  await runProductWatch(f.job(true), f.io);
  assert.equal(f.calls.length, 10);
});

test('new watch cadence refreshes both monthly metrics each day and preserves successful data on an unknown request', async () => {
  const f = fixture();
  const job = () => {
    const current = f.job(true);
    current.input.monthlyHistoryCadence = 'watch';
    return current;
  };
  await runProductWatch(job(), f.io);
  const first = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends;
  assert.equal(f.calls.length, 4);
  assert.equal(first.SalesAmount.points[0].value, 456);
  await runProductWatch(job(), f.io);
  assert.equal(f.calls.length, 4);
  // A new daily observation refreshes even less than 24 hours after the prior one.
  f.values({ SalesVolume: 0, SalesAmount: 0 });
  f.io.now = () => Date.parse('2026-11-11T00:30:00+08:00');
  await runProductWatch(job(), f.io);
  let history = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends;
  assert.equal(f.calls.length, 8);
  assert.equal(history.SalesVolume.points[0].value, 0);
  assert.equal(history.SalesAmount.points[0].value, 0);
  assert.notEqual(
    history.SalesAmount.collectedAt,
    first.SalesAmount.collectedAt,
  );
  const lastSuccess = structuredClone(history.SalesAmount);
  f.fail();
  f.values({ SalesVolume: 12, SalesAmount: 90 });
  f.io.now = () => Date.parse('2026-11-12T01:00:00+08:00');
  const failed = await runProductWatch(job(), f.io);
  history = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends;
  assert.equal(f.calls.length, 12);
  assert.equal(history.SalesVolume.points[0].value, 12);
  assert.deepEqual(history.SalesAmount.points, lastSuccess.points);
  assert.equal(history.SalesAmount.collectedAt, lastSuccess.collectedAt);
  assert.match(history.SalesAmount.error, /outcome unknown/);
  assert.equal(failed.checkpoint.failures.length, 1);
  await runProductWatch(job(), f.io);
  assert.equal(f.calls.length, 12);
  f.fail(false);
  f.io.now = () => Date.parse('2026-11-13T01:00:00+08:00');
  await runProductWatch(job(), f.io);
  history = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends;
  assert.equal(f.calls.length, 16);
  assert.equal(history.SalesAmount.points[0].value, 90);
  assert.equal(history.SalesAmount.error, undefined);
});
test('legacy and disabled jobs never add monthly calls, enabled history remains visible when disabled', async () => {
  const f = fixture();
  await runProductWatch(f.job(), f.io);
  assert.equal(f.calls.length, 2);
  f.io.now = () => Date.parse('2026-11-11T01:00:00+08:00');
  await runProductWatch(f.job(true), f.io);
  assert.equal(f.calls.length, 6);
  f.io.now = () => Date.parse('2026-11-19T01:00:00+08:00');
  await runProductWatch(f.job(false), f.io);
  assert.equal(f.calls.length, 8);
  assert.equal(
    f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends.SalesVolume
      .points.length,
    1,
  );
});
test('legacy monthly failure preserves previous success and its seven-day retry interval', async () => {
  const f = fixture();
  await runProductWatch(f.job(true), f.io);
  const previous = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends
    .SalesAmount;
  f.fail();
  f.io.now = () => Date.parse('2026-11-17T01:00:00+08:00');
  const result = await runProductWatch(f.job(true), f.io);
  const history = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends;
  assert.deepEqual(history.SalesAmount.points, previous.points);
  assert.equal(history.SalesAmount.collectedAt, previous.collectedAt);
  assert.match(history.SalesAmount.error, /outcome unknown/);
  assert.equal(result.checkpoint.failures.length, 1);
  f.io.now = () => Date.parse('2026-11-18T01:00:00+08:00');
  await runProductWatch(f.job(true), f.io);
  assert.equal(f.calls.length, 10);
});
test('cancelled jobs make no source requests', async () => {
  const f = fixture();
  f.cancel();
  const result = await runProductWatch(f.job(true), f.io);
  assert.equal(result.status, 'cancelled');
  assert.equal(f.calls.length, 0);
});

test('empty refresh never erases previously collected history', async () => {
  const f = fixture();
  await runProductWatch(f.job(true), f.io);
  const previous = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends
    .SalesVolume;
  f.empty();
  f.io.now = () => Date.parse('2026-11-17T01:00:00+08:00');
  await runProductWatch(f.job(true), f.io);
  const latest = f.documents.get(`product-watch:latest:${p.id}`).monthlyTrends
    .SalesVolume;
  assert.deepEqual(latest.points, previous.points);
  assert.equal(latest.collectedAt, previous.collectedAt);
  assert.equal(latest.empty, true);
});
