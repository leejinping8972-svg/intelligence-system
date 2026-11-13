import { randomUUID } from 'node:crypto';
import { validateResearchTrends } from './keyword-research-trends.mjs';
import { sanitizeSemrushExtras } from './semrush-keyword-trends.mjs';

export const normalizeTerm = (value) =>
  String(value || '')
    .normalize('NFKC')
    .replaceAll(/\s+/g, ' ')
    .trim();
export const naturalKey = (record) =>
  `${record.market}|${normalizeTerm(record.term).toLowerCase()}`;
const markets = new Set(['MX', 'US', 'VN']);
const sources = new Set([
  'amazon_autocomplete',
  'google_autocomplete',
  'semrush',
  'sorftime',
]);
export const keywordFields = new Set([
  'adCollection',
  'batch',
  'category',
  'collectedAt',
  'dataNature',
  'favorite',
  'growth',
  'id',
  'market',
  'metrics',
  'productIds',
  'productKeywordEvidence',
  'reviewNote',
  'reviewStatus',
  'seedTerm',
  'seedTermZh',
  'semrushCollection',
  'series',
  'siteCollection',
  'siteIds',
  'source',
  'term',
  'termZh',
  'trendCollectedAt',
  'trendDailyCollectedAt',
  'trendDailyMessage',
  'trendDailyPoints',
  'trendHistoryCollectedAt',
  'trendHistoryPoints',
  'trendHistoryResolution',
  'trendHistorySourceUrl',
  'trendInsightsMessage',
  'trendInsightsPeriod',
  'trendInsightsStatus',
  'trendMessage',
  'trendParts',
  'trendPeriod',
  'trendPoints',
  'trendRegions',
  'trendRelatedRising',
  'trendRelatedTop',
  'trendResolution',
  'trendSourceUrl',
  'trendStatus',
  'updatedAt',
]);
export function cleanKeyword(value) {
  if (!value || typeof value !== 'object' || !markets.has(value.market))
    throw new Error('关键词市场仅支持US、MX、VN');
  const record = Object.fromEntries(
    Object.entries(value).filter(([key]) => keywordFields.has(key)),
  );
  record.term = normalizeTerm(record.term);
  if (typeof record.termZh === 'string')
    record.termZh = normalizeTerm(record.termZh).slice(0, 255);
  else delete record.termZh;
  if (typeof record.batch === 'string') {
    record.batch = normalizeTerm(record.batch).slice(0, 100);
    if (!record.batch) delete record.batch;
  } else delete record.batch;
  if (
    !record.term ||
    record.term.length > 255 ||
    JSON.stringify(record).length > 150_000
  )
    throw new Error('关键词数据格式或长度不正确');
  if (value.dataNature === 'demo') throw new Error('演示数据不会迁移至云端');
  return {
    ...record,
    id: String(record.id || randomUUID()).slice(0, 100),
    source: String(record.source || '人工导入').slice(0, 2000),
    favorite: record.favorite === true,
    reviewStatus: ['excluded', 'selected'].includes(record.reviewStatus)
      ? record.reviewStatus
      : 'pending',
    series: Array.isArray(record.series) ? record.series.slice(0, 800) : [],
    productIds: Array.isArray(record.productIds)
      ? record.productIds.filter((id) => typeof id === 'string').slice(0, 1000)
      : [],
    siteIds: Array.isArray(record.siteIds)
      ? record.siteIds.filter((id) => typeof id === 'string').slice(0, 1000)
      : [],
    dataNature: record.dataNature === 'collected' ? 'collected' : 'imported',
  };
}
/** Per discovery collect call: take as many suggestions as sources return. */
export const KEYWORD_EXPANSION_FETCH_CAP = 10_000;

