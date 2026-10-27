import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaStatistics, opportunityRows, radarStatistics } from './model.js';
import { createPublicObservationReader, createWorkspaceStatistics, encodeStatistic, decodeStatistic } from './workspace-statistics.mjs';

test('compressed findings preserve every field and legacy rows remain readable', () => {
  const row = { id: 'radar-qa', title: '补充剂', evidence: Array.from({ length: 30 }, () => ({ detail: 'Evidence text '.repeat(100), url: 'https://example.com/product' })), score: null };
  const packed = encodeStatistic(row);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(row).length / 3);
  assert.deepEqual(decodeStatistic(packed), row);
  assert.equal(decodeStatistic(row), row);
});

test('formula totals cover the full dataset and do not mix unknown sales periods', () => {
  const products = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, market: 'VN', siteId: 's', brand: i % 2 ? 'A' : 'B', reviewed: i < 10, ingredientInsights: [{ name: 'Magnesium' }], sourceMetrics: { reportedSales: 999999 } }));
  const summary = formulaStatistics(products);
  assert.equal(summary.coverage.total, 150);
  assert.equal(summary.coverage.observed, 150);
  assert.equal(summary.coverage.verified, 10);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].products, 150);
  assert.equal(summary.rows[0].score, 3020);
  products[0].formula = { fingerprint: 'verified-specific', status: 'verified', ingredients: [{ name: 'Vitamin D' }] };
  assert.equal(formulaStatistics(products).rows.length, 2);
});
test('radar statistics use every finding and include all activity dates', () => {
  const rows = Array.from({ length: 43 }, (_, i) => ({ type: i % 2 ? 'ad' : 'product', confidenceScore: 80, businessScore: i % 2 ? null : 60, firstSeenAt: '2026-10-22' }));
  const stats = radarStatistics(rows);
  assert.equal(stats.counts.product, 22);
  assert.equal(stats.counts.ad, 21);
  assert.equal(stats.counts.verified, 43);
  assert.equal(stats.averageScore, 60);
  assert.deepEqual(stats.activity['2026-10-22'], { product: 22, ad: 21 });
});
test('opportunity grouping preserves whole-dataset site counts and repeated titles', () => {
  const state = { products: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, title: 'same', market: 'US', brand: 'A', siteId: 's', ingredient: 'Mg', category: 'Sleep' })), sites: [{ id: 's', brand: 'S', market: 'US' }], keywords: [] };
  assert.equal(opportunityRows(state, 'site')[0].count, 80);
  assert.equal(opportunityRows(state, 'ingredient')[0].count, 80);
  assert.equal(new Set(opportunityRows(state, 'new').map(r => r.id)).size, 80);
});
test('public feed cache makes no requests during TTL and keeps last good feed after outage', async (context) => {
  let requests = 0;
  let now = Date.now(), offline = false;
  context.mock.method(Date, 'now', () => now);
  const reader = createPublicObservationReader({ fetcher: async url => {
    requests++;
    if (offline) throw new Error('offline');
    return new Response(JSON.stringify(url.pathname.includes('free-') ? { signals: [] } : { observations: [] }));
  } });
  const first = await reader();
  assert.equal(requests, 2);
  assert.equal((await reader()), first);
  assert.equal(requests, 2);
  offline = true;
  now += 300_001;
  const stale = await reader();
  assert.deepEqual(stale.free, first.free);
  assert.equal(stale.freeStale, true);
  assert.equal((await reader()), stale);
  assert.equal(requests, 4);
  const unavailable = createPublicObservationReader({ fetcher: async () => { throw new Error('offline'); } });
  const result = await unavailable();
  assert.equal(result.free, null);
  assert.equal(result.freeStale, true);
});

test('cold radar pagination reads only page candidates; refresh is atomic, revision-driven and periodic', async (context) => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  let now = Date.parse('2026-10-27T05:00:00Z'), fail = false;
  const reads = [];
  context.mock.method(Date, 'now', () => now);
  const connection = {
    query: async (statement, params = []) => {
      if (fail && statement.startsWith('INSERT INTO workspace_statistic_rows')) throw new Error('write failed');
      const result = await db.query(statement, params.map(value => value && typeof value === 'object' ? JSON.stringify(value) : value));
      reads.push({ statement, params, count: result.rows.length });
      return result;
    }, release() {},
  };
  const pool = { connect: async () => connection };
  const putDocument = async (_table, name, value, _importOnly, c) => c.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value', [name, value]);
  const create = () => createWorkspaceStatistics({ pool, sql: pg => pg, putDocument, loadPublic: async () => ({}) });
  const stats = create();
  const rebuild = async revision => {
    await connection.query('BEGIN');
    try { await stats.rebuild(connection, revision); await connection.query('COMMIT'); }
    catch (error) { await connection.query('ROLLBACK'); throw error; }
  };
  try {
    await db.exec('CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb); CREATE TABLE workspace_read_rows(collection text,id text,payload jsonb); CREATE TABLE workspace_statistic_rows(kind text,market text,variant text,position integer,subtype text,payload jsonb,PRIMARY KEY(kind,market,variant,position));');
    for (let i = 0; i < 45; i++) await connection.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', ['products', `p${i}`, { id: `p${i}`, title: `Product ${i}`, market: i % 2 ? 'MX' : 'US', dataNature: 'collected', firstSeenAt: new Date(now - 86400000).toISOString(), ingredientInsights: [], benefits: [] }]);
    await rebuild('1');
    reads.length = 0;
    const page = await create().read({ kind: 'radar', type: 'product', page: 2, pageSize: 20 });
    assert.equal(page.total, 45);
    assert.equal(page.rows.length, 20);
    assert.ok(page.rows.every(row => row.title && Array.isArray(row.evidence)));
    const payloadReads = reads.filter(row => row.statement.includes("kind='radar-data'"));
    assert.equal(payloadReads.length, 1);
    assert.equal(payloadReads[0].count, 20);
    assert.equal(payloadReads[0].params.length, 21);
    assert.ok(reads.every(row => !row.statement.includes('read:radar-payload')));
    reads.length = 0;
    await rebuild('1');
    assert.ok(reads.every(row => !row.statement.startsWith('INSERT INTO workspace_statistic_rows')));
    now += 300_001;
    reads.length = 0;
    await rebuild('1');
    assert.ok(reads.every(row => !row.statement.startsWith('INSERT INTO workspace_statistic_rows')));
    await connection.query("DELETE FROM workspace_read_rows WHERE id='p0'");
    fail = true;
    await assert.rejects(rebuild('2'), /write failed/);
    assert.equal((await create().read({ kind: 'radar', type: 'product' })).total, 45);
    fail = false;
    await rebuild('2');
    assert.equal((await stats.read({ kind: 'radar', type: 'product' })).total, 44);
    // A quiet database still expires observations when the rolling window moves.
    now += 31 * 86400000;
    await rebuild('2');
    assert.equal((await stats.read({ kind: 'radar', type: 'product' })).total, 0);
    // A pre-upgrade snapshot stays readable until its background replacement commits.
    const legacy = { id: 'legacy', title: 'Saved legacy' };
    await putDocument('', 'read:radar-payload:7', { revision: 'old', data: encodeStatistic([legacy]) }, false, connection);
    await putDocument('', 'read:statistics:radar:ALL:7', { generatedAt: 'old', revision: 'old', radarPayloadKey: 'read:radar-payload:7' }, false, connection);
    await connection.query("INSERT INTO workspace_statistic_rows VALUES('radar','ALL','7',0,'product','0')");
    assert.deepEqual((await create().read({ kind: 'radar' })).rows, [legacy]);
  } finally { await db.close(); }
});
