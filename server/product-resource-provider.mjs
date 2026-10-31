/* eslint-disable preserve-caught-error -- Provider causes can retain credentials. */
import { createHash } from 'node:crypto';

import { openAdsKey, scrapeRequest } from './ads-provider.mjs';
import { pool, putDocument } from './database.mjs';
import { normalizeTikTokShopProduct, normalizeTikTokShopSearch } from './tiktok-shop-provider.mjs';
import { discoveryRequest, parseDiscovery } from './public-content-discovery.mjs';
import { articleHttpsUrl } from './public-article-http.mjs';
import { normalizeContent } from './public-content-domain.mjs';
import { resourceRoute } from './product-resource-domain.mjs';
import { matchesProductTerm } from './platform-product-data.mjs';

const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean = (error, key = '') => String(error?.message || error || '资源来源请求失败')
  .replaceAll(key || '\u0000', '[已隐藏]')
  .replaceAll(/https:\/\/mcp\.sorftime\.com[^\s"<>]*/gi, 'Sorftime MCP')
  .slice(0, 700);

export async function productResourceRequest(request, overrides = {}) {
  const route = resourceRoute(request.routeId);
  if (!route || (route.provider !== request.provider && request.provider !== 'public_web') || !route.markets.includes(request.market)) throw new Error('此来源不支持所选资源路径或国家');
  const cache = overrides.cache === false ? null : overrides.cache || {
    read: async (name) => (await pool.query('SELECT value FROM provider_configs WHERE name=$1', [name])).rows[0]?.value,
    write: (name, value) => putDocument('provider_configs', name, value),
  };
  const name = `resource:cache:${digest([request.routeId, request.provider, request.platform, request.market, request.op, request.term, request.query, request.parentId, request.category, request.url, request.domain, request.websiteDomain, request.page, request.cursor, request.product?.sourceProductId, request.product?.sourceVariantId, request.windowDays, request.ranking, request.limit])}`;
  const previous = await cache?.read(name);
  const ttl = previous?.result?.empty ? 15 * 60_000 : 86_400_000;
  if (previous?.result && Date.now() - Date.parse(previous.at) < ttl) return {
    ...previous.result, cached: true, providerCalls: 0, creditsCharged: 0, apiUnits: 0,
    usage: { requests: 0, providerCalls: 0, sorftimeCalls: 0, scrapeCredits: 0, semrushUnits: 0, braveRequests: 0, browserPages: 0, modelTokens: 0 },
  };
  const result = await collectResource(request, overrides);
  if (!result || typeof result !== 'object') throw new Error('资源来源未返回可识别结果');
  const { semrushKeyId: _key, ...safe } = result;
  if (JSON.stringify(safe).length < 250_000) await cache?.write(name, { at: new Date().toISOString(), result: safe });
  return result;
}
async function collectResource(request, overrides) {
  if (request.provider === 'sorftime') {
    const { collectSorftimeResource } = await import('./product-resource-sorftime.mjs');
    return collectSorftimeResource(request, overrides);
  }
  if (request.provider === 'public_web') {
    const { collectPublicProductResource } = await import('./product-resource-public.mjs');
    return collectPublicProductResource(request, overrides);
  }
  if (request.provider === 'brave') {
    const { searchProductResourceLeads } = await import('./product-resource-public.mjs');
    return searchProductResourceLeads(request, overrides);
  }
  if (request.provider === 'semrush') {
    if (!['domains', 'shopping'].includes(request.op)) throw new Error('Semrush资源操作不支持；必须分别计入域名发现与Shopping请求');
    if (!overrides.legacyRequest) throw new Error('Semrush资源适配器未连接已有报告服务');
    const { client } = await import('./semrush-reports.mjs');
    let requests = 0;
    const fetcher = async (...args) => {
      requests++;
      return (overrides.fetcher || fetch)(...args);
    };
    const result = await overrides.legacyRequest({ ...request, resourceDiscovery: false }, { ...overrides, semrushClient: () => (overrides.semrushClient || client)(fetcher) });
    return { ...result, providerCalls: result.cached ? 0 : 1, usage: { requests, providerCalls: result.cached ? 0 : 1, ...(finite(result.apiUnits) ? { semrushUnits: result.apiUnits } : {}) }, empty: !result.domains?.length && !result.products?.length };
  }
  if (!['tiktok_shop', 'scrapecreators'].includes(request.provider)) throw new Error('资源来源不支持');
  const stored = overrides.config || (!overrides.key && (await pool.query('SELECT value FROM provider_configs WHERE name=$1', ['provider:scrapecreators:v1'])).rows[0]?.value);
  const key = overrides.key || (stored ? openAdsKey(stored) : '');
  if (!key) throw new Error('请先在数据源设置配置ScrapeCreators');
  try {
    if (request.platform === 'instagram') return await instagramResource(request, key, overrides);
    return await tiktokResource(request, key, overrides);
  } catch (error) {
    throw new Error(clean(error, key));
  }
}
function usage(data) {
  const credits = data.credits_charged;
  return { requests: 1, providerCalls: 1, ...(finite(credits) ? { scrapeCredits: credits } : {}) };
}
function sourceRows(data) {
  const container = data?.data || data?.result || data;
  return container.products || container.items || data?.products || data?.items || [];
}
function enrichTikTok(product, row) {
  const source = { ...row, ...(row.product_info || row.product) };
  const rawPrice = source.product_price_info?.sale_price_decimal ?? source.price_info?.sale_price ?? source.price?.value ?? source.price?.amount ?? source.price;
  const rawCategories = source.category_path ?? source.categories ?? source.category;
  const nodes = Array.isArray(rawCategories) ? rawCategories : rawCategories ? [rawCategories] : [];
  const path = nodes.map((n) => typeof n === 'object' ? String(n.name || n.category_name || n.id || n.category_id || '') : String(n)).filter(Boolean).slice(0, 20);
  const last = nodes.at(-1);
  const categoryId = source.category_id || (last && typeof last === 'object' && (last.id || last.category_id));
  const variantId = String(source.sku_id || source.variant_id || '');
  return {
    ...product,
    ...(variantId ? { sourceVariantId: variantId } : {}),
    resourceRaw: {
      ...(typeof rawPrice === 'string' || typeof rawPrice === 'number' ? { priceRaw: String(rawPrice) } : {}),
      shopId: String(source.seller?.id || source.seller_info?.shop_id || source.seller_info?.seller_id || source.shop_info?.shop_id || source.shop_id || ''),
      variantId,
      variants: (Array.isArray(source.skus) ? source.skus : Array.isArray(source.variants) ? source.variants : []).slice(0, 100),
      ...(categoryId ? { category: { id: String(categoryId), path: path.length ? path : [String(source.category_name || categoryId)], market: product.market, provider: product.sourceProvider, platform: 'tiktok_shop' } } : {}),
    },
  };
}
function assertTikTokMarket(data, market) {
  const check = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const key of ['sale_region', 'region', 'country_code']) {
      const region = value[key];
      if (typeof region === 'string' && region.trim() && region.trim().toUpperCase() !== market) throw new Error('来源返回国家与请求不一致，未跨国替代');
    }
    for (const key of ['product', 'product_info']) check(value[key]);
  };
  check(data); check(data.data); check(data.result);
  for (const row of sourceRows(data)) check(row);
}
async function tiktokResource(request, key, overrides) {
  let path, params;
  if (request.op === 'search') {
    path = '/v1/tiktok/shop/search';
    params = { query: request.term, page: request.page || 1, region: request.market };
  } else if (request.op === 'shop_products') {
    const url = articleHttpsUrl(request.url);
    if (!/(?:^|\.)tiktok\.com$/i.test(url.hostname)) throw new Error('不支持此店铺链接；请输入TikTok官方店铺页');
    path = '/v1/tiktok/shop/products';
    params = { url: url.href, region: request.market, sort_by: request.ranking === 'platform_bestsellers' ? 'top' : 'new_releases', ...(request.cursor ? { cursor: request.cursor } : {}) };
  } else if (request.op === 'detail') {
    if (request.market !== 'US') throw new Error('ScrapeCreators商品详情当前仅US受文档支持，其他国家请用Sorftime或可验证公开页');
    const url = articleHttpsUrl(request.url || request.product?.sourceUrl);
    if (!/(?:^|\.)tiktok\.com$/i.test(url.hostname)) throw new Error('不支持此商品链接；请输入TikTok官方商品页');
    path = '/v1/tiktok/product';
    params = { url: url.href, region: request.market };
  } else throw new Error('TikTok来源不支持类目、历史或指定周期销量操作');
  const data = await (overrides.scrapeRequest || scrapeRequest)(path, params, key, overrides.fetcher || fetch, 'GET');
  const at = new Date().toISOString();
  assertTikTokMarket(data, request.market);
  if (request.op === 'detail') {
    const row = data.product || data.data?.product || data.data || data;
    const product = normalizeTikTokShopProduct(row, request.market, at);
    if (!product) return { empty: true, products: [], providerCalls: 1, usage: usage(data), message: '来源未收录此商品或详情字段不完整，不当作销量为0' };
    const expectedId = request.product?.sourceProductId || new URL(params.url).pathname.match(/\/(?:pdp|product)\/(?:[^/]+\/)?(\d+)(?:\/|$)/i)?.[1];
    if (expectedId && product.sourceProductId !== expectedId) throw new Error('来源返回商品标识与请求不一致，原商品未覆盖');
    return { product: enrichTikTok(product, row), providerCalls: 1, usage: usage(data), collectedAt: at, message: '已保存US商品来源详情，缺失规格和配方保留未知' };
  }
  const normalized = normalizeTikTokShopSearch(data, request.market, at);
  const rawRows = sourceRows(data);
  const allProducts = rawRows.map((row) => {
    const p = normalizeTikTokShopProduct(row, request.market, at);
    return p && enrichTikTok(p, row);
  }).filter(Boolean);
  const products = allProducts.filter((p) => request.op !== 'search' || matchesProductTerm(p, request.term));
  const nextCursor = data.next_cursor || data.cursor || data.data?.next_cursor || data.data?.cursor;
  const explicitMore = data.has_more ?? data.data?.has_more;
  const hasMore = request.op === 'shop_products' ? Boolean(nextCursor) && explicitMore !== false : explicitMore === true || normalized.products.length >= Math.min(20, request.limit || 20) && (!normalized.total || (request.page || 1) * normalized.products.length < normalized.total);
  return { products, sourceRows: normalized.sourceRows, pageFingerprint: digest(allProducts.map((p) => [p.sourceProductId, p.sourceVariantId || ''])), hasMore, nextCursor, providerCalls: 1, usage: usage(data), empty: normalized.sourceRows === 0, collectedAt: at, message: `${request.op === 'shop_products' ? '店铺商品来源顺序' : '关键词商品样本'}；展示已售按累计件数保留，不代表近${request.windowDays}天销量。${request.market !== 'US' ? '非US覆盖可能有限。' : ''}` };
}
function contentList(value) {
  if (!Array.isArray(value)) throw new Error('Instagram返回字段结构未识别，未编造商品');
  return value;
}
async function instagramResource(request, key, overrides) {
  if (request.op !== 'instagram_search') throw new Error('Instagram不支持交易商品类目、销量排名或历史销量');
  const spec = discoveryRequest('instagram', request.term, { market: request.market, searchScope: 'local' });
  const data = await (overrides.scrapeRequest || scrapeRequest)(spec.path, spec.params, key, overrides.fetcher || fetch, 'GET');
  const at = new Date().toISOString();
  const raw = parseDiscovery('instagram', data, { market: request.market }, Math.min(100, request.limit || 20), contentList);
  const contents = raw.map((row) => normalizeContent(row, 'instagram', { market: request.market, searchScope: 'local', language: { US: 'en', MX: 'es', VN: 'vi' }[request.market], keywordIds: [], productIds: [] }, request.term, at)).filter(Boolean);
  const leads = [];
  for (const row of contents) {
    for (const match of String(row.summary || row.text || '').matchAll(/https:\/\/[^\s<>"']+/g)) {
      try {
        const url = articleHttpsUrl(match[0].replace(/[),.;]+$/, ''));
        if (/(?:^|\.)(?:instagram|facebook|tiktok|youtube)\.com$/i.test(url.hostname)) continue;
        leads.push({ url: url.href, platform: 'website', websiteDomain: url.hostname, fromContentId: row.id });
      } catch {}
    }
  }
  return { contents, leads: leads.slice(0, 100), products: [], hasMore: false, providerCalls: 1, usage: usage(data), empty: !contents.length, collectedAt: at, message: `保存${contents.length}条Instagram品牌/内容线索；仅原文明示的公开落地商品可继续核验，不生成交易销量。` };
}