export function validateJob(value) {
  const existingRecords = value.existingRecords?.map(cleanKeyword);
  const rawLimit = value.limit;
  const input = {
    ...(typeof value.batch === 'string' && normalizeTerm(value.batch)
      ? { batch: normalizeTerm(value.batch).slice(0, 100) }
      : {}),
    seeds: [
      ...new Set(
        (Array.isArray(value.seeds) ? value.seeds : [])
          .map((seed) => normalizeTerm(seed))
          .filter(Boolean),
      ),
    ],
    markets: [...new Set(Array.isArray(value.markets) ? value.markets : [])],
    sources: [...new Set(Array.isArray(value.sources) ? value.sources : [])],
    depth: value.depth === 2 ? 2 : 1,
    limit: rawLimit,
    existingRecords,
    trendComparisonVersion: 2,
  };
  if (
    input.markets.length === 0 ||
    input.markets.some((market) => !markets.has(market))
  )
    throw new Error('请选择市场');
  if (input.existingRecords) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100
    )
      throw new Error('请选择市场，关键词上限为1～100');
    input.expectedKeywordCount = value.expectedKeywordCount ?? input.limit;
    if (value.semrushRefreshMetrics === true) {
      if (!input.sources.includes('semrush')) throw new Error('更新Semrush字段必须选择Semrush渠道');
      input.semrushRefreshMetrics = true;
    }
    if (
      input.existingRecords.length === 0 ||
      input.existingRecords.length > 100 ||
      input.limit !== input.existingRecords.length ||
      input.expectedKeywordCount !== input.existingRecords.length ||
      new Set(input.existingRecords.map((r) => r.id)).size !==
        input.existingRecords.length ||
      new Set(input.existingRecords.map(naturalKey)).size !==
        input.existingRecords.length ||
      input.existingRecords.some(
        (record) => !input.markets.includes(record.market),
      )
    )
      throw new Error(
        '补齐任务的勾选数量、名单和结果上限必须一致，且为所选市场的1～100个不同关键词；未提交部分名单',
      );
  } else {
    // Expansion research: no keyword-count ceiling; 0 / omitted means unlimited.
    if (rawLimit === undefined || rawLimit === null || rawLimit === 0) {
      input.limit = 0;
    } else if (
      !Number.isInteger(rawLimit) ||
      rawLimit < 1 ||
      rawLimit > KEYWORD_EXPANSION_FETCH_CAP
    ) {
      throw new Error(
        `扩词任务可不设上限；若填写结果上限须为1～${KEYWORD_EXPANSION_FETCH_CAP}`,
      );
    }
    if (
      input.seeds.length === 0 ||
      input.seeds.some((seed) => seed.length > 255) ||
      (input.limit > 0 &&
        input.seeds.length * input.markets.length > input.limit) ||
      input.sources.length === 0 ||
      input.sources.some((source) => !sources.has(source))
    )
      throw new Error('请检查种子词与关键词渠道');
    input.expansionOnly = true;
  }
  // Google / TK / INS / FB trends run via 趋势采集 / 每日监测, not keyword expansion.
  if (value.socialTrends !== undefined && !input.expansionOnly)
    input.socialTrends = validateResearchTrends(value.socialTrends, input.markets);
  return input;
}
export function editableKeywordPatch(patch) {
  const result = {};
  if (typeof patch.termZh === 'string')
    result.termZh = normalizeTerm(patch.termZh).slice(0, 255);
  if (typeof patch.favorite === 'boolean') result.favorite = patch.favorite;
  if (['excluded', 'pending', 'selected'].includes(patch.reviewStatus))
    result.reviewStatus = patch.reviewStatus;
  if (typeof patch.reviewNote === 'string')
    result.reviewNote = patch.reviewNote.slice(0, 2000);
  if (
    patch.metrics === null ||
    (patch.metrics &&
      markets.has(patch.metrics.market) &&
      typeof patch.metrics.source === 'string' &&
      Number.isFinite(Date.parse(patch.metrics.collectedAt)))
  ) {
    if (patch.metrics === null) result.metrics = null;
    else {
      result.metrics = {
        market: patch.metrics.market,
        source: patch.metrics.source.slice(0, 200),
        collectedAt: patch.metrics.collectedAt,
      };
      for (const key of ['intent', 'database', 'report'])
        if (typeof patch.metrics[key] === 'string')
          result.metrics[key] = patch.metrics[key].slice(0, 100);
      Object.assign(result.metrics, sanitizeSemrushExtras(patch.metrics));
      for (const key of [
        'monthlySearchVolume',
        'difficulty',
        'top3Share',
        'cpc',
        'advertisingCompetition',
      ]) {
        const number = patch.metrics[key];
        if (
          typeof number === 'number' &&
          Number.isFinite(number) &&
          number >= 0 &&
          (['cpc', 'monthlySearchVolume'].includes(key) ||
            number <= (key === 'advertisingCompetition' ? 1 : 100))
        )
          result.metrics[key] = number;
      }
    }
  }
  return result;
}
