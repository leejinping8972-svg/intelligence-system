import assert from 'node:assert/strict';
import test from 'node:test';

import { collectSorftimeResource } from './product-resource-sorftime.mjs';

const at = '2026-10-22T08:00:00.000Z';
const string = { type: 'string' };
const market = { type: 'string', enum: ['US', 'MX', 'VN'] };
const tool = (name, properties, required = Object.keys(properties)) => ({ name, inputSchema: { type: 'object', properties, required } });
const request = (patch = {}) => ({ provider: 'sorftime', platform: 'amazon', op: 'search', term: 'creatine gummies', market: 'US', page: 1, limit: 20, ...patch });
function source(tools, value) {
  const calls = [];
  return {
    calls,
    overrides: {
      now: () => Date.parse(at),
      client: { tools, rpc: async (method, params) => { calls.push({ method, params }); return { structuredContent: typeof value === 'function' ? value(params) : value }; } },
    },
  };
}

test('Amazon keyword collection reuses existing normalization and makes exactly one guarded data call', async () => {
  const s = source([tool('product_search_from_name', { name: string, amz_site: market, page: { type: 'integer' }, query_type: { type: 'integer', enum: [1, 2] } })], {
    data: [{ asin: 'B0TEST0001', title: 'Creatine Gummies', price: '12.30', monthly_sale_volume: 45 }, { asin: 'B0TEST0002', title: 'Unrelated bottle' }],
  });
  const result = await collectSorftimeResource(request(), s.overrides);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].params.arguments, { amz_site: 'US', name: 'creatine gummies', page: 1, query_type: 2 });
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].sourceMetrics.monthlySales, 45);
  assert.equal(result.products[0].sourceMetrics.orderCount, undefined);
  assert.equal(result.products[0].resourceRaw.priceRaw, '12.30');
  assert.deepEqual(result.usage, { requests: 1, providerCalls: 1, sorftimeCalls: 1 });
});

test('actual category trees retain native IDs, ancestral labels, raw paths and country', async () => {
  const s = source([tool('category_tree', { amz_site: market, parent_id: { type: 'string', default: '0' } })], { data: [{ node_id: '10', node_name: 'Health', children: [{ node_id: '20', node_name: 'Vitamins', node_path: '10:20' }] }] });
  const result = await collectSorftimeResource(request({ op: 'categories', term: undefined }), s.overrides);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0].params.arguments, { amz_site: 'US', parent_id: '0' });
  assert.deepEqual(result.categories[1], { id: '20', name: 'Vitamins', path: ['Health', 'Vitamins'], market: 'US', provider: 'sorftime', platform: 'amazon', rawPath: '10:20' });
});

test('category query uses only an actually listed alias and does not invent keyword categories', async () => {
  const s = source([tool('category_search_from_name', { name: string, amz_site: market })], { data: [{ keyword: 'creatine', volume: 50 }] });
  const result = await collectSorftimeResource(request({ op: 'categories', query: 'creatine' }), s.overrides);
  assert.equal(s.calls[0].params.name, 'category_search_from_name');
  assert.deepEqual(result.categories, []);
  assert.equal(result.empty, true);
});

test('market enum, unknown required parameters and unsupported schema are rejected before any paid data call', async () => {
  for (const target of [
    tool('category_products', { amz_site: { type: 'string', enum: ['US'] }, node_id: string }),
    tool('category_products', { amz_site: market, node_id: string, unexplained_option: { type: 'boolean', default: true } }),
    tool('category_products', { amz_site: { type: 'string' }, node_id: string }),
    tool('category_products', { amz_site: market, node_id: { type: 'boolean' } }),
    tool('category_products', { amz_site: market, node_id: { type: 'string', anyOf: [{ type: 'string' }] } }),
    tool('category_products', { amz_site: market, node_id: { type: 'string', $ref: '#/$defs/id' } }),
  ]) {
    const s = source([target], { data: [] });
    await assert.rejects(collectSorftimeResource(request({ op: 'category', market: 'VN', category: { id: '20', path: ['Vitamins'], market: 'VN' } }), s.overrides), /未发起|不支持/);
    assert.equal(s.calls.length, 0);
  }
});

