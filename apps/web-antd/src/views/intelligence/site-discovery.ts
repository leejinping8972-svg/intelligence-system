import type { Keyword, Market, Product, Site } from './data';

export interface DiscoveredProduct {
  availability: null | string;
  benefits: string[];
  brand: string;
  collectionFields: string[];
  currency: string;
  description: string;
  form: string;
  image: null | string;
  ingredientInsights: Array<{
    amount: string;
    evidence: string;
    name: string;
    role: string;
  }>;
  ingredients: string;
  price: null | number;
  servingSize: string;
  size: string;
  sku: string;
  title: string;
  url: string;
}

export interface DiscoveredSite extends Omit<Site, 'dataNature'> {
  confidence: number;
  evidenceUrl: string;
  products: DiscoveredProduct[];
  signals: string[];
}

export interface DiscoveryGroup {
  coverage: {
    candidateDomains: number;
    rejectedOrUnreachable: number;
    searchResults: number;
    validatedSites: number;
  };
  keyword: string;
  market: Market;
  sites: DiscoveredSite[];
}

export interface DiscoveryResponse {
  generatedAt: string;
  groups: DiscoveryGroup[];
  suggestions: SuggestionGroup[];
  trends: TrendGroup[];
}

export interface ProductEnrichmentResult {
  id: string;
  message: string;
  product?: DiscoveredProduct;
  status: 'failed' | 'success';
}

export interface ProductEnrichmentResponse {
  generatedAt: string;
  products: ProductEnrichmentResult[];
}

export interface TrendGroup {
  collectedAt?: string;
  dailyMessage?: string;
  dailyPoints?: Array<{ date: string; isPartial?: boolean; value: number }>;
  growth: null | number;
  keyword: string;
  market: Market;
  message: string;
  points: Array<{ date: string; isPartial?: boolean; value: number }>;
  period?: string;
  resolution?: 'day' | 'month' | 'unknown' | 'week';
  sourceUrl?: string;
  series: number[];
  source: string;
  status: 'empty' | 'error' | 'success';
}

export interface SuggestionGroup {
  items: Array<{
    category?: string;
    source: string;
    term: string;
  }>;
  keyword: string;
  market: Market;
  sources: Array<{
    count: number;
    message: string;
    source: string;
    status: 'empty' | 'error' | 'partial' | 'success' | 'unsupported';
  }>;
}

export function trendRecordFields(trend: TrendGroup) {
  return {
    growth: trend.growth,
    series: trend.series,
    trendPoints: trend.points,
    trendDailyPoints: trend.dailyPoints || [],
    trendResolution: trend.resolution || 'unknown',
    trendPeriod: trend.period,
    trendSourceUrl: trend.sourceUrl,
    trendCollectedAt: trend.collectedAt,
    trendDailyMessage: trend.dailyMessage,
    trendStatus: trend.series.length > 0 ? 'collected' : 'failed',
    trendMessage: trend.message || trend.dailyMessage || '已采集一年趋势',
  } satisfies Partial<Keyword>;
}

/**
 * Classify a search expression before a site or product has been collected.
 * The same multilingual rules are also applied in the Worker response so the
 * keyword list never has to wait for a later product crawl to become useful.
 */
