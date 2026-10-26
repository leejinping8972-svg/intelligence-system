import { editableKeywordPatch } from './domain.mjs';
import { trendComparisons } from './model.js';

const timestamp = (value) => Date.parse(value || '') || 0;
const metricFields = [
  'monthlySearchVolume',
  'difficulty',
  'top3Share',
  'cpc',
  'advertisingCompetition',
];
const annualFields = [
  'series',
  'trendPoints',
  'trendPeriod',
  'trendResolution',
  'trendSourceUrl',
  'trendCollectedAt',
  'trendStatus',
  'trendMessage',
  'trendRegions',
  'trendRelatedTop',
  'trendRelatedRising',
  'trendInsightsStatus',
  'trendInsightsMessage',
  'trendInsightsPeriod',
];
const dailyFields = [
  'trendDailyPoints',
  'trendDailyCollectedAt',
  'trendDailyMessage',
];
const historyFields = [
  'trendHistoryPoints',
  'trendHistoryResolution',
  'trendHistoryCollectedAt',
  'trendHistorySourceUrl',
];
const collectionFields = [
  'siteCollection',
  'semrushCollection',
  'adCollection',
];

export function mergeKeywordMetrics(current, incoming, importOnly = false) {
  const metrics = editableKeywordPatch({ metrics: incoming }).metrics;
  if (
    metrics?.market !== current.market ||
    !metricFields.some((key) => metrics[key] !== undefined) ||
    (current.metrics &&
      (importOnly ||
        timestamp(metrics.collectedAt) <
          timestamp(current.metrics.collectedAt)))
  )
    return current.metrics;
  return { ...current.metrics, ...metrics };
}

// Checkpoints can outlive newer writes from other jobs. Merge each source by its own timestamp.
export function mergeKeyword(current, incoming, importOnly = false) {
  const merged = { ...current };
  merged.source = [
    ...new Set(
      [current.source, incoming.source]
        .flatMap((s) => String(s || '').split(' / '))
        .filter(Boolean),
    ),
  ].join(' / ');
  for (const key of ['seedTerm', 'category', 'termZh'])
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  for (const key of ['productIds', 'siteIds'])
    merged[key] = [
      ...new Set([...(current[key] || []), ...(incoming[key] || [])]),
    ];
  if (incoming.dataNature === 'collected') merged.dataNature = 'collected';

  const metrics = mergeKeywordMetrics(current, incoming.metrics, importOnly);
  if (metrics !== undefined) merged.metrics = metrics;

  let updatedTrend = false;
  for (const [points, at, fields] of [
    ['series', 'trendCollectedAt', annualFields],
    ['trendDailyPoints', 'trendDailyCollectedAt', dailyFields],
    ['trendHistoryPoints', 'trendHistoryCollectedAt', historyFields],
  ]) {
    if (!incoming[points]?.length || (importOnly && current[points]?.length))
      continue;
    if (
      current[points]?.length &&
      timestamp(incoming[at]) < timestamp(current[at])
    )
      continue;
    for (const key of fields)
      if (incoming[key] !== undefined) merged[key] = incoming[key];
    updatedTrend = true;
  }
  if (updatedTrend) merged.growth = trendComparisons(merged)[0].change;
  if (
    !importOnly &&
    timestamp(incoming.updatedAt) >= timestamp(current.updatedAt)
  ) {
    for (const key of ['trendParts', 'trendDailyMessage', 'trendMessage'])
      if (
        incoming[key] !== undefined &&
        (key === 'trendParts' || incoming.trendStatus !== 'pending')
      )
        merged[key] = incoming[key];
    if (!merged.series?.length && incoming.trendStatus)
      merged.trendStatus = incoming.trendStatus;
  }
  for (const key of collectionFields)
    if (!merged[key] && incoming[key]) merged[key] = incoming[key];
  for (const key of ['collectedAt', 'updatedAt'])
    if (timestamp(incoming[key]) > timestamp(current[key]))
      merged[key] = incoming[key];
  return merged;
}
