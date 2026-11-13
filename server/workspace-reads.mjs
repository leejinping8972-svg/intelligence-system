import { collectionRange, productDiscoveryDay, resourceCollectionTime, shanghaiDay } from './collection-time.mjs';
import { createHash, randomUUID } from 'node:crypto';

import {BATCH_SETTINGS, batchRecord} from './collection-batch-domain.mjs';
import {conceptMemberCondition} from './concept-members.mjs';
import { createConceptMonitor } from './concept-monitor.mjs';
import {
  assessKeyword,
  groupAdvertisers,
  productDataSource,
  productDecisions,
  trendComparisons,
  coreMetrics,
} from './model.js';
import { discoveryDecision } from './discovery-newness.mjs';
import { scoreSite } from './site-scoring.mjs';
import { sourceSiteDomain } from './site-keyword-provenance.mjs';
import { createWorkspaceStatistics } from './workspace-statistics.mjs';
import { projectReportSummary } from './report-read-summaries.mjs';
import { keywordTrendList } from './keyword-trend-list.mjs';
import { keywordMetricEvidence } from './keyword-metric-evidence.mjs';
import { keywordVolumeSql } from './keyword-volume-sort.mjs';
import { productChineseName } from './product-names.mjs';
import { productAsin } from './product-asin.mjs';
import { productSellerDetails, productSellerId, productSellerName } from './product-seller.mjs';
import { productListingDate, validateListingRange } from './product-listing.mjs';
import { compareProductValues, productSortKeys, productSortValue } from './product-list-sort.mjs';
import { productPlatformSql, resolvedProductPlatform } from './product-platform.mjs';
import { createDirtyBatchReader, isolateProjectionWrites, projectionCollection } from './workspace-projection-writes.mjs';

const collections = new Set([
  'keywords',
  'products',
  'sites',
  'ads',
  'advertisers',
  'insightReports',
]);
const MODEL_VERSION = 'workspace-reads-v8-collection-time';
const keywordAssociationSorts = new Map([
  ['relatedAds', 'ads'], ['relatedProducts', 'products'], ['relatedSites', 'sites'],
]);
// Share the same bidirectional, existing-record union for displayed counts
// and ordering. UNION also removes links saved on both sides.
function keywordAssociationRows(slots, collection) {
  const kind = collection ? `r.collection='${collection}'` : "r.collection IN ('ads','products','sites')";
  return `SELECT l.target,r.collection,r.id FROM workspace_read_links l
    JOIN workspace_read_rows r ON r.collection=l.collection AND r.id=l.id
    WHERE l.relation='keyword' AND ${kind}${slots ? ` AND l.target IN (${slots})` : ''}
    UNION
    SELECT l.id AS target,r.collection,r.id FROM workspace_read_links l
    JOIN workspace_read_rows r ON r.collection=l.relation AND r.id=l.target
    WHERE l.collection='keywords' AND ${kind}${slots ? ` AND l.id IN (${slots})` : ''}`;
}
const normalizeTerm = (term) => String(term || '').normalize('NFKC').trim().toLowerCase().replaceAll(/\s+/g, ' ');
const truncate = (value, length) =>
  Array.from(String(value ?? '')).slice(0, length).join('');
const pick = (value, keys) =>
  Object.fromEntries(
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, value[key]]),
  );
