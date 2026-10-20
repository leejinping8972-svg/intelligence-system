import type { Market } from './data';
export interface WatchConfig {
  id: string;
  kind: 'advertiser' | 'site';
  label: string;
  market: Market;
  siteId: string;
  pageId: string;
  enabled: boolean;
  hour: number;
  maxRequests: number;
}
export interface HotConfig {
  market: Market;
  seeds: string[];
  enabled: boolean;
  hour: number;
  unitLimit: number;
}
export interface WatchRun {
  id: string;
  market: Market;
  day: string;
  status: string;
  added?: number;
  count?: number;
  requests: number;
  reservedUnits?: number;
  confirmedUnits?: number;
  unknownCharges?: number;
  errors: string[];
  channels?: Array<{
    kind: string;
    baseline?: boolean;
    observed?: number;
    status: string;
  }>;
}
export interface HotRanking {
  market: Market;
  day: string;
  collectedAt: string;
  complete: boolean;
  seeds: string[];
  rows: Array<{
    term: string;
    rank: number;
    volume: number;
    change: null | number;
  }>;
}
export interface WatchSnapshot {
  targets: WatchConfig[];
  configs: HotConfig[];
  runs: WatchRun[];
  rankings: HotRanking[];
  events: Array<{
    id: string;
    targetId: string;
    market: Market;
    kind: string;
    itemId: string;
    title: string;
    detectedAt: string;
    url: string;
    terms: string[];
  }>;
}
export const watchStatus: Record<string, string> = {
  running: '执行中',
  completed: '完成',
  partial: '部分完成',
  failed: '失败',
  empty: '无数据',
  interrupted: '执行中断',
};
export function researchSourceTags(source: string) {
  return ['竞品上新', 'Semrush热词'].filter((tag) => source.includes(tag));
}
