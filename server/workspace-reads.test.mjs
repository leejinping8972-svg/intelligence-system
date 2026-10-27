import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';
import { readReportSummaries } from './report-read-summaries.mjs';

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
    loadPublic: async () => ({ collector: null, free: null }),
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
  const observedAt = new Date(Date.now() - 86_400_000).toISOString();
  for (let i = 0; i < 240; i++)
    await putDocument('workspace_documents', `business:products:p${i}`, {
      id: `p${i}`,
      market: i % 2 ? 'MX' : 'US',
      title: `Product ${i}`,
      brand: 'Test brand',
      category: '运动营养',
      benefits: ['睡眠支持'],
      ingredient: '镁 100mg',
      ingredientInsights: [{ name: '镁', amount: '100mg', role: '矿物质' }],
      siteId: 's1',
      favorite: false,
      dataNature: 'collected',
      firstSeenAt: observedAt,
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
  const dates = Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.parse('2026-10-26T00:00:00Z') - (365 - i) * 86400000).toISOString().slice(0, 10), value: 50 }));
  const saved = { ...keyword(0), series: dates.map((p) => p.value), trendPoints: dates, trendResolution: 'day', trendCollectedAt: '2026-10-26T00:00:00Z', trendDailyPoints: dates.slice(-60), trendDailyCollectedAt: '2026-10-26T00:00:00Z', trendRelatedTop: Array.from({ length: 25 }, (_, i) => ({ query: `saved query ${i}`, value: i, formattedValue: String(i) })) };
  await pool.query('UPDATE research_keywords SET data=$1 WHERE natural_key=$2', [saved, 'key0']);
  // Simulate a v6 projection that predates calendar summaries; no rebuild is needed.
  await pool.query("UPDATE workspace_read_rows SET payload=$1 WHERE collection='keywords' AND id='k0'", [{ ...keyword(0), listSummary: true, trendPoints: [], trendRelatedTop: [] }]);
  const savedPage = await reads.list({ collection: 'keywords', search: 'magnesium gummies 0' });
  const savedRow = savedPage.rows.find((r) => r.id === 'k0');
  assert.equal(savedRow.trendPoints.length, 365);
  assert.equal(savedRow.trendCalendarSummary.length, 4);
  assert.equal(savedRow.trendCalendarSummary[1].heat, 50);
  assert.equal(savedRow.trendRelatedTop.length, 25);
  assert.equal(savedRow.trendDailyPoints, undefined);
  await drain();
  const overview = await reads.overview({ market: 'ALL' });
  assert.equal(overview.snapshot.counts.keywords, 34);
  assert.equal(overview.snapshot.counts.products, 240);
  assert.equal(overview.snapshot.productMarkets.US, 120);
  const radar = await reads.statistics({ kind: 'radar', type: 'product', pageSize: 20 });
  assert.equal(radar.total, 240);
  assert.equal(radar.rows.length, 20);
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS n FROM workspace_documents WHERE name LIKE 'read:radar-payload:%'")).rows[0].n), 0);
  assert.equal((await pool.query("SELECT payload FROM workspace_statistic_rows WHERE kind='radar-data' LIMIT 1")).rows[0].payload.codec, 'deflate-json-v1');
  assert.equal(typeof (await pool.query("SELECT payload FROM workspace_statistic_rows WHERE kind='radar' LIMIT 1")).rows[0].payload, 'number');
  assert.equal(radar.snapshot.summary.counts.product, 240);
  assert.equal(Object.values(radar.snapshot.summary.activity).reduce((sum, day) => sum + day.product, 0), 240);
  const nextRadar = await reads.statistics({ kind: 'radar', type: 'product', page: 2, pageSize: 20 });
  assert.equal(new Set([...radar.rows, ...nextRadar.rows].map(r => r.id)).size, 40);
  const mexicoRadar = await reads.statistics({ kind: 'radar', type: 'product', market: 'MX' });
  assert.equal(mexicoRadar.total, 120);
  assert.ok(mexicoRadar.rows.every(r => r.market === 'MX'));
  assert.match((await reads.statistics({ kind: 'radar', type: 'product', report: true })).report, /240/);
  const formulas = await reads.statistics({ kind: 'formulas', market: 'US' });
  assert.equal(formulas.snapshot.coverage.total, 120);
  assert.equal(formulas.snapshot.coverage.observed, 120);
  assert.equal(formulas.rows[0].products, 120);
  assert.equal((await reads.statistics({ kind: 'opportunities', tab: 'concept' })).rows[0].count, 240);
  assert.equal((await reads.statistics({ kind: 'opportunities', tab: 'new', saved: [] })).total, 0);
  assert.equal((await reads.statistics({ kind: 'opportunities', tab: 'new', saved: ['Product 1'] })).total, 1);
  await assert.rejects(reads.statistics({ kind: 'invalid' }), /未知/);
  const report = { id: 'report-qa', title: 'Synthetic report', kind: 'market_analysis', market: 'VN', createdAt: new Date().toISOString(), status: 'completed', evidenceIds: ['qa'], marketSnapshot: { coverage: { products: 99 }, topProducts: ['x'.repeat(50000)] }, modelAnalysis: { model: 'fake', findings: [] } };
  await putDocument('workspace_documents', 'business:insightReports:report-qa', report);
  assert.equal((await readReportSummaries(pool))[0].title, 'Synthetic report');
  await drain();
  const reportSummary = (await readReportSummaries(pool))[0];
  assert.deepEqual(reportSummary.marketSnapshot, { coverage: { products: 99 } });
  assert.equal(reportSummary.hasModelAnalysis, true);
  assert.equal(reportSummary.revision, 1);
  await putDocument('workspace_documents', 'business:insightReports:report-qa', { ...report, title: 'Changed before indexing' });
  assert.equal((await readReportSummaries(pool))[0].title, 'Changed before indexing');
  await pool.query('DELETE FROM workspace_documents WHERE name=$1', ['business:insightReports:report-qa']);
  assert.equal((await readReportSummaries(pool)).length, 0);
  await drain();
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
  const siteEvidence = (await reads.details({ collection: 'sites', id: 's1' })).record.coreSummary.related;
  assert.equal(siteEvidence.products, 120);
  assert.equal(siteEvidence.ads, 31);
  assert.equal(siteEvidence.hasIngredients, true);
  await pool.query('UPDATE research_keywords SET data=$2 WHERE natural_key=$1', ['key2', { ...keyword(2), seedTerm: keyword(0).term, source: 'Google搜索联想' }]);
  await putDocument('workspace_documents', 'business:products:metric-qa', {
    id: 'metric-qa', title: 'Metric QA', market: 'US', sourceProvider: 'Sorftime', sourcePlatform: 'Amazon', sourceProductId: 'ASIN-QA',
    benefits: [], ingredientInsights: [], sourceMetrics: { collectedAt: '2026-10-22T12:00:00Z' },
    sourceContent: { descriptions: ['complete source text'] },
    decisionData: { series: [{ metric: 'sales_volume', provider: 'Sorftime', platform: 'Amazon', productId: 'ASIN-QA', market: 'US', collectedAt: '2026-10-22T12:00:00Z', period: 'day', points: [{ start: '2026-09-22', end: '2026-10-21', value: 60 }] }] },
  });
  await drain();
  const projectedMetric = (await reads.list({ collection: 'products', search: 'Metric QA' })).rows[0];
  assert.equal(projectedMetric.coreSummary.periods[30].find((metric) => metric.key === 'sales').value, 60);
  assert.equal(projectedMetric.decisionData, undefined);
  assert.deepEqual((await reads.details({ collection: 'keywords', id: 'k0' })).record.coreSummary.related.expansions, [{ term: keyword(2).term, source: 'Google搜索联想' }]);
  const fullExport = await reads.exportRecords({ collection: 'products', ids: ['metric-qa', 'p0'] });
  assert.equal(fullExport.rows[0].sourceContent.descriptions[0], 'complete source text');
  assert.equal(fullExport.rows[0].decisionData.series[0].points[0].value, 60);
  assert.equal(fullExport.rows[1].sourceContent.descriptions[0].length, 50000);
  await assert.rejects(reads.exportRecords({ collection: 'products', ids: Array.from({ length: 51 }, (_, index) => String(index)) }), /50/);
  await pool.query('DELETE FROM workspace_documents WHERE name=$1', ['business:products:metric-qa']);
  await drain();
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
  for (const [key, id] of [['cafe', 'accent-a'], ['caf\u00e9', 'accent-b']]) {
    await pool.query('INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)', [
      `case:${key}`,
      { ...keyword(90), id, term: `collation-probe-${id}` },
    ]);
  }
  await drain();
  assert.equal((await reads.list({ collection: 'keywords', search: 'collation-probe' })).total, 2);
  for (const [id, date] of [['p10', '2026-10-15'], ['p12', '2026-10-22'], ['p14', '2026-10-14']]) {
    const old = (await reads.details({ collection: 'products', id })).record;
    await putDocument('workspace_documents', `business:products:${id}`, {
      ...old, decisionData: { ...old.decisionData, listing: { date, provider: 'Synthetic', platform: 'Amazon', market: 'US', collectedAt: '2026-10-22T00:00:00Z', evidenceUrl: 'https://synthetic.example/product' } },
    });
  }
  await drain();
  const listingFilter = { collection: 'products', market: 'US', listedFrom: '2026-10-15', listedTo: '2026-10-22' };
  assert.equal((await reads.list({ ...listingFilter, pageSize: 1 })).total, 2);
  assert.equal((await reads.list({ ...listingFilter, page: 2, pageSize: 1 })).rows.length, 1);
  const listed = await reads.selection(listingFilter);
  assert.deepEqual(listed.rows.map((row) => row.id).sort(), ['p10', 'p12']);
  assert.deepEqual((await reads.exportRecords({ collection: 'products', ids: listed.rows.map((row) => row.id) })).rows.map((row) => row.id).sort(), ['p10', 'p12']);
  assert.equal((await reads.list({ ...listingFilter, search: '镁软糖' })).total, 2);
  assert.equal((await reads.list({ ...listingFilter, search: 'MAGNESIUM' })).total, 2);
  assert.equal((await reads.list({ ...listingFilter, market: 'MX' })).total, 0);
  await assert.rejects(reads.list({ ...listingFilter, listedFrom: '2026-10-30' }), /开始日期/);
  if (engine === 'mysql') {
    for (const table of ['workspace_read_dirty', 'workspace_read_rows'])
      await pool.query(`ALTER TABLE ${table} MODIFY source_key varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL`);
    await migrateWorkspaceReads(pool, engine);
    await drain();
    assert.equal((await reads.list({ collection: 'keywords', search: 'collation-probe' })).total, 2);
  }
  await pool.query('UPDATE research_keywords SET data=$1 WHERE natural_key=$2', [
    { ...keyword(90), id: 'accent-a', term: 'collation-probe-updated' }, 'case:cafe',
  ]);
  await drain();
  assert.equal((await reads.list({ collection: 'keywords', search: 'collation-probe' })).total, 2);
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