test('native category ID and raw node path map only to declared schema fields', async () => {
  const s = source([tool('category_products', { amz_site: market, node_id: { type: 'integer' }, node_path: string, page: { type: 'integer' } })], { data: [{ asin: 'B0TEST0001', title: 'Creatine Gummies', position: 3 }], has_more: true });
  const result = await collectSorftimeResource(request({ op: 'bestsellers', category: { id: '20', path: ['Health', 'Vitamins'], rawPath: '10:20', market: 'US' } }), s.overrides);
  assert.deepEqual(s.calls[0].params.arguments, { amz_site: 'US', node_id: 20, node_path: '10:20', page: 1 });
  assert.equal(result.products[0].resourceRaw.sourceRank, 3);
  assert.equal(result.hasMore, true);
  assert.equal(result.products[0].sourceMetrics.sales90Days, undefined);
});

test('TikTok category aggregate top50 without real product IDs is preserved as unsupported product coverage', async () => {
  const s = source([tool('tiktok_category_report', { tiktok_site: market, category_id: string })], { data: { top50: [{ title: 'A top seller', sales: 900 }, { title: 'Another seller', sales: 800 }, { id: 'category-aggregate', name: 'Health category', sales: 10_000 }] } });
  const result = await collectSorftimeResource(request({ platform: 'tiktok_shop', op: 'category', market: 'VN', category: { id: '100', path: ['Health'], market: 'VN' } }), s.overrides);
  assert.equal(s.calls.length, 1);
  assert.equal(result.unsupported, true);
  assert.deepEqual(result.products, []);
  assert.match(result.message, /缺少可核验商品ID/);
  assert.deepEqual(result.sourceReceipt, {
    tool: 'tiktok_category_report', collectedAt: at, market: 'VN', platform: 'tiktok_shop',
    aggregate: { data: { top50: [{ title: 'A top seller', sales: 900 }, { title: 'Another seller', sales: 800 }, { id: 'category-aggregate', name: 'Health category', sales: 10_000 }] } },
    truncated: false, filtered: false,
  });
});

test('unsupported aggregate receipts are bounded, omit transport fields and scrub credentials and URLs', async () => {
  const s = source([tool('tiktok_category_report', { tiktok_site: market, category_id: string })], {
    data: {
      top50: Array.from({ length: 80 }, (_, index) => ({ title: `Report ${index} ${'x'.repeat(900)}`, sales: index, api_key: 'synthetic-secret' })),
      summary: 'token:synthetic-secret https://mcp.sorftime.com/?key=synthetic-secret',
      endpoint: 'https://mcp.sorftime.com/?key=synthetic-secret',
    },
  });
  const result = await collectSorftimeResource(request({ platform: 'tiktok_shop', op: 'category', market: 'VN', category: { id: '100', path: ['Health'], market: 'VN' } }), s.overrides);
  const encoded = JSON.stringify(result.sourceReceipt);
  assert.equal(result.unsupported, true);
  assert.deepEqual(result.products, []);
  assert.ok(Buffer.byteLength(encoded, 'utf8') <= 20_000);
  assert.equal(result.sourceReceipt.truncated, true);
  assert.equal(result.sourceReceipt.filtered, true);
  assert.equal(encoded.includes('synthetic-secret'), false);
  assert.equal(encoded.includes('https://'), false);
  assert.equal(encoded.includes('api_key'), false);
  assert.equal(encoded.includes('endpoint'), false);
});

test('aggregate-only category reports retain metrics while a truly empty category response stays empty', async () => {
  const target = tool('tiktok_category_report', { tiktok_site: market, category_id: string });
  const query = request({ platform: 'tiktok_shop', op: 'category', market: 'VN', category: { id: '100', path: ['Health'], market: 'VN' } });
  const aggregate = source([target], { data: { sales_volume: 900, period: 'month', date: '2026-09' } });
  const result = await collectSorftimeResource(query, aggregate.overrides);
  assert.equal(result.unsupported, true);
  assert.deepEqual(result.sourceReceipt.aggregate, { data: { sales_volume: 900, period: 'month', date: '2026-09' } });
  assert.deepEqual(result.products, []);
  const empty = source([target], { data: [] });
  const notFound = await collectSorftimeResource(query, empty.overrides);
  assert.equal(notFound.empty, true);
  assert.equal(notFound.unsupported, undefined);
  assert.equal(notFound.sourceReceipt, undefined);
});

