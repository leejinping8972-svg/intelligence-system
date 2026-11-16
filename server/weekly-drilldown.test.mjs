import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { conceptMemberCondition } from './concept-members.mjs';
import { conceptMonitorRows } from './concept-monitor-domain.mjs';
import { createConceptMonitor } from './concept-monitor.mjs';
import { weeklyMemberCondition } from './weekly-members.mjs';
import { createWeeklySummary } from './weekly-summary.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';

const NOW = Date.parse('2026-11-16T04:00:00Z');
const FIRST = '2026-11-16T00:00:00+08:00';

test('batch weeks include Monday, preserve first discoveries, exclude future records and deduplicate saved links', () => {
  const captured = new Map();
  const rows = conceptMonitorRows({
    keywords: [{ id: 'k', batch: 'A', market: 'US', firstSeenAt: FIRST, productIds: ['p', 'p', 'old', 'future', 'no-date'] }],
    products: [
      { id: 'p', market: 'US', firstSeenAt: FIRST, keywordIds: ['k'] },
      { id: 'old', market: 'US', discovery: { firstSeenAt: '2026-11-15T15:59:59.999Z' }, lastCollectedAt: FIRST },
      { id: 'future', market: 'US', firstSeenAt: '2026-11-16T05:00:00Z' },
      { id: 'no-date', market: 'US' },
    ],
  }, NOW, (batch, members) => captured.set(batch, members));
  assert.equal(rows[0].keywordsWeek, 1);
  assert.equal(rows[0].productsWeek, 1);
  assert.equal(rows[0].products, 4);
  assert.deepEqual(captured.get('A').products.weekIds, ['p']);
  assert.equal(captured.get('A').products.weekStart, '2026-11-16');
});

