import type { Market } from './data';

export type PublicSignalKind =
  | 'content'
  | 'ingredient_profile'
  | 'news'
  | 'product'
  | 'regulatory'
  | 'research'
  | 'safety_aggregate'
  | 'trial';

export type PublicSignalMarket = 'GLOBAL' | Market;

export interface PublicSignal {
  brand?: string;
  category: string;
  collectedAt: string;
  id: string;
  ingredients?: string[];
  kind: PublicSignalKind;
  market: PublicSignalMarket;
  metrics?: Record<string, unknown>;
  observedAt: string;
  query: string;
  source: string;
  sourceId: string;
  summary: string;
  title: string;
  url: string;
}

export interface PublicSourceRun {
  count: number;
  documentation: string;
  finishedAt: string;
  note: string;
  source: string;
  status: 'error' | 'needs_key' | 'rate_limited' | 'success';
}

export interface FreeSourceData {
  generatedAt: null | string;
  retentionDays: number;
  signals: PublicSignal[];
  sourceRuns: PublicSourceRun[];
  version: number;
}

export const sourceMeta: Record<
  string,
  { color: string; label: string; mark: string; purpose: string }
> = {
  NIH_DSLD: {
    label: 'NIH DSLD',
    mark: 'DS',
    color: 'green',
    purpose: '美国膳食补充剂商品标签、品牌与配方',
  },
  OPENFDA: {
    label: 'openFDA',
    mark: 'FD',
    color: 'red',
    purpose: '召回与CAERS公开监管线索',
  },
  PUBMED: {
    label: 'PubMed',
    mark: 'PM',
    color: 'blue',
    purpose: '近期公开科研文献',
  },
  CLINICAL_TRIALS: {
    label: 'ClinicalTrials.gov',
    mark: 'CT',
    color: 'cyan',
    purpose: '临床研究登记与研究方向',
  },
  PUBCHEM: {
    label: 'PubChem',
    mark: 'PC',
    color: 'purple',
    purpose: '成分标识与基础化学信息',
  },
  YOUTUBE: {
    label: 'YouTube Data API',
    mark: 'YT',
    color: 'volcano',
    purpose: '分市场视频内容与传播热度',
  },
  GDELT: {
    label: 'GDELT',
    mark: 'GD',
    color: 'gold',
    purpose: '全球新闻提及和议题变化',
  },
};

export const kindMeta: Record<
  PublicSignalKind,
  { color: string; label: string }
> = {
  product: { label: '商品标签', color: 'green' },
  research: { label: '科研文献', color: 'blue' },
  trial: { label: '临床研究', color: 'cyan' },
  ingredient_profile: { label: '成分档案', color: 'purple' },
  regulatory: { label: '召回记录', color: 'red' },
  safety_aggregate: { label: '安全汇总', color: 'orange' },
  content: { label: '内容热度', color: 'volcano' },
  news: { label: '新闻信号', color: 'gold' },
};

export function publicMarketName(market: PublicSignalMarket) {
  if (market === 'GLOBAL') return '全球';
  if (market === 'US') return '美国';
  if (market === 'MX') return '墨西哥';
  return '越南';
}

export function sourceStatus(run: PublicSourceRun) {
  if (run.status === 'success') return { label: '自动运行', color: 'green' };
  if (run.status === 'needs_key')
    return { label: '等待免费Key', color: 'orange' };
  if (run.status === 'rate_limited')
    return { label: '本次限流', color: 'gold' };
  return { label: '本次失败', color: 'red' };
}