test('pagination fingerprints include explicit variants of the same source product', async () => {
  const target = tool('tiktok_category_products', { tiktok_site: market, category_id: string, page: { type: 'integer' } });
  const query = request({ platform: 'tiktok_shop', op: 'category', market: 'VN', category: { id: '100', path: ['Health'], market: 'VN' } });
  const s = source([target], ({ arguments: args }) => ({ data: [{ product_id: '70001', title: 'Gummies', sku_id: `sku${args.page}` }], has_more: true }));
  const first = await collectSorftimeResource(query, s.overrides);
  const second = await collectSorftimeResource({ ...query, page: 2 }, s.overrides);
  assert.notEqual(first.pageFingerprint, second.pageFingerprint);
  assert.equal(first.products[0].resourceRaw.variantId, 'sku1');
  assert.equal(second.products[0].resourceRaw.variantId, 'sku2');
});

test('nested TikTok fields preserve original VND precision, specification, formula, shop and variants', async () => {
  const s = source([tool('tiktok_category_products', { country: market, category_id: string })], { data: [{
    product_info: { product_id: '70001', title: 'Gummies', product_price_info: { sale_price_decimal: '95.500', currency_name: 'VND' }, sold_info: { sold_count: '12.3K' }, specification: '60 gummies', ingredients: 'Vitamin C', shop_info: { shop_id: 's1', shop_name: 'Official shop' }, variants: [{ sku_id: 'v1', name: '60 count', price: '95.500' }] },
  }] });
  const result = await collectSorftimeResource(request({ platform: 'tiktok_shop', op: 'category', market: 'VN', category: { id: '100', path: ['Health'], market: 'VN' } }), s.overrides);
  const p = result.products[0];
  assert.equal(p.sourceProductId, '70001');
  assert.equal(p.price, 95500);
  assert.equal(p.currency, 'VND');
  assert.equal(p.size, '60 gummies');
  assert.equal(p.ingredient, 'Vitamin C');
  assert.equal(p.sourceMetrics.soldCount, undefined);
  assert.equal(p.sourceMetrics.soldRaw, '12.3K');
  assert.equal(p.resourceRaw.shopId, 's1');
  assert.equal(p.resourceRaw.priceRaw, '95.500');
  assert.equal(p.resourceRaw.variants[0].sku_id, 'v1');
});

test('Shopee and Temu keep separate source identities and reject a row from another country', async () => {
  for (const platform of ['shopee', 'temu']) {
    const s = source([tool(`${platform}_product_search_from_name`, { name: string, country: market, page: { type: 'integer' } })], { data: [{ item_id: 'same-id', title: 'Creatine Gummies', price: '12.30', currency: 'USD', country: 'US' }, { item_id: 'other-id', title: 'Creatine Gummies', country: 'VN' }] });
    const result = await collectSorftimeResource(request({ platform }), s.overrides);
    assert.equal(result.products.length, 1);
    assert.match(result.products[0].id, new RegExp(`platform-${platform}-`));
    assert.equal(result.products[0].sourceProductId, 'same-id');
    assert.equal(result.products[0].currency, 'USD');
    assert.equal(result.products[0].price, 12.3);
    assert.equal(result.products[0].resourceRaw.priceRaw, '12.30');
  }
});

test('Amazon detail URL extracts exact ASIN and prevents a country or identity switch', async () => {
  const target = tool('product_detail', { asin: string, amz_site: market });
  const s = source([target], { data: { asin: 'B0TEST0001', title: 'Creatine Gummies', price: 12 } });
  const result = await collectSorftimeResource(request({ op: 'detail', url: 'https://www.amazon.com/dp/B0TEST0001' }), s.overrides);
  assert.equal(s.calls[0].params.arguments.asin, 'B0TEST0001');
  assert.equal(result.product.sourceProductId, 'B0TEST0001');
  const mismatch = source([target], {});
  await assert.rejects(collectSorftimeResource(request({ op: 'detail', market: 'MX', url: 'https://www.amazon.com/dp/B0TEST0001' }), mismatch.overrides), /国家不一致/);
  assert.equal(mismatch.calls.length, 0);
});

