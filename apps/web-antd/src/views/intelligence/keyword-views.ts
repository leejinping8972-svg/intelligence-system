import type { ScoreFilter } from './resource-list';
import type { CorePeriod } from './core-list-metrics';
export interface KeywordViewFilters {
  market: string; search: string; category: string; rating: string; ratingStatus: string;
  score: ScoreFilter; tags: string[]; timeRange: string; review: string; favorite: boolean;
  sort: string; order: string; pageSize: number; period: CorePeriod;
}
export interface SavedKeywordView {
  id: string; name: string; filters: KeywordViewFilters; revision: number;
}
