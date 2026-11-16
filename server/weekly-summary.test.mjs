import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { createWeeklyAccumulator, weeklyDate, weekStart } from './weekly-summary-domain.mjs';
import { createWeeklySummary } from './weekly-summary.mjs';

const now = Date.parse('2026-11-16T04:00:00Z');
function product(id, firstSeenAt, listingDate = '2026-11-15', extra = {}) {
  return {
    id, market: 'US', firstSeenAt, lastCollectedAt: '2026-11-16T02:00:00Z',
    newProductClassifications: [{ type: 'regular_new' }],
    decisionData: { listing: { date: listingDate, provider: 'synthetic', platform: 'amazon', market: 'US', collectedAt: '2026-11-16T02:00:00Z', evidenceUrl: 'https://example.com/product' } },
    ...extra,
  };
}
function ad(id, firstSeenAt, startDate = '2026-11-15', extra = {}) {
  return { id, market: 'US', firstSeenAt, startDate, source: 'synthetic', lastCollectedAt: '2026-11-16T02:00:00Z', evidenceUrl: 'https://example.com/ad', ...extra };
}
function summarize(state, at = now) {
  const summary = createWeeklyAccumulator(at);
  for (const [kind, rows] of Object.entries(state)) for (const row of rows) summary.add(kind, row);
  return summary.results();
}
const counts = (row) => [row.discoveredProducts, row.newProducts, row.discoveredAds, row.newAds];

test('Shanghai natural weeks handle midnight, year boundaries and explicit or missing zones', () => {
  assert.equal(weeklyDate('2026-11-15T15:59:59.999Z', now), '2026-11-15');
  assert.equal(weeklyDate('2026-11-15T16:00:00Z', now), '2026-11-16');
  assert.equal(weeklyDate('2026-11-16T00:00:00', now), '2026-11-16');
  assert.equal(weeklyDate('2026-11-15', now), '2026-11-15');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekStart('2027-01-03'), '2026-12-28');
  assert.equal(weekStart('2027-01-04'), '2027-01-04');
  for (const value of ['', 'invalid', '2026-02-30', '2026-13-01', '2026-11-17', '2026-11-16T05:00:00Z'])
    assert.equal(weeklyDate(value, now), '', value);
});

test('new counts are a subset of first discoveries, using seven-day age at capture and existing pool evidence', () => {
  const result = summarize({
    products: [
      product('seven', '2026-11-16T00:00:00Z', '2026-11-09'),
      product('eight', '2026-11-16T00:00:00Z', '2026-11-08'),
      product('not-in-pool', '2026-11-16T00:00:00Z', '2026-11-15', { newProductClassifications: [] }),
      product('missing-source', '2026-11-16T00:00:00Z', '2026-11-15', { decisionData: {} }),
      product('source-after-discovery', '2026-11-09T00:00:00Z', '2026-11-15'),
      product('historical', '2026-11-09T00:00:00Z', '2026-11-03', { discovery: { firstSeenAt: '2026-11-09T00:00:00Z' } }),
    ],
    ads: [
      ad('seven', '2026-11-16T00:00:00Z', '2026-11-09'),
      ad('eight', '2026-11-16T00:00:00Z', '2026-11-08'),
      ad('unverified', '2026-11-16T00:00:00Z', '2026-11-15', { evidenceUrl: '' }),
      ad('historical', '2026-11-09T00:00:00Z', '2026-11-02'),
    ],
  });
  assert.deepEqual(counts(result.ALL.rows[0]), [4, 1, 3, 1]);
  assert.deepEqual(counts(result.ALL.rows[1]), [2, 1, 1, 1]);
  // A later refresh does not age historical new records out of their original week.
  const later = summarize({ products: [product('historical', '2026-11-09T00:00:00Z', '2026-11-03')] }, Date.parse('2027-01-05T04:00:00Z'));
  assert.deepEqual(counts(later.ALL.rows.find((row) => row.weekStart === '2026-11-09')), [1, 1, 0, 0]);
});

