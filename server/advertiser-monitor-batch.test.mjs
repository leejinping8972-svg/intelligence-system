/* oxlint-disable vitest/no-import-node-test -- Backend runs with node --test. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { saveAdvertiserBatch } from './advertiser-monitor-batch.mjs';

function fixture(initial = [], failAt = 0) {
  let values = new Map(initial),
    before,
    writes = 0;
  const db = {
    read: async (name) => values.get(name),
    list: async (prefix) =>
      [...values]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value]) => ({ name, value })),
    write: async (name, value) => {
      if (++writes === failAt) throw new Error('synthetic failure');
      values.set(name, value);
    },
  };
  const connection = {
    query: async (text) => {
      if (text === 'BEGIN') before = structuredClone(values);
      if (text === 'ROLLBACK') values = before;
    },
  };
  return { db, connection, values: () => [...values], writes: () => writes };
}
const ad = (id, pageId = '123', market = 'US', extra = {}) => [
  `business:ads:${id}`,
  {
    id,
    pageId,
    market,
    brand: 'Same Brand',
    dataNature: 'collected',
    ...extra,
  },
];
test('deduplicates by market and exact Page ID, preserves all existing settings', async () => {
  const old = {
    id: 'old',
    kind: 'advertiser',
    pageId: '123',
    market: 'US',
    enabled: false,
    hour: 22,
    maxRequests: 1,
    siteId: 'keep',
  };
  const f = fixture([
    ad('a'),
    ad('duplicate'),
    ad('vn', '123', 'VN'),
    ad('other', '456'),
    ['competitor:target:old', old],
  ]);
  const result = await saveAdvertiserBatch(
    {
      adIds: ['a', 'a', 'duplicate', 'vn', 'other'],
      enabled: true,
      hour: 9,
      maxRequests: 4,
    },
    f.db,
    f.connection,
  );
  assert.deepEqual(result, { saved: true, created: 2, preserved: 1, total: 3 });
  assert.deepEqual(await f.db.read('competitor:target:old'), old);
  const created = (await f.db.list('competitor:target:'))
    .map((r) => r.value)
    .filter((t) => t.id !== 'old');
  assert.ok(created.some((t) => t.market === 'VN' && t.pageId === '123'));
  assert.ok(created.some((t) => t.market === 'US' && t.pageId === '456'));
  assert.ok(created.every((t) => t.siteId === '' && t.enabled === true));
  assert.equal(
    (
      await saveAdvertiserBatch(
        { adIds: ['a', 'vn', 'other'] },
        f.db,
        f.connection,
      )
    ).created,
    0,
  );
});
test('capacity includes site monitors and rejects the complete batch before mutation', async () => {
  const initial = Array.from({ length: 99 }, (_, i) => [
    `competitor:target:${i}`,
    { kind: 'site', siteId: `s${i}` },
  ]);
  const f = fixture([...initial, ad('a'), ad('b', '456')]);
  await assert.rejects(
    () => saveAdvertiserBatch({ adIds: ['a', 'b'] }, f.db, f.connection),
    /剩余1个/,
  );
  assert.equal(f.writes(), 0);
});
test('invalid or missing identity cannot create monitors or silently truncate selection', async () => {
  for (const extra of [
    { pageId: '' },
    { pageId: 'Brand' },
    { pageId: '123/456' },
    { market: 'XX' },
    { dataNature: 'demo' },
  ]) {
    const f = fixture([ad('a'), ad('bad', '123', 'US', extra)]);
    await assert.rejects(
      () => saveAdvertiserBatch({ adIds: ['a', 'bad'] }, f.db, f.connection),
      /有效Page ID/,
    );
    assert.equal(f.writes(), 0);
  }
  const f = fixture([ad('a')]);
  for (const input of [
    { adIds: [] },
    { adIds: ['missing'] },
    { adIds: ['a'], maxRequests: 0 },
    { adIds: ['a'], hour: 24 },
  ])
    await assert.rejects(() => saveAdvertiserBatch(input, f.db, f.connection));
});
test('entire batch rolls back on a later write failure', async () => {
  const f = fixture([ad('a'), ad('b', '456')], 2),
    original = f.values();
  await assert.rejects(
    () => saveAdvertiserBatch({ adIds: ['a', 'b'] }, f.db, f.connection),
    /synthetic/,
  );
  assert.deepEqual(f.values(), original);
});
