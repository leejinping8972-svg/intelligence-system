import { createHash } from 'node:crypto';

import { load } from 'cheerio';

import { collectorEnv } from './local-provider.mjs';
import {
  articleDns,
  articleHttpsUrl,
  readPublicArticleOnce,
} from './public-article-http.mjs';
import { scheduleSource } from './source-scheduler.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const text = (value, limit = 12_000) =>
  typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const platforms = {
  amazon: 'Amazon',
  tiktok_shop: 'TikTok Shop',
  shopee: 'Shopee',
  mercado_libre: 'Mercado Libre',
  temu: 'Temu',
  instagram: 'Instagram',
  website: '公开商品网站',
};

function platformId(value) {
  const aliases = {
    tiktok: 'tiktok_shop',
    tiktokshop: 'tiktok_shop',
    mercadolibre: 'mercado_libre',
    mercado: 'mercado_libre',
    ins: 'instagram',
    publicwebsite: 'website',
    publicweb: 'website',
    storefront: 'website',
    independent: 'website',
  };
  const key = String(value || '')
    .toLowerCase()
    .replaceAll(/[\s_-]/g, '');
  return aliases[key] || key;
}

function publicError(message, state = 'unsupported') {
  return Object.assign(new Error(message), { state, code: state });
}

function websiteHost(value) {
  if (!value) return undefined;
  try {
    return articleHttpsUrl(
      String(value).includes('://') ? value : `https://${value}`,
    )
      .hostname.toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function resourceHosts(platform, market, websiteDomain) {
  if (!['MX', 'US', 'VN'].includes(market)) return [];
  switch (platformId(platform)) {
    case 'amazon':
      return { US: ['amazon.com'], MX: ['amazon.com.mx'] }[market] || [];
    case 'shopee':
      return market === 'VN' ? ['shopee.vn'] : [];
    case 'mercado_libre':
      return market === 'MX' ? ['mercadolibre.com.mx'] : [];
    case 'temu':
      return ['MX', 'US'].includes(market) ? ['temu.com'] : [];
    case 'tiktok_shop':
      return ['tiktok.com'];
    case 'instagram':
      return ['instagram.com'];
    case 'website': {
      const host = websiteHost(websiteDomain);
      return host ? [host] : [];
    }
    default:
      return [];
  }
}

function checkUrl(value, request) {
  const url = articleHttpsUrl(value);
  const allowed = resourceHosts(
    request.platform,
    request.market,
    request.websiteDomain || request.domain || request.websiteUrl,
  );
  if (
    allowed.length === 0 ||
    !allowed.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    )
  )
    throw publicError('该链接不属于所选平台及国家的已允许公开域名');
  if (platformId(request.platform) === 'temu') {
    const pathCountry = /^\/(?:([a-z]{2})-[a-z]{2}|(us|mx))(?:\/|$)/i.exec(
      url.pathname,
    );
    if (
      pathCountry &&
      (pathCountry[1] || pathCountry[2]).toUpperCase() !== request.market
    )
      throw publicError('该Temu链接的国家路径与所选市场不一致');
  }
  const queryKeys = [...url.searchParams.keys()];
  for (const key of queryKeys)
    if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  return url;
}

export function isResourceUrl(value, platform, market, websiteDomain) {
  try {
    checkUrl(value, { platform, market, websiteDomain });
    return true;
  } catch {
    return false;
  }
}

function candidateUrl(value, base, request) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return checkUrl(new URL(value, base).href, request).href;
  } catch {
    return undefined;
  }
}

function boundLimit(value, maximum = 100) {
  const limit = value ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum)
    throw publicError(`单页数量须为1至${maximum}之间的整数`);
  return limit;
}