test('demo, invalid and future dates are excluded; first discovery is never replaced by repeat collection', () => {
  const result = summarize({ products: [
    product('demo', '2026-11-16', '2026-11-15', { dataNature: 'demo' }),
    product('future', '2026-11-17', '2026-11-15'),
    product('missing', '', '2026-11-15'),
    product('bad', '2026-02-30', '2026-11-15'),
    product('repeat', '2026-11-16', '2026-11-01', { discovery: { firstSeenAt: '2026-11-08T15:00:00Z' } }),
    product('fallback', '2026-11-16', '2026-11-15', { discovery: { firstSeenAt: 'invalid' } }),
  ] });
  assert.deepEqual(counts(result.ALL.rows[0]), [1, 1, 0, 0]);
  assert.deepEqual(counts(result.ALL.rows[1]), [0, 0, 0, 0]);
  assert.deepEqual(counts(result.ALL.rows[2]), [1, 1, 0, 0]);
  assert.equal(result.ALL.missingDiscovery, 3);
  assert.equal(result.ALL.rows.length, 12);
});

test('market scopes, zero weeks, historical weeks and pool exposure substitutes follow saved identities', () => {
  const exposure = product('exposure', '2026-11-16', '2026-11-15');
  exposure.decisionData.listing.dateBasis = 'exposure';
  const result = summarize({
    products: [exposure, product('mexico', '2026-11-16', '2026-11-15', { market: 'MX', decisionData: {} }), product('old', '2026-01-01', '2025-12-30')],
    ads: [ad('vietnam', '2026-11-16', '2026-11-15', { market: 'VN' }), ad('other-market', '2026-11-16', '2026-11-15', { market: 'OTHER' })],
  });
  assert.deepEqual(counts(result.ALL.rows[0]), [2, 1, 2, 2]);
  assert.deepEqual(counts(result.US.rows[0]), [1, 1, 0, 0]);
  assert.deepEqual(counts(result.MX.rows[0]), [1, 0, 0, 0]);
  assert.deepEqual(counts(result.VN.rows[0]), [0, 0, 1, 1]);
  assert.equal(result.ALL.rows.at(-1).weekStart, '2025-12-29');
  assert.equal(result.ALL.rows.at(-1).newProducts, 1);
  assert.equal(result.ALL.rows[10].discoveredProducts, 0);
});

test('source evidence is checked in Shanghai time and cannot postdate the first capture', () => {
  const at = Date.parse('2026-11-15T16:30:00Z');
  const p = product('midnight', '2026-11-16T00:10:00', '2026-11-16');
  p.decisionData.listing.collectedAt = '2026-11-16T00:10:00';
  const result = summarize({
    products: [p],
    ads: [
      ad('midnight', '2026-11-16T00:10:00', '2026-11-16', { lastCollectedAt: '2026-11-16T00:10:00' }),
      ad('later-that-day', '2026-11-16T00:10:00', '2026-11-16T00:20:00', { lastCollectedAt: '2026-11-16T00:25:00' }),
    ],
  }, at);
  assert.deepEqual(counts(result.ALL.rows[0]), [1, 1, 2, 1]);
});

