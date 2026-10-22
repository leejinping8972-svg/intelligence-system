import type { DiscoveryObservation } from './discovery';
import type { KeywordAssessment, KeywordMetrics } from './keyword-scoring';
import type {
  ProductCompletion,
  ProductDecisionData,
} from './product-decisions';

import { computed, reactive, watch } from 'vue';

import officialTrendSnapshots from '../../../../../workers/site-discovery/data/trends-snapshots.json';
import { trendComparisons } from './trend-comparison';

export type Market = 'MX' | 'US' | 'VN';
export type MarketFilter = 'ALL' | Market;
export const markets = [
  {
    code: 'US' as Market,
    name: '美国',
    english: 'United States',
    currency: 'USD',
    language: 'en-US',
    color: '#198771',
  },
  {
    code: 'MX' as Market,
    name: '墨西哥',
    english: 'Mexico',
    currency: 'MXN',
    language: 'es-MX',
    color: '#dc9c43',
  },
  {
    code: 'VN' as Market,
    name: '越南',
    english: 'Vietnam',
    currency: 'VND',
    language: 'vi-VN',
    color: '#647cc4',
  },
];
export const marketOptions = [
  { label: '全部市场', value: 'ALL' },
  ...markets.map((m) => ({ label: `${m.name} · ${m.code}`, value: m.code })),
];
export const categories = [
  '肠道与益生菌',
  '女性健康',
  '功能性营养',
  '体重管理',
  '美容与抗衰',
  '睡眠与压力',
  '运动营养',
];
export interface Keyword {
  adCollection?: {
    jobId?: string;
    status: string;
    count?: number;
    target?: number;
    message?: string;
    submittedAt?: string;
    startedAt?: string;
    finishedAt?: string;
  };
  id: string;
  term: string;
  termZh?: string;
  market: Market;
  category: string;
  source: string;
  growth: null | number;
  series: number[];
  seedTerm?: string;
  collectedAt?: string;
  metrics?: KeywordMetrics;
  assessment?: KeywordAssessment;
  reviewStatus?: 'excluded' | 'pending' | 'selected';
  reviewNote?: string;
  trendPoints?: Array<{ date: string; isPartial?: boolean; value: number }>;
  trendHistoryPoints?: Array<{
    date: string;
    isPartial?: boolean;
    value: number;
  }>;
  trendHistoryResolution?: 'day' | 'month' | 'unknown' | 'week';
  trendHistoryCollectedAt?: string;
  trendHistorySourceUrl?: string;
  trendDailyCollectedAt?: string;
  trendDailyPoints?: Array<{
    date: string;
    isPartial?: boolean;
    value: number;
  }>;
  trendResolution?: 'day' | 'month' | 'unknown' | 'week';
  trendPeriod?: string;
  trendSourceUrl?: string;
  trendCollectedAt?: string;
  trendDailyMessage?: string;
  trendStatus?: 'collected' | 'empty' | 'failed' | 'pending';
  trendMessage?: string;
  trendRegions?: TrendRegion[];
  trendRelatedTop?: TrendRelatedQuery[];
  trendRelatedRising?: TrendRelatedQuery[];
  trendInsightsStatus?: 'collected' | 'empty' | 'failed' | 'partial';
  trendInsightsMessage?: string;
  trendInsightsPeriod?: string;
  discoveryStatus?: 'collected' | 'failed' | 'pending';
  discoveryMessage?: string;
  siteCollection?: CollectionState;
  semrushCollection?: CollectionState;
  favorite: boolean;
  productIds: string[];
  siteIds: string[];
  updatedAt?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface TrendRegion {
  code: string;
  name: string;
  value: number;
  formattedValue?: string;
}
export interface TrendRelatedQuery {
  query: string;
  value: null | number;
  formattedValue: string;
  breakout?: boolean;
}
export interface CollectionState {
  jobId?: string;
  status:
    | 'cancelled'
    | 'completed'
    | 'empty'
    | 'failed'
    | 'partial'
    | 'queued'
    | 'running';
  target?: number;
  count?: number;
  message?: string;
  submittedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  apiUnits?: number;
  detailTarget?: number;
  detailCompleted?: number;
  ingredientCoverage?: number;
  doseCoverage?: number;
}
export interface IngredientInsight {
  name: string;
  amount: string;
  role: string;
  evidence: string;
}
export interface Product {
  formula?: {
    status: 'observed' | 'unknown' | 'verified';
    fingerprint: string;
    ingredients: Array<{ name: string; amount: string; raw: string }>;
    evidenceUrl: string;
    collectedAt: string;
  };
  discovery?: DiscoveryObservation;
  lastCollectedAt?: string;
  sourceMetrics?: {
    collectedAt?: string;
    rating?: number;
    reviewCount?: number;
    monthlySales?: number;
    reportedSales?: number;
    salesRank?: number;
    platformPotential?: number;
    keywordsCount?: number;
    position?: number;
    keyword?: string;
    shopName?: string;
    salesMetricNature?: string;
    timestamp?: number | string;
    observedAt?: string;
    urlKind?: string;
  };
  sourceContent?: {
    collectedAt: string;
    descriptions: string[];
    attributes: Record<string, string>;
    productInfo?: Record<string, string>;
    aPlusImages?: string[];
  };
  imageUrls?: string[];
  queryTerms?: string[];
  decisionData?: ProductDecisionData;
  dataCompletion?: ProductCompletion;
  sourceProvider?: string;
  sourcePlatform?: string;
  sourceProductId?: string;
  sourceUrl?: string;
  id: string;
  title: string;
  brand: string;
  market: Market;
  category: string;
  form: string;
  size: string;
  price: number;
  currency: string;
  ingredient: string;
  dose: string;
  claim: string;
  benefits: string[];
  benefitEvidence: string;
  ingredientInsights: IngredientInsight[];
  siteId: string;
  color: string;
  imageUrl?: string;
  collectionFields?: string[];
  reviewed: boolean;
  favorite: boolean;
  firstSeenAt?: string;
  publishedAt?: string;
  evidenceUrl?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface SiteAssessment {
  version: string;
  score: null | number;
  coverage: number;
  status: string;
  grade: string;
  assessedAt: string;
  dimensions: {
    key: string;
    label: string;
    weight: number;
    value: null | number;
    evidence: string;
  }[];
}
export interface Site {
  productCollection?: CollectionState;
  id: string;
  brand: string;
  domain: string;
  sources?: string[];
  sourceEvidence?: {
    source: string;
    url?: string;
    landingUrl?: string;
    keyword?: string;
    adId?: string;
    collectedAt?: string;
  }[];
  assessment?: SiteAssessment;
  metrics?: {
    source: string;
    market: Market;
    collectedAt: string;
    domain: string;
    organicTraffic?: number;
    organicKeywords?: number;
    paidTraffic?: number;
    paidKeywords?: number;
  };
  metricsStatus?: string;
  metricsMessage?: string;
  keywordIds?: string[];
  market: Market;
  platform: string;
  type: string;
  keyword: string;
  category: string;
  mainProducts: string[];
  ownershipBackground: string;
  ownershipOperations: string;
  ownershipEvidence: string;
  ownershipSource: string;
  collectorMode?: 'automatic' | 'manual' | 'restricted';
  lastCollectedAt?: string;
  evidenceUrl?: string;
  confidence?: number;
  signals?: string[];
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface Ad {
  discovery?: DiscoveryObservation;
  archiveId?: string;
  pageId?: string;
  keywordIds?: string[];
  query?: string;
  siteIds?: string[];
  landingUrls?: string[];
  imageUrls?: string[];
  videoUrls?: string[];
  videoPosterUrls?: string[];
  lastCollectedAt?: string;
  startDate?: string;
  source?: string;
  verification?: {
    url: string;
    status: string;
    reason?: string;
    siteId?: string;
  }[];
  id: string;
  brand: string;
  market: Market;
  platform: string;
  headline: string;
  copy: string;
  format: string;
  productId: string;
  status: string;
  color: string;
  firstSeenAt?: string;
  evidenceUrl?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface Review {
  id: string;
  productId: string;
  field: 'dose' | 'ingredient';
  current: string;
  proposed: string;
  quote: string;
  status: 'approved' | 'pending' | 'rejected';
  reason: string;
}
export interface Task {
  researchProgress?: {
    unlimitedRequests?: boolean;
    profile?: string;
    policyWarnings?: string[];
    detailTarget?: number;
    detailCompleted?: number;
    ingredientProducts?: number;
    doseProducts?: number;
    stopReason?: string;
    completion?: {
      total: number;
      done: number;
      withHistory: number;
      pending: number;
      failed: number;
      unsupported: number;
    };
    semrushUnits?: number;
    semrushReserved?: number;
    semrushUnitLimit?: number;
    current?: string;
    transcriptSummary?: {
      collected: number;
      unavailable: number;
      limited: number;
      failed: number;
      notVideo: number;
      skipped: number;
    };
    waiting?: number;
    previousRequests?: number;
    browserPages?: number;
    browserPageLimit?: number;
    paidRequests?: number;
    paidRequestLimit?: number;
    nextRunAt?: string;
    rows?: Array<{
      id: string;
      brand: string;
      domain: string;
      status: string;
      lastHttpStatus?: number;
      errorKind?: string;
      requests: number;
      products: number;
      detailTarget?: number;
      detailCompleted?: number;
      ingredients?: number;
      doses?: number;
      stopReason?: string;
      nextRunAt: string;
      message: string;
    }>;
    requestLog?: Array<{
      url: string;
      at: string;
      status: string;
      httpStatus?: number;
      products?: number;
      message?: string;
    }>;
    kind: string;
    done: number;
    total: number;
    evidence: number;
    products: number;
    requests: number;
    requestLimit: number;
    credits?: number;
    unknownCharges: number;
    reportId: string;
  };
  collectionProgress?: {
    channels?: {
      source: string;
      status: string;
      done: number;
      total: number;
    }[];
    kind?: string;
    semrushUnits?: number;
    done: number;
    total: number;
    current: string;
    ads: number;
    sites: number;
    requests: number;
    requestLimit: number;
    credits?: number;
    unknownCharges: number;
  };
  id: string;
  cloudJobId?: string;
  title: string;
  market: Market;
  mode?: 'demo' | 'live';
  stage?: 'keywords' | 'products' | 'sites';
  status:
    | 'awaiting_review'
    | 'cancelled'
    | 'completed'
    | 'partial'
    | 'queued'
    | 'running';
  created: string;
  steps: string[];
  progress?: {
    asyncRetries?: boolean;
    succeeded?: number;
    retryPending?: number;
    notStarted?: number;
    needsAttention?: number;
    retryLimit?: number;
    phase: string;
    metricProcessed?: number;
    semrushUnits?: number;
    semrushEnabled?: boolean;
    percent: number;
    terminal: boolean;
    target: number;
    discovered: number;
    discoveryDone: number;
    discoveryTotal: number;
    processed: number;
    total: number;
    annualAvailable: number;
    dailyAvailable: number;
    failed: number;
    limited: number;
    noSignal: number;
    rated: number;
    shortfall: number;
    nextRunAt: string;
    waitReason: string;
    retryAttempt: number;
    currentTerm: string;
    startedAt: string;
    finishedAt: string;
    updatedAt: string;
    rows: Array<{
      id: string;
      term: string;
      market: Market;
      annualPoints: number;
      dailyPoints: number;
      growth: null | number;
      assessment: string;
      status: string;
      message: string;
      failed: boolean;
      nextRetryAt?: string;
      retryAttempts?: number;
      annualStatus?: string;
      dailyStatus?: string;
    }>;
  };
}
export interface Monitor {
  id: string;
  productId: string;
  frequency: string;
  enabled: boolean;
}
export interface ImportBatch {
  id: string;
  name: string;
  count: number;
  skipped: number;
  errors: number;
  at: string;
  markets: Market[];
}
export interface AuditEvent {
  id: string;
  title: string;
  detail: string;
  at: string;
  market: MarketFilter;
}
export interface BrandingSettings {
  appName: string;
  workspaceName: string;
  businessName: string;
  environmentLabel: string;
  logo: string;
}
export const defaultBranding: BrandingSettings = {
  appName: '知衡情报',
  workspaceName: '知衡工作区',
  businessName: '大健康跨境市场情报',
  environmentLabel: '前台演示',
  logo: `${import.meta.env.BASE_URL}hci-logo.svg`,
};
export interface DemoState {
  version: number;
  market: MarketFilter;
  keywords: Keyword[];
  products: Product[];
  sites: Site[];
  ads: Ad[];
  reviews: Review[];
  tasks: Task[];
  monitors: Monitor[];
  imports: ImportBatch[];
  audit: AuditEvent[];
  savedOpportunities: string[];
  branding: BrandingSettings;
  settings: {
    taskBudget: number;
    monthlyBudget: number;
    trendLimit: number;
    productsPerSite: number;
    serpSearchCost: number;
    trendsTaskCost: number;
    trendsKeywordsPerTask: number;
    storeLeadsMarketCost: number;
    costBufferRate: number;
    researchApiUrl: string;
    researchAccessKey: string;
    researchMaxSites: number;
  };
}
const STATE_VERSION = 2;

function initial(): DemoState {
  return {
    version: STATE_VERSION,
    market: 'ALL',
    sites: [],
    products: [],
    keywords: [],
    ads: [],
    reviews: [],
    tasks: [],
    monitors: [],
    imports: [],
    audit: [],
    savedOpportunities: [],
    branding: { ...defaultBranding },
    settings: {
      taskBudget: 0,
      monthlyBudget: 0,
      trendLimit: 100,
      productsPerSite: 20,
      serpSearchCost: 0.015,
      trendsTaskCost: 0.0012,
      trendsKeywordsPerTask: 5,
      storeLeadsMarketCost: 0,
      costBufferRate: 20,
      researchApiUrl:
        'https://zhiheng-site-discovery.leejinping8972.workers.dev',
      researchAccessKey: '',
      researchMaxSites: 6,
    },
  };
}
// Keep table changes consistent with the 90-day chart displayed in the detail view.
function normalizeGrowth(data: DemoState) {
  for (const k of data.keywords) {
    // Apply verified official-page captures only to an existing matching record.
    // Never create seed records or replace a newer annual collection.
    const snapshot = officialTrendSnapshots.find(
      (item) =>
        item.keyword.toLowerCase() === k.term.toLowerCase() &&
        item.market === k.market,
    );
    if (
      snapshot &&
      (!k.trendPoints?.length ||
        Date.parse(k.trendCollectedAt || '') < Date.parse(snapshot.collectedAt))
    ) {
      k.series = snapshot.points.map((point) => point.value);
      k.trendPoints = snapshot.points;
      k.trendResolution = 'week';
      k.trendPeriod = snapshot.period;
      k.trendSourceUrl = snapshot.sourceUrl;
      k.trendCollectedAt = snapshot.collectedAt;
      k.trendStatus = 'collected';
      k.dataNature = 'collected';
      if (!k.source.includes('Google Trends'))
        k.source = `${k.source} / Google Trends官网实采`;
      k.trendMessage = `Google官网页面真实采集快照，采集于${snapshot.collectedAt.slice(
        0,
        10,
      )}`;
      if (!k.trendDailyPoints?.length) {
        k.growth = null;
        k.trendDailyMessage =
          '一年周曲线已采集；30天变化需要另取日数据，不能把周时点当成天计算';
      }
    }
    k.growth = trendComparisons(k)[0]!.change;
  }
  return data;
}
const storageKey = 'hci-demo-state-v1';
function restore(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    const defaults = initial();
    if (saved && saved.version !== STATE_VERSION) {
      return {
        ...defaults,
        market: ['ALL', 'MX', 'US', 'VN'].includes(saved.market)
          ? saved.market
          : defaults.market,
        branding: { ...defaults.branding, ...saved.branding },
        settings: {
          ...defaults.settings,
          ...saved.settings,
          productsPerSite: Math.min(
            20,
            Number(saved.settings?.productsPerSite) ||
              defaults.settings.productsPerSite,
          ),
          researchMaxSites: Math.min(
            10,
            Number(saved.settings?.researchMaxSites) ||
              defaults.settings.researchMaxSites,
          ),
          researchApiUrl:
            saved.settings?.researchApiUrl || defaults.settings.researchApiUrl,
        },
      } as DemoState;
    }
    if (
      saved?.version === STATE_VERSION &&
      Array.isArray(saved.products) &&
      Array.isArray(saved.audit)
    ) {
      const products: Product[] = saved.products.map((product: Product) => {
        const fallback = defaults.products.find(
          (item) => item.id === product.id,
        );
        const suspiciousIngredient =
          /\*\/|\/\*|display\s*:|position\s*:|trên cùng một trục ngang|stylesheet|javascript|^label directions?$|work together to support/i.test(
            String(product.ingredient || ''),
          );
        return {
          ...fallback,
          ...product,
          benefits:
            product.benefits ||
            fallback?.benefits ||
            [product.claim].filter(Boolean),
          benefitEvidence:
            product.benefitEvidence ||
            fallback?.benefitEvidence ||
            '人工导入，待补充官网商品页卖点依据。',
          ingredient: suspiciousIngredient
            ? '疑似非配方网页文案，待重新采集'
            : product.ingredient || fallback?.ingredient || '官网配方待采集',
          ingredientInsights: suspiciousIngredient
            ? []
            : product.ingredientInsights ||
              fallback?.ingredientInsights || [
                {
                  name: product.ingredient || '未知成分',
                  amount: product.dose || '剂量未知',
                  role: '待分析',
                  evidence: '人工导入，待补充标签或官网依据',
                },
              ],
          collectionFields: suspiciousIngredient
            ? (product.collectionFields || []).filter(
                (field) => !['成分分析', '配方'].includes(field),
              )
            : product.collectionFields,
        } as Product;
      });
      const sites: Site[] = (saved.sites || defaults.sites).map(
        (site: Site) => {
          const fallback = defaults.sites.find((item) => item.id === site.id);
          return {
            ...fallback,
            ...site,
            category: site.category || fallback?.category || '待分类',
            mainProducts: site.mainProducts || fallback?.mainProducts || [],
            ownershipBackground:
              site.ownershipBackground ||
              fallback?.ownershipBackground ||
              '待核验',
            ownershipOperations:
              site.ownershipOperations ||
              fallback?.ownershipOperations ||
              '待核验',
            ownershipEvidence:
              site.ownershipEvidence ||
              fallback?.ownershipEvidence ||
              '尚未从官网获取股权或运营主体信息。',
            ownershipSource:
              site.ownershipSource || fallback?.ownershipSource || '官网待采集',
          } as Site;
        },
      );
      const keywords: Keyword[] = (saved.keywords || defaults.keywords).map(
        (keyword: Keyword) => {
          const fallback = defaults.keywords.find(
            (item) => item.id === keyword.id,
          );
          const relatedProducts = products.filter(
            (product) =>
              product.market === keyword.market &&
              product.category === keyword.category,
          );
          return {
            ...fallback,
            ...keyword,
            productIds:
              keyword.productIds ||
              fallback?.productIds ||
              relatedProducts.map((product) => product.id),
            siteIds: keyword.siteIds ||
              fallback?.siteIds || [
                ...new Set(relatedProducts.map((product) => product.siteId)),
              ],
          } as Keyword;
        },
      );
      const ads: Ad[] = (saved.ads || defaults.ads).map((ad: Ad) => {
        const fallback = defaults.ads.find((item) => item.id === ad.id);
        return {
          ...fallback,
          ...ad,
          firstSeenAt: ad.firstSeenAt || fallback?.firstSeenAt,
          evidenceUrl: ad.evidenceUrl || fallback?.evidenceUrl,
          dataNature: ad.dataNature || fallback?.dataNature || 'imported',
        } as Ad;
      });
      return {
        ...defaults,
        ...saved,
        products,
        sites,
        keywords,
        ads,
        branding: { ...defaults.branding, ...saved.branding },
        settings: {
          ...defaults.settings,
          ...saved.settings,
          productsPerSite: Math.min(
            20,
            Number(saved.settings?.productsPerSite) ||
              defaults.settings.productsPerSite,
          ),
          researchMaxSites: Math.min(
            10,
            Number(saved.settings?.researchMaxSites) ||
              defaults.settings.researchMaxSites,
          ),
          researchApiUrl:
            saved.settings?.researchApiUrl || defaults.settings.researchApiUrl,
        },
      };
    }
  } catch {
    /* Start fresh when storage is unavailable. */
  }
  return initial();
}
export const state = reactive<DemoState>(normalizeGrowth(restore()));
const bootBranding = (
  globalThis as typeof globalThis & {
    __hciBranding?: Pick<BrandingSettings, 'appName' | 'logo'>;
  }
).__hciBranding;
if (bootBranding) Object.assign(state.branding, bootBranding);
window.addEventListener('hci:branding-changed', (event) => {
  Object.assign(state.branding, (event as CustomEvent).detail);
});
watch(
  () => [state.branding.appName, state.branding.logo],
  () => {
    try {
      localStorage.setItem(
        'intelligence-public-branding-v1',
        JSON.stringify({
          appName: state.branding.appName,
          logo: state.branding.logo,
        }),
      );
    } catch {
      /* Storage can be disabled. */
    }
  },
);
if (
  import.meta.env.VITE_HCI_SERVER === 'true' ||
  globalThis.location?.hostname === '43.172.66.45'
) {
  state.settings.researchApiUrl = `${globalThis.location.origin}/api`;
  if (state.branding.environmentLabel === '前台演示')
    state.branding.environmentLabel = '服务器版';
  if (import.meta.env.VITE_HCI_SERVER === 'true')
    state.settings.researchAccessKey = 'session';
}

export function openCapturedTrend(term: string, market: string) {
  const existing = state.keywords.find(
    (record) =>
      record.term.toLowerCase() === term.toLowerCase() &&
      record.market === market,
  );
  if (existing) return existing;
  const capture = officialTrendSnapshots.find(
    (record) =>
      record.keyword.toLowerCase() === term.toLowerCase() &&
      record.market === market,
  );
  if (!capture) return;
  const record: Keyword = {
    id: crypto.randomUUID(),
    term: capture.keyword,
    market: capture.market as Market,
    category: '女性健康',
    source: 'Google Trends官网实采',
    growth: null,
    series: [],
    favorite: false,
    productIds: [],
    siteIds: [],
    dataNature: 'collected',
    updatedAt: capture.collectedAt,
  };
  state.keywords.unshift(record);
  normalizeGrowth(state);
  return record;
}
export const storageError = reactive({ value: '' });
watch(
  state,
  () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      storageError.value = '';
    } catch {
      storageError.value = '浏览器存储不可用，本次操作仅在当前页面会话保留。';
    }
  },
  { deep: true, immediate: true },
);
export const inMarket = (market: Market) =>
  state.market === 'ALL' || state.market === market;
export const filteredProducts = computed(() =>
  state.products.filter((p) => inMarket(p.market)),
);
export const filteredKeywords = computed(() =>
  state.keywords.filter((p) => inMarket(p.market)),
);
export const filteredSites = computed(() =>
  state.sites.filter((p) => inMarket(p.market)),
);
export const pendingReviews = computed(() =>
  state.reviews.filter((review) => {
    if (review.status !== 'pending') return false;
    const product = state.products.find((item) => item.id === review.productId);
    return product ? inMarket(product.market) : false;
  }),
);
export function marketName(code: string) {
  return markets.find((m) => m.code === code)?.name ?? '全部市场';
}
export function money(value: number, currency: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(value);
}
export function stamp() {
  return new Date().toLocaleString('sv-SE');
}
export function audit(
  title: string,
  detail: string,
  market: MarketFilter = state.market,
) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    title,
    detail,
    at: stamp(),
    market,
  });
}
export function toggleFavorite(product: Product) {
  product.favorite = !product.favorite;
  audit(
    product.favorite ? '收藏商品' : '取消收藏',
    product.title,
    product.market,
  );
}
export function monitorProduct(productId: string) {
  const found = state.monitors.find((m) => m.productId === productId);
  if (found) found.enabled = true;
  else
    state.monitors.push({
      id: crypto.randomUUID(),
      productId,
      frequency: '每周',
      enabled: true,
    });
  audit(
    '开启演示监控',
    state.products.find((p) => p.id === productId)?.title || productId,
    state.products.find((p) => p.id === productId)?.market || state.market,
  );
}
export function clearWorkspaceResults() {
  const branding = { ...state.branding };
  const settings = { ...state.settings };
  const market = state.market;
  Object.assign(state, normalizeGrowth(initial()), {
    branding,
    market,
    settings,
  });
}
export function download(
  name: string,
  content: string,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvValue(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(name: string, rows: Record<string, unknown>[]) {
  const [firstRow] = rows;
  if (!firstRow) return;
  const keys = Object.keys(firstRow);
  download(
    name,
    `\uFEFF${[
      keys.map((key) => csvValue(key)).join(','),
      ...rows.map((r) => keys.map((k) => csvValue(r[k])).join(',')),
    ].join('\r\n')}`,
    'text/csv;charset=utf-8',
  );
}
