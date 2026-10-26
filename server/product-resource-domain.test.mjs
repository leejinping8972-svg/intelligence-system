import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { archiveResourceEvidence, decorateResourceProduct, mergeResourceHistory, rankResourceProducts, requestedSalesWindow, resourceCapabilities, resourceResumeAllowed, resourceSalesMetric, validateResourceInput } from './product-resource-domain.mjs';
import { productResourceRequest } from './product-resource-provider.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';
import { connectSemrush } from './semrush-mcp.mjs';

const at = '2026-10-22T09:00:00Z';
const input = (patch = {}) => ({ requestId: randomUUID(), routeId: 'tiktok-scrapecreators', resourceDiscovery: true, market: 'VN', terms: 'probiotic', mode: 'keyword', salesWindowDays: 90, ranking: 'sample', maxProducts: 100, ...patch });
const plan = (patch = {}) => validateResourceInput(input(patch)).resourcePlan;
const product = (patch = {}) => ({ id: 'qa-product', title: 'QA probiotic', market: 'VN', price: 250000, currency: 'VND', collectionFields: ['price'], sourceProvider: 'ScrapeCreators', sourcePlatform: 'TikTok Shop', sourceProductId: 'qa-1', sourceMetrics: { soldCount: 100, soldRaw: '100', soldPrecision: 'exact', collectedAt: at }, ...patch });

