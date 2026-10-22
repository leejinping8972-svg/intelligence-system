import assert from 'node:assert/strict';
import test from 'node:test';

import { productResourceRequest } from './product-resource-provider.mjs';
import {
  collectPublicProductResource,
  isResourceUrl,
  parsePublicProductResource,
  resourceHosts,
  searchProductResourceLeads,
} from './product-resource-public.mjs';

const at = '2026-10-22T12:00:00.000Z';
const html = (data, extra = '') => `<html><head><title>Products</title><script type="application/ld+json">${JSON.stringify(data)}</script>${extra}</head><body></body></html>`;
const request = (value = {}) => ({
  platform: 'website',
  market: 'US',
  websiteDomain: 'example.com',
  url: 'https://example.com/products/one',
  limit: 20,
  ...value,
});
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];

test('platform and market allowlists reject cross-country, arbitrary hosts and unsafe URLs', () => {
  assert.deepEqual(resourceHosts('shopee', 'VN'), ['shopee.vn']);
  assert.deepEqual(resourceHosts('shopee', 'MX'), []);
  assert.deepEqual(resourceHosts('mercadolibre', 'MX'), ['mercadolibre.com.mx']);
  assert.deepEqual(resourceHosts('mercado_libre', 'US'), []);
  assert.deepEqual(resourceHosts('temu', 'VN'), []);
  assert.equal(isResourceUrl('https://www.amazon.com/dp/B012345678', 'amazon', 'MX'), false);
  assert.equal(isResourceUrl('https://amazon.com.evil.com/dp/B012345678', 'amazon', 'US'), false);
  assert.equal(isResourceUrl('https://user:pass@www.amazon.com/', 'amazon', 'US'), false);
  assert.equal(isResourceUrl('https://127.0.0.1/', 'website', 'US', '127.0.0.1'), false);
  assert.equal(isResourceUrl('http://www.amazon.com/', 'amazon', 'US'), false);
  assert.equal(isResourceUrl('https://www.amazon.com:444/', 'amazon', 'US'), false);
  assert.equal(isResourceUrl('https://shop.example.com/products/one', 'website', 'US', 'example.com'), true);
  assert.equal(isResourceUrl('https://example.com/products/one', 'website', 'US'), false);
  assert.equal(isResourceUrl('https://www.temu.com/mx-es/item-g-123.html', 'temu', 'US'), false);
  assert.equal(isResourceUrl('https://www.temu.com/us/item-g-123.html', 'temu', 'MX'), false);
});

test('Brave uses one bounded page, existing credentials and leads-only results', async () => {
  const calls = [];
  const result = await searchProductResourceLeads({
    platform: 'shopee', market: 'VN', term: 'vitamin', page: 2, limit: 100,
  }, {
    collectorEnv: async () => ({ BRAVE_SEARCH_API_KEY: 'synthetic-key' }),
    fetcher: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return new Response(JSON.stringify({
        query: { more_results_available: true },
        web: { results: [
          { title: 'Vitamin', url: 'https://shopee.vn/vitamin-i.123.456?utm_source=x', description: 'sold 99999' },
          { title: 'Duplicate', url: 'https://shopee.vn/vitamin-i.123.456' },
          { title: 'Wrong country', url: 'https://shopee.com.mx/item' },
          { title: 'Wrong host', url: 'https://example.com/item' },
        ] },
      }));
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.searchParams.get('country'), 'ALL');
  assert.equal(calls[0].url.searchParams.get('search_lang'), 'vi');
  assert.equal(calls[0].url.searchParams.get('count'), '20');
  assert.equal(calls[0].url.searchParams.get('offset'), '1');
  assert.match(calls[0].url.searchParams.get('q'), /site:shopee\.vn/);
  assert.equal(calls[0].options.headers['x-loc-country'], 'VN');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].url, 'https://shopee.vn/vitamin-i.123.456');
  assert.equal(result.leads[0].description, undefined);
  assert.deepEqual(result.products, []);
  assert.deepEqual(result.usage, { braveRequests: 1 });
  assert.equal(result.hasMore, true);
});

