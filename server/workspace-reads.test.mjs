import { shanghaiDay } from './collection-time.mjs';
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';
import { readReportSummaries } from './report-read-summaries.mjs';

const pgSql = (postgres) => postgres;
test('keyword list projection includes collected seed and related query translations', () => {
  const { data } = projectRecord('keywords', {
    id: 'translated-keyword', term: 'maltitol powder', termZh: '麦芽糖醇粉', seedTerm: 'Maltitol', seedTermZh: '麦芽糖醇', source: 'synthetic', series: [],
    trendRelatedTop: [{ query: 'maltitol gummies', queryZh: '麦芽糖醇软糖', value: 100 }],
  });
  assert.equal(data.seedTermZh, '麦芽糖醇');
  assert.equal(data.trendRelatedTop[0].queryZh, '麦芽糖醇软糖');
});
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
test('product projection indexes FBM and regular new-product classification types', () => {
  const product = projectRecord('products', {
    id: 'new-product',
    title: 'Creatine',
    market: 'US',
    newProductClassifications: [
      { type: 'fbm_new', label: 'FBM新品', listingDate: '2026-11-01' },
      { type: 'regular_new', label: '常规新品', listingDate: '2026-11-01' },
      { type: 'ignored', label: '忽略' },
    ],
  });
  assert.deepEqual(
    product.links
      .filter(([relation]) => relation === 'newProduct')
      .map(([, target]) => target)
      .sort(),
    ['fbm_new', 'regular_new'],
  );
});
test('business projections expose keyword links for reverse association counts', () => {
  const projection = projectRecord('products', {
    id: 'keyword-linked-product',
    market: 'US',
    title: 'Creatine Gummies',
    keywordIds: ['keyword-creatine'],
  });
  assert.deepEqual(projection.links.filter(([relation]) => relation === 'keyword'), [
    ['keyword', 'keyword-creatine'],
  ]);
});
const keyword = (i) => ({
  id: `k${i}`,
  term: `magnesium gummies ${i}`,
  batch: i < 17 ? '2026-11-01-US' : 'legacy-batch',
  termZh: '镁软糖',
  market: i % 2 ? 'MX' : 'US',
  category: '运动营养',
  source: 'Semrush',
  reviewStatus: 'selected',
  favorite: false,
  productIds: i === 0 ? ['p0', 'p1', 'deleted-product'] : [`p${i}`],
  siteIds: ['s1'],
  series: [],
  trendPoints: [],
  trendHistoryPoints: Array.from({ length: 2000 }, (_, x) => ({
    date: '2025-01-01',
    value: x % 100,
  })),
  dataNature: 'collected',
});

export async function exerciseWorkspaceReads(pool, sql, engine, lock, unlock) {
  let now = Date.parse('2026-10-27T00:00:00Z');
  const clock = mock.method(Date, 'now', () => now);
  try {
    return await exerciseReadModel(pool, sql, engine, lock, unlock, () => { now = Date.parse('2026-10-27T01:00:00Z'); });
  } finally { clock.mock.restore(); }
}