test('capabilities distinguish native categories, public paths, Instagram, markets and account verification', () => {
  const c = resourceCapabilities({ public_web: true, tiktok_shop: true });
  assert.equal(c.routes.find((r) => r.id === 'shopee-sorftime').markets.join(), 'VN');
  assert.equal(c.routes.find((r) => r.id === 'temu-sorftime').markets.join(), 'US');
  assert.equal(c.routes.find((r) => r.id === 'mercadolibre-public').markets.join(), 'MX');
  assert.equal(c.routes.find((r) => r.id === 'tiktok-scrapecreators').modes.includes('category'), false);
  assert.deepEqual(c.routes.find((r) => r.platform === 'instagram').rankings, ['sample']);
  assert.match(c.platforms.find((p) => p.id === 'instagram').reason, /没有交易销量/);
  assert.equal(c.routes.find((r) => r.id === 'amazon-sorftime').configured, false);
});
test('resource validation rejects fake categories, unsupported country and budget-free paid routes', () => {
  assert.throws(() => plan({ routeId: 'shopee-sorftime', market: 'US' }), /不支持所选国家/);
  assert.throws(() => plan({ mode: 'category' }), /关键词样本/);
  assert.throws(() => plan({ routeId: 'amazon-sorftime', market: 'US', mode: 'category', category: { id: 'fake', market: 'US', path: ['fake'] } }), /拼造ID/);
  assert.throws(() => plan({ budget: { scrapeCredits: 0 } }), /预算为0/);
  assert.throws(() => plan({ budget: { browserPages: 1 } }), /不使用模型或浏览器/);
  assert.throws(() => plan({ budget: { maxPages: 6 } }), /maxPages预算/);
  assert.throws(() => plan({ maxProducts: 101 }), /1至100/);
  assert.throws(() => plan({ salesWindowDays: 365 }), /不是上架时间/);
  assert.throws(() => plan({ ranking: 'period_sales' }), /滚动30/);
});
test('operations and independent budgets are fixed for category, URL, Semrush and shop routes', () => {
  assert.equal(plan({ routeId: 'tiktok-detail-scrapecreators', market: 'US', mode: 'urls', urls: 'https://www.tiktok.com/shop/pdp/123' }).initialOperation, 'detail');
  assert.equal(plan({ routeId: 'tiktok-shop-scrapecreators', mode: 'urls', urls: 'https://www.tiktok.com/shop/qa', ranking: 'platform_bestsellers' }).initialOperation, 'shop_products');
  assert.equal(plan({ routeId: 'shopping-semrush' }).initialOperation, 'domains');
  for (const semrushUnits of [0, 1, 200_000]) {
    const p = plan({ routeId: 'shopping-semrush', budget: { semrushUnits } });
    assert.equal(p.budget.semrushUnits, 0);
  }
  assert.throws(() => plan({ routeId: 'shopping-semrush', budget: { providerCalls: 0 } }), /预算为0/);
  assert.equal(plan({ routeId: 'amazon-public', market: 'US', mode: 'urls', urls: 'https://www.amazon.com/dp/B000000001' }).initialOperation, 'public_page');
  assert.throws(() => plan({ routeId: 'website-public', mode: 'urls', urls: 'https://brand.example/product' }), /域名/);
});
test('rolling sales window excludes today and does not use listing age or calendar months', () => {
  assert.deepEqual(requestedSalesWindow({ salesWindowDays: 30 }, at), { days: 30, start: '2026-09-22', end: '2026-10-21', kind: 'rolling_days', purpose: 'sales_statistics', timezone: 'UTC' });
  const p = decorateResourceProduct(product(), plan(), { jobId: 'qa', collectedAt: at });
  assert.equal(p.resourceEvidence.requestedWindow.days, 90);
  assert.equal(p.resourceEvidence.metric.kind, 'cumulative_units');
  assert.equal(p.resourceEvidence.metric.unit, '件');
  assert.equal(p.resourceEvidence.metric.originalWindow.kind, 'cumulative');
  assert.match(p.resourceEvidence.metric.message, /不代表近90天/);
});
test('exact daily same-source history supports rolling units; missing, partial and conflicting dates do not', () => {
  const window = requestedSalesWindow({ salesWindowDays: 30 }, at);
  const points = Array.from({ length: 30 }, (_, i) => { const date = new Date(Date.parse(window.start) + i * 86400000).toISOString().slice(0, 10); return { start: date, end: date, value: 2 }; });
  const series = { provider: 'ScrapeCreators', platform: 'TikTok Shop', market: 'VN', productId: 'qa-1', metric: 'sales_volume', period: 'day', points };
  assert.equal(resourceSalesMetric(product({ decisionData: { series: [series] } }), window).value, 60);
  assert.equal(resourceSalesMetric(product({ sourceVariantId: 'sku-other', decisionData: { series: [series] } }), window).kind, 'cumulative_units');
  const variantSeries = { ...series, sourceVariantId: 'sku-a' };
  assert.equal(resourceSalesMetric(product({ sourceVariantId: 'sku-a', decisionData: { series: [variantSeries] } }), window).value, 60);
  assert.equal(resourceSalesMetric(product({ sourceVariantId: 'sku-b', decisionData: { series: [variantSeries] } }), window).kind, 'cumulative_units');
  for (const invalid of [{ ...series, points: points.slice(1) }, { ...series, provider: 'Other' }, { ...series, period: 'month' }, { ...series, points: [...points, { ...points[0], value: 9 }] }]) assert.equal(resourceSalesMetric(product({ decisionData: { series: [invalid] } }), window).kind, 'cumulative_units');
});
test('monthly estimates and BSR retain source nature instead of rolling period or orders', () => {
  const window = requestedSalesWindow({ salesWindowDays: 90 }, at);
  const monthly = resourceSalesMetric(product({ sourceMetrics: { monthlySales: 300 } }), window);
  assert.equal(monthly.originalWindow.kind, 'source_month_unspecified');
  assert.match(monthly.message, /不能换算/);
  assert.equal(resourceSalesMetric(product({ sourceMetrics: { salesRank: 10 } }), window).kind, 'bsr');
  assert.equal(resourceSalesMetric(product({ sourceMetrics: {} }), window).value, undefined);
});
test('sample ranks compare only exact comparable metrics and do not invent ranks for rounded or unknown values', () => {
  const p = plan();
  const rows = [product(), product({ id: 'qa-2', sourceMetrics: { soldCount: 300, soldPrecision: 'exact' } }), product({ id: 'qa-3', sourceMetrics: { soldRaw: '1K+', soldPrecision: 'lower_bound' } }), product({ id: 'qa-4', sourceMetrics: { monthlySales: 2000 } })].map((v) => decorateResourceProduct(v, p, { collectedAt: at }));
  const result = rankResourceProducts(rows, p);
  assert.equal(result.products[0].resourceEvidence.ranking.rank, 2);
  assert.equal(result.products[1].resourceEvidence.ranking.rank, 1);
  assert.equal(result.products[2].resourceEvidence.ranking.rank, undefined);
  assert.equal(result.products[3].resourceEvidence.ranking.rank, undefined);
  assert.equal(result.summary.complete, false);
});
test('raw currency, precision, identity and immutable observation history survive refresh and retry', async () => {
  const p = decorateResourceProduct(product({ resourceRaw: { priceRaw: '250.000', pricePrecision: 'source_decimal', shopId: 'qa-shop', variantId: 'qa-sku' } }), plan(), { collectedAt: at });
  assert.equal(p.resourceEvidence.price.raw, '250.000');
  assert.equal(p.resourceEvidence.price.amount, 250000);
  assert.equal(p.resourceEvidence.identity.variantId, 'qa-sku');
  const next = decorateResourceProduct(product(), plan({ salesWindowDays: 180 }), { collectedAt: at });
  const history = mergeResourceHistory(p, next);
  assert.equal(history.length, 2);
  assert.equal(mergeResourceHistory({ ...next, resourceHistory: history }, next).length, 2);
  const writes = new Map();
  await archiveResourceEvidence({ ...next, resourceHistory: history }, undefined, async (key, value) => writes.set(key, value));
  assert.equal(writes.size, 2);
});
test('resume is limited to cancelled resource checkpoints with no unknown charge or in-flight request', () => {
  const job = { input: { resourceDiscovery: true }, status: 'cancelled', cancelled: true, checkpoint: { index: 1, work: [{}, {}], startedAt: at, finishedAt: at } };
  assert.equal(resourceResumeAllowed(job), true);
  for (const patch of [{ unknownCharges: 1 }, { inFlight: { index: 1 } }, { finishedAt: undefined }, { index: 2 }]) assert.equal(resourceResumeAllowed({ ...job, checkpoint: { ...job.checkpoint, ...patch } }), false);
  assert.equal(resourceResumeAllowed({ ...job, status: 'partial', cancelled: false }), false);
});
const request = (patch = {}) => ({ resourceDiscovery: true, routeId: 'tiktok-scrapecreators', provider: 'tiktok_shop', platform: 'tiktok_shop', market: 'VN', op: 'search', term: 'probiotic', page: 1, windowDays: 90, ...patch });
test('TikTok new resource path reuses production nested parser and records explicit credits and raw price', async () => {
  const result = await productResourceRequest(request(), { cache: false, key: 'qa-secret', scrapeRequest: async (path, params) => {
    assert.equal(path, '/v1/tiktok/shop/search'); assert.equal(params.region, 'VN');
    return { credits_charged: 1, products: [{ id: 'qa-1', title: 'QA probiotic', product_price_info: { sale_price_decimal: '250.000', currency_name: 'VND' }, sold_info: { sold_count: 100 }, seo_url: { canonical_url: 'https://www.tiktok.com/shop/pdp/123' } }] };
  } });
  assert.equal(result.products[0].price, 250000);
  assert.equal(result.products[0].sourceMetrics.soldCount, 100);
  assert.equal(result.products[0].resourceRaw.priceRaw, '250.000');
  assert.equal(result.usage.scrapeCredits, 1);
});
test('TikTok missing fee receipt stays unknown; non-US details are rejected before provider request', async () => {
  const result = await productResourceRequest(request(), { cache: false, key: 'qa-key', scrapeRequest: async () => ({ products: [] }) });
  assert.equal(result.usage.scrapeCredits, undefined);
  let calls = 0;
  await assert.rejects(productResourceRequest(request({ routeId: 'tiktok-detail-scrapecreators', op: 'detail', market: 'VN' }), { cache: false, key: 'qa-key', scrapeRequest: async () => calls++ }), /国家/);
  assert.equal(calls, 0);
});
test('TikTok shop uses documented cursor and top ordering without period-sales claim', async () => {
  const result = await productResourceRequest(request({ routeId: 'tiktok-shop-scrapecreators', op: 'shop_products', url: 'https://www.tiktok.com/shop/store/qa', cursor: 'next-token', ranking: 'platform_bestsellers' }), { cache: false, key: 'qa-key', scrapeRequest: async (path, params) => {
    assert.equal(path, '/v1/tiktok/shop/products'); assert.equal(params.cursor, 'next-token'); assert.equal(params.sort_by, 'top');
    return { credits_charged: 1, cursor: 'later', products: [{ id: 'qa-1', title: 'Probiotic', sold_count: 5 }] };
  } });
  assert.equal(result.nextCursor, 'later');
  assert.match(result.message, /不代表近90天/);
});
test('Instagram results save content and exact outbound leads without inventing transactional products', async () => {
  const result = await productResourceRequest(request({ routeId: 'instagram-scrapecreators', provider: 'scrapecreators', platform: 'instagram', op: 'instagram_search', market: 'US' }), { cache: false, key: 'qa-key', scrapeRequest: async (path) => {
    assert.equal(path, '/v2/instagram/reels/search');
    return { credits_charged: 1, reels: [{ id: 'qa-reel', url: 'https://www.instagram.com/reel/qa/', caption: 'Probiotic brand https://brand.example/products/probiotic', owner: { username: 'qa-brand' } }] };
  } });
  assert.equal(result.contents.length, 1);
  assert.equal(result.products.length, 0);
  assert.equal(result.leads[0].websiteDomain, 'brand.example');
  assert.equal(result.contents[0].authorCountry, 'unknown');
});
test('source errors redact credentials and provider cache separates countries, terms, pages and category queries', async () => {
  await assert.rejects(productResourceRequest(request(), { cache: false, key: 'qa-secret-token', scrapeRequest: async () => { throw new Error('bad qa-secret-token'); } }), (e) => !e.message.includes('qa-secret-token'));
  const cacheValues = new Map(); let calls = 0;
  const overrides = { cache: { read: async (key) => cacheValues.get(key), write: async (key, value) => cacheValues.set(key, value) }, key: 'qa', scrapeRequest: async () => { calls++; return { credits_charged: 1, products: [{ id: 'qa-1', title: 'Probiotic' }] }; } };
  await productResourceRequest(request(), overrides);
  const cached = await productResourceRequest(request(), overrides);
  assert.equal(cached.usage.scrapeCredits, 0);
  await productResourceRequest(request({ page: 2 }), overrides);
  await productResourceRequest(request({ market: 'US' }), overrides);
  assert.equal(calls, 3);
});

