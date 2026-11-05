import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import {
  createUsageSnapshotReader,
  decodeUsageSnapshot,
  encodeUsageSnapshot,
} from './source-usage-snapshot.mjs';
import { sourceUsageAction } from './source-usage.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const event = (id, amount = 1) => ({
  id,
  sourceId: 'sorftime',
  amount,
  billing: 'confirmed',
  at: new Date().toISOString(),
  day: new Date().toISOString().slice(0, 10),
  jobId: 'fixture',
  task: '商品研究',
  step: 'detail',
  market: 'US',
  request: {
    startedAt: new Date(Date.now() - 1000).toISOString(),
    host: 'fixture.test',
    path: '/product',
    outcome: 'success',
  },
});

test('concurrent cold panels share one hydration and full journal read; filtering reuses the completed snapshot', async () => {
  const pending = deferred();
  let loads = 0,
    reads = 0;
  const connection = {};
  const cache = createUsageSnapshotReader({
    load: async () => {
      loads++;
    },
    read: () => {
      reads++;
      return pending.promise;
    },
  });
  const a = cache(connection),
    b = cache(connection);
  await setImmediate();
  assert.equal(loads, 1);
  assert.equal(reads, 1);
  pending.resolve([event('a')]);
  const results = await Promise.all([a, b]);
  assert.equal(results[0].events, results[1].events);
  assert.equal((await cache(connection)).events, results[0].events);
  assert.equal(reads, 1);
});

test('a saved complete snapshot is immediately readable after restart and a slow refresh cannot blank its totals', async () => {
  let clock = Date.now();
  const initial = {
    events: [event('a', 7)],
    checkedAt: new Date(clock).toISOString(),
  };
  const saved = await encodeUsageSnapshot(initial);
  const pending = deferred();
  let reads = 0;
  const cache = createUsageSnapshotReader({
    now: () => clock,
    load: async () => saved,
    read: () => {
      reads++;
      return pending.promise;
    },
  });
  const connection = {};
  const ready = await cache(connection);
  assert.deepEqual(ready.events, initial.events);
  assert.equal(reads, 0);
  clock += 31_000;
  const stale = await cache(connection);
  assert.equal(stale.refreshing, true);
  assert.equal(stale.checkedAt, initial.checkedAt);
  assert.deepEqual(stale.events, initial.events);
  await cache(connection, { refresh: true });
  assert.equal(reads, 1);
  pending.resolve([event('b', 9)]);
  await setImmediate();
  const updated = await cache(connection);
  assert.equal(updated.refreshing, false);
  assert.equal(updated.events[0].amount, 9);
  assert.equal(updated.checkedAt, new Date(clock).toISOString());
});

test('refresh failures keep their timestamp and confirmed/unknown distinction and do not trigger a retry storm', async () => {
  let clock = Date.now();
  const initial = {
    events: [
      event('known', 0),
      { ...event('unknown'), amount: null, billing: 'unknown' },
    ],
    checkedAt: new Date(clock).toISOString(),
  };
  let reads = 0;
  const cache = createUsageSnapshotReader({
    now: () => clock,
    load: async () => encodeUsageSnapshot(initial),
    read: async () => {
      reads++;
      throw new Error('private upstream details');
    },
  });
  const connection = {};
  await cache(connection, { refresh: true });
  await setImmediate();
  const failed = await cache(connection);
  assert.deepEqual(failed.events, initial.events);
  assert.equal(failed.checkedAt, initial.checkedAt);
  assert.match(failed.refreshError, /上次结果/);
  assert.equal(
    JSON.stringify(failed).includes('private upstream details'),
    false,
  );
  await cache(connection, { refresh: true });
  assert.equal(reads, 1);
  clock += 5001;
  await cache(connection, { refresh: true });
  await setImmediate();
  assert.equal(reads, 2);
});

test('continuous source writes are coalesced while explicit refresh remains available', async () => {
  let clock = Date.now(),
    reads = 0;
  const connection = {};
  const cache = createUsageSnapshotReader({
    now: () => clock,
    read: async () => [event(String(++reads))],
  });
  await cache(connection);
  for (let i = 0; i < 10; i++) {
    cache.invalidate();
    await cache(connection);
  }
  assert.equal(reads, 1);
  clock += 15_000;
  await cache(connection);
  await setImmediate();
  assert.equal(reads, 2);
  await cache(connection, { refresh: true });
  await setImmediate();
  assert.equal(reads, 3);
});

test('corrupt/future cache data is disposable and a persistence failure does not hide current results', async () => {
  assert.equal(
    await decodeUsageSnapshot({
      version: 1,
      codec: 'deflate-json-v1',
      body: 'broken',
      checkedAt: new Date().toISOString(),
    }),
    undefined,
  );
  const future = await encodeUsageSnapshot({
    events: [event('future')],
    checkedAt: new Date(Date.now() + 600_000).toISOString(),
  });
  assert.equal(await decodeUsageSnapshot(future), undefined);
  const warnings = [];
  const cache = createUsageSnapshotReader({
    load: async () => {
      throw Error('read-only cache');
    },
    read: async () => [event('fresh')],
    save: async () => {
      throw Error('cannot save');
    },
    onCacheError: (e) => warnings.push(e.message),
  });
  assert.equal((await cache({})).events[0].id, 'fresh');
  assert.deepEqual(warnings, ['read-only cache', 'cannot save']);
});

test('usage and request log endpoints reuse one complete snapshot and log filters search beyond the former 5000 row cap', async () => {
  const events = Array.from({ length: 5010 }, (_, i) => ({
    ...event(String(i)),
    task: i === 5009 ? 'rare task' : 'common task',
  }));
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const io = {
    pool: { query: async () => ({ rows: [] }) },
    credentialStatus: async () => ({}),
    readSnapshot: async () => ({ events, checkedAt, refreshing: true }),
  };
  const admin = { role: 'admin' };
  const usage = await sourceUsageAction(
    { action: 'server_source_usage' },
    admin,
    io,
  );
  const log = await sourceUsageAction(
    { action: 'server_source_request_log', query: 'rare task' },
    admin,
    io,
  );
  assert.equal(usage.sources.find((s) => s.id === 'sorftime').records, 5010);
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].task, 'rare task');
  assert.equal(log.truncated, false);
  assert.equal(usage.checkedAt, checkedAt);
  assert.equal(log.checkedAt, checkedAt);
  assert.equal(usage.refreshing, true);
  assert.equal(log.refreshing, true);
});
