import type { Market, Product, Site } from './data';

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
}

export interface SuggestionGroup {
  items: Array<{
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
