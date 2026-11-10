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
          points: empty ? [] : [{ date: '2026-10', value: 123 }],
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
    fail: () => {
      failedAmount = true;
    },
    cancel: () => {
      cancel = true;
    },
    empty: () => {
      empty = true;
    },
  };
}
test('new enabled jobs save both monthly metrics, seven-day cache suppresses calls and restart is idempotent', async () => {
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
test('one monthly failure preserves previous success and records a checked time to avoid daily retries', async () => {
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
