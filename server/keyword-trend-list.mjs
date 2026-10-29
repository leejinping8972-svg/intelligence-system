import { fourPeriodComparisons, rollingTrendComparison } from './model.js';

// Read only the saved Google trend fields needed by the visible list page.
export function keywordTrendList(record) {
  const fields = ['trendResolution', 'trendPeriod', 'trendCollectedAt',
    'trendDailyCollectedAt', 'trendHistoryCollectedAt', 'trendStatus', 'trendMessage',
    'trendRelatedTop', 'trendRelatedRising', 'trendInsightsStatus',
    'trendInsightsMessage', 'trendInsightsPeriod', 'trendSourceUrl'];
  return {
    ...Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]])),
    series: (record.series || []).slice(-366),
    trendPoints: (record.trendPoints || []).slice(-366),
    trendCalendarSummary: fourPeriodComparisons(record),
    trendRollingSummary: [30, 90, 180].map((days) => rollingTrendComparison(record, days)),
  };
}
