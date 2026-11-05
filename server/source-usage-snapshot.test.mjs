import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeUsageSnapshot,
  encodeUsageSnapshot,
} from './source-usage-snapshot.mjs';
import { sourceUsageAction } from './source-usage.mjs';

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

test('saved codec preserves real zero and unknown charges, rejecting corruption and future dates', async () => {
  const initial = { events: [event('zero', 0), { ...event('unknown'), amount: null, billing: 'unknown' }], checkedAt: new Date().toISOString() };
  assert.deepEqual(await decodeUsageSnapshot(await encodeUsageSnapshot(initial)), initial);
  assert.equal(await decodeUsageSnapshot({ version: 1, codec: 'deflate-json-v1', body: 'broken', checkedAt: initial.checkedAt }), undefined);
  assert.equal(await decodeUsageSnapshot(await encodeUsageSnapshot({ ...initial, checkedAt: new Date(Date.now() + 600_000).toISOString() })), undefined);
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
