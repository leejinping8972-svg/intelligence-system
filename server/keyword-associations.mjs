import { createHash } from 'node:crypto';

import { cleanKeyword, naturalKey, normalizeTerm } from './domain.mjs';
import { siteKeywordProvenance } from './site-keyword-provenance.mjs';

const BUSINESS_COLLECTIONS = new Set(['ads', 'products', 'sites']);

function asObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string').map((value) => normalizeTerm(value)).filter(Boolean))];
}

/**
 * Recover exact keyword associations already present in collected business
 * records. This deliberately uses only persisted text/evidence and never
 * expands terms or calls a provider/model.
 */
export function associationTerms(value) {
  if (value?.domain && Array.isArray(value?.mainProducts))
    return siteKeywordProvenance(value).queryTerms.filter((term) => term.length <= 255);
  const sourceEvidence = Array.isArray(value?.sourceEvidence) ? value.sourceEvidence : [];
  const resourceTerms = Array.isArray(value?.resourceEvidence?.queryTerms)
    ? value.resourceEvidence.queryTerms
    : [];
  const queryTerms = Array.isArray(value?.queryTerms) ? value.queryTerms : [];
  return uniqueStrings([
    value?.keyword,
    value?.query,
    value?.sourceMetrics?.keyword,
    ...queryTerms,
    ...resourceTerms,
    ...sourceEvidence.flatMap((item) => [item?.keyword, item?.query]),
  ]).filter((term) => term.length <= 255);
}

function businessCollection(name) {
  const match = /^business:(ads|products|sites):/.exec(name || '');
  return match?.[1] || '';
}

function stableBackfillId(market, term) {
  return `keyword-backfill-${createHash('sha256').update(`${market}|${normalizeTerm(term).toLowerCase()}`).digest('hex').slice(0, 32)}`;
}

async function ensureKeyword(connection, sql, index, term, market) {
  const key = naturalKey({ term, market });
  const existing = index.get(key);
  if (existing) return existing;
  const record = cleanKeyword({
    id: stableBackfillId(market, term),
    term,
    market,
    source: '历史业务关联补齐',
    reviewStatus: 'pending',
    dataNature: 'collected',
  });
  await connection.query(
    sql(
      'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2) ON CONFLICT(natural_key) DO NOTHING',
      'INSERT IGNORE INTO research_keywords(natural_key,data) VALUES($1,$2)',
    ),
    [key, record],
  );
  const result = await connection.query(
    'SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
    [key],
  );
  const row = result.rows[0];
  const value = row?.data || record;
  index.set(key, { key, data: value });
  return index.get(key);
}

function appendUnique(target, values) {
  const merged = [...new Set([...(Array.isArray(target) ? target : []), ...values])];
  return merged;
}

/**
 * Backfill keyword records and their exact business relationships. The caller
 * supplies the already locked workspace-read connection so the operation can
 * be retried safely by the startup projection pass.
 */