export function classifyKeyword(...values: string[]) {
  const text = values.join(' ').toLocaleLowerCase();
  const rules: Array<[RegExp, string]> = [
    [
      /probiotic|prebiotic|gut|digest|inulin|psyllium|fiber|fibre|men vi sinh|đường ruột|chất xơ|probiótico|digestiv/,
      '肠道与益生菌',
    ],
    [
      /women|woman|female|menopause|prenatal|fertility|inositol|phụ nữ|nội tiết|mujer|femenin/,
      '女性健康',
    ],
    [
      /collagen|skin|beauty|hair|nail|anti-aging|anti aging|làm đẹp|da tóc|belleza/,
      '美容与抗衰',
    ],
    [
      /weight|slim|metabolism|fat burn|keto|giảm cân|control de peso/,
      '体重管理',
    ],
    [/sleep|stress|calm|melatonin|ashwagandha|ngủ|estrés|sueño/, '睡眠与压力'],
    [/protein|creatine|bcaa|workout|sport|gym|thể thao|deport/, '运动营养'],
    [
      /multivitamin|vitamin|mineral|magnesium|omega|zinc|supplement|thực phẩm bổ sung|vitamina|suplemento/,
      '功能性营养',
    ],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || '待分类';
}

function stableId(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.codePointAt(index) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export async function discoverSites(input: {
  accessKey: string;
  apiUrl: string;
  depth?: number;
  keywords: string[];
  limit?: number;
  markets: Market[];
  maxSites: number;
  productsPerSite?: number;
  sources?: string[];
}) {
  const response = await fetch(input.apiUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-research-key': input.accessKey,
    },
    body: JSON.stringify({
      keywords: input.keywords,
      markets: input.markets,
      maxSites: input.maxSites,
      productsPerSite: input.productsPerSite,
      depth: input.depth,
      limit: input.limit,
      sources: input.sources,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | DiscoveryResponse
    | { error?: string };
  if (!response.ok)
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `研究服务返回HTTP ${response.status}`,
    );
  return payload as DiscoveryResponse;
}

export async function enrichProducts(input: {
  accessKey: string;
  apiUrl: string;
  products: Array<{
    brand: string;
    id: string;
    market: Market;
    title: string;
    url: string;
  }>;
}) {
  const response = await fetch(input.apiUrl.replace(/\/$/, ''), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-research-key': input.accessKey,
    },
    body: JSON.stringify({
      action: 'enrich_products',
      products: input.products,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as
    | ProductEnrichmentResponse
    | { error?: string };
  if (!response.ok)
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : `商品补齐服务返回HTTP ${response.status}`,
    );
  return payload as ProductEnrichmentResponse;
}

export function enrichedProductRecord(
  current: Product,
  product: DiscoveredProduct,
  generatedAt: string,
): Product {
  return {
    ...current,
    title: product.title || current.title,
    brand: product.brand || current.brand,
    form: product.form || current.form,
    size: product.size.length > 0 ? product.size : current.size,
    price: Number.isFinite(product.price)
      ? Number(product.price)
      : current.price,
    currency: product.currency || current.currency,
    ingredient: product.ingredients || current.ingredient,
    dose: product.servingSize || current.dose,
    claim: product.description || current.claim,
    benefits: product.benefits.length > 0 ? product.benefits : current.benefits,
    benefitEvidence: product.description
      ? `官网商品页描述：${product.description}`
      : current.benefitEvidence,
    ingredientInsights:
      product.ingredientInsights.length > 0
        ? product.ingredientInsights
        : current.ingredientInsights,
    imageUrl: product.image || current.imageUrl,
    collectionFields: [
      ...new Set([
        ...(current.collectionFields || []),
        ...product.collectionFields,
      ]),
    ],
    firstSeenAt: current.firstSeenAt || generatedAt,
    evidenceUrl: product.url || current.evidenceUrl,
    dataNature: 'collected',
  };
}

export function siteRecord(site: DiscoveredSite): Site {
  const { products: _products, ...record } = site;
  return { ...record, dataNature: 'collected' };
}

export function productRecords(site: DiscoveredSite): Product[] {
  return site.products.map((product) => {
    const productSize = product.size;
    return {
      id: `web-${stableId(`${site.market}|${product.url}|${product.sku}`)}`,
      title: product.title,
      brand: product.brand || site.brand,
      market: site.market,
      category: site.category || '待分类',
      form: product.form || '待识别',
      size: productSize || product.sku || '规格待识别',
      price: Number.isFinite(product.price) ? Number(product.price) : 0,
      currency: product.currency,
      ingredient: product.ingredients || '官网未公开结构化配方',
      dose: product.servingSize || '官网未公开每份用量',
      claim: product.description || '官网商品页暂未提供结构化卖点',
      benefits: product.benefits,
      benefitEvidence: product.description
        ? `官网商品页描述：${product.description}`
        : '官网商品页未提供结构化描述。',
      ingredientInsights: product.ingredientInsights,
      siteId: site.id,
      color: '#e9f4f0',
      imageUrl: product.image || undefined,
      collectionFields: product.collectionFields,
      reviewed: false,
      favorite: false,
      firstSeenAt: site.lastCollectedAt,
      evidenceUrl: product.url || site.evidenceUrl,
      dataNature: 'collected',
    };
  });
}