test('monthly histories remain calendar months and explicit daily history never fills missing days with zero', async () => {
  const target = tool('product_trend', { asin: string, amz_site: market, type: { type: 'string', enum: ['AsinSalesVolume', 'Rank'] } });
  const product = { id: 'saved', sourceProductId: 'B0TEST0001', title: 'Gummies', market: 'US', sourceUrl: 'https://www.amazon.com/dp/B0TEST0001' };
  const monthly = source([target], { data: ['202608', 50, '202609', -1] });
  const result = await collectSorftimeResource(request({ op: 'history', product }), monthly.overrides);
  assert.equal(result.series.period, 'month');
  assert.deepEqual(result.series.points.map((p) => [p.start, p.end, p.value]), [['2026-08-01', '2026-08-31', 50]]);
  const daily = source([target], { data: { product_id: 'B0TEST0001', period: 'daily', items: [{ date: '2026-10-20', value: 5 }, { date: '2026-10-21', value: -1 }] } });
  const dayResult = await collectSorftimeResource(request({ op: 'history', product }), daily.overrides);
  assert.equal(dayResult.series.period, 'day');
  assert.equal(dayResult.series.platform, 'Amazon');
  assert.deepEqual(dayResult.series.points, [{ start: '2026-10-20', end: '2026-10-20', value: 5, partial: false }]);
  const unknown = source([target], { data: [{ date: 'last week', value: 50 }] });
  const unavailable = await collectSorftimeResource(request({ op: 'history', product }), unknown.overrides);
  assert.equal(unavailable.unsupported, true);
  assert.equal(unavailable.series, undefined);
  assert.equal(unavailable.usage.sorftimeCalls, 1);
});

test('non Amazon monthly and daily histories preserve actual platform, market, product and variant scope', async () => {
  const target = tool('tiktok_product_trend', { product_id: string, sku_id: string, tiktok_site: market, type: { type: 'string', enum: ['ProductSalesVolume'] } });
  const product = { id: 'tk-saved', sourceProductId: '70001', sourcePlatform: 'TikTok Shop', sourceVariantId: 'sku1', title: 'Gummies', market: 'VN', sourceUrl: 'https://shop.tiktok.com/view/product/70001' };
  for (const value of [{ data: ['202609', 50] }, { data: { period: 'day', items: [{ date: '2026-10-20', value: 5 }] } }]) {
    const s = source([target], value);
    const result = await collectSorftimeResource(request({ op: 'history', platform: 'tiktok_shop', market: 'VN', product }), s.overrides);
    assert.equal(result.series.platform, 'TikTok Shop');
    assert.equal(result.series.market, 'VN');
    assert.equal(result.series.productId, '70001');
    assert.equal(result.series.sourceVariantId, 'sku1');
    assert.equal(result.series.basis.includes('ASIN'), false);
  }
});

test('successful Sorftime collection reports control plus data HTTP usage separately from data tool allowance', async () => {
  const target = tool('product_search_from_name', { name: string, amz_site: market });
  let physical = 0;
  const result = await collectSorftimeResource(request(), {
    env: {}, token: 'synthetic', now: () => Date.parse(at),
    fetch: async () => { physical++; return Response.json({}); },
    connectSorftime: async (_token, fetcher) => {
      for (const method of ['initialize', 'notifications/initialized', 'tools/list']) await fetcher('https://mcp.sorftime.com/', { body: JSON.stringify({ method }) });
      return { tools: [target], rpc: async (method, params) => {
        await fetcher('https://mcp.sorftime.com/', { body: JSON.stringify({ method }) });
        return { structuredContent: { data: [{ asin: 'B0TEST0001', title: 'Creatine Gummies' }] } };
      } };
    },
  });
  assert.equal(physical, 4);
  assert.equal(result.usage.requests, 4);
  assert.equal(result.controlRequests, 3);
  assert.equal(result.dataRequests, 1);
  assert.equal(result.usage.sorftimeCalls, 1);
});

test('control requests continue beyond the old cap and transport errors still scrub credentials', async () => {
  const token = 'synthetic-token-never-real';
  let controls = 0;
  const result = await collectSorftimeResource(request(), {
    token, env: {}, fetch: async () => { controls++; return Response.json({}); },
    connectSorftime: async (_token, fetcher) => {
      for (let index = 0; index < 5; index++) await fetcher('https://mcp.sorftime.com/', { body: JSON.stringify({ method: 'tools/list' }) });
      return source([tool('product_search_from_name', { name: string, amz_site: market })], { data: [] }).overrides.client;
    },
  });
  assert.equal(controls, 5);
  assert.equal(result.usage.requests, 6);
  try {
    await collectSorftimeResource(request(), { token, env: {}, connectSorftime: async () => { throw new Error(`fetch https://mcp.sorftime.com/?key=${token}`); } });
    assert.fail('expected credential scrubbed error');
  } catch (error) {
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes('key='), false);
    assert.equal(error.cause, undefined);
  }
});
