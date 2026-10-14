const MARKET_OPTIONS = {
  US: {
    country: 'us',
    language: 'en',
    intent: 'supplement shop buy official store',
    currency: 'USD',
  },
  MX: {
    country: 'mx',
    language: 'es',
    intent: 'suplemento comprar tienda oficial',
    currency: 'MXN',
  },
  VN: {
    country: 'vn',
    language: 'vi',
    intent: 'thực phẩm bổ sung mua cửa hàng chính hãng',
    currency: 'VND',
  },
};

const EXCLUDED_DOMAINS = [
  'alibaba.com',
  'aliexpress.com',
  'amazon.com',
  'amazon.com.mx',
  'costco.com',
  'cvs.com',
  'ebay.com',
  'facebook.com',
  'instagram.com',
  'iherb.com',
  'kroger.com',
  'lazada.vn',
  'linkedin.com',
  'mercadolibre.com',
  'mercadolibre.com.mx',
  'pinterest.com',
  'reddit.com',
  'riteaid.com',
  'samsclub.com',
  'shopee.vn',
  'tiktok.com',
  'target.com',
  'vitacost.com',
  'walgreens.com',
  'walmart.com',
  'walmart.com.mx',
  'youtube.com',
];

const PRODUCT_EXTENSIONS =
  /\.(?:avi|css|docx?|gif|jpe?g|js|mp3|mp4|pdf|png|pptx?|svg|webp|xlsx?)(?:$|\?)/i;

function json(data, status = 200, origin = '') {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type,x-research-key',
      'access-control-allow-methods': 'POST,OPTIONS',
      'cache-control': 'no-store',
      vary: 'Origin',
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return { allowed: allowed.includes(origin), origin };
}