test('Brave caps pagination and never automatically replays HTTP429 or unknown results', async () => {
  let calls = 0;
  const io = {
    collectorEnv: async () => ({ BRAVE_SEARCH_API_KEY: 'synthetic-key' }),
    fetcher: async () => { calls++; return new Response('', { status: 429 }); },
  };
  await assert.rejects(searchProductResourceLeads({
    platform: 'amazon', market: 'US', term: 'x', page: 11,
  }, io), /第1至10页/);
  assert.equal(calls, 0);
  await assert.rejects(searchProductResourceLeads({
    platform: 'amazon', market: 'US', term: 'x', page: 1,
  }, io), (error) => {
    assert.equal(error.state, 'rate_limited');
    assert.deepEqual(error.usage, { braveRequests: 1 });
    return true;
  });
  assert.equal(calls, 1);
  await assert.rejects(searchProductResourceLeads({
    platform: 'amazon', market: 'US', term: 'x',
  }, { ...io, fetcher: async () => { throw new Error('synthetic-key'); } }),
  (error) => !error.message.includes('synthetic-key') && error.usage.braveRequests === 1);
});

test('Product keeps source identity, raw decimal, currency, seller and explicit formulation fields', () => {
  const result = parsePublicProductResource(html({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList', itemListElement: [
          { position: 1, name: 'Home', item: 'https://example.com/' },
          { position: 2, name: 'Vitamins', item: { '@id': 'https://example.com/vitamins' } },
          { position: 3, name: 'Gummies', item: 'https://example.com/products/one' },
        ],
      },
      {
        '@type': 'Product', name: 'Gummies', sku: 'sku-1', productID: 'item-1',
        description: 'Formulation marketing is not a measured sale', brand: { name: 'Brand' },
        image: ['https://images.example.com/one.png'],
        additionalProperty: [
          { '@type': 'PropertyValue', name: 'Ingredients', value: 'Vitamin C 100 mg' },
          { '@type': 'PropertyValue', name: 'Serving Size', value: '2 gummies' },
          { '@type': 'PropertyValue', name: 'Unit Count', value: '60 gummies' },
        ],
        offers: { '@type': 'Offer', price: '12.3400', priceCurrency: 'USD', seller: { name: 'Shop', identifier: 'seller-1' } },
      },
    ],
  }), request(), { at });
  assert.equal(result.products.length, 1);
  assert.equal(result.collectedAt, at);
  const product = result.products[0];
  assert.equal(product.sourceProductId, 'item-1');
  assert.equal(product.sourceVariantId, 'sku-1');
  assert.equal(product.price, 12.34);
  assert.equal(product.currency, 'USD');
  assert.equal(product.sourceMetrics.priceRaw, '12.3400');
  assert.equal(product.sourceMetrics.priceDecimalPlaces, 4);
  assert.equal(product.sourceMetrics.shopId, 'seller-1');
  assert.equal(product.ingredient, 'Vitamin C 100 mg');
  assert.equal(product.dose, '2 gummies');
  assert.equal(product.size, '60 gummies');
  assert.equal(product.sourceCategoryId, 'https://example.com/vitamins');
  assert.equal(product.sourceCategory.breadcrumbPath.length, 3);
  assert.equal(product.resourceRaw.priceRaw, '12.3400');
  assert.equal(product.resourceRaw.pricePrecision, 'source_decimal');
  assert.equal(product.resourceRaw.shopId, 'seller-1');
  assert.equal(product.resourceRaw.variantId, 'sku-1');
  assert.deepEqual(product.resourceRaw.category.path, ['Home', 'Vitamins']);
  assert.equal(product.resourceRaw.category.evidencePath.at(-1).url, 'https://example.com/vitamins');
  assert.deepEqual(product.resourceRaw.variants, [{ sku: 'sku-1', productID: 'item-1' }]);
  assert.equal(product.sourceMetrics.soldCount, undefined);
  assert.equal(product.sourceMetrics.orderCount, undefined);
  assert.deepEqual(product.decisionData.series, []);
  assert.equal(product.resourceRaw.marketEvidence, 'research_scope_only');
});

test('missing or range prices and absent currency remain unknown rather than zero or guessed currency', () => {
  const missing = parsePublicProductResource(html({ '@type': 'Product', name: 'One', sku: 'one' }), request());
  assert.equal(Object.hasOwn(missing.products[0], 'price'), false);
  assert.equal(Object.hasOwn(missing.products[0], 'currency'), false);
  const range = parsePublicProductResource(html({
    '@type': 'Product', name: 'One', offers: { '@type': 'AggregateOffer', lowPrice: '10.00', highPrice: '25.00', priceCurrency: 'USD' },
  }), request());
  assert.equal(range.products[0].price, undefined);
  assert.equal(range.products[0].sourceMetrics.priceRange.lowRaw, '10.00');
  const unknownCurrency = parsePublicProductResource(html({
    '@type': 'Product', name: 'One', offers: { price: '123' },
  }), request());
  assert.equal(unknownCurrency.products[0].price, undefined);
  assert.equal(unknownCurrency.products[0].sourceMetrics.priceRaw, '123');
});

