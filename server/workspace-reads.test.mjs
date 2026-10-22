import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';

const pgSql = (postgres) => postgres;
test('list truncation preserves complete emoji at JSON and SQL column boundaries', () => {
  const emoji = '\uD83D\uDC8A';
  const ad = projectRecord('ads', {
    id: 'unicode-ad', copy: 'a'.repeat(1499) + emoji + 'end',
    category: 'c'.repeat(159) + emoji + 'end',
    benefits: ['b'.repeat(179) + emoji + 'end'],
  });
  assert.equal(ad.data.copy, 'a'.repeat(1499) + emoji);
  assert.equal(ad.columns[1], 'c'.repeat(159) + emoji);
  assert.equal(ad.links.find(([relation]) => relation === 'benefit')[1], 'b'.repeat(179) + emoji);
  const product = projectRecord('products', {
    id: 'unicode-product', benefitEvidence: 'e'.repeat(1199) + emoji + 'end',
  });
  assert.equal(product.data.benefitEvidence, 'e'.repeat(1199) + emoji);
  assert.ok(JSON.stringify([ad, product]).isWellFormed());
});
const keyword = (i) => ({
  id: `k${i}`,
  term: `magnesium gummies ${i}`,
  termZh: '镁软糖',
  market: i % 2 ? 'MX' : 'US',
  category: '运动营养',
  source: 'Semrush',
  reviewStatus: 'selected',
  favorite: false,
  productIds: [`p${i}`],
  siteIds: ['s1'],
  series: [],
  trendPoints: [],
  trendHistoryPoints: Array.from({ length: 2000 }, (_, x) => ({
    date: '2025-01-01',
    value: x % 100,
  })),
  dataNature: 'collected',
});

