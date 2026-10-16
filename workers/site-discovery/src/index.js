import trendSnapshots from '../data/trends-snapshots.json' with { type: 'json' };
import { readSorftimeToken, saveSorftimeToken } from './provider-config.js';
import { sorftimeStatus, sorftimeSuggestions } from './sorftime.js';

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
    // Brave Web Search supports Vietnamese content, but VN is not one of its
    // country-ranking enums. Search globally and use Vietnamese intent plus
    // the location header to keep the results focused on Vietnam.
    country: 'ALL',
    language: 'vi',
    intent: 'Việt Nam thực phẩm bổ sung mua cửa hàng chính hãng',
    currency: 'VND',
  },
};

const GOOGLE_SUGGEST_OPTIONS = {
  US: { gl: 'us', hl: 'en' },
  MX: { gl: 'mx', hl: 'es' },
  VN: { gl: 'vn', hl: 'vi' },
};

const AMAZON_SUGGEST_OPTIONS = {
  US: {
    host: 'completion.amazon.com',
    locale: 'en_US',
    marketplace: 'ATVPDKIKX0DER',
  },
  MX: {
    host: 'completion.amazon.com.mx',
    locale: 'es_MX',
    marketplace: 'A1AM78C64UM0Y8',
  },
};

const LIVE_SOURCES = new Set([
  'amazon_autocomplete',
  'google_autocomplete',
  'google_trends',
  'site_discovery',
  'sorftime',
]);

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