test('same-title variants stay distinct and only explicit Product nodes become products', () => {
  const result = parsePublicProductResource(html({
    '@type': 'ProductGroup', productGroupID: 'group-1', hasVariant: [
      { '@type': 'Product', name: 'Same title', url: '/products/one', sku: 'small', inProductGroupWithID: 'group-1' },
      { '@type': 'Product', name: 'Same title', url: '/products/one', sku: 'large', inProductGroupWithID: 'group-1' },
    ],
  }), request());
  assert.equal(result.products.length, 2);
  assert.notEqual(result.products[0].id, result.products[1].id);
  assert.equal(result.products[0].sourceParentProductId, 'group-1');
  const unstructured = parsePublicProductResource('<h1>Product for $99; sold 500</h1>', request());
  assert.equal(unstructured.products.length, 0);
  assert.equal(unstructured.empty, true);
});

test('source IDs and local variant identities stay stable when unrelated Product nodes are added', () => {
  const row = { '@type': 'Product', name: 'Same title', url: '/dp/B012345678', sku: 'small', productID: 'supplier-small' };
  const req = request({ platform: 'amazon', url: 'https://www.amazon.com/dp/B012345678' });
  const one = parsePublicProductResource(html(row), req).products[0];
  const many = parsePublicProductResource(html([
    row,
    { ...row, sku: 'large', productID: 'supplier-large' },
    { ...row, sku: undefined, productID: 'supplier-only' },
  ]), req).products;
  assert.equal(many.length, 3);
  assert.equal(new Set(many.map((item) => item.id)).size, 3);
  assert.equal(many[0].id, one.id);
  assert.deepEqual(many.map((item) => item.sourceProductId), ['B012345678', 'B012345678', 'B012345678']);
  assert.deepEqual(many.map((item) => item.sourceVariantId), ['small', 'large', 'supplier-only']);
  const bare = parsePublicProductResource(html({ ...row, url: 'https://amazon.com/dp/B012345678' }), { ...req, url: 'https://amazon.com/dp/B012345678' }).products[0];
  assert.equal(bare.id, one.id);
});

test('variant breadcrumbs remove only an actual current product, not a category containing one Product', () => {
  const trail = { '@type': 'BreadcrumbList', itemListElement: [
    { position: 1, name: 'Home', item: 'https://example.com/' },
    { position: 2, name: 'Vitamins', item: 'https://example.com/vitamins' },
    { position: 3, name: 'Product', item: 'https://example.com/products/one' },
  ] };
  const variants = parsePublicProductResource(html([
    trail,
    { '@type': 'Product', name: 'One', url: '/products/one', sku: 'small' },
    { '@type': 'Product', name: 'One', url: '/products/one', sku: 'large' },
  ]), request());
  assert.deepEqual(variants.products[0].resourceRaw.category.path, ['Home', 'Vitamins']);
  const category = parsePublicProductResource(html([
    { ...trail, itemListElement: trail.itemListElement.slice(0, 2) },
    { '@type': 'Product', name: 'One', url: '/products/one', sku: 'small' },
  ]), request({ url: 'https://example.com/vitamins' }));
  assert.deepEqual(category.products[0].resourceRaw.category.path, ['Home', 'Vitamins']);
});

test('ItemList and visible links are bounded leads, missing URLs cannot create undefined URLs', () => {
  const result = parsePublicProductResource(html({
    '@type': 'ItemList', itemListElement: [
      { '@type': 'ListItem', name: 'Only name' },
      { '@type': 'ListItem', item: { name: 'Two', url: '/products/two' } },
      { '@type': 'ListItem', item: { name: 'External', url: 'https://evil.com/products/three' } },
    ],
  }, '<link rel="next" href="/category?page=2">'), request({ limit: 1 }));
  assert.deepEqual(result.products, []);
  assert.equal(result.leads.length, 1);
  assert.equal(result.leads[0].url, 'https://example.com/products/two');
  assert.equal(result.nextUrl, 'https://example.com/category?page=2');
  assert.equal(result.hasMore, true);
  assert.equal(result.empty, false);
  const external = parsePublicProductResource('<link rel="next" href="https://evil.com/page2">', request());
  assert.equal(external.nextUrl, undefined);
});

test('malformed optional entries do not discard unrelated structured product evidence', () => {
  const result = parsePublicProductResource(html([
    { '@type': 'BreadcrumbList', itemListElement: [null, { position: 1, name: 'Home', item: 'https://example.com/' }] },
    { '@type': 'ItemList', itemListElement: [null, { name: 'Two', url: '/products/two' }] },
    { '@type': 'Product', name: 'One', offers: [null], additionalProperty: [null] },
  ]), request());
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].price, undefined);
  assert.equal(result.leads[0].url, 'https://example.com/products/two');
});