test('TikTok rejects explicit wrong nested sale_region and wrong detail identity, preserving native shop and categories', async () => {
  const detail = request({ routeId: 'tiktok-detail-scrapecreators', op: 'detail', market: 'US', url: 'https://www.tiktok.com/shop/pdp/123' });
  const row = { product_id: '123', title: 'Probiotic', sale_region: 'US', seller_info: { shop_id: 'native-shop' }, category: [{ id: 'health', name: 'Health' }, { id: 'digestive', name: 'Digestive' }] };
  const run = (data) => productResourceRequest(detail, { cache: false, key: 'qa', scrapeRequest: async () => data });
  await assert.rejects(run({ data: { product_info: { ...row, sale_region: 'MX' } } }), /国家/);
  await assert.rejects(run({ product: { ...row, product_id: '456' } }), /商品标识/);
  const result = await run({ product: row });
  assert.equal(result.product.resourceRaw.shopId, 'native-shop');
  assert.deepEqual(result.product.resourceRaw.category.path, ['Health', 'Digestive']);
  assert.equal(result.product.resourceRaw.category.id, 'digestive');
});

test('TikTok top-level products preserve market and variant checks even when metadata is nested', async () => {
  const row = { product_id: '123', title: 'Synthetic probiotic', sale_region: 'VN', sku_id: 'sku-a' };
  const options = (raw) => ({ cache: false, key: 'qa', scrapeRequest: async () => ({ data: { total: 1 }, products: [raw], credits_charged: 1 }) });
  await assert.rejects(productResourceRequest(request(), options({ ...row, sale_region: 'US' })), /国家/);
  const first = await productResourceRequest(request(), options(row));
  assert.equal(first.products[0].sourceVariantId, 'sku-a');
  const next = await productResourceRequest(request({ page: 2 }), options({ ...row, sku_id: 'sku-b' }));
  assert.notEqual(first.pageFingerprint, next.pageFingerprint);
  const irrelevant = await productResourceRequest(request(), options({ ...row, title: 'Unrelated camera' }));
  assert.deepEqual(irrelevant.products, []);
});