function cleanText(value = '') {
  return String(value)
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;|&#160;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;|&#34;/gi, '"')
    .replaceAll(/&#39;|&apos;/gi, "'")
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function meta(html, name) {
  const escaped = name.replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    (match) => `\\${match}`,
  );
  return cleanText(
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
        'i',
      ),
    )?.[1] ||
      html.match(
        new RegExp(
          `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
          'i',
        ),
      )?.[1] ||
      '',
  );
}

function findProducts(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) findProducts(item, found);
    return found;
  }
  const types = Array.isArray(value['@type'])
    ? value['@type']
    : [value['@type']];
  if (types.some((type) => String(type).toLowerCase() === 'product'))
    found.push(value);
  for (const child of Object.values(value)) findProducts(child, found);
  return found;
}

export function extractJsonLdProducts(html) {
  const blocks =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    ) || [];
  const products = [];
  for (const block of blocks) {
    const raw = block
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    try {
      findProducts(JSON.parse(raw), products);
    } catch {
      // Invalid third-party JSON-LD is ignored.
    }
  }
  return products;
}

function firstOffer(product) {
  if (Array.isArray(product?.offers)) return product.offers[0] || {};
  return product?.offers || {};
}

function productFromJsonLd(product, pageUrl, market, fallbackBrand) {
  const offer = firstOffer(product);
  const brand =
    (typeof product.brand === 'string' ? product.brand : product.brand?.name) ||
    fallbackBrand;
  let image = product.image;
  if (Array.isArray(image)) image = image[0];
  else if (typeof image === 'object') image = image?.url;
  return {
    title: cleanText(product.name || ''),
    brand: cleanText(brand || ''),
    description: cleanText(product.description || ''),
    sku: cleanText(product.sku || product.mpn || product.gtin || ''),
    price:
      offer.price === undefined || offer.price === null
        ? null
        : Number(offer.price),
    currency: offer.priceCurrency || MARKET_OPTIONS[market].currency,
    availability: offer.availability || null,
    image: image || null,
    url: product.url ? new URL(product.url, pageUrl).toString() : pageUrl,
  };
}

async function fetchShopifyProduct(pageUrl) {
  const page = new URL(pageUrl);
  const match = page.pathname.match(/\/products\/([^/?#]+)/i);
  if (!match) return null;
  const endpoint = new URL(`/products/${match[1]}.js`, page.origin);
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const variant =
    data.variants?.find((item) => item.available) || data.variants?.[0] || {};
  const rawPrice = Number(variant.price ?? data.price);
  return {
    '@type': 'Product',
    name: data.title,
    brand: data.vendor,
    description: data.description,
    sku: variant.sku || variant.id || data.id,
    image: data.featured_image || data.images?.[0],
    url: pageUrl,
    offers: {
      price: Number.isFinite(rawPrice) ? rawPrice / 100 : null,
      availability: variant.available
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
    },
  };
}

export function hostnameRoot(hostname) {
  const parts = hostname
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  if (parts.length <= 2) return parts.join('.');
  const secondLevel = new Set(['co.nz', 'co.uk', 'com.au', 'com.mx', 'com.vn']);
  const suffix = parts.slice(-2).join('.');
  return secondLevel.has(suffix)
    ? parts.slice(-3).join('.')
    : parts.slice(-2).join('.');
}

export function isCandidateUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (PRODUCT_EXTENSIONS.test(url.pathname)) return false;
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(':')
    )
      return false;
    const root = hostnameRoot(hostname);
    return !EXCLUDED_DOMAINS.some(
      (domain) => root === domain || hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

export function classifyStore(html, pageUrl) {
  const signals = [];
  const products = extractJsonLdProducts(html);
  const hasProductSchema = products.length > 0;
  const hasCart =
    /(?:add[-_ ]?to[-_ ]?cart|add to bag|añadir al carrito|agregar al carrito|thêm vào giỏ)/i.test(
      html,
    );
  const hasCheckout =
    /(?:\/checkout|checkout-button|proceed to checkout)/i.test(html);
  const hasPrice =
    /(?:[$€£]|USD|MXN|VND|₫)\s?\d|\d[\d.,]*\s?(?:USD|MXN|VND|₫)/i.test(html);
  const productPath = /\/(?:products?|shop|tienda|san-pham)\//i.test(
    new URL(pageUrl).pathname,
  );
  let platform = '其他';
  if (/cdn\.shopify\.com|shopify-payment-button|myshopify\.com/i.test(html))
    platform = 'Shopify';
  else if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html))
    platform = 'WooCommerce';
  else if (/cdn\d*\.bigcommerce\.com|bigcommerce/i.test(html))
    platform = 'BigCommerce';
  else if (/static\.wixstatic\.com|wixstores/i.test(html)) platform = 'Wix';

  let score = 0;
  if (hasProductSchema) {
    score += 4;
    signals.push('Product结构化数据');
  }
  if (hasCart) {
    score += 2;
    signals.push('加入购物车');
  }
  if (hasCheckout) {
    score += 2;
    signals.push('结账入口');
  }
  if (hasPrice) {
    score += 1;
    signals.push('价格');
  }
  if (productPath) {
    score += 1;
    signals.push('商品路径');
  }
  if (platform !== '其他') {
    score += 2;
    signals.push(platform);
  }
  return {
    confidence: Math.min(100, score * 10),
    isIndependentStore:
      score >= 5 && (hasProductSchema || hasCart || platform !== '其他'),
    platform,
    products,
    signals,
  };
}

export function productPageUrl(html, pageUrl) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)].map(
    (match) => match[1],
  );
  const pageRoot = hostnameRoot(new URL(pageUrl).hostname);
  for (const href of links) {
    try {
      const url = new URL(href, pageUrl);
      if (
        hostnameRoot(url.hostname) === pageRoot &&
        /\/(?:products?|shop|tienda|san-pham)\//i.test(url.pathname) &&
        isCandidateUrl(url.toString())
      )
        return url.toString();
    } catch {
      // Invalid links are ignored.
    }
  }
  return null;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent':
        'ZhihengMarketResearch/0.1 (+https://leejinping8972-svg.github.io/intelligence-system/)',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html') && !type.includes('application/xhtml+xml'))
    throw new Error('非HTML页面');
  const body = await response.text();
  return {
    html: body.slice(0, 800_000),
    url: response.url,
  };
}

async function validateCandidate(candidate, keyword, market) {
  try {
    let { html, url } = await fetchHtml(candidate);
    if (!isCandidateUrl(url)) return null;
    let classification = classifyStore(html, url);
    const productUrl = productPageUrl(html, url);
    if (
      classification.products.length === 0 &&
      productUrl &&
      productUrl !== url
    ) {
      try {
        const productPage = await fetchHtml(productUrl);
        const productClassification = classifyStore(
          productPage.html,
          productPage.url,
        );
        if (productClassification.isIndependentStore) {
          html = productPage.html;
          url = productPage.url;
          classification = productClassification;
        }
      } catch {
        // Homepage evidence can still validate the store.
      }
    }
    if (!classification.isIndependentStore) return null;
    if (
      classification.products.length === 0 &&
      classification.platform === 'Shopify'
    ) {
      try {
        const shopifyProduct = await fetchShopifyProduct(url);
        if (shopifyProduct) classification.products = [shopifyProduct];
      } catch {
        // The storefront evidence still validates the site when product JSON is unavailable.
      }
    }
    const domain = hostnameRoot(new URL(url).hostname);
    const brand =
      meta(html, 'og:site_name') ||
      classification.products[0]?.brand?.name ||
      classification.products[0]?.brand ||
      cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
        .split(/[|–—-]/)[0]
        ?.trim() ||
      domain;
    return {
      id: `${market}-${domain}`,
      brand: cleanText(brand),
      domain,
      market,
      platform: classification.platform,
      type: '搜索发现独立站',
      keyword,
      category: '待分类',
      mainProducts: classification.products
        .map((item) => cleanText(item.name || ''))
        .filter(Boolean)
        .slice(0, 5),
      ownershipBackground: '待从官网核验',
      ownershipOperations: '待从官网核验',
      ownershipEvidence: '当前仅确认官网具有独立销售能力。',
      ownershipSource: url,
      collectorMode: 'automatic',
      lastCollectedAt: new Date().toISOString(),
      evidenceUrl: url,
      confidence: classification.confidence,
      signals: classification.signals,
      products: classification.products
        .slice(0, 5)
        .map((product) =>
          productFromJsonLd(product, url, market, cleanText(brand)),
        )
        .filter((product) => product.title),
    };
  } catch {
    return null;
  }
}

async function braveSearch(keyword, market, env, count) {
  const options = MARKET_OPTIONS[market];
  const params = new URLSearchParams({
    q: `${keyword} ${options.intent}`,
    country: options.country,
    search_lang: options.language,
    count: String(Math.min(20, count)),
    safesearch: 'moderate',
  });
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        accept: 'application/json',
        'x-subscription-token': env.BRAVE_SEARCH_API_KEY,
      },
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    if (response.status === 429)
      throw new Error('Brave Search免费额度或速率已达上限');
    throw new Error(`Brave Search返回HTTP ${response.status}`);
  }
  const data = await response.json();
  return (data.web?.results || [])
    .map((item) => item.url)
    .filter((url) => isCandidateUrl(url));
}

async function runResearch(input, env) {
  const keywords = [
    ...new Set(input.keywords.map((item) => item.trim())),
  ].filter(Boolean);
  const markets = [...new Set(input.markets)];
  const maxSites = Math.max(1, Math.min(6, Number(input.maxSites) || 6));
  const candidateLimit = Math.min(12, Math.max(6, maxSites * 2));
  if (keywords.length === 0 || keywords.length > 3)
    throw new Error('每次请输入1至3个关键词');
  if (markets.length === 0 || markets.some((market) => !MARKET_OPTIONS[market]))
    throw new Error('市场仅支持US、MX、VN');
  if (keywords.length * markets.length > 3)
    throw new Error('单次最多运行3个“关键词 × 市场”组合，请减少关键词或市场');

  const groups = [];
  for (const keyword of keywords) {
    for (const market of markets) {
      const urls = await braveSearch(keyword, market, env, 20);
      const unique = [];
      const domains = new Set();
      for (const url of urls) {
        const domain = hostnameRoot(new URL(url).hostname);
        if (domains.has(domain)) continue;
        domains.add(domain);
        unique.push(url);
        if (unique.length >= candidateLimit) break;
      }
      const candidates = await Promise.all(
        unique.map((url) => validateCandidate(url, keyword, market)),
      );
      const validated = candidates
        .filter(Boolean)
        .toSorted((a, b) => b.confidence - a.confidence)
        .slice(0, maxSites);
      groups.push({
        keyword,
        market,
        coverage: {
          searchResults: urls.length,
          candidateDomains: unique.length,
          validatedSites: validated.length,
          rejectedOrUnreachable: unique.length - validated.length,
        },
        sites: validated,
      });
    }
  }
  return { generatedAt: new Date().toISOString(), groups };
}

export default {
  async fetch(request, env) {
    const originState = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!originState.allowed)
        return json({ error: '来源未授权' }, 403, 'null');
      return json({}, 204, originState.origin);
    }
    if (request.method !== 'POST')
      return json(
        { error: '仅支持POST请求' },
        405,
        originState.origin || 'null',
      );
    if (!originState.allowed)
      return json({ error: '来源未授权' }, 403, originState.origin || 'null');
    if (!env.BRAVE_SEARCH_API_KEY || !env.RESEARCH_ACCESS_KEY)
      return json(
        { error: '研究服务尚未完成密钥配置' },
        503,
        originState.origin,
      );
    if (request.headers.get('x-research-key') !== env.RESEARCH_ACCESS_KEY)
      return json({ error: '研究访问码无效' }, 401, originState.origin);
    try {
      const input = await request.json();
      const result = await runResearch(input, env);
      return json(result, 200, originState.origin);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : '研究任务执行失败' },
        400,
        originState.origin,
      );
    }
  },
};