async function exerciseReadModel(
  pool,
  sql,
  engine,
  lock = async () => true,
  unlock = async () => {},
  advanceStatistics,
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
      keywordIds: i === 0 || i === 2 ? ['k0'] : [],
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
    keywordIds: ['k0'],
    dataNature: 'collected',
  });
  for (let i = 0; i < 31; i++)
    await putDocument('workspace_documents', `business:ads:a${i}`, {
      id: `a${i}`,
      pageId: '123456',
      market: 'US',
      brand: 'Test advertiser',
      brandZh: '测试广告主',
      headline: 'Test',
      headlineZh: '测试素材',
      collectionBatches: i < 3 ? ['October', 'November'] : ['October'],
      copy: 'x'.repeat(1499) + '\uD83D\uDC8A' + 'x'.repeat(8500),
      keywordIds: ['k0'],
      siteIds: ['s1'],
      productId: i < 2 ? 'p1' : 'p2',
      status: '投放中',
      lastCollectedAt: '2026-10-22T00:00:00Z',
      dataNature: 'collected',
    });
  await drain();
  const firstProducts = await reads.list({ collection: 'products', pageSize: 1 });
  const keywordSummary = await reads.list({ collection: 'keywords', market: 'US', search: 'magnesium gummies 0', pageSize: 1 });
  assert.equal(keywordSummary.total, 1);
  // The list must retain counts when merging freshly saved trend evidence.
  // Include forward-only p1, reverse-only p2 and p0/s1 linked both ways;
  // omit the deleted product and never count the same business row twice.
  assert.deepEqual(keywordSummary.rows[0].relatedCounts, { ads: 31, products: 3, sites: 1 });
  for (const collection of ['ads', 'products', 'sites']) {
    const filtered = await reads.list({ collection, keywordId: 'k0', pageSize: 1 });
    assert.equal(keywordSummary.rows[0].relatedCounts[collection], filtered.total);
  }
  const otherKeyword = await reads.list({ collection: 'keywords', keywordId: 'k2', pageSize: 1 });
  assert.deepEqual(otherKeyword.rows[0].relatedCounts, { ads: 0, products: 1, sites: 1 });
  assert.equal(keywordSummary.marketSummary.total, 17);
  assert.equal(keywordSummary.marketSummary.selected, 17);
  assert.equal((await reads.list({ collection: 'keywords' })).marketSummary.total, 34);
  assert.equal(firstProducts.rows[0].linkedSite.domain, 'synthetic.example');
  assert.equal(firstProducts.rows[0].linkedSite.brand, 'Test brand');
  assert.deepEqual(Object.keys(firstProducts.rows[0].linkedSite).sort(), ['brand', 'domain', 'id', 'market']);
  const dates = Array.from({ length: 365 }, (_, i) => ({ date: new Date(Date.parse('2026-10-26T00:00:00Z') - (365 - i) * 86400000).toISOString().slice(0, 10), value: 50 }));
  assert.equal((await reads.list({ collection: 'ads', linkedProduct: 'p1', linkedSite: 's1' })).total, 2);
  assert.equal((await reads.list({ collection: 'ads', linkedProduct: 'p1', linkedSite: 'missing' })).total, 0);
  assert.equal((await reads.list({ collection: 'ads', linkedProduct: 'missing' })).total, 0);
  const adBatch = await reads.list({ collection: 'ads', batch: 'novem' });
  assert.equal(adBatch.total, 3);
  assert.equal(adBatch.rows[0].brandZh, '测试广告主');
  assert.deepEqual(adBatch.rows[0].collectionBatches, ['October', 'November']);
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
  assert.deepEqual(savedRow.relatedCounts, { ads: 31, products: 3, sites: 1 });
  const batchPage = await reads.list({ collection: 'keywords', batch: '2026-11-01' });
  assert.equal(batchPage.total, 17);
  assert.ok(batchPage.rows.every((row) => row.batch === '2026-11-01-US'));
  await drain();
  const overview = await reads.overview({ market: 'ALL' });
  assert.equal(overview.snapshot.counts.keywords, 34);
  assert.equal(overview.snapshot.counts.products, 240);
  assert.equal(overview.snapshot.productMarkets.US, 120);
  assert.equal((await reads.statistics({ kind: 'radar' })).snapshot, null);
  advanceStatistics();
  await reads.refresh();
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
  assert.equal(advertisers.rows[0].nameZh, '测试广告主');
  assert.equal((await reads.list({ collection: 'advertisers', search: '测试广告主' })).total, 1);
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
    id: 'metric-qa', title: 'Metric QA', market: 'US', sourceProvider: 'Sorftime', sourcePlatform: 'Amazon', sourceProductId: 'B000000001',
    benefits: [], ingredientInsights: [], sourceMetrics: { collectedAt: '2026-10-22T12:00:00Z' },
    sourceContent: { descriptions: ['complete source text'] },
    decisionData: { series: [{ metric: 'sales_volume', provider: 'Sorftime', platform: 'Amazon', productId: 'B000000001', market: 'US', collectedAt: '2026-10-22T12:00:00Z', period: 'day', points: [{ start: '2026-09-22', end: '2026-10-21', value: 60 }] }] },
  });
  await drain();
  const projectedMetric = (await reads.list({ collection: 'products', search: 'Metric QA' })).rows[0];
  assert.equal(projectedMetric.asin, 'B000000001');
  // Old cached list rows have only sourceProductId. Reading supplies ASIN without
  // rebuilding the projection or fetching the product from its paid provider.
  await pool.query(`UPDATE workspace_read_rows SET payload=${sql("payload-'asin'", "JSON_REMOVE(payload,'$.asin')")} WHERE collection='products' AND id='metric-qa'`);
  assert.equal((await reads.list({ collection: 'products', search: 'Metric QA' })).rows[0].asin, 'B000000001');
  assert.equal((await reads.details({ collection: 'products', id: 'metric-qa' })).record.asin, 'B000000001');
  assert.equal(projectedMetric.coreSummary.periods[30].some((metric) => ['sales', 'dailySales'].includes(metric.key)), false);
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
  assert.match((await reads.list({ collection: 'products' })).error, /本列表部分记录/);
  assert.equal((await reads.list({ collection: 'keywords' })).error, '', 'a bad product must not show an error on the keyword list');
  assert.equal((await reads.list({ collection: 'ads' })).error, '', 'a bad product must not show an error on the advertising list');
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
  const poolProduct = (await reads.details({ collection: 'products', id: 'p12' })).record;
  await putDocument('workspace_documents', 'business:products:p12', { ...poolProduct, sourceCategories: ['Amazon · US · Synthetic (123)'], newProductClassifications: [{ type: 'regular_new', listingDate: '2026-10-22' }] });
  await drain();
  assert.equal((await reads.list({ collection: 'products', productPool: 'pool' })).total, 1);
  assert.equal((await reads.list({ collection: 'products', productPool: 'existing', sourceCategory: 'Amazon · US · Synthetic (123)' })).total, 0);
  assert.equal((await reads.selection({ collection: 'products', productPool: 'pool', sourceCategory: 'Amazon · US · Synthetic (123)' })).count, 1);
  assert.ok((await reads.facets({ collection: 'products' })).facets.sourceCategory.includes('Amazon · US · Synthetic (123)'));
  const currentProduct = (await reads.details({ collection: 'products', id: 'p10' })).record;
  await putDocument('workspace_documents', 'business:products:p10', { ...currentProduct, sourceProvider: 'Synthetic Provider', sourcePlatform: 'Amazon', currency: 'USD' });
  await drain();
  assert.equal((await reads.list({ collection: 'products', provider: 'Synthetic Provider', productPlatform: 'Amazon', pageSize: 1 })).total, 1);
  assert.equal((await reads.selection({ collection: 'products', provider: 'Synthetic Provider', productPlatform: 'Shopee' })).count, 0);
  assert.equal((await reads.list({ collection: 'products', provider: 'Synthetic Provider', siteLinked: 'unlinked' })).total, 0);
  assert.equal((await reads.list({ collection: 'products', provider: 'Synthetic Provider', siteLinked: 'linked' })).total, 1);
  const identityFacets = (await reads.facets({ collection: 'products' })).facets;
  assert.ok(identityFacets.provider.includes('Synthetic Provider'));
  assert.ok(identityFacets.productPlatform.includes('Amazon'));
  assert.ok(identityFacets.productPlatform.includes('未记录'));
  assert.ok(!identityFacets.productPlatform.includes('独立站'));
  assert.equal((await reads.list({ collection: 'products', productPlatform: '独立站' })).total, 0);
  const legacy = (await reads.details({ collection: 'products', id: 'p2' })).record;
  await putDocument('workspace_documents', 'business:products:p2', { ...legacy, siteId: 's1', evidenceUrl: 'https://www.synthetic.example/products/2' });
  await drain();
  const websitePage = await reads.list({ collection: 'products', productPlatform: '独立站', pageSize: 1 });
  assert.equal(websitePage.total, 1);
  assert.equal(websitePage.rows[0].id, 'p2');
  assert.equal(websitePage.rows[0].sourcePlatform, '独立站');
  assert.equal(websitePage.rows[0].linkedSite.domain, 'synthetic.example');
  assert.equal((await reads.details({ collection: 'products', id: 'p10' })).record.sourcePlatform, 'Amazon');
  assert.ok((await reads.facets({ collection: 'products' })).facets.productPlatform.includes('独立站'));
  assert.equal((await reads.selection({ collection: 'products', productPlatform: '独立站' })).rows[0].linkedSite.domain, 'synthetic.example');
  assert.equal((await reads.exportRecords({ collection: 'products', ids: ['p2'] })).rows[0].sourcePlatform, '独立站');
  // Site display is read from the small authoritative document fields, even
  // when its projection and the separate facets request have not refreshed.
  const sourceSite = (await pool.query("SELECT value FROM workspace_documents WHERE name='business:sites:s1'")).rows[0].value;
  await putDocument('workspace_documents', 'business:sites:s1', { ...sourceSite, brand: 'Updated brand', secretExtra: 'not-returned' });
  const updatedPage = await reads.list({ collection: 'products', productPlatform: '独立站' });
  assert.equal(updatedPage.rows[0].linkedSite.brand, 'Updated brand');
  assert.equal(updatedPage.rows[0].linkedSite.secretExtra, undefined);
  assert.ok(identityFacets.currency.includes('USD'));
  assert.ok(identityFacets.currency.includes('未记录'));
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
  for (const [i, raw] of ['500+', '3,000+', '12.3K', undefined].entries()) {
    const id = `sort-probe-${i}`;
    await putDocument('workspace_documents', `business:products:${id}`, {
      id, title: `sort-probe ${i}`, market: 'US', benefits: [], ingredientInsights: [],
      firstSeenAt: '2026-10-26T00:00:00Z',
      lastCollectedAt: i === 3 ? undefined : `2026-10-25T0${i}:00:00Z`,
      sourceMetrics: { soldRaw: raw, collectedAt: i === 0 ? '2026-10-25T12:00:00+08:00' : undefined },
      sourceContent: { collectedAt: i === 1 ? '2026-10-25T05:00:00Z' : undefined },
      decisionData: i === 3 ? {} : { listing: { date: `2026-10-${20 + i}`, provider: 'Synthetic', platform: 'Test', market: 'US', collectedAt: '2026-10-25T00:00:00Z', evidenceUrl: 'https://synthetic.example/product' } },
    });
  }
  await drain();
  const sortQuery = { collection: 'products', search: 'sort-probe', pageSize: 2 };
  for (const [sort, ascending] of [['collectedAt', [2, 0, 1, 3]], ['core:cumulativeSold', [0, 1, 2, 3]], ['core:listingDate', [0, 1, 2, 3]]]) {
    for (const [order, expected] of [['ascend', ascending], ['descend', [...ascending.slice(0, 3).reverse(), 3]]]) {
      const firstPage = await reads.list({ ...sortQuery, sort, order });
      const secondPage = await reads.list({ ...sortQuery, sort, order, page: 2 });
      assert.equal(firstPage.total, 4);
      assert.deepEqual([...firstPage.rows, ...secondPage.rows].map((row) => row.id), expected.map((i) => `sort-probe-${i}`));
    }
  }
  assert.equal((await reads.list({ ...sortQuery, market: 'MX', sort: 'core:cumulativeSold' })).total, 0);
  const associationCounts = [
    { ads: 0, products: 0, sites: 0 },
    { ads: 2, products: 1, sites: 3 },
    { ads: 10, products: 2, sites: 1 },
    { ads: 2, products: 2, sites: 0 },
    { ads: 0, products: 0, sites: 0 },
    { ads: 11, products: 4, sites: 4 },
  ];
  for (const [i, counts] of associationCounts.entries()) {
    const id = `association-sort-${i}`, market = i === 5 ? 'MX' : 'US';
    const source = { ...keyword(i), id, term: id, market, productIds: ['deleted-sort-product'], siteIds: ['deleted-sort-site'], trendHistoryPoints: [] };
    for (const collection of ['ads', 'products', 'sites']) {
      for (let j = 0; j < counts[collection]; j++) {
        const businessId = `association-${collection}-${i}-${j}`;
        if (collection !== 'ads' && j % 2 === 0) source[collection === 'products' ? 'productIds' : 'siteIds'].push(businessId);
        await putDocument('workspace_documents', `business:${collection}:${businessId}`, {
          id: businessId, market, title: businessId, brand: businessId,
          domain: `${businessId}.example`, benefits: [], ingredientInsights: [],
          mainProducts: [], sources: [],
          keywordIds: collection === 'ads' || j % 2 === 1 || j % 3 === 0 ? [id] : [],
        });
      }
    }
    await pool.query('INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)', [id, source]);
  }
  await drain();
  for (const [sort, collection] of [['relatedAds', 'ads'], ['relatedProducts', 'products'], ['relatedSites', 'sites']]) {
    for (const order of ['ascend', 'descend']) {
      const expected = associationCounts.slice(0, 5).map((counts, i) => ({ id: `association-sort-${i}`, count: counts[collection] }))
        .sort((a, b) => (a.count - b.count) * (order === 'ascend' ? 1 : -1) || a.id.localeCompare(b.id));
      const actual = [];
      for (let page = 1; page <= 3; page++) {
        const listed = await reads.list({ collection: 'keywords', search: 'association-sort-', market: 'US', sort, order, pageSize: 2, page });
        assert.equal(listed.total, 5);
        actual.push(...listed.rows.map(row => ({ id: row.id, count: row.relatedCounts[collection] })));
      }
      assert.deepEqual(actual, expected, `${sort} ${order}: global numeric order, stable ties, zero and deleted links`);
      const otherMarket = await reads.list({ collection: 'keywords', search: 'association-sort-', market: 'MX', sort, order, pageSize: 1 });
      assert.equal(otherMarket.total, 1);
      assert.equal(otherMarket.rows[0].relatedCounts[collection], associationCounts[5][collection]);
      assert.equal((await reads.list({ collection: 'keywords', search: 'missing-association-sort', sort, order })).total, 0);
    }
  }
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
  // All list actions share exact date filters, independent of page boundaries.
  for (const collection of ['keywords', 'products', 'sites', 'ads']) {
    const times = ['2026-11-08T15:59:59.999Z', '2026-11-08T16:00:00.000Z', '2026-11-09T15:59:59.999Z', '2026-11-09T16:00:00.000Z', ''];
    for (const [i, at] of times.entries()) {
      const id = `date-probe-${collection}-${i}`;
      const item = { id, market: 'US', term: id, title: id, domain: `${id}.example`, source: 'synthetic', category: 'test', benefits: [], ingredientInsights: [], mainProducts: [], sources: [], collectedAt: at, lastCollectedAt: at, firstSeenAt: '2026-11-09T00:00:00Z', series: [] };
      if (collection === 'keywords') await pool.query('INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)', [id, item]);
      else await putDocument('workspace_documents', `business:${collection}:${id}`, item);
    }
    await drain();
    const query = {collection, market:'US', search:`date-probe-${collection}`, collectedFrom:'2026-11-09',collectedTo:'2026-11-09'};
    const firstPage = await reads.list({...query,pageSize:1,page:1});
    const secondPage = await reads.list({...query,pageSize:1,page:2});
    assert.equal(firstPage.total,2,collection);assert.equal(secondPage.total,2,collection);
    assert.notEqual(firstPage.rows[0].id,secondPage.rows[0].id);
    const selection = await reads.selection(query);
    assert.equal(selection.count,2);
    const exported = await reads.exportRecords({...query,ids:selection.rows.map(r => r.id)});
    assert.equal(exported.rows.length,2);
    assert.ok(exported.rows.every(p => /-[12]$/.test(p.id)));
    await assert.rejects(reads.list({...query,collectedFrom:'2026-02-30'}), /采集日期/);
  }
  const today=shanghaiDay();
  for (const [id,market,firstSeenAt,pool] of [
    ['today-new','US',`${today}T01:00:00+08:00`,true],
    ['today-foreign','MX',`${today}T02:00:00+08:00`,true],
    ['today-existing','US',`${today}T03:00:00+08:00`,false],
    ['today-old','US','2026-01-01T00:00:00Z',true],
  ]) await putDocument('workspace_documents',`business:products:${id}`,{id,market,title:id,firstSeenAt,benefits:[],ingredientInsights:[],newProductClassifications:pool?[{type:'new_listing'}]:[]});
  for (const [id,market,enabled,status] of [['monitor-a','US',true,'failed'],['monitor-b','US',false,'blocked'],['monitor-c','MX',true,'partial'],['monitor-d','US',true,'completed']]) {
    await putDocument('workspace_documents',`competitor:target:${id}`,{id,kind:'site',market,enabled});
    await putDocument('workspace_documents',`competitor:run:${id}`,{status});
  }
  await drain();
  const todayUS = (await reads.overview({market:'US'})).snapshot;
  const todayAll = (await reads.overview({market:'ALL'})).snapshot;
  assert.equal(todayUS.todayNewProducts.count,1);assert.equal(todayAll.todayNewProducts.count,2);
  assert.equal(todayUS.monitoring.problems,1);assert.equal(todayAll.monitoring.problems,2);
  const todayList=await reads.list({collection:'products',market:'US',productPool:'pool',discoveredOn:today});
  assert.equal(todayList.total,todayUS.todayNewProducts.count);assert.equal(todayList.rows[0].id,'today-new');
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
