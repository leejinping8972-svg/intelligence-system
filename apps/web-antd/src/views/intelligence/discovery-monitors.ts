export type DiscoveryKind = 'fbm_new' | 'regular_new' | 'ingredients';
export const discoveryLabels = {
  fbm_new: 'FBM新品',
  regular_new: '常规新品',
  ingredients: '成分研究',
};
export interface DiscoveryPlan {
  id?: string;
  kind: DiscoveryKind;
  market: string;
  days: number;
  channels: string[];
  sourceMarkets?: Record<string, string>;
  topics: string | string[];
  frequency: 'daily' | 'weekly' | 'monthly';
  time: string;
  weekday: number;
  monthDay: number;
  enabled: boolean;
  maxCalls: number;
  maxProducts: number;
  maxPages: number;
  maxDetails: number;
  lastJobId?: string;
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
  days: 7,
  channels: kind === 'ingredients' ? ['reddit', 'quora'] : ['amazon'],
  sourceMarkets: {},
  topics: 'dietary supplements\nnew supplement ingredients',
  frequency: kind === 'ingredients' ? 'daily' : 'weekly',
  time: '09:00',
  weekday: 1,
  monthDay: 1,
  enabled: false,
  maxCalls: 20,
  maxProducts: 100,
  maxPages: 3,
  maxDetails: 5,
});
