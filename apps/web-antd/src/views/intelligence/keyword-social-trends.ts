import { reactive } from 'vue';

import { cloudRequest } from './cloud-workspace';

export interface SocialPeriod {
  collectedAt?: string;
  stale?: boolean;
  key: string;
  label: string;
  start: string;
  end: string;
  count: null | number;
  change: null | number;
  previousStart?: string;
  previousEnd?: string;
  previousCount?: number;
  currentMean?: null | number;
  previousMean?: null | number;
  currentComplete?: boolean;
  previousComplete?: boolean;
  state?: string;
  reason: string;
}
export interface SocialSummary {
  comparisonVersion?: number;
  metric?: string;
  keywordId: string;
  term: string;
  market: string;
  source: string;
  collectedAt: string;
  coverage: string;
  sampleCount: number;
  undatedCount: number;
  periods: SocialPeriod[];
  status?: string;
  attemptMessage?: string;
}
export interface TrendPlan {
  comparisonVersion: number;
  enabled: boolean;
  time: string;
  sources: string[];
  markets: string[];
  maxRequests: number;
  maxPages: number;
}
export interface TrendSnapshot {
  requiresPlanReview?: boolean;
  plan: TrendPlan;
  summaries: SocialSummary[];
  run: null | {
    day: string;
    total: number;
    pending: number;
    usedRequests: number;
    work: Array<{
      key: string;
      term: string;
      source: string;
      window: string;
      status: string;
      reason?: string;
      jobId?: string;
    }>;
  };
}
export const socialTrends = reactive({
  summaries: [] as SocialSummary[],
  error: '',
  loading: false,
});
let flight: Promise<TrendSnapshot> | undefined;
export function loadSocialTrends(): Promise<TrendSnapshot> {
  if (flight) return flight;
  socialTrends.loading = true;
  flight = cloudRequest<TrendSnapshot>('server_keyword_trends_snapshot')
    .then((value) => {
      socialTrends.summaries = value.summaries;
      socialTrends.error = '';
      return value;
    })
    .catch((error: unknown) => {
      socialTrends.error =
        error instanceof Error ? error.message : '趋势读取失败';
      throw error;
    })
    .finally(() => {
      flight = undefined;
      socialTrends.loading = false;
    });
  return flight;
}
