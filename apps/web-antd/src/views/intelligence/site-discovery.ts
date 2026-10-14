import type { Market, Product, Site } from './data';

export interface DiscoveredProduct {
  availability: null | string;
  brand: string;
  currency: string;
  description: string;
  image: null | string;
  price: null | number;
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
  keywords: string[];
  markets: Market[];
  maxSites: number;
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

export function siteRecord(site: DiscoveredSite): Site {
  const { products: _products, ...record } = site;
  return { ...record, dataNature: 'collected' };
}

export function productRecords(site: DiscoveredSite): Product[] {
  return site.products.map((product) => ({
    id: `web-${stableId(`${site.market}|${product.url}|${product.sku}`)}`,
    title: product.title,
    brand: product.brand || site.brand,
    market: site.market,
    category: site.category || '待分类',
    form: '待识别',
    size: product.sku || '规格待识别',
    price: Number.isFinite(product.price) ? Number(product.price) : 0,
    currency: product.currency,
    ingredient: '待从商品标签提取',
    dose: '待从商品标签提取',
    claim: product.description || '官网商品页暂未提供结构化卖点',
    benefits: [],
    benefitEvidence: product.description
      ? `官网商品页描述：${product.description}`
      : '官网商品页未提供结构化描述。',
    ingredientInsights: [],
    siteId: site.id,
    color: '#e9f4f0',
    reviewed: false,
    favorite: false,
    firstSeenAt: site.lastCollectedAt,
    evidenceUrl: product.url || site.evidenceUrl,
    dataNature: 'collected',
  }));
}