async function responseJson(response) {
  if (!response.body?.getReader) {
    const value = await response.text();
    if (Buffer.byteLength(value) > 2_000_000)
      throw publicError('检索响应超过2MB限制', 'failed');
    return JSON.parse(value);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.length;
      if (length > 2_000_000) {
        await reader.cancel();
        throw publicError('检索响应超过2MB限制', 'failed');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function searchProductResourceLeads(request, overrides = {}) {
  const limit = boundLimit(request.limit, 100);
  const page = request.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 10)
    throw publicError('Brave公开检索仅支持第1至10页');
  const term = text(request.term, 500);
  if (!term) throw publicError('公开检索需要明确关键词');
  const hosts = resourceHosts(
    request.platform,
    request.market,
    request.websiteDomain || request.domain || request.websiteUrl,
  );
  if (hosts.length === 0)
    throw publicError('所选平台在该国家尚无已核实的公开检索路径');
  const env = await (overrides.collectorEnv || collectorEnv)();
  const key = env.BRAVE_SEARCH_API_KEY;
  if (!key) throw publicError('请先在现有数据源设置中配置Brave检索凭据');
  const language = { US: 'en', MX: 'es', VN: 'vi' }[request.market];
  const params = new URLSearchParams({
    q: `${term} site:${hosts[0]}`,
    country: request.market === 'VN' ? 'ALL' : request.market,
    search_lang: language,
    count: String(Math.min(20, limit)),
    offset: String(page - 1),
    safesearch: 'moderate',
  });
  let response;
  try {
    response = await scheduleSource(
      'brave',
      () =>
        (overrides.fetcher || fetch)(
          `https://api.search.brave.com/res/v1/web/search?${params}`,
          {
            headers: {
              accept: 'application/json',
              'x-subscription-token': key,
              'x-loc-country': request.market,
            },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
          },
        ),
      { intervalMs: overrides.fetcher ? 0 : 1000 },
    );
    if (!response.ok)
      throw publicError(
        `Brave检索HTTP ${response.status}，本页未自动重试`,
        response.status === 429 ? 'rate_limited' : 'failed',
      );
    const payload = await responseJson(response);
    if (!Array.isArray(payload.web?.results))
      throw publicError(
        'Brave未返回可识别网页结果，未作为空商品成功',
        'failed',
      );
    const seen = new Set();
    const leads = payload.web.results
      .flatMap((row) => {
        const url = candidateUrl(row.url, undefined, request);
        if (!url || seen.has(url)) return [];
        seen.add(url);
        return [
          {
            url,
            title: text(row.title, 500),
            kind:
              platformId(request.platform) === 'instagram'
                ? 'content'
                : 'product_page',
            source: 'Brave',
          },
        ];
      })
      .slice(0, limit);
    const hasMore = payload.query?.more_results_available === true && page < 10;
    return {
      products: [],
      leads,
      hasMore,
      empty: !leads.length && !hasMore,
      collectedAt: overrides.at || new Date().toISOString(),
      pageFingerprint: hash(JSON.stringify(leads.map((row) => row.url))),
      providerCalls: 1,
      usage: { braveRequests: 1 },
      status: 'leads_only',
      message: `取得${leads.length}条公开链接线索；检索摘要未作为商品或销量入库${request.market === 'VN' ? '；越南使用全球索引及越南语，国家不作为来源销售区域证明' : ''}`,
    };
  } catch (error) {
    // Provider responses and transport errors can contain authorization headers.
    const message = response
      ? String(error.message).replaceAll(String(key), '[已隐藏]')
      : 'Brave请求结果未知，本页不自动重放';
    throw Object.assign(new Error(message), {
      state: error.state || 'failed',
      code: error.code || 'failed',
      providerCalls: 1,
      usage: { braveRequests: 1 },
    });
  }
}

function types(value) {
  return list(value?.['@type']).map((type) =>
    String(type).replace(/^https?:\/\/schema\.org\//, ''),
  );
}

function structuredNodes($) {
  const nodes = [];
  let visited = 0;
  function visit(value, depth = 0) {
    if (!value || depth > 12 || visited >= 2000) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    visited++;
    if (value['@type']) nodes.push(value);
    for (const child of Object.values(value))
      if (child && typeof child === 'object') visit(child, depth + 1);
  }
  $('script[type="application/ld+json"]')
    .slice(0, 50)
    .each((_index, element) => {
      const raw = $(element).text();
      if (Buffer.byteLength(raw) > 1_000_000) return;
      try {
        visit(JSON.parse(raw));
      } catch {}
    });
  return nodes;
}

function breadcrumb(nodes, url, request, at) {
  const paths = nodes
    .filter((node) => types(node).includes('BreadcrumbList'))
    .map((node) =>
      list(node.itemListElement)
        .toSorted((a, b) => Number(a?.position || 0) - Number(b?.position || 0))
        .flatMap((entry) => {
          const item = entry?.item;
          const name = text(entry?.name || item?.name, 500);
          const href = candidateUrl(
            typeof item === 'string'
              ? item
              : item?.['@id'] || item?.url || entry?.url,
            url,
            request,
          );
          return name && href ? [{ id: href, name, url: href }] : [];
        }),
    )
    .filter((path) => path.length > 0);
  const originalPath = paths.toSorted((a, b) => b.length - a.length)[0];
  if (!originalPath) return undefined;
  const productRows = nodes.filter((node) => types(node).includes('Product'));
  const currentProduct = productRows.some((row) => {
    const value = row.url || row['@id'];
    return value
      ? candidateUrl(value, url, request) === url
      : productRows.length === 1 &&
          productPath(url, platformId(request.platform));
  });
  const path =
    currentProduct && originalPath.length > 1 && originalPath.at(-1).url === url
      ? originalPath.slice(0, -1)
      : originalPath;
  return {
    id: path.at(-1).id,
    path,
    breadcrumbPath: originalPath,
    name: path.at(-1).name,
    provider: 'public_web',
    platform: platforms[platformId(request.platform)],
    market: request.market,
    collectedAt: at,
    evidenceUrl: url,
    basis: '页面BreadcrumbList原始路径；未推断平台完整类目树',
  };
}

function propertyTable(row) {
  const values = {};
  for (const property of list(row.additionalProperty)) {
    const key = text(property?.name || property?.propertyID, 200);
    const value = property?.value;
    if (key && ['number', 'string'].includes(typeof value))
      values[key] = String(value).slice(0, 4000);
  }
  return values;
}

function explicitProperty(row, attributes, names) {
  for (const name of names) {
    const value = row[name] ?? attributes[name];
    if (typeof value === 'string' && value.trim()) return text(value);
  }
  return '';
}

function originalPrice(row) {
  const offers = list(row.offers);
  const offer = offers.length === 1 ? offers[0] : undefined;
  const raw = offer?.price ?? offer?.priceSpecification?.price;
  const currency = text(
    offer?.priceCurrency || offer?.priceSpecification?.priceCurrency,
    3,
  ).toUpperCase();
  const rawText = ['number', 'string'].includes(typeof raw) ? String(raw) : '';
  const valid = /^\d+(?:\.\d+)?$/.test(rawText) && /^[A-Z]{3}$/.test(currency);
  const numeric = valid ? Number(rawText) : undefined;
  const usable =
    numeric !== undefined &&
    Number.isFinite(numeric) &&
    numeric <= Number.MAX_SAFE_INTEGER;
  return {
    ...(usable ? { price: numeric, currency } : {}),
    ...(rawText
      ? {
          priceRaw: rawText,
          priceCurrencyRaw: currency || undefined,
          pricePrecision:
            typeof raw === 'string' ? 'source_decimal' : 'source_number',
          priceDecimalPlaces: rawText.includes('.')
            ? rawText.split('.')[1].length
            : 0,
        }
      : {}),
    ...(offer?.lowPrice !== undefined || offer?.highPrice !== undefined
      ? {
          priceRange: {
            lowRaw: String(offer.lowPrice ?? ''),
            highRaw: String(offer.highPrice ?? ''),
            currency: currency || undefined,
          },
        }
      : {}),
  };
}

function nativeId(url, platform) {
  const u = new URL(url);
  if (platform === 'amazon')
    return /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i
      .exec(u.pathname)?.[1]
      ?.toUpperCase();
  if (platform === 'shopee') {
    const match = /(?:-i\.|\/product\/)(\d+)[./](\d+)/.exec(u.pathname);
    return match ? `${match[1]}.${match[2]}` : undefined;
  }
  if (platform === 'mercado_libre') {
    const id = /\bMLM-?(\d+)\b/i.exec(u.pathname)?.[1];
    return id
      ? `${/\/p\/MLM/i.test(u.pathname) ? 'catalog:' : ''}MLM${id}`
      : undefined;
  }
  if (platform === 'temu')
    return (
      /-g-(\d+)\.html/.exec(u.pathname)?.[1] ||
      u.searchParams.get('goods_id') ||
      undefined
    );
  if (platform === 'tiktok_shop')
    return /\/(?:pdp|product)\/(?:[^/]+\/)?(\d+)(?:[/?]|$)/.exec(
      u.pathname,
    )?.[1];
}

function regionCodes(value) {
  return list(value).flatMap((item) => {
    if (typeof item === 'string')
      return /^[a-z]{2}$/i.test(item) ? [item.toUpperCase()] : [];
    if (!item || typeof item !== 'object') return [];
    return regionCodes(item.addressCountry || item.identifier || item.name);
  });
}

function marketProof(row, url, request) {
  const platform = platformId(request.platform);
  const regions = [
    ...new Set([
      ...regionCodes(row.sale_region || row.saleRegion),
      ...regionCodes(row.areaServed),
      ...list(row.offers).flatMap((offer) => [
        ...regionCodes(offer?.eligibleRegion),
        ...list(offer?.shippingDetails).flatMap((shipping) =>
          regionCodes(shipping?.shippingDestination),
        ),
      ]),
    ]),
  ];
  if (regions.length > 0)
    return regions.includes(request.market) ? 'source_sale_region' : undefined;
  if (['amazon', 'mercado_libre', 'shopee'].includes(platform))
    return 'country_specific_platform_host';
  if (platform === 'temu') {
    const country = /^\/(us|mx)(?:[-_/]|$)/i
      .exec(new URL(url).pathname)?.[1]
      ?.toUpperCase();
    return country === request.market ? 'explicit_country_path' : undefined;
  }
  if (platform === 'website') return 'research_scope_only';
  return undefined;
}

function rawProduct(row) {
  const raw = JSON.stringify(row);
  return raw.length <= 64_000
    ? { structuredProduct: row }
    : {
        structuredProductTruncated: true,
        structuredProductBytes: Buffer.byteLength(raw),
      };
}

function productFromSchema(row, context) {
  const { request, at, category, base, multiple } = context;
  const platform = platformId(request.platform);
  const title = text(row.name);
  const schemaUrl = row.url || row['@id'];
  if (multiple && !schemaUrl && !row.sku && !row.productID) return undefined;
  const url = candidateUrl(schemaUrl || base, base, request);
  if (!title || !url) return undefined;
  const proof = marketProof(row, url, request);
  if (!proof) return undefined;
  const sku = text(row.sku, 200);
  const productId = text(row.productID, 300);
  const native = nativeId(url, platform);
  const id = native || productId || sku || url;
  const variantId =
    sku || (native && productId !== native ? productId : '') || undefined;
  const identity = JSON.stringify([id, sku || null, productId || null]);
  const identityHost =
    platform === 'website'
      ? new URL(url).hostname.replace(/^www\./, '')
      : resourceHosts(request.platform, request.market)[0];
  const attributes = propertyTable(row);
  const price = originalPrice(row);
  const ingredient = explicitProperty(row, attributes, [
    'ingredients',
    'Ingredients',
    'Thành phần',
    'Ingredientes',
  ]);
  const dose = explicitProperty(row, attributes, [
    'servingSize',
    'Serving Size',
    'Dosage',
    'Liều dùng',
  ]);
  const size = explicitProperty(row, attributes, [
    'size',
    'Size',
    'Unit Count',
    'Quy cách',
    'Contenido neto',
  ]);
  const description = text(row.description);
  const image = list(row.image)
    .map((item) =>
      typeof item === 'string' ? item : item?.url || item?.contentUrl,
    )
    .filter((item) => {
      try {
        return articleHttpsUrl(item);
      } catch {
        return false;
      }
    })
    .slice(0, 20);
  const seller =
    list(row.offers).length === 1 ? list(row.offers)[0]?.seller : undefined;
  const shopName = text(
    typeof seller === 'string' ? seller : seller?.name,
    500,
  );
  const shopId = text(seller?.identifier || seller?.['@id'], 500) || undefined;
  const variant = Object.fromEntries(
    [
      'sku',
      'productID',
      'inProductGroupWithID',
      'size',
      'color',
      'material',
      'pattern',
      'gtin',
      'gtin8',
      'gtin12',
      'gtin13',
      'gtin14',
      'mpn',
    ]
      .filter((key) => ['number', 'string'].includes(typeof row[key]))
      .map((key) => [
        key,
        typeof row[key] === 'string' ? text(row[key], 1000) : row[key],
      ]),
  );
  const fieldNames = [
    'title',
    ...(price.price === undefined ? [] : ['price']),
    ...(image.length ? ['image'] : []),
    ...(description ? ['description'] : []),
    ...(size ? ['size'] : []),
    ...(ingredient ? ['ingredients'] : []),
    ...(dose ? ['servingSize'] : []),
  ];
  return {
    id: `${request.market}-platform-public-${hash(`${platform}|${identityHost}|${identity}`).slice(0, 24)}`,
    title,
    brand:
      text(typeof row.brand === 'string' ? row.brand : row.brand?.name, 500) ||
      '品牌待确认',
    market: request.market,
    category: category?.name || text(row.category, 500) || '待分类',
    form: explicitProperty(row, attributes, ['form', 'Item Form']) || '待识别',
    size: size || '官网未公开规格',
    ...(price.price === undefined
      ? {}
      : { price: price.price, currency: price.currency }),
    ingredient: ingredient || '官网未公开可核验配方',
    dose: dose || '官网未公开每份剂量',
    claim: description,
    benefits: [],
    benefitEvidence: '',
    ingredientInsights: [],
    siteId: '',
    color: '#edf2f7',
    imageUrl: image[0],
    imageUrls: image,
    reviewed: false,
    favorite: false,
    firstSeenAt: at,
    lastCollectedAt: at,
    sourceUrl: url,
    evidenceUrl: base,
    sourceProvider: '公开网页',
    sourcePlatform: platforms[platform],
    sourceProductId: id,
    sourceVariantId: variantId,
    sourceParentProductId: text(row.inProductGroupWithID, 300) || undefined,
    sourceCategory: category,
    sourceCategoryId: category?.id,
    sourceCategoryPath: category?.path,
    resourceRaw: {
      ...(category
        ? {
            category: {
              ...category,
              path: category.path.map((item) => item.name),
              evidencePath: category.path,
            },
          }
        : {}),
      ...price,
      shopName: shopName || undefined,
      shopId,
      variantId,
      ...(Object.keys(variant).length
        ? {
            variants: [variant],
            variantBasis: '当前Product节点的原始变体字段；不代表完整变体目录',
          }
        : {}),
      marketEvidence: proof,
    },
    sourceContent: {
      collectedAt: at,
      descriptions: description ? [description] : [],
      attributes,
      ...rawProduct(row),
    },
    sourceMetrics: {
      collectedAt: at,
      ...price,
      shopName: shopName || undefined,
      shopId,
      marketEvidence: proof,
      salesMetricNature: '结构化商品页，未提供可核验周期销量或订单数',
    },
    collectionFields: fieldNames,
    dataNature: 'collected',
    sourceEvidence: [
      {
        provider: '公开网页',
        platform: platforms[platform],
        market: request.market,
        collectedAt: at,
        evidenceUrl: base,
        fields: fieldNames,
        basis: 'JSON-LD Product原始结构化字段',
      },
    ],
    decisionData: { series: [] },
  };
}

function productPath(url, platform) {
  if (nativeId(url, platform)) return true;
  if (platform === 'website')
    return /\/(?:products?|shop|item)(?:\/|\.html?)/i.test(
      new URL(url).pathname,
    );
  return false;
}

export function parsePublicProductResource(html, request, options = {}) {
  const limit = boundLimit(request.limit);
  const url = checkUrl(request.url, request).href;
  if (typeof html !== 'string' || Buffer.byteLength(html) > 5_000_000)
    throw publicError('公开页面为空或超过5MB限制', 'failed');
  const $ = load(html);
  const heading = `${$('title').text()} ${$('h1').first().text()}`;
  if (
    /captcha|robot check|access denied|verify (?:that )?you are human|security verification|just a moment|人机验证|安全验证/i.test(
      heading,
    ) ||
    $(
      'form[action*="captcha"], #captcha, #challenge-form, input[type="password"]',
    ).length > 0 ||
    (/sign in|log in|login|đăng nhập|iniciar sesi[oó]n/i.test(heading) &&
      $('input[type="email"], input[type="tel"]').length > 0)
  )
    throw publicError('公开页面要求登录或访问验证，未绕过限制', 'blocked');
  const at = options.at || new Date().toISOString();
  const nodes = structuredNodes($);
  const category = breadcrumb(nodes, url, request, at);
  const rows = nodes.filter((node) => types(node).includes('Product'));
  const products = [];
  const seen = new Set();
  if (platformId(request.platform) !== 'instagram')
    for (const row of rows) {
      const product = productFromSchema(row, {
        request,
        at,
        category,
        base: url,
        multiple: rows.length > 1,
      });
      if (!product || seen.has(product.id)) continue;
      seen.add(product.id);
      products.push(product);
      if (products.length >= limit) break;
    }
  const leads = [];
  const seenUrls = new Set(products.map((product) => product.sourceUrl));
  function addLead(value, title, reason = 'structured_item_link') {
    const href = candidateUrl(value, url, request);
    if (!href || seenUrls.has(href) || href === url || leads.length >= limit)
      return;
    seenUrls.add(href);
    leads.push({
      url: href,
      title: text(title, 500),
      kind: 'product_page',
      source: '公开网页',
      reason,
    });
  }
  for (const node of nodes.filter((item) => types(item).includes('ItemList')))
    for (const entry of list(node.itemListElement)) {
      const item = entry?.item || entry;
      addLead(
        typeof item === 'string'
          ? item
          : item?.url || item?.['@id'] || entry?.url,
        item?.name || entry?.name,
      );
    }
  $('a[href]')
    .slice(0, 3000)
    .each((_index, element) => {
      const href = candidateUrl($(element).attr('href'), url, request);
      if (href && productPath(href, platformId(request.platform)))
        addLead(href, $(element).text(), 'visible_product_link');
    });
  const nextValue = $('link[rel="next"], a[rel="next"]').first().attr('href');
  const nextUrl = nextValue && candidateUrl(nextValue, url, request);
  const differentNext = nextUrl && nextUrl !== url ? nextUrl : undefined;
  return {
    products,
    leads,
    collectedAt: at,
    empty: !products.length && !leads.length && !differentNext,
    category,
    nextUrl: differentNext,
    nextCursor: differentNext,
    hasMore: Boolean(differentNext),
    pageFingerprint: hash(
      JSON.stringify([url, [...seen].toSorted(), [...seenUrls].toSorted()]),
    ),
    providerCalls: 0,
    status: products.length
      ? 'collected'
      : leads.length
        ? 'leads_only'
        : 'unavailable',
    message: products.length
      ? `保存${products.length}件结构化商品；未把页面排名、评论或片段当销量`
      : `页面未提供满足商品身份及国家校验的JSON-LD Product；保留${leads.length}条可核验线索，未填造商品或销量`,
  };
}

export async function collectPublicProductResource(request, overrides = {}) {
  const url = checkUrl(request.url, request);
  boundLimit(request.limit);
  if (platformId(request.platform) === 'instagram')
    return {
      products: [],
      leads: [
        { url: url.href, title: '', kind: 'content', source: '公开网页' },
      ],
      hasMore: false,
      collectedAt: overrides.at || new Date().toISOString(),
      pageFingerprint: hash(url.href),
      providerCalls: 0,
      usage: { publicRequests: 0 },
      status: 'leads_only',
      message:
        'Instagram仅作为品牌、内容与落地商品线索；内容采集使用既有公共情报入口，不提供交易销量',
    };
  let attempted = false;
  try {
    const addresses = await articleDns(url.hostname, overrides.resolve);
    attempted = true;
    const page = await (overrides.read || readPublicArticleOnce)(
      url,
      addresses,
    );
    if (page.status >= 300 && page.status < 400) {
      const redirectUrl =
        page.location && candidateUrl(page.location, url, request);
      if (!redirectUrl || redirectUrl === url.href)
        throw publicError(
          '公开页跳转到未允许的域名或循环地址，已停止',
          'blocked',
        );
      return {
        products: [],
        leads: [
          {
            url: redirectUrl,
            title: '',
            kind: 'product_page',
            reason: 'redirect',
          },
        ],
        hasMore: false,
        collectedAt: overrides.at || new Date().toISOString(),
        pageFingerprint: hash(`${url.href}|redirect|${redirectUrl}`),
        providerCalls: 0,
        usage: { publicRequests: 1 },
        status: 'leads_only',
        message: '收到同平台公开跳转线索，后续读取单独计入请求预算',
      };
    }
    if (page.status !== 200)
      throw publicError(
        `公开页HTTP ${page.status}，未作为空商品成功`,
        page.status === 429 ? 'rate_limited' : 'failed',
      );
    return {
      ...parsePublicProductResource(
        page.text,
        { ...request, url: url.href },
        { at: overrides.at },
      ),
      usage: { publicRequests: 1 },
    };
  } catch (error) {
    throw Object.assign(error, {
      providerCalls: 0,
      usage: { publicRequests: attempted ? 1 : 0 },
    });
  }
}

export function productResourcePublicRequest(request, overrides = {}) {
  return request.provider === 'brave' || request.op === 'search'
    ? searchProductResourceLeads(request, overrides)
    : collectPublicProductResource(request, overrides);
}
