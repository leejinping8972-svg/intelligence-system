import { createHash, randomUUID } from 'node:crypto';

import {
  assessKeyword,
  groupAdvertisers,
  productDataSource,
  productDecisions,
  trendComparisons,
} from './model.js';
import { discoveryDecision } from './discovery-newness.mjs';
import { scoreSite } from './site-scoring.mjs';

const collections = new Set([
  'keywords',
  'products',
  'sites',
  'ads',
  'advertisers',
]);
const MODEL_VERSION = 'workspace-reads-v1';
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
    'id pageId market name adId adIds adCount active stopped siteIds domains collectedAt dataNature',
  keywords:
    'id term termZh market category source growth seedTerm collectedAt metrics reviewStatus reviewNote favorite productIds siteIds updatedAt dataNature siteCollection adCollection semrushCollection trendStatus trendMessage trendCollectedAt discoveryStatus discoveryMessage',
  products:
    'id title brand market category form size price currency ingredient dose claim benefits benefitEvidence ingredientInsights siteId color imageUrl reviewed favorite firstSeenAt publishedAt evidenceUrl dataNature sourceProvider sourcePlatform sourceProductId sourceUrl sourceMetrics lastCollectedAt collectionFields dataCompletion discovery',
  sites:
    'id brand domain market platform type keyword keywordIds category mainProducts ownershipBackground ownershipEvidence signals sources metrics metricsStatus metricsMessage productCollection collectorMode lastCollectedAt evidenceUrl confidence dataNature',
  ads: 'id brand market platform headline copy format productId status color archiveId pageId keywordIds query siteIds landingUrls imageUrls videoUrls videoPosterUrls lastCollectedAt startDate source firstSeenAt evidenceUrl dataNature discovery',
};
export function projectRecord(collection, value) {
  const data = pick(value, listKeys[collection].split(' '));
  if (!data.id) throw new Error('记录缺少编号');
  data.listSummary = true;
  if (collection === 'products') {
    data.ingredientInsights = (value.ingredientInsights || [])
      .slice(0, 20)
      .map((item) => ({
        name: item.name,
        amount: item.amount,
        role: item.role,
        evidence: '',
      }));
    data.benefits = (value.benefits || []).slice(0, 30);
    data.benefitEvidence = truncate(value.benefitEvidence, 1200);
  }
  if (collection === 'keywords') {
    data.assessment = assessKeyword(value);
    data.score = data.assessment.score;
    data.trendSummary = trendComparisons(value);
    data.series = (value.series || []).slice(-52);
    data.trendPoints = (value.trendPoints || []).slice(-104);
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
    ...(value.domains || []),
    value.term,
    value.termZh,
    value.seedTerm,
    value.title,
    value.brand,
    value.domain,
    value.keyword,
    value.headline,
    value.copy,
    value.query,
    value.pageId,
    value.category,
    value.ownershipBackground,
    value.size,
    value.form,
    value.claim,
    value.ingredient,
    ...(value.mainProducts || []),
    ...(value.benefits || []),
    ...(value.ingredientInsights || []).flatMap((item) => [
      item.name,
      item.role,
    ]),
    ...(data.assessment?.tags || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const at =
    value.collectedAt || value.lastCollectedAt || value.firstSeenAt || '';
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
}) {
  let flight;
  let lastError = '';
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
          `INSERT INTO workspace_read_links(collection,id,relation,target) VALUES ${part.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(',')}`,
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
      const dirty = (
        await connection.query(
          'SELECT kind,source_key,revision FROM workspace_read_dirty ORDER BY kind,source_key LIMIT 100',
        )
      ).rows;
      if (!dirty.length) {
        const snapshot = await connection.query(
          'SELECT market FROM workspace_overview_snapshots LIMIT 1',
        );
        if (!snapshot.rows.length) await buildOverview(connection);
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
              `SELECT ${key} AS source_key,${value} AS data FROM ${table} WHERE ${key} IN (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
              keys,
            )
          ).rows;
          for (const row of rows)
            sources.set(`${kind}:${row.source_key}`, row.data);
        }
        const projected = [],
          replacements = [],
          clearFailures = [];
        for (const item of dirty) {
          const source = sources.get(`${item.kind}:${item.source_key}`);
          const collection =
            item.kind === 'keywords'
              ? 'keywords'
              : item.source_key.slice(9).split(':')[0];
          if (collections.has(collection)) {
            if (collection === 'ads' || collection === 'sites')
              advertiserDirty = true;
            const failureKey = `read:failure:${createHash('sha256').update(`${item.kind}:${item.source_key}`).digest('hex')}`;
            if (source && source.dataNature !== 'demo') {
              try {
                projected.push({
                  collection,
                  sourceKey: item.source_key,
                  projection: projectRecord(collection, source),
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
        if (clearFailures.length)
          await connection.query(
            `DELETE FROM workspace_documents WHERE name IN (${clearFailures.map((_, i) => `$${i + 1}`).join(',')})`,
            clearFailures,
          );
        if (replacements.length) {
          const condition = replacements
            .map(
              (_, i) =>
                `(collection=$${i * 2 + 1} AND source_key=$${i * 2 + 2})`,
            )
            .join(' OR ');
          const old = (
            await connection.query(
              `SELECT collection,id FROM workspace_read_rows WHERE ${condition}`,
              replacements.flat(),
            )
          ).rows;
          if (old.length)
            await connection.query(
              `DELETE FROM workspace_read_links WHERE ${old.map((_, i) => `(collection=$${i * 2 + 1} AND id=$${i * 2 + 2})`).join(' OR ')}`,
              old.flatMap((r) => [r.collection, r.id]),
            );
          await connection.query(
            `DELETE FROM workspace_read_rows WHERE ${condition}`,
            replacements.flat(),
          );
          await saveProjections(connection, projected);
        }
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
        }
        await connection.query('COMMIT');
        lastError = (
          await connection.query(
            "SELECT name FROM workspace_documents WHERE name LIKE 'read:failure:%' LIMIT 1",
          )
        ).rows.length
          ? '部分记录字段异常，保留上次可用结果'
          : '';
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      }
      return dirty.length === 100;
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
  async function status() {
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
    return {
      snapshot: row
        ? {
            ...row.payload,
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
    equals('category', 'category');
    equals('ratingStatus', 'rating_status');
    equals('review', 'review_status');
    equals('platform', 'platform');
    equals('ownership', 'ownership');
    equals('siteId', 'site_id');
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
    if (input.keywordId) {
      if (collection === 'ads') relation('keyword', [input.keywordId]);
      else
        clauses.push(
          `EXISTS(SELECT 1 FROM workspace_read_links k WHERE k.collection='keywords' AND k.id=${bind(input.keywordId)} AND k.relation=${bind(collection)} AND k.target=r.id)`,
        );
    }
    if (collection === 'ads' && input.linkedSite)
      relation('sites', [input.linkedSite]);
    if (input.search?.trim()) {
      const search = bind(
        `%${String(input.search).trim().toLowerCase().slice(0, 200).replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`,
      );
      clauses.push(
        `(r.search_text LIKE ${search} ESCAPE '!' OR EXISTS(SELECT 1 FROM workspace_read_links l JOIN workspace_read_rows k ON k.collection='keywords' AND k.id=l.id WHERE l.collection='keywords' AND l.relation=r.collection AND l.target=r.id AND k.search_text LIKE ${search} ESCAPE '!') OR EXISTS(SELECT 1 FROM workspace_read_rows s WHERE s.collection='sites' AND s.id=r.site_id AND s.search_text LIKE ${search} ESCAPE '!'))`,
      );
    }
    return { collection, values, where: clauses.join(' AND ') };
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
    const total = Number(
      (
        await pool.query(
          `SELECT COUNT(*) AS total FROM workspace_read_rows r WHERE ${query.where}`,
          query.values,
        )
      ).rows[0].total,
    );
    page = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const sortColumn =
      input.sort === 'collectedAt'
        ? 'r.collected_at'
        : ['keywords', 'sites'].includes(query.collection)
          ? 'r.score'
          : 'r.collected_at';
    const direction = input.order === 'ascend' ? 'ASC' : 'DESC';
    const result = await pool.query(
      `SELECT r.payload,${query.collection === 'sites' ? "(SELECT COUNT(*) FROM workspace_read_rows p WHERE p.collection='products' AND p.site_id=r.id)" : '0'} AS product_count FROM workspace_read_rows r WHERE ${query.where} ORDER BY CASE WHEN ${sortColumn} IS NULL THEN 1 ELSE 0 END,${sortColumn} ${direction},r.id ASC LIMIT $${query.values.length + 1} OFFSET $${query.values.length + 2}`,
      [...query.values, pageSize, (page - 1) * pageSize],
    );
    return {
      rows: result.rows.map((r) =>
        query.collection === 'sites'
          ? { ...r.payload, productCount: Number(r.product_count) }
          : r.payload,
      ),
      total,
      page,
      pageSize,
      ...(await status()),
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
        `SELECT l.relation,l.target FROM workspace_read_links l JOIN workspace_read_rows r ON r.collection=l.collection AND r.id=l.id WHERE r.collection=$1${market.replace('market', 'r.market')} AND l.relation IN ('tag','source','benefit','ingredient') GROUP BY l.relation,l.target LIMIT 4000`,
        values,
      )
    ).rows;
    for (const name of ['tag', 'source', 'benefit', 'ingredient'])
      result[name] = [
        ...new Set([
          ...(result[name] || []),
          ...links.filter((r) => r.relation === name).map((r) => r.target),
        ]),
      ].sort();
    // Lookup options stay small and omit source evidence and time series.
    for (const collection of ['keywords', 'sites']) {
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
          `SELECT id,market,${columns} FROM workspace_read_rows WHERE collection=$1${market} ORDER BY id LIMIT 2000`,
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
      rows: rows.map((r) => r.payload),
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
    return { record: { ...record, listSummary: false } };
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
    list,
    facets,
    selection,
    details,
    bootstrap,
  };
}