export async function exerciseWorkspaceReads(
  pool,
  sql,
  engine,
  lock = async () => true,
  unlock = async () => {},
) {
  await migrateWorkspaceReads(pool, engine);
  // Running migrations twice must preserve the queue and existing revisions.
  await migrateWorkspaceReads(pool, engine);
  const putDocument = async (
    _table,
    name,
    value,
    _importOnly,
    connection = pool,
  ) =>
    connection.query(
      sql(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,revision=workspace_documents.revision+1',
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON DUPLICATE KEY UPDATE value=VALUES(value),revision=revision+1',
      ),
      [name, value],
    );
  const reads = createWorkspaceReads({
    pool,
    sql,
    lock,
    unlock,
    putDocument,
    isWorkspaceSyncKey: () => true,
  });
  const drain = async () => {
    for (let i = 0; i < 100; i++) if (!(await reads.refresh())) break;
    assert.equal((await reads.status()).indexing, false);
  };
  await drain();
  assert.equal((await reads.overview({})).snapshot.counts.products, 0);
  for (let i = 0; i < 34; i++)
    await pool.query(
      'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
      [`key${i}`, keyword(i)],
    );
  for (let i = 0; i < 240; i++)
    await putDocument('workspace_documents', `business:products:p${i}`, {
      id: `p${i}`,
      market: i % 2 ? 'MX' : 'US',
      title: `Product ${i}`,
      brand: 'Test brand',
      category: '运动营养',
      benefits: ['睡眠支持'],
      ingredientInsights: [{ name: '镁', amount: '100mg', role: '矿物质' }],
      siteId: 's1',
      favorite: false,
      dataNature: 'collected',
      benefitEvidence: 'e'.repeat(1199) + '\uD83D\uDC8A' + 'end',
      sourceContent: { descriptions: ['x'.repeat(50000)] },
      decisionData: { series: [] },
    });
  await putDocument('workspace_documents', 'business:sites:s1', {
    id: 's1',
    market: 'US',
    domain: 'synthetic.example',
    brand: 'Test brand',
    category: '运动营养',
    sources: ['广告落地页'],
    mainProducts: ['magnesium'],
    dataNature: 'collected',
  });
  for (let i = 0; i < 31; i++)
    await putDocument('workspace_documents', `business:ads:a${i}`, {
      id: `a${i}`,
      pageId: '123456',
      market: 'US',
      brand: 'Test advertiser',
      headline: 'Test',
      copy: 'x'.repeat(1499) + '\uD83D\uDC8A' + 'x'.repeat(8500),
      keywordIds: ['k0'],
      siteIds: ['s1'],
      status: '投放中',
      lastCollectedAt: '2026-10-22T00:00:00Z',
      dataNature: 'collected',
    });
  await drain();
  const overview = await reads.overview({ market: 'ALL' });
  assert.equal(overview.snapshot.counts.keywords, 34);
  assert.equal(overview.snapshot.counts.products, 240);
  assert.equal(overview.snapshot.productMarkets.US, 120);
  const first = await reads.list({ collection: 'products', pageSize: 20 });
  const second = await reads.list({
    collection: 'products',
    pageSize: 20,
    page: 2,
  });
  assert.equal(first.total, 240);
  assert.equal(first.rows.length, 20);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
    40,
  );
  assert.ok(
    first.rows.every((r) => !r.sourceContent && !r.decisionData?.series),
  );
  assert.ok(Buffer.byteLength(JSON.stringify(first)) < 50000);
  const selected = await reads.selection({
    collection: 'keywords',
    review: 'selected',
  });
  assert.equal(selected.count, 34);
  assert.equal(selected.rows.length, 34);
  assert.equal(new Set(selected.rows.map((r) => r.id)).size, 34);
  assert.ok(selected.rows.every((r) => !r.trendHistoryPoints));
  assert.equal(
    (await reads.list({ collection: 'products', keywordId: 'k0' })).rows[0].id,
    'p0',
  );
  assert.equal(
    (
      await reads.list({
        collection: 'sites',
        keywordId: 'k0',
        source: '广告落地页',
      })
    ).rows[0].productCount,
    240,
  );
  assert.equal(
    (await reads.list({ collection: 'ads', keywordId: 'k0' })).total,
    31,
  );
  const advertisers = await reads.list({ collection: 'advertisers' });
  assert.equal(advertisers.total, 1);
  assert.equal(advertisers.rows[0].adCount, 31);
  assert.equal(advertisers.rows[0].active, 31);
  assert.deepEqual(advertisers.rows[0].domains, ['synthetic.example']);
  const facets = (await reads.facets({ collection: 'products', market: 'US' }))
    .facets;
  assert.ok(facets.ingredient.includes('镁'));
  assert.ok(facets.benefit.includes('睡眠支持'));
  assert.equal(facets.keywords.length, 17);
  assert.equal(
    (
      await reads.list({
        collection: 'products',
        ingredient: '镁',
        benefit: '睡眠支持',
        market: 'MX',
      })
    ).total,
    120,
  );
  assert.equal(
    (
      await reads.list({
        collection: 'keywords',
        search: '镁软糖',
        market: 'US',
      })
    ).total,
    17,
  );
  assert.equal(
    (await reads.list({ collection: 'products', search: '%' })).total,
    0,
  );
  assert.equal(
    (await reads.details({ collection: 'products', id: 'p0' })).record
      .sourceContent.descriptions[0].length,
    50000,
  );
  const before = await reads.status();
  await pool.query('BEGIN');
  await pool.query(
    'UPDATE research_keywords SET data=$2 WHERE natural_key=$1',
    ['key0', { ...keyword(0), term: 'rolled back' }],
  );
  await pool.query('ROLLBACK');
  assert.deepEqual((await reads.status()).revisions, before.revisions);
  // A content update with the same timestamp must still invalidate the list.
  await pool.query(
    'UPDATE research_keywords SET data=$2 WHERE natural_key=$1',
    ['key0', { ...keyword(0), favorite: true }],
  );
  assert.equal((await reads.status()).indexing, true);
  await drain();
  assert.equal(
    (await reads.list({ collection: 'keywords', favorite: true })).total,
    1,
  );
  // An accepted cross-page selection stays frozen when records are later deleted.
  await pool.query('DELETE FROM research_keywords WHERE natural_key=$1', [
    'key0',
  ]);
  await pool.query('DELETE FROM workspace_documents WHERE name=$1', [
    'business:products:p0',
  ]);
  await drain();
  assert.equal((await reads.list({ collection: 'keywords' })).total, 33);
  assert.equal((await reads.list({ collection: 'products' })).total, 239);
  const frozen = (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `read:selection:${selected.selectionId}`,
    ])
  ).rows[0].value;
  assert.equal(frozen.ids.length, 34);
  // One malformed source must not stall other records or erase its last good projection.
  await putDocument('workspace_documents', 'business:products:p1', {
    id: 'p1',
    market: 'MX',
    ingredientInsights: 'invalid',
  });
  await putDocument('workspace_documents', 'business:products:p2', {
    id: 'p2',
    market: 'US',
    title: 'Repaired while another row fails',
    benefits: [],
    ingredientInsights: [],
  });
  await drain();
  assert.equal(
    (
      await reads.list({ collection: 'products', search: 'Product 1' })
    ).rows.some((r) => r.id === 'p1'),
    true,
  );
  assert.equal(
    (await reads.list({ collection: 'products', search: 'Repaired while' }))
      .total,
    1,
  );
  assert.match((await reads.status()).error, /部分记录/);
  await putDocument('workspace_documents', 'business:products:p1', {
    id: 'p1',
    market: 'MX',
    title: 'Now valid',
    benefits: [],
    ingredientInsights: [],
  });
  await drain();
  assert.equal((await reads.status()).error, '');
  const cachedOverview = (await reads.overview({})).snapshot;
  const query = pool.query;
  pool.query = async (...args) => {
    if (args[0].startsWith('SELECT kind,source_key'))
      throw new Error('synthetic refresh failure');
    return query(...args);
  };
  await reads.refresh();
  assert.equal(
    (await reads.overview({})).snapshot.generatedAt,
    cachedOverview.generatedAt,
  );
  pool.query = query;
  await drain();
  return {
    pageBytes: Buffer.byteLength(JSON.stringify(first)),
    overviewBytes: Buffer.byteLength(JSON.stringify(overview)),
    products: first.total,
    selectedKeywords: selected.count,
  };
}

if (!process.env.WORKSPACE_READ_MYSQL_QA)
  test('PostgreSQL read model: snapshots, projections, pagination, transactional invalidation and frozen selection', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite();
    const queryLog = [];
    const pool = {
      async query(statement, params = []) {
        queryLog.push(statement);
        return db.query(
          statement,
          params.map((value) =>
            value && typeof value === 'object' && !(value instanceof Date)
              ? JSON.stringify(value)
              : value,
          ),
        );
      },
      async connect() {
        return { query: (...args) => pool.query(...args), release() {} };
      },
    };
    try {
      await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer DEFAULT 1);
      CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
      CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false);`);
      const result = await exerciseWorkspaceReads(pool, pgSql, 'postgres');
      assert.ok(queryLog.every((sql) => !/md5\(/i.test(sql)));
      console.log('Synthetic read-model metrics:', JSON.stringify(result));
    } finally {
      await db.close();
    }
  });
