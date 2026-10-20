/* oxlint-disable vitest/no-import-node-test -- Node server tests run without Vitest. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { saveSiteBatch } from './competitor-batch.mjs';

function fixture(initial = [], fail = false) {
  let values = new Map(initial);
  let before;
  let writes = 0;
  const connection = {
    async query(sql) {
      if (sql === 'BEGIN') before = structuredClone(values);
      if (sql === 'ROLLBACK') values = before;
    },
  };
  const db = {
    read: async (name) => values.get(name),
    list: async (prefix) =>
      [...values]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value]) => ({ name, value })),
    async write(name, value) {
      writes++;
      if (fail && writes === 2) throw new Error('write failed');
      values.set(name, value);
    },
  };
  return { db, connection, entries: () => [...values], writes: () => writes };
}
const site = (id, market = 'US') => [
  `business:sites:${id}`,
  { id, market, domain: `${id}.example.test`, dataNature: 'collected' },
];
test('batch saves mixed markets once and preserves existing paused monitors and Page IDs', async () => {
  const old = {
    id: 'old',
    kind: 'site',
    siteId: 'a',
    market: 'US',
    enabled: false,
    pageId: '123',
    hour: 18,
    maxRequests: 3,
  };
  const f = fixture([
    site('a'),
    site('b', 'VN'),
    ['competitor:target:old', old],
  ]);
  const input = {
    siteIds: ['a', 'b', 'b'],
    enabled: true,
    hour: 8,
    maxRequests: 5,
  };
  const result = await saveSiteBatch(input, f.db, f.connection);
  assert.deepEqual(result, { saved: true, created: 1, preserved: 1, total: 2 });
  assert.deepEqual(await f.db.read('competitor:target:old'), old);
  const targets = await f.db.list('competitor:target:');
  const added = targets.find((row) => row.value.siteId === 'b').value;
  assert.equal(added.market, 'VN');
  assert.equal(added.enabled, true);
  assert.equal(added.pageId, '');
  const repeated = await saveSiteBatch(input, f.db, f.connection);
  assert.equal(repeated.created, 0);
});
test('capacity and invalid sites fail before any writes; no silent truncation', async () => {
  const existing = Array.from({ length: 99 }, (_, i) => [
    `competitor:target:${i}`,
    { id: String(i), kind: 'advertiser' },
  ]);
  const f = fixture([...existing, site('a'), site('b')]);
  await assert.rejects(
    () => saveSiteBatch({ siteIds: ['a', 'b'] }, f.db, f.connection),
    /剩余1个/,
  );
  assert.equal(f.writes(), 0);
  const invalid = fixture([site('a'), site('b', 'XX')]);
  await assert.rejects(
    () =>
      saveSiteBatch({ siteIds: ['a', 'b'] }, invalid.db, invalid.connection),
    /有效市场/,
  );
  assert.equal(invalid.writes(), 0);
});
test('write failure rolls back the complete batch and rejects invalid schedules', async () => {
  const f = fixture([site('a'), site('b')], true);
  const before = f.entries();
  await assert.rejects(
    () => saveSiteBatch({ siteIds: ['a', 'b'] }, f.db, f.connection),
    /write failed/,
  );
  assert.deepEqual(f.entries(), before);
  await assert.rejects(
    () => saveSiteBatch({ siteIds: ['a'], hour: 24 }, f.db, f.connection),
    /0～23/,
  );
  await assert.rejects(
    () => saveSiteBatch({ siteIds: [] }, f.db, f.connection),
    /请选择/,
  );
});