async function fixture() {
  const db = new PGlite();
  try {
  const statements = [];
  let fail = false;
  const pool = {
    query: (text, values = []) => {
      statements.push(text);
      if (fail && text.startsWith('INSERT INTO workspace_documents') && values[0] === 'read:weekly-summary-version') throw Error('synthetic publication failure');
      return db.query(text, values.map(value => value && typeof value === 'object' ? JSON.stringify(value) : value));
    },
    connect: async () => ({ query: (...args) => pool.query(...args), release() {} }),
  };
  await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL);
    CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
    CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,checkpoint jsonb,status text,cancelled boolean,updated_at timestamptz);`);
  await migrateWorkspaceReads(pool, 'postgres');
  const putDocument = (_table, name, value, _importOnly, c = pool) => c.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value', [name, value]);
  const options = { pool, sql: pg => pg, putDocument, lock: async () => true, unlock: async () => {}, isWorkspaceSyncKey: () => true, loadPublic: async () => ({}) };
  const reads = createWorkspaceReads(options);
  async function add(kind, row) {
    const source = kind === 'keywords' ? row.id : `business:${kind}:${row.id}`;
    if (kind === 'keywords') await pool.query('INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)', [source, row]);
    else await putDocument('', source, row);
    const projected = projectRecord(kind, row);
    await pool.query(`INSERT INTO workspace_read_rows(collection,id,source_key,market,category,score,grade,rating_status,review_status,collection_status,favorite,collected_at,source_label,platform,ownership,site_id,newness,recent_discovery,search_text,payload) VALUES(${Array.from({ length: 20 }, (_, i) => `$${i + 1}`).join(',')})`, [kind, row.id, source, ...projected.columns, projected.data]);
    for (const [relation, target] of projected.links) await pool.query('INSERT INTO workspace_read_links VALUES($1,$2,$3,$4)', [kind, row.id, relation, target]);
  }
  async function publish(revision = 1) {
    await pool.query('BEGIN');
    try {
      await createConceptMonitor(options).rebuild(pool, revision, false);
      await createWeeklySummary(options).rebuild(pool, revision, false);
      await pool.query('COMMIT');
    } catch (error) { await pool.query('ROLLBACK'); throw error; }
  }
  const product = (id, firstSeenAt, listing, extra = {}) => ({
    id, title: id, market: 'US', keywordIds: ['k'], firstSeenAt, lastCollectedAt: FIRST,
    newProductClassifications: [{ type: 'regular_new' }],
    decisionData: { listing: { date: listing, provider: 'synthetic', platform: 'amazon', market: 'US', collectedAt: FIRST, evidenceUrl: 'https://example.com/product' } },
    ...extra,
  });
  await add('keywords', { id: 'k', term: 'synthetic', termZh: '合成词', category: 'Vitamins', source: 'synthetic', market: 'US', batch: 'A', series: [], trendPoints: [], firstSeenAt: FIRST, collectedAt: FIRST });
  await add('products', product('new', FIRST, '2026-11-09'));
  await add('products', product('existing', FIRST, '2020-01-01', { newProductClassifications: [] }));
  await add('products', product('historical', '2026-11-10', '2026-11-04'));
  await add('products', product('foreign', FIRST, '2026-11-15', { market: 'MX' }));
  await add('sites', { id: 's', domain: 'example.com', market: 'US', keywordIds: ['k'], firstSeenAt: FIRST, lastCollectedAt: FIRST });
  for (const [id, firstSeenAt, startDate] of [['a-new', FIRST, '2026-11-09'], ['a-existing', FIRST, '2020-01-01'], ['a-old', '2026-11-10', '2026-11-04']])
    await add('ads', { id, market: 'US', brand: id, collectionBatches: ['A'], firstSeenAt, startDate, lastCollectedAt: FIRST, source: 'synthetic', evidenceUrl: 'https://example.com/ad', keywordIds: ['k'] });
  return { db, pool, reads, publish, statements, fail: value => { fail = value; } };
  } catch (error) { await db.close(); throw error; }
}

test('batch weekly columns and all four weekly summary metrics match actual paged lists in each market', async () => {
  const clock = mock.method(Date, 'now', () => NOW);
  const f = await fixture();
  try {
    await f.publish();
    for (const market of ['ALL', 'US', 'MX', 'VN']) {
      const batches = await f.reads.statistics({ kind: 'concept-monitor', market });
      for (const batch of batches.rows) for (const collection of ['keywords', 'products', 'sites', 'ads']) {
        const list = await f.reads.list({ collection, market, conceptBatch: batch.batch, conceptWeek: batches.snapshot.weekStart, pageSize: 1 });
        assert.equal(list.total, batch[`${collection}Week`], `${market}/${collection}`);
        assert.equal((await f.reads.list({ collection, market, conceptBatch: batch.batch, conceptWeek: '2026-11-09' })).total, 0, 'stale batch-week links must not become unfiltered lists');
      }
      const weekly = await f.reads.statistics({ kind: 'weekly-summary', market });
      assert.equal(weekly.snapshot.version, 2);
      for (const row of weekly.rows.slice(0, 2)) for (const [metric, collection, summaryNew] of [
        ['discoveredProducts', 'products', '0'], ['newProducts', 'products', '1'],
        ['discoveredAds', 'ads', '0'], ['newAds', 'ads', '1'],
      ]) {
        const list = await f.reads.list({ collection, market, summaryWeek: row.weekStart, summaryNew, productPool: 'ALL', pageSize: 1 });
        assert.equal(list.total, row[metric], `${market}/${row.weekStart}/${metric}`);
      }
    }
    const newProducts = await f.reads.list({ collection: 'products', market: 'US', summaryWeek: '2026-11-16', summaryNew: '1' });
    assert.deepEqual(newProducts.rows.map(row => row.id), ['new']);
    const historical = await f.reads.list({ collection: 'ads', market: 'US', summaryWeek: '2026-11-09', summaryNew: '1' });
    assert.deepEqual(historical.rows.map(row => row.id), ['a-old'], 'historical newness uses first capture, not today');
    const start = f.statements.length;
    await f.reads.list({ collection: 'products', summaryWeek: '2026-11-16', page: 2, pageSize: 1 });
    assert.equal(f.statements.slice(start).some(text => /INSERT|UPDATE|DELETE/.test(text)), false, 'navigation never rebuilds or mutates data');
  } finally { clock.mock.restore(); await f.db.close(); }
});

test('weekly member publication rolls back with the counts and Monday rollover resets batch weeks before 09:00', async () => {
  let now = NOW;
  const clock = mock.method(Date, 'now', () => now);
  const f = await fixture();
  try {
    await f.publish();
    await f.pool.query("DELETE FROM workspace_read_rows WHERE collection='products' AND id='new'");
    now += 7 * 86_400_000;
    f.fail(true);
    await assert.rejects(f.publish(2), /synthetic publication failure/);
    const saved = (await f.pool.query("SELECT value FROM workspace_documents WHERE name='read:weekly-members:US:2026-11-16:products'")).rows[0].value;
    assert.deepEqual(saved.newIds, ['new']);
    assert.equal((await f.reads.statistics({ kind: 'weekly-summary' })).rows[0].weekStart, '2026-11-16');
    f.fail(false);
    now = Date.parse('2026-11-22T16:01:00Z');
    await f.publish(2);
    const batch = await f.reads.statistics({ kind: 'concept-monitor' });
    assert.equal(batch.snapshot.weekStart, '2026-11-23');
    assert.equal(batch.rows[0].productsWeek, 0);
    assert.equal((await f.reads.statistics({ kind: 'weekly-summary' })).rows[0].weekStart, '2026-11-23');
    const historical = await f.reads.list({ collection: 'products', summaryWeek: '2026-11-16', summaryNew: '1' });
    assert.equal(historical.total, 0, 'removed sources disappear from the next stored membership');
  } finally { clock.mock.restore(); await f.db.close(); }
});

test('weekly filters validate dates and type, bind untrusted names, and preserve binary MySQL member identities', () => {
  for (const week of ['2026-11-17', '2026-02-30', "2026-11-16' OR 1=1", ['2026-11-16']])
    assert.throws(() => weeklyMemberCondition({ summaryWeek: week }, 'products', () => '$1', pg => pg), /周统计日期/);
  assert.throws(() => weeklyMemberCondition({ summaryWeek: '2026-11-16' }, 'keywords', () => '$1', pg => pg), /类型无效/);
  assert.throws(() => weeklyMemberCondition({ summaryWeek: '2026-11-16', summaryNew: 'yes' }, 'ads', () => '$1', pg => pg), /新品筛选无效/);
  assert.throws(() => conceptMemberCondition({ conceptBatch: 'A', conceptWeek: '2026-11-16', conceptDay: '2026-11-16' }, 'products', () => '$1', pg => pg), /同时/);
  const values = [];
  const sql = weeklyMemberCondition({ summaryWeek: '2026-11-16', summaryNew: '1', market: 'US' }, 'products', value => { values.push(value); return '?'; }, (_pg, mysql) => mysql);
  assert.match(sql, /COLLATE utf8mb4_bin/);
  assert.match(sql, /newIds/);
  assert.deepEqual(values, ['read:weekly-members:US:2026-11-16:products']);
});
