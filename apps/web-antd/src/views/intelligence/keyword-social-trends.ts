import { reactive, watch } from 'vue';

import { cloudRequest } from './cloud-workspace';
import { session } from './session';

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
  loadedIds: [] as string[],
  loadingIds: [] as string[],
  errors: {} as Record<string, string>,
  loadedAll: false,
});
const flights = new Map<string, Promise<TrendSnapshot>>();
let generation = 0;
watch(() => session.user?.id, () => {
  generation += 1;
  flights.clear();
  Object.assign(socialTrends, { summaries: [], error: '', loading: false, loadedIds: [], loadingIds: [], errors: {}, loadedAll: false });
});
export function loadSocialTrends(keywordIds?: string[]): Promise<TrendSnapshot> {
  const ids = keywordIds ? [...new Set(keywordIds)].toSorted() : undefined;
  const key = JSON.stringify(ids || null);
  const existing = flights.get(key);
  if (existing) return existing;
  const ticket = generation;
  socialTrends.loading = true;
  socialTrends.loadingIds = [...new Set([...socialTrends.loadingIds, ...(ids || [])])];
  const request = cloudRequest<TrendSnapshot>('server_keyword_trends_snapshot', ids ? { keywordIds: ids } : {})
    .then((value) => {
      if (ticket !== generation) return value;
      // A second list or page must not erase another visible page's saved values.
      socialTrends.summaries = ids
        ? [...socialTrends.summaries.filter((s) => !ids.includes(s.keywordId)), ...value.summaries]
        : value.summaries;
      socialTrends.loadedIds = [...new Set([...socialTrends.loadedIds, ...(ids || value.summaries.map((s) => s.keywordId))])];
      if (!ids) socialTrends.loadedAll = true;
      for (const id of ids || []) delete socialTrends.errors[id];
      socialTrends.error = '';
      return value;
    })
    .catch((error: unknown) => {
      if (ticket === generation) {
        socialTrends.error = error instanceof Error ? error.message : '趋势读取失败';
        for (const id of ids || []) socialTrends.errors[id] = socialTrends.error;
      }
      throw error;
    })
    .finally(() => {
      if (ticket !== generation) return;
      flights.delete(key);
      socialTrends.loadingIds = socialTrends.loadingIds.filter((id) => !ids?.includes(id) || [...flights.keys()].some((k) => (JSON.parse(k) || []).includes(id)));
      socialTrends.loading = flights.size > 0;
    });
  flights.set(key, request);
  return request;
}
