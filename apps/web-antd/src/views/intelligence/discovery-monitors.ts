export type DiscoveryKind = 'fbm_new' | 'ingredients' | 'regular_new';
export const discoveryLabels = {
  fbm_new: 'FBM新品',
  regular_new: '常规新品',
  ingredients: '成分风向',
};
export interface DiscoveryCategory { id: string; name: string; path: string[]; receiptId: string; market: string; }
export interface DiscoveryPlan {
  id?: string;
  kind: DiscoveryKind;
  market: string;
  days: number;
  channels: string[];
  sourceMarkets?: Record<string, string>;
  categories?: Record<string, DiscoveryCategory[]>;
  completeDays?: boolean;
  healthCoverageVersion?: string;
  healthProductPolicy?: string;
  supplementOnly?: boolean;
  sourceMode?: 'ingredient_trends' | 'official_new_releases' | 'sorftime';
  communities?: string[];
  maxRequests?: number;
  maxCommentRequests?: number;
  analysisMaxRecords?: number;
  analysisWeekday?: number;
  analysisTime?: string;
  focus?: string;
  lastCollectionJobId?: string;
  lastAnalysisJobId?: string;
  requireSales?: boolean;
  requireListingDate?: boolean;
  officialBoardUrls?: string[];
  topics: string | string[];
  frequency: 'daily' | 'monthly' | 'weekly';
  time: string;
  weekday: number;
  monthDay: number;
  enabled: boolean;
  maxProducts: number;
  maxPages: number;
  maxDetails: number;
  lastJobId?: string;
  lastScheduleError?: string;
  lastScheduledAt?: string;
}
export interface DiscoveryCapabilities {
  channels: {
    id: string;
    name: string;
    tools: string[];
    markets?: string[];
    sourceMarket?: string;
  }[];
  social: { id: string; supported: boolean; details: boolean }[];
}
export interface IngredientFinding {
  id: string;
  name: string;
  summary: string;
  market: string;
  firstSeenAt: string;
  lastSeenAt: string;
  mentionCount: number;
  platforms: string[];
  firstSeenInSystem: boolean;
  window?: {start: string; end: string};
  current?: {mentionCount: number; postCount: number; commentCount: number; authorCount: number; discussionCount: number};
  previous?: {mentionCount: number};
  observedChange?: number | null;
  comparisonReady?: boolean;
  mentions: {
    id: string;
    quote: string;
    platform: string;
    url: string;
    publishedAt: string;
    topic: string;
    community?: string;
    type?: 'comment' | 'post';
  }[];
}
export const defaultDiscoveryPlan = (
  kind: DiscoveryKind = 'regular_new',
  market = 'US',
): DiscoveryPlan => ({
  kind,
  market,
  days: 7,
  completeDays: kind !== 'ingredients',
  supplementOnly: true,
  categories: {},
  sourceMode: kind === 'ingredients' ? 'ingredient_trends' : 'sorftime',
  channels: kind === 'ingredients' ? ['reddit'] : ['amazon'],
  ...(kind === 'ingredients' ? {communities: ['Supplements','Nootropics','Biohackers'],maxRequests:60,maxCommentRequests:30,analysisMaxRecords:2000,analysisWeekday:1,analysisTime:'10:00',focus:''} : {}),
  sourceMarkets: {},
  topics:
    kind === 'ingredients'
      ? 'dietary supplements\nnew supplement ingredients'
      : '',
  frequency: 'daily',
  time: kind === 'ingredients' ? '09:00' : '00:00',
  weekday: 1,
  monthDay: 1,
  enabled: false,
  maxProducts: kind === 'ingredients' ? 1000 : 100,
  maxPages: kind === 'ingredients' ? 20 : 3,
  maxDetails: kind === 'ingredients' ? 6 : 5,
});

export interface IngredientTrendReport {
  id: string;
  market: string;
  asOf: string;
  generatedAt: string;
  window: {start: string; end: string};
  findings: IngredientFinding[];
  recordCount: number;
  omittedRecords: number;
  comparisonReady: boolean;
  postCoverageReady: boolean;
  communities: string[];
  commentCoverage: {postId:string;reported:number|null;unique:number;pending:number;countsMatch:boolean;blocked:boolean}[];
}
