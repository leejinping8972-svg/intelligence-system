export type DiscoveryKind = 'fbm_new' | 'ingredients' | 'regular_new';
export const discoveryLabels = {
  fbm_new: 'FBM新品',
  regular_new: '常规新品',
  ingredients: '成分研究',
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
  supplementOnly?: boolean;
  sourceMode?: 'official_new_releases' | 'sorftime';
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
  mentions: {
    id: string;
    quote: string;
    platform: string;
    url: string;
    publishedAt: string;
    topic: string;
  }[];
}
export const defaultDiscoveryPlan = (
  kind: DiscoveryKind = 'regular_new',
  market = 'US',
): DiscoveryPlan => ({
  kind,
  market,
  days: kind === 'ingredients' ? 30 : 7,
  completeDays: kind !== 'ingredients',
  supplementOnly: true,
  categories: {},
  sourceMode: 'sorftime',
  channels: kind === 'ingredients' ? ['reddit', 'quora'] : ['amazon'],
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
  maxProducts: 100,
  maxPages: 3,
  maxDetails: 5,
});
