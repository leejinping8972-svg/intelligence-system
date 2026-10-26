import { randomUUID } from 'node:crypto';

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
  'category',
  'collectedAt',
  'dataNature',
  'favorite',
  'growth',
  'id',
  'market',
  'metrics',
  'productIds',
  'reviewNote',
  'reviewStatus',
  'seedTerm',
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
export function validateJob(value) {
  const input = {
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
    limit: value.limit,
    sorftimeRequestLimit: 0,
    existingRecords: value.existingRecords?.map(cleanKeyword),
    trendComparisonVersion: 2,
  };
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    input.markets.length === 0 ||
    input.markets.some((market) => !markets.has(market))
  )
    throw new Error('请选择市场，关键词上限为1～100');
  if (input.existingRecords) {
    input.expectedKeywordCount = value.expectedKeywordCount ?? input.limit;
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
  } else if (
    input.seeds.length === 0 ||
    input.seeds.some((seed) => seed.length > 255) ||
    input.seeds.length * input.markets.length > input.limit ||
    input.sources.length === 0 ||
    input.sources.some((source) => !sources.has(source))
  )
    throw new Error('请检查种子词、结果上限与关键词渠道');
  const remaining = input.limit - input.seeds.length * input.markets.length;
  const supportedPairs =
    input.seeds.length *
    input.markets.filter((market) => market === 'US' || market === 'MX').length;
  if (
    !input.existingRecords &&
    input.sources.includes('sorftime') &&
    remaining > 0 &&
    supportedPairs > 0
  )
    input.sorftimeRequestLimit =
      input.depth === 2
        ? Math.min(input.limit, supportedPairs + remaining)
        : supportedPairs;
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