function readableText(html = '') {
  return String(html)
    .replaceAll(
      /<(?:script|style|noscript|svg)[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi,
      ' ',
    )
    .replaceAll(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replaceAll(/<\/(?:div|h[1-6]|li|p|section|tr)>/gi, '\n')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;|&#160;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;|&#34;/gi, '"')
    .replaceAll(/&#39;|&apos;/gi, "'")
    .replaceAll(/[ \t]+/g, ' ')
    .replaceAll(/\s*\n\s*/g, '\n')
    .trim();
}

function plausibleIngredients(value) {
  const text = cleanText(value);
  if (text.length < 2 || text.length > 1500) return '';
  if (/[{}]|\*\/|\/\*|=>|var\(|@media|display\s*:|position\s*:/i.test(text))
    return '';
  if (
    /trên cùng một trục ngang|căn chỉnh|stylesheet|javascript|cookie policy/i.test(
      text,
    )
  )
    return '';
  if (
    /^(?:label directions?|directions?|supplement facts?|nutrition facts?|product details?|suggested use)$/i.test(
      text,
    )
  )
    return '';
  const hasIngredientEvidence =
    /[,;；•·|]|\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|cfu)\b|lactobacillus|bifidobacter|inulin|psyllium|magnesium|inositol|collagen|vitamin|zinc|omega|dha|epa/i.test(
      text,
    );
  if (
    !hasIngredientEvidence &&
    /\b(?:work together|supports?|promotes?|maintains?|feel your best|fast shipping|shop now|health benefits?)\b/i.test(
      text,
    )
  )
    return '';
  if (!hasIngredientEvidence && text.split(/\s+/).length > 8) return '';
  return text;
}

function additionalProperty(product, names) {
  const wanted = names.map((item) => item.toLowerCase());
  let properties = [];
  if (Array.isArray(product?.additionalProperty))
    properties = product.additionalProperty;
  else if (product?.additionalProperty)
    properties = [product.additionalProperty];
  const match = properties.find((item) =>
    wanted.some((name) => cleanText(item?.name).toLowerCase().includes(name)),
  );
  return cleanText(match?.value || match?.description || '');
}

function labeledText(text, labels) {
  const lines = String(text)
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  for (const [lineIndex, line] of lines.entries()) {
    const normalized = line.toLowerCase();
    for (const label of labels) {
      const index = normalized.indexOf(label.toLowerCase());
      if (index === -1) continue;
      const value = cleanText(
        line.slice(index + label.length).replace(/^\s*[:：\-–—]\s*/, ''),
      );
      if (value.length >= 2 && value.length <= 1000) return value;
      const nextLine = cleanText(lines[lineIndex + 1] || '');
      if (nextLine.length >= 2 && nextLine.length <= 1000) return nextLine;
    }
  }
  return '';
}

function inferForm(value) {
  const text = String(value).toLowerCase();
  if (/capsule|capsules|cápsula|viên nang/.test(text)) return '胶囊';
  if (/tablet|tablets|tableta|comprimido|viên nén/.test(text)) return '片剂';
  if (/gumm|gomita|kẹo dẻo/.test(text)) return '软糖';
  if (/powder|polvo|bột/.test(text)) return '粉剂';
  if (/liquid|líquido|syrup|dung dịch|nước/.test(text)) return '液体';
  if (/softgel|soft gel/.test(text)) return '软胶囊';
  return '';
}

function benefitExcerpts(description) {
  return cleanText(description)
    .split(/(?<=[.!?。！？])\s+/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 12)
    .map((item) => item.slice(0, 120))
    .slice(0, 4);
}

function inferSize(value) {
  const text = cleanText(value);
  return (
    text.match(
      /\b\d+(?:\.\d+)?\s*(?:capsules?|tablets?|softgels?|gummies?|servings?|sachets?|sticks?|count|ct|mcg|mg|kg|g|ml|oz|lb)\b/i,
    )?.[0] || ''
  );
}

function ingredientRole(name) {
  const value = name.toLowerCase();
  const roles = [
    [
      /lactobacillus|bifidobacter|probiotic|men vi sinh/,
      '益生菌菌株；常见用于肠道菌群相关配方',
    ],
    [/inulin|psyllium|fiber|fibre|chất xơ/, '膳食纤维或益生元类成分'],
    [/magnesium|magnesio|magiê/, '矿物质镁来源；具体盐型和剂量需结合标签判断'],
    [/inositol/, '肌醇类成分；具体异构体比例需结合标签判断'],
    [/collagen|colágeno/, '胶原蛋白或胶原肽来源'],
    [/omega|dha|epa|fish oil/, 'Omega脂肪酸来源；需核验EPA、DHA具体含量'],
    [/vitamin|vitamina|vitaminas/, '维生素类营养成分；需核验具体形式和剂量'],
    [
      /zinc|zinc oxide|zinc citrate|kẽm/,
      '矿物质锌来源；需核验具体形式和元素量',
    ],
  ];
  return (
    roles.find(([pattern]) => pattern.test(value))?.[1] ||
    '官网配方成分；具体作用和科学证据待人工审核'
  );
}

function ingredientRecords(ingredients, pageUrl) {
  return cleanText(ingredients)
    .split(/[,;；•·|]/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 2 && item.length <= 120)
    .slice(0, 12)
    .map((item) => {
      const amount =
        item.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|cfu)\b/i)?.[0] ||
        '官网未标注单项剂量';
      const name = cleanText(
        item.replace(amount, '').replaceAll(/[()（）]/g, ' '),
      );
      return {
        name: name || item,
        amount,
        role: ingredientRole(name || item),
        evidence: pageUrl,
      };
    });
}

function absoluteUrl(value, pageUrl) {
  if (!value) return null;
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}

function imageFromHtml(html, pageUrl) {
  const metadata =
    meta(html, 'og:image') ||
    meta(html, 'og:image:secure_url') ||
    meta(html, 'twitter:image');
  if (metadata) return absoluteUrl(metadata, pageUrl);
  const images = [...String(html).matchAll(/<img\b[^>]*>/gi)];
  const ranked = images
    .map(([tag]) => {
      const source =
        tag.match(/(?:src|data-src|data-original)=["']([^"']+)["']/i)?.[1] ||
        tag.match(/srcset=["']([^"',\s]+)[^"']*["']/i)?.[1] ||
        '';
      const context = tag.toLowerCase();
      let score = 0;
      if (/product|featured|main|gallery|zoom/.test(context)) score += 4;
      if (/logo|icon|avatar|flag|payment|tracking/.test(context)) score -= 5;
      if (/\.svg(?:$|\?)/i.test(source)) score -= 3;
      return { score, source: absoluteUrl(source, pageUrl) };
    })
    .filter((item) => item.source)
    .toSorted((a, b) => b.score - a.score);
  return ranked[0]?.source || null;
}

export function inferCategory(...values) {
  const text = values.join(' ').toLowerCase();
  const rules = [
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

export function productFromJsonLd(
  product,
  pageUrl,
  market,
  fallbackBrand,
  html = '',
) {
  const offer = firstOffer(product);
  const brand =
    (typeof product.brand === 'string' ? product.brand : product.brand?.name) ||
    fallbackBrand;
  let image = product.image;
  if (Array.isArray(image)) image = image[0];
  else if (typeof image === 'object') image = image?.url;
  const resolvedImage =
    absoluteUrl(image, pageUrl) || imageFromHtml(html, pageUrl);
  const text = readableText(html || product.description || '');
  const ingredients =
    plausibleIngredients(product.ingredients) ||
    plausibleIngredients(
      additionalProperty(product, [
        'ingredient',
        'ingrediente',
        'thành phần',
        'formula',
      ]),
    ) ||
    plausibleIngredients(
      labeledText(text, ['ingredients', 'ingredientes', 'thành phần']),
    );
  const servingSize = cleanText(
    product.servingSize ||
      additionalProperty(product, [
        'serving size',
        'servings',
        'porción',
        'khẩu phần',
      ]) ||
      labeledText(text, ['serving size', 'tamaño de la porción', 'khẩu phần']),
  );
  const productSize = product.size;
  const size = cleanText(
    productSize ||
      product.weight?.value ||
      product.weight ||
      additionalProperty(product, [
        'size',
        'count',
        'net weight',
        'contents',
        'tamaño',
        'khối lượng',
      ]) ||
      labeledText(text, [
        'net weight',
        'servings per container',
        'contenido neto',
        'khối lượng',
      ]) ||
      inferSize(`${product.name || ''} ${product.description || ''}`),
  );
  const description = cleanText(
    product.description || meta(html, 'description'),
  );
  const benefits = benefitExcerpts(description);
  const ingredientInsights = ingredientRecords(ingredients, pageUrl);
  const collectionFields = [
    ['图片', resolvedImage],
    ['规格', size],
    ['剂型', inferForm(`${product.name} ${size} ${description}`)],
    ['配方', ingredients],
    ['每份用量', servingSize],
    ['卖点', benefits.length > 0],
    ['成分分析', ingredientInsights.length > 0],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label]) => label);
  return {
    title: cleanText(product.name || ''),
    brand: cleanText(brand || ''),
    description,
    sku: cleanText(product.sku || product.mpn || product.gtin || ''),
    price:
      offer.price === undefined || offer.price === null
        ? null
        : Number(offer.price),
    currency: offer.priceCurrency || MARKET_OPTIONS[market].currency,
    availability: offer.availability || null,
    image: resolvedImage,
    url: product.url ? new URL(product.url, pageUrl).toString() : pageUrl,
    size,
    form: inferForm(`${product.name} ${size} ${description}`),
    ingredients,
    servingSize,
    benefits,
    ingredientInsights,
    collectionFields,
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

async function fetchShopifyCatalog(pageUrl, limit) {
  const page = new URL(pageUrl);
  const endpoint = new URL('/products.json', page.origin);
  endpoint.searchParams.set('limit', String(Math.min(50, limit)));
  const response = await fetch(endpoint, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.products || []).slice(0, limit).map((item) => {
    const variant =
      item.variants?.find((candidate) => candidate.available) ||
      item.variants?.[0] ||
      {};
    const rawPrice = Number(variant.price);
    return {
      '@type': 'Product',
      name: item.title,
      brand: item.vendor,
      description: item.body_html,
      sku: variant.sku || variant.id || item.id,
      image: item.images?.[0]?.src,
      size: variant.title === 'Default Title' ? '' : variant.title,
      url: new URL(`/products/${item.handle}`, page.origin).toString(),
      offers: {
        price: Number.isFinite(rawPrice) ? rawPrice : null,
        availability: variant.available
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
    };
  });
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

export function productPageUrls(html, pageUrl, limit = 1) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)].map(
    (match) => match[1],
  );
  const pageRoot = hostnameRoot(new URL(pageUrl).hostname);
  const found = [];
  const seen = new Set();
  for (const href of links) {
    try {
      const url = new URL(href, pageUrl);
      if (
        hostnameRoot(url.hostname) === pageRoot &&
        /\/(?:products?|shop|tienda|san-pham)\//i.test(url.pathname) &&
        isCandidateUrl(url.toString()) &&
        !seen.has(url.toString())
      ) {
        seen.add(url.toString());
        found.push(url.toString());
        if (found.length >= limit) break;
      }
    } catch {
      // Invalid links are ignored.
    }
  }
  return found;
}

export function productPageUrl(html, pageUrl) {
  return productPageUrls(html, pageUrl, 1)[0] || null;
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

async function validateCandidate(candidate, keyword, market, productsPerSite) {
  try {
    let { html, url } = await fetchHtml(candidate);
    if (!isCandidateUrl(url)) return null;
    let classification = classifyStore(html, url);
    const landingHtml = html;
    const landingUrl = url;
    const productLinks = productPageUrls(
      html,
      url,
      Math.min(productsPerSite, 3),
    );
    const productUrl = productLinks[0];
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
    let normalizedProducts = classification.products
      .map((product) => productFromJsonLd(product, url, market, '', html))
      .filter((product) => product.title);
    if (classification.platform === 'Shopify') {
      try {
        const catalog = await fetchShopifyCatalog(landingUrl, productsPerSite);
        if (catalog.length > 0) {
          normalizedProducts = catalog
            .map((product) =>
              productFromJsonLd(
                product,
                product.url,
                market,
                product.brand,
                product.description,
              ),
            )
            .filter((product) => product.title);
        } else if (normalizedProducts.length === 0) {
          const shopifyProduct = await fetchShopifyProduct(url);
          if (shopifyProduct)
            normalizedProducts = [
              productFromJsonLd(
                shopifyProduct,
                url,
                market,
                shopifyProduct.brand,
                html,
              ),
            ];
        }
      } catch {
        // The storefront evidence still validates the site when product JSON is unavailable.
      }
    }
    if (
      classification.platform !== 'Shopify' &&
      normalizedProducts.length < productsPerSite
    ) {
      const remainingLinks = productLinks.filter((item) => item !== url);
      const pages = await Promise.all(
        remainingLinks.map(async (item) => {
          try {
            return await fetchHtml(item);
          } catch {
            return null;
          }
        }),
      );
      for (const page of pages.filter(Boolean)) {
        const pageProducts = extractJsonLdProducts(page.html)
          .map((product) =>
            productFromJsonLd(product, page.url, market, '', page.html),
          )
          .filter((product) => product.title);
        normalizedProducts.push(...pageProducts);
      }
    }
    const seenProducts = new Set();
    normalizedProducts = normalizedProducts
      .filter((product) => {
        const key =
          `${product.url}|${product.sku}|${product.title}`.toLowerCase();
        if (seenProducts.has(key)) return false;
        seenProducts.add(key);
        return true;
      })
      .slice(0, productsPerSite);
    const domain = hostnameRoot(new URL(url).hostname);
    const brand =
      meta(landingHtml, 'og:site_name') ||
      normalizedProducts[0]?.brand ||
      cleanText(landingHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
        .split(/[|–—-]/)[0]
        ?.trim() ||
      domain;
    const category = inferCategory(
      keyword,
      readableText(landingHtml).slice(0, 20_000),
      ...normalizedProducts.flatMap((product) => [
        product.title,
        product.description,
        product.ingredients,
        ...product.benefits,
      ]),
    );
    return {
      id: `${market}-${domain}`,
      brand: cleanText(brand),
      domain,
      market,
      platform: classification.platform,
      type: '搜索发现独立站',
      keyword,
      category,
      mainProducts: normalizedProducts
        .map((item) => item.title)
        .filter(Boolean)
        .slice(0, 10),
      ownershipBackground: '待从官网核验',
      ownershipOperations: '待从官网核验',
      ownershipEvidence: '当前仅确认官网具有独立销售能力。',
      ownershipSource: url,
      collectorMode: 'automatic',
      lastCollectedAt: new Date().toISOString(),
      evidenceUrl: url,
      confidence: classification.confidence,
      signals: classification.signals,
      products: normalizedProducts.map((product) => ({
        ...product,
        brand: product.brand || cleanText(brand),
      })),
    };
  } catch {
    return null;
  }
}

export function googleSuggestUrl(keyword, market) {
  const options = GOOGLE_SUGGEST_OPTIONS[market];
  const params = new URLSearchParams({
    client: 'firefox',
    gl: options.gl,
    hl: options.hl,
    q: keyword,
  });
  return `https://suggestqueries.google.com/complete/search?${params}`;
}

export function amazonSuggestUrl(keyword, market) {
  const options = AMAZON_SUGGEST_OPTIONS[market];
  if (!options) return null;
  const params = new URLSearchParams({
    alias: 'aps',
    'client-info': 'amazon-search-ui',
    event: 'onkeypress',
    limit: '11',
    lop: options.locale,
    mid: options.marketplace,
    prefix: keyword,
    'response-type': 'COMPLETIONS',
    'site-variant': 'desktop',
    'suggestion-type': 'KEYWORD',
    version: '3',
  });
  return `https://${options.host}/api/2017/suggestions?${params}`;
}

async function fetchGoogleSuggestions(keyword, market) {
  const response = await fetch(googleSuggestUrl(keyword, market), {
    headers: {
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google联想词返回HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.[1])
    ? payload[1].map((item) => cleanText(item)).filter(Boolean)
    : [];
}

async function fetchAmazonSuggestions(keyword, market) {
  const url = amazonSuggestUrl(keyword, market);
  if (!url) return null;
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Amazon联想词返回HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.suggestions)
    ? payload.suggestions
        .map((item) => cleanText(item?.value || ''))
        .filter(Boolean)
    : [];
}

async function suggestionSource(
  source,
  keyword,
  market,
  depth,
  limit,
  requestBudget,
) {
  const label =
    source === 'google_autocomplete' ? 'Google 联想词' : 'Amazon 联想词';
  if (source === 'amazon_autocomplete' && !AMAZON_SUGGEST_OPTIONS[market]) {
    return {
      items: [],
      message: '越南没有Amazon本地站，未执行Amazon联想词',
      source: label,
      status: 'unsupported',
    };
  }

  const fetcher =
    source === 'google_autocomplete'
      ? fetchGoogleSuggestions
      : fetchAmazonSuggestions;
  const items = [];
  const seen = new Set();
  const add = (values) => {
    for (const value of values || []) {
      const normalized = cleanText(value);
      const key = normalized.toLocaleLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      items.push({ source: label, term: normalized });
      if (items.length >= limit) break;
    }
  };
  const query = async (term) => {
    if (requestBudget.remaining <= 0) return false;
    requestBudget.remaining -= 1;
    add(await fetcher(term, market));
    return true;
  };

  try {
    await query(keyword);
    if (depth === 2 && items.length < limit) {
      const parents = items.slice(0, 5).map((item) => item.term);
      for (const parent of parents) {
        if (items.length >= limit || !(await query(parent))) break;
      }
    }
    const capped = items.slice(0, limit);
    return {
      items: capped,
      message:
        requestBudget.remaining <= 0 && depth === 2
          ? '已达到免费请求保护上限，保留当前结果'
          : '',
      source: label,
      status: capped.length > 0 ? 'success' : 'empty',
    };
  } catch (error) {
    return {
      items: items.slice(0, limit),
      message: error instanceof Error ? error.message : `${label}请求失败`,
      source: label,
      status: items.length > 0 ? 'partial' : 'error',
    };
  }
}

async function collectSuggestions(
  keyword,
  market,
  sources,
  depth,
  limit,
  requestBudget,
  sorftimeBudget,
  env,
) {
  const sourceResults = [];
  for (const source of sources) {
    if (source === 'sorftime') {
      sourceResults.push(
        await sorftimeSuggestions(
          keyword,
          market,
          depth,
          limit,
          sorftimeBudget,
          env,
        ),
      );
      continue;
    }
    if (!['amazon_autocomplete', 'google_autocomplete'].includes(source))
      continue;
    sourceResults.push(
      await suggestionSource(
        source,
        keyword,
        market,
        depth,
        limit,
        requestBudget,
      ),
    );
  }
  const items = mergeSuggestionItems(sourceResults, limit);
  return {
    items,
    keyword,
    market,
    sources: sourceResults.map(({ items: values, ...result }) => ({
      ...result,
      count: values.length,
    })),
  };
}

export function mergeSuggestionItems(sourceResults, limit) {
  const items = [];
  const byTerm = new Map();
  const longestSource = Math.max(
    0,
    ...sourceResults.map((result) => result.items.length),
  );
  for (let index = 0; index < longestSource; index += 1) {
    for (const result of sourceResults) {
      const item = result.items[index];
      if (!item) continue;
      const key = item.term.toLocaleLowerCase();
      const existing = byTerm.get(key);
      if (existing) {
        const sources = new Set(existing.source.split(' / '));
        sources.add(item.source);
        existing.source = [...sources].join(' / ');
        continue;
      }
      const record = { ...item, category: inferCategory(item.term) };
      byTerm.set(key, record);
      items.push(record);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  return items;
}

export function braveSearchRequest(keyword, market, count) {
  const options = MARKET_OPTIONS[market];
  const params = new URLSearchParams({
    q: `${keyword} ${options.intent}`,
    country: options.country,
    search_lang: options.language,
    count: String(Math.min(20, count)),
    safesearch: 'moderate',
  });
  return {
    locationCountry: market,
    url: `https://api.search.brave.com/res/v1/web/search?${params}`,
  };
}

async function braveSearch(keyword, market, env, count) {
  const request = braveSearchRequest(keyword, market, count);
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(request.url, {
      headers: {
        accept: 'application/json',
        'x-subscription-token': env.BRAVE_SEARCH_API_KEY,
        'x-loc-country': request.locationCountry,
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Math.min(
      3000,
      Math.max(
        1000,
        Number(response.headers.get('retry-after')) * 1000 || 1000,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new Error('Brave Search免费额度或速率已达上限');
    const payload = await response.json().catch(() => null);
    const detail = cleanText(
      payload?.error?.detail ||
        payload?.error?.message ||
        payload?.message ||
        '',
    );
    throw new Error(
      `Brave Search返回HTTP ${response.status}${detail ? `：${detail}` : ''}`,
    );
  }
  const data = await response.json();
  return (data.web?.results || [])
    .map((item) => item.url)
    .filter((url) => isCandidateUrl(url));
}

export function parseGoogleTrendsPayload(text) {
  const start = String(text).indexOf('{');
  if (start === -1) throw new Error('Google Trends返回内容无法解析');
  return JSON.parse(String(text).slice(start));
}

export function calculate28DayGrowth(series) {
  if (!Array.isArray(series) || series.length < 56) return null;
  const average = (values) =>
    values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  const previous = average(series.slice(-56, -28));
  if (previous <= 0) return null;
  const recent = average(series.slice(-28));
  return Math.round(((recent - previous) / previous) * 1000) / 10;
}

export function trendSeriesMessage(series) {
  if (!Array.isArray(series) || series.length < 56)
    return '有效日序列不足56天，暂不计算28天变化';
  const average = (values) =>
    values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  const previous = average(series.slice(-56, -28));
  const recent = average(series.slice(-28));
  if (series.every((value) => Number(value || 0) === 0))
    return '近90天相对热度均为0，Google Trends样本不足';
  if (previous <= 0 && recent > 0)
    return '此前28天均值为0，最近28天已出现搜索信号，无法计算百分比变化';
  if (previous <= 0) return '此前28天基期为0，无法计算百分比变化';
  return '';
}

export function googleTrendsExploreUrl(
  keywords,
  market,
  period = 'today 12-m',
) {
  const terms = (Array.isArray(keywords) ? keywords : [keywords]).filter(
    Boolean,
  );
  const options = MARKET_OPTIONS[market];
  const url = new URL('https://trends.google.com/trends/api/explore');
  url.searchParams.set('hl', options.language);
  url.searchParams.set('tz', '0');
  url.searchParams.set(
    'req',
    JSON.stringify({
      category: 0,
      comparisonItem: terms.map((keyword) => ({
        geo: market,
        keyword,
        time: period,
      })),
      property: '',
    }),
  );
  return url.toString();
}

export function googleCookieHeader(setCookie) {
  return String(setCookie || '')
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((item) => item.trim().split(';')[0])
    .filter(Boolean)
    .join('; ');
}

const GOOGLE_TRENDS_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129 Safari/537.36',
];

function googleTrendsHeaders(market, cookie = '', attempt = 0) {
  const headers = {
    accept: 'application/json,text/plain,*/*',
    'accept-language': `${MARKET_OPTIONS[market].language},en;q=0.8`,
    referer: `https://trends.google.com/trends/explore?geo=${market}`,
    'user-agent':
      GOOGLE_TRENDS_USER_AGENTS[attempt % GOOGLE_TRENDS_USER_AGENTS.length],
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}

async function googleTrendsSession(market) {
  const response = await fetch(
    `https://trends.google.com/trends/explore?geo=${market}`,
    {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': `${MARKET_OPTIONS[market].language},en;q=0.8`,
        'user-agent': GOOGLE_TRENDS_USER_AGENTS[0],
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    },
  );
  return googleCookieHeader(response.headers.get('set-cookie'));
}

async function fetchGoogleTrendsEndpoint(url, market, cookie) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: googleTrendsHeaders(market, cookie, attempt),
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) return response;
    lastStatus = response.status;
    if (response.status !== 429 && response.status < 500) return response;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return new Response('', { status: lastStatus || 503 });
}

export async function fetchGoogleTrendsBatch(
  keywords,
  market,
  period = 'today 12-m',
) {
  const cookie = await googleTrendsSession(market).catch(() => '');
  const exploreResponse = await fetchGoogleTrendsEndpoint(
    googleTrendsExploreUrl(keywords, market, period),
    market,
    cookie,
  );
  if (!exploreResponse.ok)
    throw new Error(`Google Trends探索接口返回HTTP ${exploreResponse.status}`);
  const explore = parseGoogleTrendsPayload(await exploreResponse.text());
  const widget = (explore.widgets || []).find(
    (item) => item.id === 'TIMESERIES',
  );
  if (!widget?.token || !widget?.request)
    throw new Error('Google Trends未返回时间序列组件');

  const timelineUrl = new URL(
    'https://trends.google.com/trends/api/widgetdata/multiline',
  );
  timelineUrl.searchParams.set('hl', MARKET_OPTIONS[market].language);
  timelineUrl.searchParams.set('tz', '0');
  timelineUrl.searchParams.set('req', JSON.stringify(widget.request));
  timelineUrl.searchParams.set('token', widget.token);
  const timelineResponse = await fetchGoogleTrendsEndpoint(
    timelineUrl,
    market,
    cookie,
  );
  if (!timelineResponse.ok)
    throw new Error(
      `Google Trends时间序列接口返回HTTP ${timelineResponse.status}`,
    );
  const timeline = parseGoogleTrendsPayload(await timelineResponse.text());
  const timelineData = timeline.default?.timelineData || [];
  return keywords.map((keyword, keywordIndex) => {
    const points = timelineData
      .map((item) => ({
        date: new Date(Number(item.time) * 1000).toISOString().slice(0, 10),
        isPartial: Boolean(item.isPartial),
        value: Number(item.value?.[keywordIndex]),
      }))
      .filter((item) => Number.isFinite(item.value));
    const series = points.map((item) => item.value);
    return {
      growth: null,
      keyword,
      market,
      message: '',
      period,
      resolution: inferTrendResolution(points),
      collectedAt: new Date().toISOString(),
      sourceUrl: trendSourceUrl(keyword, market),
      points,
      series,
      source: 'Google Trends',
      status: series.some((value) => value > 0) ? 'success' : 'empty',
    };
  });
}

export function inferTrendResolution(points) {
  if (points.length < 2) return 'unknown';
  const interval =
    (Date.parse(points[1].date) - Date.parse(points[0].date)) / 86_400_000;
  if (interval <= 2) return 'day';
  if (interval <= 8) return 'week';
  return 'month';
}

function trendSourceUrl(keyword, market) {
  const url = new URL('https://trends.google.com/trends/explore');
  url.searchParams.set('date', 'today 12-m');
  url.searchParams.set('geo', market);
  url.searchParams.set('q', keyword);
  return url.toString();
}

export async function collectGoogleTrendsBatch(keywords, market) {
  const results = [];
  // Each keyword has its own 0–100 scale, matching a single-term official chart.
  for (const keyword of keywords) {
    let annual;
    let annualError = '';
    try {
      [annual] = await fetchGoogleTrendsBatch([keyword], market);
    } catch (error) {
      annualError =
        error instanceof Error ? error.message : 'Google Trends采集失败';
    }
    if (!annual?.series.length) {
      const snapshot = trendSnapshots.find(
        (item) =>
          item.keyword.toLowerCase() === keyword.toLowerCase() &&
          item.market === market,
      );
      if (snapshot) {
        annual = {
          ...snapshot,
          series: snapshot.points.map((point) => point.value),
          source: 'Google Trends',
          status: 'success',
          growth: null,
          message: `使用Google官网页面实采快照（${snapshot.collectedAt.slice(
            0,
            10,
          )}）；实时接口：${annualError || '未返回序列'}`,
        };
      }
    }
    if (!annual?.series.length) {
      results.push({
        growth: null,
        keyword,
        market,
        message: annualError || 'Google Trends未返回一年时间序列',
        points: [],
        series: [],
        dailyPoints: [],
        period: 'today 12-m',
        resolution: 'unknown',
        source: 'Google Trends',
        sourceUrl: trendSourceUrl(keyword, market),
        status: 'error',
      });
      continue;
    }
    // Annual results are normally weekly. Query daily data separately for 28-day metrics.
    try {
      const [daily] = await fetchGoogleTrendsBatch(
        [keyword],
        market,
        'today 3-m',
      );
      const dailyPoints =
        daily.resolution === 'day'
          ? daily.points.filter((point) => !point.isPartial)
          : [];
      annual.dailyPoints = dailyPoints;
      const dailySeries = dailyPoints.map((point) => point.value);
      annual.growth = calculate28DayGrowth(dailySeries);
      annual.dailyMessage = trendSeriesMessage(dailySeries);
    } catch (error) {
      annual.dailyPoints = [];
      annual.growth = null;
      annual.dailyMessage = `一年曲线已保存；28天日数据查询失败：${
        error instanceof Error ? error.message : '接口异常'
      }`;
    }
    results.push(annual);
  }
  return results;
}

async function enrichProduct(input) {
  try {
    const page = await fetchHtml(input.url);
    const rawProducts = extractJsonLdProducts(page.html);
    try {
      const shopifyProduct = await fetchShopifyProduct(page.url);
      if (shopifyProduct) rawProducts.unshift(shopifyProduct);
    } catch {
      // JSON-LD and visible page fields can still be used on non-Shopify pages.
    }
    const candidates = rawProducts
      .map((product) =>
        productFromJsonLd(
          product,
          page.url,
          input.market,
          input.brand || '',
          page.html,
        ),
      )
      .filter((product) => product.title);
    const expectedTitle = cleanText(input.title || '').toLowerCase();
    const product =
      candidates.find((candidate) => {
        const title = candidate.title.toLowerCase();
        return (
          expectedTitle &&
          (title.includes(expectedTitle) || expectedTitle.includes(title))
        );
      }) || candidates[0];
    if (!product) {
      return {
        id: input.id,
        message: '商品页未返回可识别的结构化商品信息',
        status: 'failed',
      };
    }
    return {
      id: input.id,
      message: `已补齐${product.collectionFields.length}项商品字段`,
      product,
      status: 'success',
    };
  } catch (error) {
    return {
      id: input.id,
      message: error instanceof Error ? error.message : '商品页面抓取失败',
      status: 'failed',
    };
  }
}

export async function runProductEnrichment(input) {
  const products = Array.isArray(input.products) ? input.products : [];
  if (products.length === 0 || products.length > 10)
    throw new Error('单次请输入1至10件商品');
  for (const product of products) {
    if (!product?.id || !product?.url)
      throw new Error('商品补齐请求缺少商品ID或官网地址');
    if (!MARKET_OPTIONS[product.market])
      throw new Error('市场仅支持US、MX、VN');
    const url = new URL(product.url);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('商品官网地址无效');
  }
  return {
    generatedAt: new Date().toISOString(),
    products: await Promise.all(
      products.map((product) => enrichProduct(product)),
    ),
  };
}

async function runResearch(input, env) {
  const keywords = [
    ...new Set(input.keywords.map((item) => item.trim())),
  ].filter(Boolean);
  const markets = [...new Set(input.markets)];
  const sources = [
    ...new Set(
      Array.isArray(input.sources) && input.sources.length > 0
        ? input.sources
        : ['site_discovery'],
    ),
  ];
  const depth = Number(input.depth) === 2 ? 2 : 1;
  const suggestionLimit = Math.max(
    1,
    Math.min(100, Number(input.limit) || 100),
  );
  const maxSites = Math.max(1, Math.min(10, Number(input.maxSites) || 6));
  const productsPerSite = Math.max(
    1,
    Math.min(20, Number(input.productsPerSite) || 10),
  );
  const candidateLimit = Math.min(20, Math.max(10, maxSites * 2));
  if (keywords.length === 0 || keywords.length > 3)
    throw new Error('每次请输入1至3个关键词');
  if (markets.length === 0 || markets.some((market) => !MARKET_OPTIONS[market]))
    throw new Error('市场仅支持US、MX、VN');
  if (sources.some((source) => !LIVE_SOURCES.has(source)))
    throw new Error('包含尚未接入的真实数据源');
  if (keywords.length * markets.length > 3)
    throw new Error('单次最多运行3个“关键词 × 市场”组合，请减少关键词或市场');

  const groups = [];
  const suggestions = [];
  const trends = [];
  const suggestionRequestBudget = { remaining: 20 };
  const sorftimeBudget = {
    remaining: Math.max(
      0,
      Math.min(6, Math.floor(Number(input.sorftimeRequestLimit) || 0)),
    ),
    used: 0,
  };
  const totalCombinations = keywords.length * markets.length;
  let processedCombinations = 0;
  let remainingSuggestions = suggestionLimit;
  if (sources.includes('google_trends')) {
    for (const market of markets)
      trends.push(...(await collectGoogleTrendsBatch(keywords, market)));
  }
  for (const keyword of keywords) {
    for (const market of markets) {
      if (
        remainingSuggestions > 0 &&
        (sources.includes('google_autocomplete') ||
          sources.includes('amazon_autocomplete') ||
          sources.includes('sorftime'))
      ) {
        const combinationsLeft = totalCombinations - processedCombinations;
        const groupLimit = Math.max(
          1,
          Math.ceil(remainingSuggestions / combinationsLeft),
        );
        const suggestionGroup = await collectSuggestions(
          keyword,
          market,
          sources,
          depth,
          groupLimit,
          suggestionRequestBudget,
          sorftimeBudget,
          env,
        );
        suggestions.push(suggestionGroup);
        remainingSuggestions = Math.max(
          0,
          remainingSuggestions - suggestionGroup.items.length,
        );
      }
      if (sources.includes('site_discovery')) {
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
          unique.map((url) =>
            validateCandidate(url, keyword, market, productsPerSite),
          ),
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
      processedCombinations += 1;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    usage: { sorftimeCalls: sorftimeBudget.used },
    groups,
    suggestions,
    trends,
  };
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
    if (!env.RESEARCH_ACCESS_KEY)
      return json(
        { error: '研究服务尚未完成密钥配置' },
        503,
        originState.origin,
      );
    if (request.headers.get('x-research-key') !== env.RESEARCH_ACCESS_KEY)
      return json({ error: '研究访问码无效' }, 401, originState.origin);
    try {
      const input = await request.json();
      if (input.action === 'keyword_sources_config')
        return json(
          await saveSorftimeToken(input, env),
          200,
          originState.origin,
        );
      if (input.action === 'keyword_sources_status')
        return json(
          {
            sorftime: await sorftimeStatus(
              { ...env, SORFTIME_MCP_TOKEN: await readSorftimeToken(env) },
              input.verify === true,
            ),
          },
          200,
          originState.origin,
        );
      if (input.action === 'keyword_research') {
        const allowed = new Set([
          'amazon_autocomplete',
          'google_autocomplete',
          'google_trends',
          'sorftime',
        ]);
        if (
          !Array.isArray(input.sources) ||
          input.sources.length === 0 ||
          input.sources.some((source) => !allowed.has(source))
        )
          throw new Error(
            '关键词研究仅允许找词与趋势数据源，不接受站点或商品采集',
          );
      }
      const needsSiteDiscovery =
        input.action !== 'enrich_products' &&
        (!input.sources?.length || input.sources.includes('site_discovery'));
      if (needsSiteDiscovery && !env.BRAVE_SEARCH_API_KEY)
        throw new Error('独立站研究服务尚未配置搜索密钥');
      const result =
        input.action === 'enrich_products'
          ? await runProductEnrichment(input)
          : await runResearch(
              input,
              input.sources?.includes('sorftime')
                ? { ...env, SORFTIME_MCP_TOKEN: await readSorftimeToken(env) }
                : env,
            );
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