test('unknown public label fields preserve existing verified specifications and formula', () => {
  const merged = mergePlatformProduct(product({ ingredient: 'Magnesium', dose: '100mg', size: '60 capsules' }), { ingredient: '官网未公开配方', dose: '官网未公开剂量', size: '官网未公开规格' });
  assert.equal(merged.ingredient, 'Magnesium');
  assert.equal(merged.dose, '100mg');
  assert.equal(merged.size, '60 capsules');
});

test('Semrush counts paginated MCP discovery plus report HTTP and blocks the fifteenth transport request', async () => {
  let calls = 0;
  const fetcher = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result;
    if (body.method === 'initialize') result = { protocolVersion: '2025-03-26' };
    else if (body.method === 'tools/list') result = { tools: [], ...(calls < 12 ? { nextCursor: String(calls) } : {}) };
    else if (body.params.name === 'get_report_schema') result = { structuredContent: { report: 'phrase_adwords', parameters: { database: { enum: ['us'] }, export_columns: { items: { enum: ['domain', 'url'] } } } } };
    else result = { structuredContent: { data: [{ domain: 'synthetic.example' }], metadata: { usage: { api_units: 20 } } } };
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  };
  const semrushClient = async (transport) => ({ c: await connectSemrush('qa-synthetic-key', transport), key: 'qa-synthetic-key' });
  const result = await platformProductRequest(request({ routeId: 'shopping-semrush', provider: 'semrush', platform: 'shopping', market: 'US', op: 'domains', limit: 1 }), { cache: false, fetcher, semrushClient });
  assert.equal(calls, 14);
  assert.equal(result.usage.requests, 14);
  assert.equal(result.usage.semrushUnits, 20);
  assert.deepEqual(result.domains, ['synthetic.example']);
  calls = 0;
  await assert.rejects(productResourceRequest(request({ routeId: 'shopping-semrush', provider: 'semrush', platform: 'shopping', market: 'US', op: 'domains' }), { cache: false, fetcher, semrushClient, legacyRequest: async (_request, overrides) => {
    const { c } = await overrides.semrushClient();
    await c.rpc('tools/call', { name: 'get_report_schema' });
    await c.rpc('tools/call', { name: 'execute_report' });
    await c.rpc('tools/call', { name: 'unexpected_extra' });
    return {};
  } }), /14次HTTP/);
});