const listKeys = {
  advertisers:
    'id pageId market name nameZh adId adIds adCount active stopped siteIds domains collectedAt dataNature',
  keywords:
    'id term termZh batch market category source growth seedTerm seedTermZh collectedAt metrics reviewStatus reviewNote favorite productIds siteIds updatedAt dataNature siteCollection adCollection semrushCollection trendStatus trendMessage trendCollectedAt discoveryStatus discoveryMessage',
  products:
    'id title titleZh publicDataEvidence brand brandZh market category categoryZh form formZh size sizeZh price currency ingredient ingredientZh dose claim claimZh benefits benefitsZh benefitEvidence ingredientInsights formula siteId keywordIds keywordDerivation color imageUrl reviewed favorite firstSeenAt publishedAt evidenceUrl dataNature sourceProvider sourcePlatform sourceProductId sourceUrl sourceMetrics lastCollectedAt collectionFields dataCompletion discovery sourceMarket newProductClassifications sourceCategories',
  sites:
    'id brand brandZh domain market platform type keyword keywordIds sourceKeywordLinks category categoryZh description descriptionZh mainProducts mainProductsZh ownershipBackground ownershipEvidence signals sources sourceEvidence categoryEvidence metrics metricsStatus metricsMessage productCollection collectorMode lastCollectedAt evidenceUrl confidence dataNature',
  ads: 'id brand brandZh market platform headline headlineZh copy copyZh sellingPointZh format productId status color archiveId pageId keywordIds query collectionBatches siteIds landingUrls imageUrls videoUrls videoPosterUrls lastCollectedAt startDate source firstSeenAt evidenceUrl dataNature discovery',
};
export function projectRecord(collection, value) {
  if (!value.id) throw new Error('记录缺少编号');
  if (collection === 'insightReports') return {
    data: projectReportSummary(value), links: [],
    columns: [value.market || '', '', null, '', '', value.reviewStatus || 'pending', '', 0, value.createdAt || '', '', '', '', '', 'unknown', 0, value.title || ''],
  };
  const data = pick(value, listKeys[collection].split(' '));
  if (collection === 'products' && value.resourceEvidence) {
    data.resourceEvidence = pick(value.resourceEvidence, ['version', 'jobId', 'routeId', 'platform', 'provider', 'market', 'mode', 'category', 'researchCategory', 'requestedWindow', 'metric', 'ranking', 'coverage', 'collectedAt', 'evidenceUrl', 'states']);
  }
  if (!data.id) throw new Error('记录缺少编号');
  data.listSummary = true;
  if (collection !== 'advertisers') {
    const evidence = value.coreEvidence;
    if (evidence) {
      data.coreEvidence = pick(evidence, ['version', 'fieldUpdatedAt', 'metrics', 'fx', 'historyCount', 'historyTruncated']);
      if (collection === 'sites') data.coreEvidence.history = (evidence.history || []).filter((item) => item.market === value.market && item.source === value.metrics?.source && typeof item.organicTraffic === 'number').slice(-2);
    }
    const historical = collection === 'products'
      ? value.decisionData?.series?.length || evidence?.history?.length
      : collection === 'keywords' && (value.trendHistoryPoints?.length || value.trendPoints?.length);
    if (historical) data.coreSummary = { periods: Object.fromEntries([30, 90, 180, 365].map((days) => [days, coreMetrics(collection, value, days).filter((metric) => ['sales', 'dailySales', 'sourceSales', 'observedDelta', 'relativeHeat', 'trendChange'].includes(metric.key))])) };
    if (collection === 'products' && value.sourceContent) {
      const summary = pick(value.sourceContent, ['collectedAt', 'sellingPoints']);
      if (Object.keys(summary).length) data.sourceContent = summary;
    }
    if (collection === 'keywords') Object.assign(data, pick(value, ['trendRelatedTop', 'trendRelatedRising', 'trendInsightsStatus', 'trendInsightsMessage', 'trendInsightsPeriod', 'trendSourceUrl']));
  }
  if (collection === 'products') {
    const asin = productAsin(value);
    if (asin) data.asin = asin;
    const sellerName = productSellerName(value);
    if (sellerName) data.sellerName = sellerName;
    const sellerId = productSellerId(value);
    if (sellerId) data.sellerId = sellerId;
    const sellerDetails = productSellerDetails(value);
    if (sellerDetails) data.sellerDetails = sellerDetails;
    data.ingredientInsights = (value.ingredientInsights || [])
      .slice(0, 20)
      .map((item) => ({
        name: item.name,
        amount: item.amount,
        role: item.role,
        evidence: truncate(item.evidence, 600),
      }));
    data.benefits = (value.benefits || []).slice(0, 30);
    data.benefitEvidence = truncate(value.benefitEvidence, 1200);
  }
  if (collection === 'keywords') {
    data.assessment = assessKeyword(value);
    data.score = data.assessment.score;
    data.trendSummary = trendComparisons(value);
    Object.assign(data, keywordTrendList(value));
    data.productIds ||= [];
    data.siteIds ||= [];
  }
  if (collection === 'sites') data.assessment = scoreSite(value);
  if (collection === 'products') data.decisionTags = productDecisions(value);
  if (collection === 'products' && value.decisionData?.listing)
    data.decisionData = { listing: value.decisionData.listing };
  if (collection === 'ads') {
    data.copy = truncate(data.copy, 1500);
    for (const key of ['imageUrls', 'videoUrls', 'videoPosterUrls'])
      data[key] = (data[key] || []).slice(0, 3);
  }
  const discovery = ['products', 'ads'].includes(collection)
    ? discoveryDecision(value, collection === 'ads' ? 'ad' : 'product')
    : {};
  const source =
    collection === 'products' ? productDataSource(value) : value.source || '';
  const links = new Map();
  const add = (relation, values) => {
    for (const item of values || [])
      if (item !== undefined && item !== null && String(item))
        links.set(`${relation}\0${truncate(item, 180)}`, [
          relation,
          truncate(item, 180),
        ]);
  };
  add('tag', [
    ...(data.assessment?.tags || []),
    ...String(value.source || '')
      .split(' / ')
      .map((s) => s.replaceAll(' · 实采', '').trim()),
  ]);
  add('products', value.productIds);
  add('sites', value.siteIds);
  add('keyword', value.keywordIds);
  if (collection === 'ads') add('batch', value.collectionBatches);
  if (collection === 'keywords' && value.seedTerm) add('seed', [normalizeTerm(value.seedTerm)]);
  add(
    'source',
    collection === 'sites'
      ? value.sources?.length
        ? value.sources
        : [
            value.dataNature === 'imported'
              ? '人工导入'
              : '历史采集 · 来源待核对',
          ]
      : [source],
  );
  add('benefit', value.benefits);
  if (collection === 'products') add('sourceCategory', value.sourceCategories);
  if (collection === 'products') {
    add('listingDate', [productListingDate(value)]);
    add('discoveredDay', [productDiscoveryDay(value)]);
  }
  if (collection === 'products')
    add(
      'newProduct',
      (value.newProductClassifications || [])
        .map((item) => item?.type)
        .filter((type) =>
          ['fbm_new', 'regular_new', 'new_listing'].includes(type),
        ),
    );
  add(
    'ingredient',
    value.ingredientInsights?.map((item) => item.name),
  );
  add(
    'decision',
    data.decisionTags?.map((item) => item.key),
  );
  const text = [
    value.name,
    value.nameZh,
    ...(value.domains || []),
    value.term,
    value.termZh,
    value.batch,
    value.seedTerm,
    value.title,
    collection === 'products' ? productChineseName(value) : '',
    value.brand,
    value.brandZh,
    value.domain,
    value.keyword,
    value.headline,
    value.headlineZh,
    value.copy,
    value.copyZh,
    ...(value.collectionBatches || []),
    value.query,
    value.pageId,
    value.category,
    value.categoryZh,
    value.descriptionZh,
    value.ownershipBackground,
    value.size,
    value.form,
    value.claim,
    value.ingredient,
    ...(value.mainProducts || []),
    ...(value.mainProductsZh || []),
    ...(value.benefits || []),
    ...(value.ingredientInsights || []).flatMap((item) => [
      item.name,
      item.role,
    ]),
    ...(data.assessment?.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKC')
    .toLowerCase();
  const at = resourceCollectionTime(collection, value);
  return {
    data,
    links: [...links.values()],
    columns: [
      truncate(value.market, 8),
      truncate(value.category, 160),
      data.assessment?.score ?? null,
      data.assessment?.grade || '',
      data.assessment?.status || '',
      value.reviewStatus || 'pending',
      value.siteCollection?.status || 'pending',
      value.favorite ? 1 : 0,
      at,
      truncate(source, 160),
      truncate(value.platform, 100),
      truncate(value.ownershipBackground, 160),
      value.siteId || '',
      discovery.isNew === null || discovery.isNew === undefined
        ? 'unknown'
        : discovery.isNew
          ? 'yes'
          : 'no',
      discovery.recentDiscovery ? 1 : 0,
      text,
    ],
  };
}

export function createWorkspaceReads({
  pool,
  sql,
  lock,
  unlock,
  putDocument,
  isWorkspaceSyncKey,
  loadPublic,
}) {
  let flight;
  let lastError = '';
  let collectionErrors = {};
  let errorsLoaded = false;
  const readDirtyBatch = createDirtyBatchReader();
  async function loadProjectionErrors(connection) {
    collectionErrors = Object.fromEntries((await connection.query(
      sql("SELECT DISTINCT value->>'collection' AS collection FROM workspace_documents WHERE name LIKE 'read:failure:%'", "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(value,'$.collection')) AS collection FROM workspace_documents WHERE name LIKE 'read:failure:%'"),
    )).rows.map(({ collection }) => [collection, '本列表部分记录更新失败，保留这些记录的上次结果；其他记录已继续更新']));
    errorsLoaded = true;
  }
  const statistics = createWorkspaceStatistics({ pool, sql, putDocument, loadPublic });
  const concepts = createConceptMonitor({ pool, sql, putDocument });
  async function refreshConcepts(connection) {
    await connection.query('BEGIN');
    try {
      const versions = await connection.query("SELECT revision FROM workspace_read_versions WHERE collection='published'");
      const revision = versions.rows[0].revision;
      const pending = await connection.query('SELECT kind FROM workspace_read_dirty LIMIT 1');
      await concepts.rebuild(connection, revision, pending.rows.length > 0);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      concepts.retryLater();
      console.error('Concept monitor refresh:', error.message);
    }
  }
  async function refreshStatistics(connection) {
    await connection.query('BEGIN');
    try {
      const revision = (await connection.query("SELECT revision FROM workspace_read_versions WHERE collection='published'")).rows[0].revision;
      await statistics.rebuild(connection, revision);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      console.error('Workspace statistics refresh:', error.message);
    }
  }
  async function withRelations(collection, records) {
    if (!records.length) return records;
    if (['ads','keywords'].includes(collection)) {
      const settings=(await pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows[0]?.value;
      records=records.map(record=>batchRecord(collection,record,settings?.aliases));
    }
    if (collection === 'products') {
      const ids = [...new Set(records.map((record) => record.siteId).filter(Boolean))];
      const fields = ['id', 'brand', 'domain', 'market'];
      const columns = fields.map((key) => sql(`value->>'${key}'`, `JSON_UNQUOTE(JSON_EXTRACT(value,'$.${key}'))`) + ` AS ${key}`).join(',');
      const sites = ids.length ? (await pool.query(`SELECT ${columns} FROM workspace_documents WHERE name IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids.map((id) => `business:sites:${id}`))).rows : [];
      const byId = new Map(sites.map((site) => [site.id, site]));
      // Older read summaries omitted sellers. Read only the missing names on
      // this page, without a full index rebuild or a paid source request.
      const missing = records.filter((record) => !productSellerName(record) && record.sourcePlatform?.toLowerCase() === 'amazon');
      const sellerPaths = { sellerName: ['sellerName'], shopName: ['resourceRaw', 'shopName'], soldBy: ['resourceRaw', 'soldBy'], metricShopName: ['sourceMetrics', 'shopName'], evidenceShopName: ['resourceEvidence', 'identity', 'shopName'] };
      const sellerColumns = Object.entries(sellerPaths).map(([alias, path]) => sql(`value #>> '{${path.join(',')}}'`, `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(value,'$.${path.join('.')}')), 'null')`) + ` AS ${alias.toLowerCase()}`).join(',');
      const sellers = missing.length ? (await pool.query(`SELECT name,${sellerColumns} FROM workspace_documents WHERE name IN (${missing.map((_, i) => `$${i + 1}`).join(',')})`, missing.map((record) => `business:products:${record.id}`))).rows : [];
      const sellerById = new Map(sellers.map((row) => [row.name, productSellerName({ sellerName: row.sellername, resourceRaw: { shopName: row.shopname, soldBy: row.soldby }, sourceMetrics: { shopName: row.metricshopname }, resourceEvidence: { identity: { shopName: row.evidenceshopname } } })]));
      return records.map((record) => {
        const linkedSite = byId.get(record.siteId) || null;
        const platform = resolvedProductPlatform(record, linkedSite);
        const asin = productAsin(record);
        const sellerName = productSellerName(record) || sellerById.get(`business:products:${record.id}`);
        return { ...record, linkedSite, ...(asin ? { asin } : {}), ...(sellerName ? { sellerName } : {}), ...(platform !== '未记录' ? { sourcePlatform: platform } : {}) };
      });
    }
    const values = records.map((record) => record.id);
    const slots = values.map((_, index) => `$${index + 1}`).join(',');
    if (collection === 'sites') {
      const field = (name, alias) => sql(`${alias}.payload->>'${name}'`, `JSON_UNQUOTE(JSON_EXTRACT(${alias}.payload,'$.${name}'))`);
      const metrics = (await pool.query(`SELECT s.id,
        (SELECT COUNT(*) FROM workspace_read_rows p WHERE p.collection='products' AND p.site_id=s.id AND p.market=s.market) AS products,
        (SELECT COUNT(*) FROM workspace_read_rows a WHERE a.collection='ads' AND a.market=s.market AND EXISTS(SELECT 1 FROM workspace_read_links l WHERE l.collection='ads' AND l.id=a.id AND l.relation='sites' AND l.target=s.id)) AS ads,
        (SELECT COUNT(*) FROM workspace_read_rows p WHERE p.collection='products' AND p.site_id=s.id AND p.market=s.market AND ${field('ingredient', 'p')} IS NOT NULL AND ${field('ingredient', 'p')}<>'') AS ingredients,
        (SELECT COUNT(*) FROM workspace_read_rows p WHERE p.collection='products' AND p.site_id=s.id AND p.market=s.market AND CAST(${field('price', 'p')} AS DECIMAL(20,4))>0) AS prices,
        (SELECT COUNT(*) FROM workspace_read_rows a WHERE a.collection='ads' AND a.market=s.market AND (${field('imageUrls', 'a')} NOT IN ('[]','null') OR ${field('videoUrls', 'a')} NOT IN ('[]','null')) AND EXISTS(SELECT 1 FROM workspace_read_links l WHERE l.collection='ads' AND l.id=a.id AND l.relation='sites' AND l.target=s.id)) AS creatives
        FROM workspace_read_rows s WHERE s.collection='sites' AND s.id IN (${slots})`, values)).rows;
      const map = new Map(metrics.map((row) => [row.id, { products: Number(row.products), ads: Number(row.ads), hasIngredients: Number(row.ingredients) > 0, hasPrices: Number(row.prices) > 0, hasCreatives: Number(row.creatives) > 0 }]));
      return records.map((record) => ({ ...record, coreSummary: { ...record.coreSummary, related: map.get(record.id) } }));
    }
    if (collection === 'keywords') {
      records = await keywordMetricEvidence(records, pool, sql);
      const terms = records.map((record) => normalizeTerm(record.term));
      const field = (name) => sql(`r.payload->>'${name}'`, `JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.${name}'))`);
      const [expansions, counts] = await Promise.all([
        pool.query(`SELECT r.market,l.target,${field('term')} AS term,${field('source')} AS source FROM workspace_read_links l JOIN workspace_read_rows r ON r.collection=l.collection AND r.id=l.id WHERE l.collection='keywords' AND l.relation='seed' AND l.target IN (${slots})`, terms),
        // Match the keyword filter in both directions. UNION counts a saved
        // business record once even when both sides contain the association.
        pool.query(`SELECT a.target,
          SUM(CASE WHEN a.collection='ads' THEN 1 ELSE 0 END) AS ads,
          SUM(CASE WHEN a.collection='products' THEN 1 ELSE 0 END) AS products,
          SUM(CASE WHEN a.collection='sites' THEN 1 ELSE 0 END) AS sites
          FROM (${keywordAssociationRows(slots)}) a GROUP BY a.target`, values),
      ]);
      const countMap = new Map(counts.rows.map((item) => [item.target, { ads: Number(item.ads) || 0, products: Number(item.products) || 0, sites: Number(item.sites) || 0 }]));
      return records.map((record) => ({ ...record, relatedCounts: countMap.get(record.id) || { ads: 0, products: 0, sites: 0 }, coreSummary: { ...record.coreSummary, related: { expansions: expansions.rows.filter((item) => item.market === record.market && item.target === normalizeTerm(record.term) && normalizeTerm(item.term) !== normalizeTerm(record.term)).map((item) => ({ term: item.term, source: item.source || '' })) } } }));
    }
    return records;
  }
  async function saveProjections(connection, entries) {
    for (let start = 0; start < entries.length; start += 100) {
      const batch = entries.slice(start, start + 100);
      const rows = [],
        links = [];
      for (const { collection, sourceKey, projection } of batch) {
        rows.push([
          collection,
          projection.data.id,
          sourceKey,
          ...projection.columns,
          projection.data,
        ]);
        links.push(
          ...projection.links.map(([relation, target]) => [
            collection,
            projection.data.id,
            relation,
            target,
          ]),
        );
      }
      await connection.query(
        `INSERT INTO workspace_read_rows(collection,id,source_key,market,category,score,grade,rating_status,review_status,collection_status,favorite,collected_at,source_label,platform,ownership,site_id,newness,recent_discovery,search_text,payload) VALUES ${rows.map((row, i) => `(${row.map((_, j) => `$${i * 20 + j + 1}`).join(',')})`).join(',')}`,
        rows.flat(),
      );
      for (let offset = 0; offset < links.length; offset += 2000) {
        const part = links.slice(offset, offset + 2000);
        await connection.query(
          `INSERT INTO workspace_read_links(collection,id,relation,target) VALUES ${part.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(',')} ${sql('ON CONFLICT(collection,id,relation,target) DO NOTHING', 'ON DUPLICATE KEY UPDATE target=workspace_read_links.target')}`,
          part.flat(),
        );
      }
    }
  }
  async function buildAdvertisers(connection) {
    const [ads, sites] = await Promise.all([
      connection.query(
        "SELECT payload FROM workspace_read_rows WHERE collection='ads'",
      ),
      connection.query(
        "SELECT payload FROM workspace_read_rows WHERE collection='sites'",
      ),
    ]);
    await connection.query(
      "DELETE FROM workspace_read_rows WHERE collection='advertisers'",
    );
    await connection.query(
      "DELETE FROM workspace_read_links WHERE collection='advertisers'",
    );
    await saveProjections(
      connection,
      groupAdvertisers(
        ads.rows.map((r) => r.payload),
        sites.rows.map((r) => r.payload),
      ).map((row) => ({
        collection: 'advertisers',
        sourceKey: row.id,
        projection: projectRecord('advertisers', {
          ...row,
          adCount: row.adIds.length,
          adIds: row.adIds.slice(0, 1),
        }),
      })),
    );
  }
  async function seed(connection) {
    const marker = (
      await connection.query(
        "SELECT value FROM workspace_documents WHERE name='read:model-version'",
      )
    ).rows[0]?.value;
    // Time-dependent scores and decision labels are recalibrated without charging providers.
    if (
      marker?.version === MODEL_VERSION &&
      Date.now() - Number(marker.at) < 3_600_000
    )
      return;
    for (const [kind, table, column, where] of [
      ['keywords', 'research_keywords', 'natural_key', ''],
      [
        'business',
        'workspace_documents',
        'name',
        "WHERE name LIKE 'business:%'",
      ],
    ])
      await connection.query(
        sql(
          `INSERT INTO workspace_read_dirty(kind,source_key) SELECT '${kind}',${column} FROM ${table} ${where} ON CONFLICT(kind,source_key) DO UPDATE SET revision=workspace_read_dirty.revision+1`,
          `INSERT INTO workspace_read_dirty(kind,source_key) SELECT '${kind}',${column} FROM ${table} ${where} ON DUPLICATE KEY UPDATE revision=workspace_read_dirty.revision+1`,
        ),
      );
    await putDocument(
      'workspace_documents',
      'read:model-version',
      { version: MODEL_VERSION, at: Date.now() },
      false,
      connection,
    );
  }
  async function processBatch() {
    const connection = await pool.connect();
    let locked = false;
    try {
      locked = await lock(connection, 'workspace-reads');
      if (!locked) return false;
      await seed(connection);
      if (concepts.due()) await refreshConcepts(connection);
      if (statistics.due()) await refreshStatistics(connection);
      const dirty = await readDirtyBatch(connection);
      if (!dirty.length) {
        if (!errorsLoaded) await loadProjectionErrors(connection);
        const snapshot = await connection.query(
          'SELECT market FROM workspace_overview_snapshots LIMIT 1',
        );
        if (!snapshot.rows.length) await buildOverview(connection);
        await refreshConcepts(connection);
        return false;
      }
      await connection.query('BEGIN');
      try {
        let advertiserDirty = false;
        const sources = new Map();
        for (const kind of ['keywords', 'business']) {
          const keys = dirty
            .filter((r) => r.kind === kind)
            .map((r) => r.source_key);
          if (!keys.length) continue;
          const table =
            kind === 'keywords' ? 'research_keywords' : 'workspace_documents';
          const key = kind === 'keywords' ? 'natural_key' : 'name';
          const value = kind === 'keywords' ? 'data' : 'value';
          const rows = (
            await connection.query(
              `SELECT ${key} AS source_key,${value} AS data${kind === 'business' ? ',revision' : ''} FROM ${table} WHERE ${key} IN (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
              keys,
            )
          ).rows;
          for (const row of rows)
            sources.set(`${kind}:${row.source_key}`, row.source_key.startsWith('business:insightReports:') ? { ...row.data, revision: row.revision } : row.data);
        }
        const projected = [],
          replacements = [],
          clearFailures = [];
        const batchSettings=(await connection.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows[0]?.value;
        for (const item of dirty) {
          const source = sources.get(`${item.kind}:${item.source_key}`);
          const collection = projectionCollection(item);
          if (collections.has(collection)) {
            if (collection === 'ads' || collection === 'sites')
              advertiserDirty = true;
            const failureKey = `read:failure:${createHash('sha256').update(`${item.kind}:${item.source_key}`).digest('hex')}`;
            if (source && source.dataNature !== 'demo') {
              try {
                projected.push({
                  collection,
                  sourceKey: item.source_key,
                  projection: projectRecord(collection, batchRecord(collection, source, batchSettings?.aliases)),
                });
              } catch {
                await putDocument(
                  'workspace_documents',
                  failureKey,
                  {
                    collection,
                    sourceKey: item.source_key,
                    at: new Date().toISOString(),
                    message: '记录字段格式异常，保留原始数据和上次索引',
                  },
                  false,
                  connection,
                );
                continue;
              }
            }
            clearFailures.push(failureKey);
            replacements.push([collection, item.source_key]);
          }
        }
        const successful = await isolateProjectionWrites(connection, projected, replacements, saveProjections, async ([collection, sourceKey], error) => {
          const item = dirty.find((r) => r.source_key === sourceKey);
          const failureKey = `read:failure:${createHash('sha256').update(`${item.kind}:${sourceKey}`).digest('hex')}`;
          await putDocument('workspace_documents', failureKey, {
            collection, sourceKey, revision: item.revision, at: new Date().toISOString(),
            code: error.code, message: '单条记录索引异常，原始资料和上次索引已保留；其他记录继续更新',
          }, false, connection);
        });
        const successKeys = successful.map(([, sourceKey]) => clearFailures[replacements.findIndex((r) => r[1] === sourceKey)]);
        if (successKeys.length) await connection.query(
          `DELETE FROM workspace_documents WHERE name IN (${successKeys.map((_, i) => `$${i + 1}`).join(',')})`, successKeys,
        );
        await connection.query(
          `DELETE FROM workspace_read_dirty WHERE ${dirty.map((_, i) => `(kind=$${i * 3 + 1} AND source_key=$${i * 3 + 2} AND revision=$${i * 3 + 3})`).join(' OR ')}`,
          dirty.flatMap((r) => [r.kind, r.source_key, r.revision]),
        );
        if (advertiserDirty)
          await putDocument(
            'workspace_documents',
            'read:advertiser-dirty',
            { dirty: true },
            false,
            connection,
          );
        await connection.query(
          "UPDATE workspace_read_versions SET revision=revision+1 WHERE collection='published'",
        );
        const remaining = await connection.query(
          'SELECT kind FROM workspace_read_dirty LIMIT 1',
        );
        if (!remaining.rows.length) {
          const ads = (
            await connection.query(
              "SELECT value FROM workspace_documents WHERE name='read:advertiser-dirty'",
            )
          ).rows[0];
          if (ads) {
            await buildAdvertisers(connection);
            await connection.query(
              "DELETE FROM workspace_documents WHERE name='read:advertiser-dirty'",
            );
          }
          await buildOverview(connection);
          await putDocument('workspace_documents', 'read:reports-ready', { ready: true }, false, connection);
        }
        await connection.query('COMMIT');
        if (!remaining.rows.length) await refreshConcepts(connection);
        await loadProjectionErrors(connection);
        lastError = '';
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
      return (await connection.query('SELECT kind FROM workspace_read_dirty LIMIT 1')).rows.length > 0;
    } finally {
      if (locked) await unlock(connection, 'workspace-reads');
      connection.release();
    }
  }
  function refresh() {
    if (flight) return flight;
    flight = processBatch()
      .catch((error) => {
        lastError = '汇总更新暂未成功，保留上次结果';
        console.error('Workspace read model refresh:', error.message);
        return false;
      })
      .finally(() => {
        flight = undefined;
      });
    return flight;
  }
  let statusFlight;
  function status(collection) {
    // Concurrent list, overview and bootstrap responses share the same read.
    // Completed results are not cached, so subsequent writes stay visible.
    if (!statusFlight) statusFlight = readStatus().finally(() => { statusFlight = undefined; });
    return statusFlight.then((state) => ({ ...state, error: state.error || (collection ? collectionErrors[collection] : Object.keys(collectionErrors).length ? '部分记录更新失败，其他列表和记录已继续更新' : '') || '' }));
  }
  async function readStatus() {
    const [versions, dirty] = await Promise.all([
      pool.query('SELECT collection,revision FROM workspace_read_versions'),
      pool.query('SELECT kind FROM workspace_read_dirty LIMIT 1'),
    ]);
    return {
      revisions: Object.fromEntries(
        versions.rows.map((r) => [r.collection, String(r.revision)]),
      ),
      indexing: dirty.rows.length > 0,
      error: lastError,
    };
  }
  async function buildOverview(connection) {
    const revision = (
      await connection.query(
        "SELECT revision FROM workspace_read_versions WHERE collection='published'",
      )
    ).rows[0].revision;
    const grouped = (
      await connection.query(
        'SELECT collection,market,review_status,grade,collection_status,COUNT(*) AS total FROM workspace_read_rows GROUP BY collection,market,review_status,grade,collection_status',
      )
    ).rows;
    const generatedAt = new Date().toISOString();
    const productMarkets = Object.fromEntries(
      ['US', 'MX', 'VN'].map((market) => [
        market,
        grouped
          .filter((r) => r.collection === 'products' && r.market === market)
          .reduce((sum, row) => sum + Number(row.total), 0),
      ]),
    );
    const reviews = (
      await connection.query(
        sql(
          "SELECT p.market,COUNT(*) AS total FROM workspace_documents d JOIN workspace_read_rows p ON p.collection='products' AND p.id=d.value->>'productId' WHERE d.name LIKE 'business:reviews:%' AND d.value->>'status'='pending' GROUP BY p.market",
          "SELECT p.market,COUNT(*) AS total FROM workspace_documents d JOIN workspace_read_rows p ON p.collection='products' AND p.id=JSON_UNQUOTE(JSON_EXTRACT(d.value,'$.productId')) WHERE d.name LIKE 'business:reviews:%' AND JSON_UNQUOTE(JSON_EXTRACT(d.value,'$.status'))='pending' GROUP BY p.market",
        ),
      )
    ).rows;
    for (const market of ['ALL', 'US', 'MX', 'VN']) {
      const scoped = grouped.filter(
        (r) => market === 'ALL' || r.market === market,
      );
      const count = (collection, predicate = () => true) =>
        scoped
          .filter((r) => r.collection === collection && predicate(r))
          .reduce((sum, row) => sum + Number(row.total), 0);
      const params = market === 'ALL' ? [] : [market];
      const top = (
        await connection.query(
          `SELECT payload FROM workspace_read_rows WHERE collection='keywords' ${market === 'ALL' ? '' : 'AND market=$1'} ORDER BY CASE WHEN score IS NULL THEN 1 ELSE 0 END,score DESC,id LIMIT 20`,
          params,
        )
      ).rows.map((r) => r.payload);
      const payload = {
        counts: {
          keywords: count('keywords'),
          sites: count('sites'),
          products: count('products'),
          ads: count('ads'),
          reviews: reviews
            .filter((r) => market === 'ALL' || r.market === market)
            .reduce((sum, r) => sum + Number(r.total), 0),
        },
        keywords: {
          total: count('keywords'),
          priority: count('keywords', (r) => ['A', 'B'].includes(r.grade)),
          pending: count('keywords', (r) => !r.grade),
          selected: count('keywords', (r) => r.review_status === 'selected'),
          completed: count(
            'keywords',
            (r) =>
              r.review_status === 'selected' &&
              r.collection_status === 'completed',
          ),
          active: count(
            'keywords',
            (r) =>
              r.review_status === 'selected' &&
              ['queued', 'running'].includes(r.collection_status),
          ),
        },
        productMarkets,
        topKeywords: top,
      };
      await connection.query(
        sql(
          'INSERT INTO workspace_overview_snapshots(market,revision,generated_at,payload) VALUES($1,$2,$3,$4) ON CONFLICT(market) DO UPDATE SET revision=EXCLUDED.revision,generated_at=EXCLUDED.generated_at,payload=EXCLUDED.payload',
          'INSERT INTO workspace_overview_snapshots(market,revision,generated_at,payload) VALUES($1,$2,$3,$4) ON DUPLICATE KEY UPDATE revision=VALUES(revision),generated_at=VALUES(generated_at),payload=VALUES(payload)',
        ),
        [market, revision, generatedAt, payload],
      );
    }
  }
  async function overview(input) {
    const market = ['US', 'MX', 'VN'].includes(input.market)
      ? input.market
      : 'ALL';
    const row = (
      await pool.query(
        'SELECT * FROM workspace_overview_snapshots WHERE market=$1',
        [market],
      )
    ).rows[0];
    const day = shanghaiDay();
    const todayQuery = filter({ collection: 'products', market, productPool: 'pool', discoveredOn: day });
    const today = Number((await pool.query(`SELECT COUNT(*) AS total FROM workspace_read_rows r WHERE ${todayQuery.where}`, todayQuery.values)).rows[0].total);
    const monitorRows = (await pool.query(sql(
      "SELECT t.value->>'market' AS market,t.value->>'enabled' AS enabled,r.value->>'status' AS status FROM workspace_documents t LEFT JOIN workspace_documents r ON r.name='competitor:run:' || (t.value->>'id') WHERE t.name LIKE 'competitor:target:%' AND t.value->>'kind'='site'",
      "SELECT JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.market')) AS market,JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.enabled')) AS enabled,JSON_UNQUOTE(JSON_EXTRACT(r.value,'$.status')) AS status FROM workspace_documents t LEFT JOIN workspace_documents r ON r.name=CONCAT('competitor:run:',JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.id'))) WHERE t.name LIKE 'competitor:target:%' AND JSON_UNQUOTE(JSON_EXTRACT(t.value,'$.kind'))='site'"
    ))).rows.filter(r => market === 'ALL' || r.market === market);
    const monitoring = { total: monitorRows.length, problems: monitorRows.filter(r => ['true', '1'].includes(String(r.enabled)) && ['failed','blocked','partial','interrupted','retry_wait'].includes(r.status)).length };
    return {
      snapshot: row
        ? {
            ...row.payload,
            todayNewProducts: { count: today, day },
            monitoring,
            generatedAt: row.generated_at,
            revision: String(row.revision),
          }
        : null,
      ...(await status()),
    };
  }
  function filter(input) {
    const collection = input.collection;
    if (!collections.has(collection)) throw new Error('列表类型无效');
    const values = [collection],
      clauses = ['r.collection=$1'];
    const bind = (value) => {
      values.push(value);
      return `$${values.length}`;
    };
    const equals = (key, column) => {
      if (input[key] && input[key] !== 'ALL')
        clauses.push(`r.${column}=${bind(input[key])}`);
    };
    equals('market', 'market');
    const conceptCondition = conceptMemberCondition(input, collection, bind, sql);
    if (conceptCondition) clauses.push(conceptCondition);
    equals('category', 'category');
    if (collection === 'keywords' && input.batch?.trim()) {
      const batchField = sql(
        "r.payload->>'batch'",
        "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.batch'))",
      );
      const batch = bind(
        `%${String(input.batch).normalize('NFKC').trim().toLowerCase().slice(0, 100).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`,
      );
      clauses.push(
        `LOWER(${batchField}) LIKE ${batch} ESCAPE '!'`,
      );
    }
    equals('ratingStatus', 'rating_status');
    equals('review', 'review_status');
    equals('platform', 'platform');
    equals('ownership', 'ownership');
    equals('siteId', 'site_id');
    if (collection === 'sites' && input.siteDomain) {
      const selectedDomain = sourceSiteDomain(input.siteDomain);
      if (!selectedDomain) throw new Error('站点域名无效');
      const domain = sql("r.payload->>'domain'", "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.domain'))");
      clauses.push(`LOWER(${domain}) IN (${bind(selectedDomain)},${bind(`www.${selectedDomain}`)})`);
    }
    if (collection === 'products') {
      const field = key => sql(
        `NULLIF(r.payload->>'${key}','')`,
        `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.${key}')),'')`,
      );
      const provider = `COALESCE(${field('sourceProvider')},CASE WHEN ${field('dataNature')}='demo' THEN '演示样本' ELSE '人工导入 / 来源待确认' END)`;
      const platform = productPlatformSql(sql);
      if (input.provider && input.provider !== 'ALL') clauses.push(`${provider}=${bind(input.provider)}`);
      if (input.productPlatform && input.productPlatform !== 'ALL') clauses.push(`${platform}=${bind(input.productPlatform)}`);
      if (input.siteLinked === 'linked') clauses.push("r.site_id<>''");
      if (input.siteLinked === 'unlinked') clauses.push("COALESCE(r.site_id,'')=''");
    }
    if (input.rating === 'UNRATED') clauses.push("r.grade=''");
    else equals('rating', 'grade');
    if (input.status && input.status !== 'ALL') {
      if (collection === 'keywords') equals('status', 'collection_status');
      else
        clauses.push(
          sql(
            "r.payload->>'status'",
            "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.status'))",
          ) + `=${bind(input.status)}`,
        );
    }
    if (input.favorite) clauses.push('r.favorite=1');
    const range = collectionRange(input.collectedFrom, input.collectedTo);
    if (range.from) clauses.push(`r.collected_at>=${bind(range.from)}`);
    if (range.to) clauses.push(`r.collected_at<${bind(range.to)}`);
    if (collection === 'products' && input.discoveredOn) {
      collectionRange(input.discoveredOn, input.discoveredOn);
      clauses.push(`EXISTS(SELECT 1 FROM workspace_read_links d WHERE d.collection=r.collection AND d.id=r.id AND d.relation='discoveredDay' AND d.target=${bind(input.discoveredOn)})`);
    }

    if (collection === 'products') {
      const { from, to } = validateListingRange(input.listedFrom, input.listedTo);
      if (from || to) clauses.push(`EXISTS(SELECT 1 FROM workspace_read_links d WHERE d.collection=r.collection AND d.id=r.id AND d.relation='listingDate'${from ? ` AND d.target>=${bind(from)}` : ''}${to ? ` AND d.target<=${bind(to)}` : ''})`);
      if (['pool', 'existing'].includes(input.productPool)) {
        const hasPool = sql("EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.payload->'newProductClassifications','[]'::jsonb)) e WHERE e->>'type' IN ('regular_new','fbm_new','new_listing'))", "(JSON_SEARCH(r.payload, 'one', 'regular_new', NULL, '$.newProductClassifications[*].type') IS NOT NULL OR JSON_SEARCH(r.payload, 'one', 'fbm_new', NULL, '$.newProductClassifications[*].type') IS NOT NULL OR JSON_SEARCH(r.payload, 'one', 'new_listing', NULL, '$.newProductClassifications[*].type') IS NOT NULL)");
        clauses.push(input.productPool === 'pool' ? hasPool : `NOT (${hasPool})`);
      }
      if (input.newProductType && input.newProductType !== 'ALL') {
        const type = bind(String(input.newProductType).slice(0, 32));
        clauses.push(
          `(EXISTS(SELECT 1 FROM workspace_read_links n WHERE n.collection=r.collection AND n.id=r.id AND n.relation='newProduct' AND n.target=${type}) OR ${sql(
            `EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(r.payload->'newProductClassifications','[]'::jsonb)) e WHERE e->>'type'=${type})`,
            `JSON_SEARCH(r.payload, 'one', ${type}, NULL, '$.newProductClassifications[*].type') IS NOT NULL`,
          )})`,
        );
      }
    }
    const score = input.score || {};
    if (score.status === 'unscored') clauses.push('r.score IS NULL');
    else {
      if (score.status === 'scored') clauses.push('r.score IS NOT NULL');
      if (Number.isFinite(score.min))
        clauses.push(`r.score>=${bind(score.min)}`);
      if (Number.isFinite(score.max))
        clauses.push(`r.score<=${bind(score.max)}`);
    }
    if (
      input.timeRange &&
      input.timeRange !== 'ALL' &&
      Number(input.timeRange) > 0
    )
      clauses.push(
        `r.collected_at>=${bind(new Date(Date.now() - Math.min(36500, Number(input.timeRange)) * 86400000).toISOString())}`,
      );
    if (input.newness === 'discovered') clauses.push('r.recent_discovery=1');
    else equals('newness', 'newness');
    const relation = (name, targets) => {
      if (!targets?.length) return;
      clauses.push(
        `EXISTS(SELECT 1 FROM workspace_read_links l WHERE l.collection=r.collection AND l.id=r.id AND l.relation=${bind(name)} AND l.target IN (${targets.map(bind).join(',')}))`,
      );
    };
    for (const name of ['source', 'benefit', 'ingredient', 'decision'])
      if (input[name] && input[name] !== 'ALL') relation(name, [input[name]]);
    relation('tag', input.tags?.slice(0, 30));
    if (collection === 'products' && input.sourceCategory && input.sourceCategory !== 'ALL') relation('sourceCategory', [String(input.sourceCategory).slice(0,180)]);
    if (input.keywordId) {
      if (collection === 'keywords') clauses.push(`r.id=${bind(input.keywordId)}`);
      else
        clauses.push(
          `(EXISTS(SELECT 1 FROM workspace_read_links k WHERE k.collection=r.collection AND k.id=r.id AND k.relation='keyword' AND k.target=${bind(input.keywordId)}) OR EXISTS(SELECT 1 FROM workspace_read_links k WHERE k.collection='keywords' AND k.id=${bind(input.keywordId)} AND k.relation=${bind(collection)} AND k.target=r.id))`,
        );
    }
    if (collection === 'ads' && input.linkedSite)
      relation('sites', [input.linkedSite]);
    if (collection === 'ads' && input.batch?.trim()) {
      const batch = bind(`%${String(input.batch).normalize('NFKC').trim().toLowerCase().slice(0, 100).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`);
      clauses.push(`EXISTS(SELECT 1 FROM workspace_read_links b WHERE b.collection=r.collection AND b.id=r.id AND b.relation='batch' AND LOWER(b.target) LIKE ${batch} ESCAPE '!')`);
    }
    if (collection === 'ads' && input.linkedProduct) {
      const product = bind(input.linkedProduct);
      clauses.push(`(${sql("r.payload->>'productId'", "JSON_UNQUOTE(JSON_EXTRACT(r.payload,'$.productId'))")}=${product} OR EXISTS(SELECT 1 FROM workspace_read_links l WHERE l.collection=r.collection AND l.id=r.id AND l.relation='products' AND l.target=${product}))`);
    }
    if (input.search?.trim()) {
      const search = bind(
        `%${String(input.search).normalize('NFKC').trim().toLowerCase().slice(0, 200).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`,
      );
      clauses.push(
        `(r.search_text LIKE ${search} ESCAPE '!' OR EXISTS(SELECT 1 FROM workspace_read_links l JOIN workspace_read_rows k ON k.collection='keywords' AND k.id=l.target WHERE l.collection=r.collection AND l.id=r.id AND l.relation='keyword' AND k.search_text LIKE ${search} ESCAPE '!') OR EXISTS(SELECT 1 FROM workspace_read_links l JOIN workspace_read_rows k ON k.collection='keywords' AND k.id=l.id WHERE l.collection='keywords' AND l.relation=r.collection AND l.target=r.id AND k.search_text LIKE ${search} ESCAPE '!') OR EXISTS(SELECT 1 FROM workspace_read_rows s WHERE s.collection='sites' AND s.id=r.site_id AND s.search_text LIKE ${search} ESCAPE '!'))`,
      );
    }
    return { collection, values, where: clauses.join(' AND ') };
  }
  async function withKeywordTrends(records) {
    if (!records.length) return records;
    // Read current saved trends for this page without rebuilding the full index.
    const ids = records.map((record) => record.id);
    const rows = (await pool.query(
      `SELECT k.data FROM research_keywords k JOIN workspace_read_rows r ON r.source_key=k.natural_key AND r.collection='keywords' WHERE r.id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids,
    )).rows;
    const trends = new Map(rows.map(({ data }) => [data.id, keywordTrendList(data)]));
    return records.map((record) => ({ ...record, ...trends.get(record.id) }));
  }
  async function list(input) {
    const query = filter(input);
    const pageSize = Math.max(
      1,
      Math.min(100, Math.trunc(Number(input.pageSize) || 20)),
    );
    let page = Math.max(
      1,
      Math.min(1000000, Math.trunc(Number(input.page) || 1)),
    );
    const [counted, current, marketSummary] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) AS total FROM workspace_read_rows r WHERE ${query.where}`,
        query.values,
      ),
      status(input.collection),
      query.collection === 'keywords' ? pool.query(
        `SELECT COUNT(*) AS total,SUM(CASE WHEN grade IN ('A','B') THEN 1 ELSE 0 END) AS priority,SUM(CASE WHEN grade IS NULL OR grade='' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN review_status='selected' THEN 1 ELSE 0 END) AS selected FROM workspace_read_rows WHERE collection='keywords'${input.market && input.market !== 'ALL' ? ' AND market=$1' : ''}`,
        input.market && input.market !== 'ALL' ? [input.market] : [],
      ) : null,
    ]);
    const total = Number(counted.rows[0].total);
    page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    let sortColumn = ['keywords', 'sites'].includes(query.collection) ? 'r.score' : 'r.collected_at';
    if (input.sort === 'collectedAt') sortColumn = 'r.collected_at';
    if (query.collection === 'keywords' && input.sort === 'core:searchVolume') sortColumn = keywordVolumeSql(sql);
    const direction = input.order === 'ascend' ? 'ASC' : 'DESC';
    let result;
    if (query.collection === 'keywords' && keywordAssociationSorts.has(input.sort)) {
      // Aggregate the compact association index before paging, not the visible
      // rows. Ties always use the keyword ID so adjacent pages remain stable.
      result = await pool.query(
        `SELECT r.payload FROM workspace_read_rows r LEFT JOIN (
          SELECT a.target,COUNT(*) AS related_count
          FROM (${keywordAssociationRows(null, keywordAssociationSorts.get(input.sort))}) a
          GROUP BY a.target
        ) association_counts ON association_counts.target=r.id
        WHERE ${query.where}
        ORDER BY COALESCE(association_counts.related_count,0) ${direction},r.id ASC
        LIMIT $${query.values.length + 1} OFFSET $${query.values.length + 2}`,
        [...query.values, pageSize, (page - 1) * pageSize],
      );
    } else if (query.collection === 'products' && productSortKeys.includes(input.sort)) {
      // Read only sort metadata across the filtered set; fetch full payloads for this page.
      const field = (path) => sql(`r.payload${path.split('.').map((part) => `->'${part}'`).join('')}`, `JSON_EXTRACT(r.payload,'$.${path}')`);
      const pairs = [
        "'price'", field('price'), "'market'", field('market'), "'lastCollectedAt'", field('lastCollectedAt'),
        "'sourceMetrics'", sql('jsonb_build_object', 'JSON_OBJECT') + `('collectedAt',${field('sourceMetrics.collectedAt')},'soldRaw',${field('sourceMetrics.soldRaw')},'soldCount',${field('sourceMetrics.soldCount')},'monthlySales',${field('sourceMetrics.monthlySales')})`,
        "'sourceContent'", sql('jsonb_build_object', 'JSON_OBJECT') + `('collectedAt',${field('sourceContent.collectedAt')})`,
        "'decisionData'", field('decisionData'),
        ...['sourcePlatform', 'sourceProvider', 'sourceMarket', 'sourceUrl', 'evidenceUrl'].flatMap(key => [`'${key}'`, field(key)]),
      ];
      const metadata = (await pool.query(`SELECT r.id,${sql('jsonb_build_object', 'JSON_OBJECT')}(${pairs.join(',')}) AS sort_data FROM workspace_read_rows r WHERE ${query.where}`, query.values)).rows;
      const ordered = metadata.map((row) => ({ id: row.id, value: productSortValue(typeof row.sort_data === 'string' ? JSON.parse(row.sort_data) : row.sort_data, input.sort) }))
        .sort((a, b) => compareProductValues(a.value, b.value, input.order) || a.id.localeCompare(b.id));
      const ids = ordered.slice((page - 1) * pageSize, page * pageSize).map((row) => row.id);
      result = ids.length ? await pool.query(`SELECT r.id,r.payload FROM workspace_read_rows r WHERE r.collection='products' AND r.id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`, ids) : { rows: [] };
      const positions = new Map(ids.map((id, i) => [id, i]));
      result.rows.sort((a, b) => positions.get(a.id) - positions.get(b.id));
    } else result = await pool.query(
      `SELECT r.payload,${query.collection === 'sites' ? "(SELECT COUNT(*) FROM workspace_read_rows p WHERE p.collection='products' AND p.site_id=r.id AND p.market=r.market)" : '0'} AS product_count,
        ${query.collection === 'sites' ? "(SELECT COUNT(*) FROM workspace_read_rows a WHERE a.collection='ads' AND a.market=r.market AND EXISTS(SELECT 1 FROM workspace_read_links l WHERE l.collection=a.collection AND l.id=a.id AND l.relation='sites' AND l.target=r.id))" : '0'} AS ad_count
        FROM workspace_read_rows r WHERE ${query.where} ORDER BY CASE WHEN ${sortColumn} IS NULL THEN 1 ELSE 0 END,${sortColumn} ${direction},r.id ASC LIMIT $${query.values.length + 1} OFFSET $${query.values.length + 2}`,
      [...query.values, pageSize, (page - 1) * pageSize],
    );
    const records = result.rows.map((r) =>
        query.collection === 'sites'
          ? { ...r.payload, productCount: Number(r.product_count), adCount: Number(r.ad_count) }
          : r.payload,
      );
    let related;
    if (query.collection === 'keywords') {
      const [trends, relations] = await Promise.all([
        withKeywordTrends(records), withRelations(query.collection, records),
      ]);
      related = trends.map((record, index) => ({ ...record, batch: relations[index].batch, relatedCounts: relations[index].relatedCounts, semrushCollection: relations[index].semrushCollection, coreSummary: relations[index].coreSummary }));
    } else related = await withRelations(query.collection, records);
    return {
      rows: related,
      total,
      page,
      pageSize,
      ...(marketSummary ? { marketSummary: Object.fromEntries(['total','priority','pending','selected'].map(key => [key, Number(marketSummary.rows[0]?.[key]) || 0])) } : {}),
      ...current,
    };
  }
  async function facets(input) {
    if (!collections.has(input.collection)) throw new Error('列表类型无效');
    const values = [input.collection];
    const market =
      input.market && input.market !== 'ALL'
        ? (values.push(input.market), ' AND market=$2')
        : '';
    const rows = (
      await pool.query(
        `SELECT category,source_label,platform,ownership FROM workspace_read_rows WHERE collection=$1${market} GROUP BY category,source_label,platform,ownership LIMIT 2000`,
        values,
      )
    ).rows;
    const result = Object.fromEntries(
      ['category', 'source_label', 'platform', 'ownership'].map((key) => [
        key === 'source_label' ? 'source' : key,
        [...new Set(rows.map((r) => r[key]).filter(Boolean))].sort(),
      ]),
    );
    const links = (
      await pool.query(
        `SELECT l.relation,l.target FROM workspace_read_links l JOIN workspace_read_rows r ON r.collection=l.collection AND r.id=l.id WHERE r.collection=$1${market.replace('market', 'r.market')} AND l.relation IN ('tag','source','benefit','ingredient','sourceCategory') GROUP BY l.relation,l.target LIMIT 4000`,
        values,
      )
    ).rows;
    for (const name of ['tag', 'source', 'benefit', 'ingredient', 'sourceCategory'])
      result[name] = [
        ...new Set([
          ...(result[name] || []),
          ...links.filter((r) => r.relation === name).map((r) => r.target),
        ]),
      ].sort();
    if (input.collection === 'products') {
      const field = key => sql(`NULLIF(payload->>'${key}','')`, `NULLIF(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.${key}')),'')`);
      const identity = (await pool.query(`SELECT ${field('sourceProvider')} AS provider,${productPlatformSql(sql)} AS product_platform,${field('dataNature')} AS nature,${field('currency')} AS currency,site_id FROM workspace_read_rows r WHERE collection=$1${market} GROUP BY provider,product_platform,nature,currency,site_id`, values)).rows;
      result.currency = [...new Set(identity.map(row => row.currency || '未记录'))].sort();
      result.provider = [...new Set(identity.map(row => row.provider || (row.nature === 'demo' ? '演示样本' : '人工导入 / 来源待确认')))].sort();
      result.productPlatform = [...new Set(identity.map(row => row.product_platform || '未记录'))].sort();
    }
    // Lookup options stay small and omit source evidence and time series.
    for (const collection of ['keywords', 'sites']) {
      const siteKeywordOnly = input.collection === 'sites' && collection === 'keywords'
        ? ` AND (EXISTS(SELECT 1 FROM workspace_read_links l JOIN workspace_read_rows s ON s.collection='sites' AND s.id=l.id WHERE l.collection='sites' AND l.relation='keyword' AND l.target=workspace_read_rows.id${market ? ' AND s.market=$2' : ''}) OR EXISTS(SELECT 1 FROM workspace_read_links l JOIN workspace_read_rows s ON s.collection='sites' AND s.id=l.target WHERE l.collection='keywords' AND l.id=workspace_read_rows.id AND l.relation='sites'${market ? ' AND s.market=$2' : ''}))`
        : '';
      const fields = ['term', 'brand', 'domain', 'reviewStatus'];
      const columns = fields
        .map(
          (key) =>
            sql(
              `payload->>'${key}'`,
              `JSON_UNQUOTE(JSON_EXTRACT(payload,'$.${key}'))`,
            ) + ` AS field_${key.toLowerCase()}`,
        )
        .join(',');
      result[collection] = (
        await pool.query(
          `SELECT id,market,${columns} FROM workspace_read_rows WHERE collection=$1${market}${siteKeywordOnly} ORDER BY id LIMIT 2000`,
          [collection, ...values.slice(1)],
        )
      ).rows.map((r) => ({
        value: r.id,
        label: `${r.field_term || r.field_brand || r.id} · ${r.market}`,
        market: r.market,
        term: r.field_term,
        brand: r.field_brand,
        domain: r.field_domain,
        reviewStatus: r.field_reviewstatus,
      }));
    }
    return { facets: result };
  }
  async function selection(input) {
    const query = filter(input);
    const rows = (
      await pool.query(
        `SELECT id,payload FROM workspace_read_rows r WHERE ${query.where} ORDER BY r.id LIMIT 10001`,
        query.values,
      )
    ).rows;
    if (rows.length > 10000)
      throw new Error('单次最多选择10000条，请缩小筛选范围');
    const selectionId = randomUUID();
    await putDocument('workspace_documents', `read:selection:${selectionId}`, {
      collection: query.collection,
      ids: rows.map((r) => r.id),
      at: Date.now(),
    });
    return {
      selectionId,
      count: rows.length,
      rows: await withRelations(query.collection, rows.map((r) => r.payload)),
    };
  }
  async function details(input) {
    if (
      !collections.has(input.collection) ||
      typeof input.id !== 'string' ||
      input.id.length > 160
    )
      throw new Error('详情编号无效');
    let record;
    if (input.collection === 'keywords') {
      const row = (
        await pool.query(
          "SELECT source_key FROM workspace_read_rows WHERE collection='keywords' AND id=$1",
          [input.id],
        )
      ).rows[0];
      if (row)
        record = (
          await pool.query(
            'SELECT data FROM research_keywords WHERE natural_key=$1',
            [row.source_key],
          )
        ).rows[0]?.data;
    } else
      record = (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [`business:${input.collection}:${input.id}`],
        )
      ).rows[0]?.value;
    if (!record) throw new Error('记录不存在或已移除');
    if (input.collection === 'sites')
      record = { ...record, assessment: scoreSite(record) };
    if (input.collection === 'keywords')
      record = { ...record, assessment: assessKeyword(record) };
    return { record: (await withRelations(input.collection, [{ ...record, coreSummary: {}, listSummary: false }]))[0] };
  }
  async function exportRecords(input) {
    if (!['products', 'sites', 'ads', 'keywords'].includes(input.collection) || !Array.isArray(input.ids) || !input.ids.length || input.ids.length > 50 || input.ids.some((id) => typeof id !== 'string' || !id || id.length > 160)) throw new Error('导出批次无效，最多50条');
    const ids = [...new Set(input.ids)];
    const slots = ids.map((_, index) => `$${index + 1}`).join(',');
    const rows = input.collection === 'keywords'
      ? (await pool.query(`SELECT k.data AS value FROM research_keywords k JOIN workspace_read_rows r ON r.source_key=k.natural_key AND r.collection='keywords' WHERE r.id IN (${slots})`, ids)).rows
      : (await pool.query(`SELECT value FROM workspace_documents WHERE name IN (${slots})`, ids.map((id) => `business:${input.collection}:${id}`))).rows;
    const records = rows.map((row) => ({ ...row.value, coreSummary: {}, listSummary: false }));
    const enriched = await withRelations(input.collection, records);
    const byId = new Map(enriched.map((record) => [record.id, record]));
    return { rows: ids.map((id) => byId.get(id)).filter(Boolean) };
  }
  async function bootstrap() {
    const [entries, current, active] = await Promise.all([
      pool.query(
        "SELECT name,value FROM workspace_documents WHERE name IN ('business:branding:main','business:preferences:main')",
      ),
      status(),
      pool.query(
        "SELECT COUNT(*) AS total FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      ),
    ]);
    return {
      ...current,
      generatedAt: new Date().toISOString(),
      active: Number(active.rows[0].total),
      entries: entries.rows
        .filter((r) => isWorkspaceSyncKey(r.name.slice(9)))
        .map((r) => ({ key: r.name.slice(9), value: r.value })),
    };
  }
  return {
    refresh,
    status,
    overview,
    statistics: (input) => input.kind === 'concept-monitor' ? concepts.read(input) : statistics.read(input),
    list,
    facets,
    selection,
    details,
    exportRecords,
    bootstrap,
  };
}