test('persisted snapshots stream multiple source batches, paginate, update on schedule and roll back atomically', async () => {
  let current = now;
  const clock = mock.method(Date, 'now', () => current);
  const db = new PGlite();
  const statements = [];
  let failPublish = false;
  const pool = {
    async query(statement, params = []) {
      statements.push(statement);
      if (failPublish && statement.startsWith('INSERT INTO workspace_documents') && params[0] === 'read:weekly-summary-version') throw new Error('synthetic publication failure');
      return db.query(statement, params.map((value) => value && typeof value === 'object' ? JSON.stringify(value) : value));
    },
    async connect() { return { query: (...args) => pool.query(...args), release() {} }; },
  };
  const putDocument = (_table, name, value, _importOnly, connection) => connection.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value', [name, value]);
  const create = () => createWeeklySummary({ pool, sql: (pg) => pg, putDocument });
  let service = create();
  async function rebuild(revision, indexing = false) {
    await pool.query('BEGIN');
    try { await service.rebuild(pool, revision, indexing); await pool.query('COMMIT'); }
    catch (error) { await pool.query('ROLLBACK'); throw error; }
  }
  try {
    await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL);
      CREATE TABLE workspace_read_rows(collection text,id text,payload jsonb,PRIMARY KEY(collection,id));
      CREATE TABLE workspace_statistic_rows(kind text,market text,variant text,position integer,subtype text,payload jsonb,PRIMARY KEY(kind,market,variant,position));`);
    assert.equal((await service.read({})).snapshot, null);
    for (let i = 0; i < 205; i++) await pool.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', ['products', `p${i}`, product(`p${i}`, '2026-11-16', '2026-11-15')]);
    await pool.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', ['ads', 'mexico', ad('mexico', '2026-11-16', '2026-11-15', { market: 'MX' })]);
    await pool.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', ['ads', 'old', ad('old', '2025-11-16', '2025-11-15')]);
    await rebuild(1, true);
    const initial = await service.read({ pageSize: 5 });
    assert.deepEqual(counts(initial.rows[0]), [205, 205, 1, 1]);
    assert.equal(initial.snapshot.indexing, true);
    assert.ok(initial.total > 52);
    assert.equal(initial.rows.length, 5);
    assert.equal((await service.read({ pageSize: 5, page: 2 })).rows[0].weekStart, '2026-10-12');
    assert.deepEqual(counts((await service.read({ market: 'MX' })).rows[0]), [0, 0, 1, 1]);
    assert.equal((await service.read({ pageSize: 9999 })).pageSize, 100);
    assert.equal((await service.read({ page: 9999 })).page, 5);
    assert.equal((await service.read({ market: "US' OR 1=1" })).rows[0].discoveredProducts, 205);
    const beforeRead = statements.length;
    await service.read({});
    assert.equal(statements.slice(beforeRead).some((statement) => statement.includes('workspace_read_rows')), false, 'API reads saved summaries only');
    current += 60_000;
    service = create();
    await rebuild(2, true);
    assert.equal((await service.read({})).snapshot.revision, '1', 'revision changes are batched for five minutes');
    current += 5 * 60_000;
    await rebuild(2, true);
    assert.equal((await service.read({})).snapshot.revision, '2');
    current += 60_000;
    await rebuild(2, false);
    assert.equal((await service.read({})).snapshot.indexing, false, 'catch-up completion publishes immediately');
    // Updating the same saved ID after another collection cannot duplicate the discovery.
    await pool.query("UPDATE workspace_read_rows SET payload=$1 WHERE collection='products' AND id='p0'", [product('p0', '2026-11-16', '2026-11-15', { lastCollectedAt: '2026-11-16T03:00:00Z' })]);
    current = Date.parse('2026-11-22T16:01:00Z');
    failPublish = true;
    await assert.rejects(rebuild(3), /synthetic publication failure/);
    assert.equal((await service.read({})).snapshot.revision, '2');
    assert.equal((await service.read({})).rows[0].weekStart, '2026-11-16');
    failPublish = false;
    await rebuild(3);
    const nextWeek = await service.read({});
    assert.equal(nextWeek.rows[0].weekStart, '2026-11-23');
    assert.deepEqual(counts(nextWeek.rows[0]), [0, 0, 0, 0]);
    assert.deepEqual(counts(nextWeek.rows[1]), [205, 205, 1, 1]);
    assert.equal(nextWeek.snapshot.day, '2026-11-23');
    service.retryLater();
    assert.equal(service.due(), false);
    current += 60_001;
    assert.equal(service.due(), true);
  } finally { clock.mock.restore(); await db.close(); }
});