export async function reconcileKeywordAssociations({ connection, sql, putDocument }) {
  const keywordResult = await connection.query('SELECT natural_key,data FROM research_keywords');
  const keywordRows = keywordResult.rows;
  const keywords = new Map(keywordRows.map((row) => [row.natural_key, { key: row.natural_key, data: asObject(row.data) }]));
  const keywordsById = new Map(keywordRows.map((row) => [row.data?.id, { key: row.natural_key, data: asObject(row.data) }]));
  const documentResult = await connection.query(
    "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:%'",
  );
  const docs = documentResult.rows
    .map((row) => ({ ...row, collection: businessCollection(row.name) }))
    .filter((row) => BUSINESS_COLLECTIONS.has(row.collection));
  const order = { sites: 0, products: 1, ads: 2 };
  const ordered = docs.toSorted((a, b) =>
    (order[a.collection] ?? 9) - (order[b.collection] ?? 9) || a.name.localeCompare(b.name));
  const siteKeywords = new Map();
  const productKeywords = new Map();
  const keywordUpdates = new Map();
  let created = 0;
  let updated = 0;

  for (const row of ordered) {
    const value = asObject(row.value);
    const market = typeof value.market === 'string' ? value.market : '';
    if (!market) continue;
    const ids = new Set(Array.isArray(value.keywordIds) ? value.keywordIds.filter((id) => typeof id === 'string' && id) : []);
    for (const term of associationTerms(value)) {
      const key = naturalKey({ term, market });
      const before = keywords.has(key);
      const entry = await ensureKeyword(connection, sql, keywords, term, market);
      keywordsById.set(entry.data.id, entry);
      if (!before) created++;
      ids.add(entry.data.id);
    }
    if (row.collection === 'products' && value.siteId && siteKeywords.has(`${market}|${value.siteId}`)) {
      for (const id of siteKeywords.get(`${market}|${value.siteId}`)) ids.add(id);
    }
    if (row.collection === 'ads' && Array.isArray(value.siteIds)) {
      for (const siteId of value.siteIds) {
        for (const id of siteKeywords.get(`${market}|${siteId}`) || []) ids.add(id);
      }
    }
    if (row.collection === 'ads' && value.productId) {
      for (const id of productKeywords.get(`${market}|${value.productId}`) || []) ids.add(id);
    }
    const nextIds = [...ids];
    if (row.collection === 'sites') siteKeywords.set(`${market}|${value.id}`, nextIds);
    if (row.collection === 'products') productKeywords.set(`${market}|${value.id}`, nextIds);
    for (const id of nextIds) {
      const keyword = keywordsById.get(id);
      if (!keyword) continue;
      const next = { ...(keywordUpdates.get(keyword.key) || keyword.data) };
      if (row.collection === 'products') next.productIds = appendUnique(next.productIds, [value.id]);
      if (row.collection === 'sites') next.siteIds = appendUnique(next.siteIds, [value.id]);
      keywordUpdates.set(keyword.key, next);
    }
    const oldIds = Array.isArray(value.keywordIds) ? value.keywordIds : [];
    if (JSON.stringify(oldIds) !== JSON.stringify(nextIds)) {
      await putDocument('workspace_documents', row.name, { ...value, keywordIds: nextIds }, false, connection);
      updated++;
    }
  }
  for (const [key, data] of keywordUpdates) {
    await connection.query(
      'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
      [key, data],
    );
  }
  return { created, updated, keywords: keywords.size };
}

/** Add direct-search terms only. No expansion, trends, translation, or provider call. */
export async function ensureDirectKeywords({ connection, sql, terms, market }) {
  const normalized = [...new Map((terms || []).map((term) => [normalizeTerm(term).toLowerCase(), normalizeTerm(term)]))
    .values()]
    .filter(Boolean);
  if (normalized.length === 0) return [];
  const existingResult = await connection.query(
    `SELECT natural_key,data FROM research_keywords WHERE natural_key IN (${normalized.map((_, index) => `$${index + 1}`).join(',')})`,
    normalized.map((term) => naturalKey({ term, market })),
  );
  const existing = new Map(existingResult.rows.map((row) => [row.natural_key, row.data]));
  const result = [];
  for (const term of normalized) {
    const key = naturalKey({ term, market });
    let data = existing.get(key);
    if (!data) {
      data = cleanKeyword({ term, market, source: '直接检索', dataNature: 'collected' });
      await connection.query(
        sql(
          'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2) ON CONFLICT(natural_key) DO NOTHING',
          'INSERT IGNORE INTO research_keywords(natural_key,data) VALUES($1,$2)',
        ),
        [key, data],
      );
      const inserted = await connection.query('SELECT data FROM research_keywords WHERE natural_key=$1', [key]);
      data = inserted.rows[0]?.data || data;
      existing.set(key, data);
    }
    result.push({ id: data.id, term: data.term, market: data.market, naturalKey: key });
  }
  return result;
}