test('generic TikTok URLs require source sales-region evidence; Temu requires matching country', () => {
  const row = { '@type': 'Product', name: 'One', url: 'https://www.tiktok.com/shop/pdp/123456' };
  const tkRequest = request({ platform: 'tiktok_shop', market: 'VN', url: row.url });
  assert.equal(parsePublicProductResource(html(row), tkRequest).products.length, 0);
  assert.equal(parsePublicProductResource(html({ ...row, sale_region: 'US' }), tkRequest).products.length, 0);
  const confirmed = parsePublicProductResource(html({ ...row, sale_region: 'VN' }), tkRequest);
  assert.equal(confirmed.products.length, 1);
  assert.equal(confirmed.products[0].sourceProductId, '123456');
  const temu = { '@type': 'Product', name: 'One', url: 'https://www.temu.com/mx-es/item-g-123.html' };
  assert.throws(() => parsePublicProductResource(html(temu), request({ platform: 'temu', market: 'US', url: temu.url })), /国家路径与所选市场不一致/);
  assert.equal(parsePublicProductResource(html(temu), request({ platform: 'temu', market: 'MX', url: temu.url })).products.length, 1);
});

test('public transport validates DNS before reading and a redirect remains a separately budgeted lead', async () => {
  let reads = 0;
  await assert.rejects(collectPublicProductResource(request(), {
    resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    read: async () => { reads++; },
  }), (error) => error.state === 'blocked' && error.usage.publicRequests === 0);
  assert.equal(reads, 0);
  const result = await collectPublicProductResource(request(), {
    resolve: publicDns,
    read: async (url, addresses) => {
      reads++;
      assert.equal(url.hostname, 'example.com');
      assert.equal(addresses[0].address, '93.184.216.34');
      return { status: 302, location: '/products/two' };
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.leads[0].url, 'https://example.com/products/two');
  assert.deepEqual(result.usage, { publicRequests: 1 });
  await assert.rejects(collectPublicProductResource(request(), {
    resolve: publicDns, read: async () => ({ status: 302, location: 'https://evil.com/' }),
  }), (error) => error.state === 'blocked' && error.usage.publicRequests === 1);
});

test('cached public evidence keeps its original collection date and an empty result expires after fifteen minutes', async () => {
  const req = { ...request(), routeId: 'website-public', provider: 'public_web', op: 'public_page' };
  let saved, reads = 0;
  const io = {
    at,
    cache: {
      read: async () => saved,
      write: async (_key, value) => { saved = value; },
    },
    resolve: publicDns,
    read: async () => {
      reads++;
      return { status: 200, text: html({ '@type': 'Product', name: 'One', sku: 'one' }) };
    },
  };
  await productResourceRequest(req, io);
  const cached = await productResourceRequest(req, { ...io, at: '2026-10-23T12:00:00.000Z' });
  assert.equal(reads, 1);
  assert.equal(cached.cached, true);
  assert.equal(cached.collectedAt, at);
  assert.equal(cached.products[0].lastCollectedAt, at);
  saved = {
    at: new Date(Date.now() - 16 * 60_000).toISOString(),
    result: parsePublicProductResource('<title>No products</title>', req, { at }),
  };
  const refreshed = await productResourceRequest(req, io);
  assert.equal(reads, 2);
  assert.equal(refreshed.cached, undefined);
  assert.equal(refreshed.products.length, 1);
});

test('challenge, login and non-200 are explicit failures; Instagram stays content-only', async () => {
  for (const page of [
    '<title>Robot Check</title>',
    '<title>Sign in</title><input type="password">',
    '<title>Just a moment...</title><form id="challenge-form"></form>',
  ])
    await assert.rejects(collectPublicProductResource(request(), {
      resolve: publicDns, read: async () => ({ status: 200, text: page }),
    }), (error) => error.state === 'blocked' && error.usage.publicRequests === 1);
  await assert.rejects(collectPublicProductResource(request(), {
    resolve: publicDns, read: async () => ({ status: 429 }),
  }), (error) => error.state === 'rate_limited' && error.usage.publicRequests === 1);
  const instagram = await collectPublicProductResource(request({
    platform: 'instagram', url: 'https://www.instagram.com/reel/xyz/',
  }), { resolve: () => { throw new Error('must not fetch'); } });
  assert.deepEqual(instagram.products, []);
  assert.equal(instagram.leads[0].kind, 'content');
  assert.equal(instagram.usage.publicRequests, 0);
});
