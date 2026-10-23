import assert from 'node:assert/strict';
import test from 'node:test';

import { discoveryDecision } from './discovery-newness.mjs';
import { enrichPublicProduct, publicProductUrl } from './product-public-enrichment.mjs';

const now = Date.parse('2026-10-23T05:00:00Z');
const url = 'https://brand.example/products/qa-supplement';
const product = (patch = {}) => ({ id: 'qa-1', title: 'QA Supplement', market: 'US', evidenceUrl: url, ...patch });
const script = (value, type = 'application/ld+json') => '<script type="' + type + '">' + JSON.stringify(value) + '</script>';
const html = (value) => '<html><head><link rel="canonical" href="' + url + '"></head><body>' + value + '</body></html>';
const node = (patch = {}) => ({ '@type': 'Product', name: 'QA Supplement', url, ...patch });
const read = (pages) => {
  const calls = [];
  return {
    calls,
    fetchPage: async (value, _depth, types, options) => {
      calls.push({ url: value, types, options });
      assert.equal(options.manualRedirect, true);
      assert.equal(options.allowedDomain, 'brand.example');
      const page = pages.shift();
      assert.ok(page, 'No unplanned requests');
      if (page instanceof Error) throw page;
      return typeof page === 'string' ? { html: page, url: value } : page;
    },
  };
};

test('public URL planning requires a product destination and excludes platform and merchant landing records', () => {
  assert.equal(publicProductUrl(product()), url);
  assert.equal(publicProductUrl(product({ evidenceUrl: url + '?utm_source=qa&variant=1#x' })), url + '?variant=1');
  for (const evidenceUrl of ['https://brand.example', 'https://brand.example/collections', 'https://brand.example/products.json', 'https://localhost/product/x', 'http://127.0.0.1/product/x', 'https://amazon.com.mx/product/x', 'https://shopee.vn/product/x'])
    assert.equal(publicProductUrl(product({ evidenceUrl })), '', evidenceUrl);
  assert.equal(publicProductUrl(product({ sourceProvider: 'Sorftime' })), '');
  assert.equal(publicProductUrl(product({ sourcePlatform: 'TikTok Shop' })), '');
  assert.equal(publicProductUrl(product({ sourceProvider: 'Semrush', evidenceUrl: 'https://brand.example/shop' })), '');
  assert.equal(publicProductUrl(product({ sourceProvider: 'Semrush' })), url);
});

test('exact JSON-LD publishes source-backed listing date and cumulative unit sales including zero', async () => {
  for (const sold of [0, '1,234']) {
    const reader = read([html(script(node({ datePublished: '2020-02-29T09:00:00Z', numberOfItemsSold: sold }))) ]);
    const result = await enrichPublicProduct({ product: product() }, { ...reader, now });
    assert.equal(result.providerCalls, 1);
    assert.equal(result.patch.id, 'qa-1');
    assert.equal(result.patch.decisionData.listing.date, '2020-02-29');
    assert.equal(result.patch.decisionData.listing.sourceField, 'Product JSON-LD.datePublished');
    assert.equal(discoveryDecision({ ...product(), ...result.patch }, 'product', now).evidenceDate, '2020-02-29');
    assert.equal(result.patch.sourceMetrics.soldCount, sold === 0 ? 0 : 1234);
    assert.equal(result.patch.sourceMetrics.soldProvider, '官网公开商品数据');
    assert.equal(result.patch.sourceMetrics.soldPlatform, '官网');
    assert.equal(result.patch.sourceMetrics.soldEvidenceUrl, url);
    assert.equal(result.patch.publicDataEvidence.listing.status, 'observed');
    assert.equal(result.patch.publicDataEvidence.sold.status, 'observed');
    assert.equal(result.empty, false);
    assert.equal(result.patch.sourceProvider, undefined);
    assert.equal(reader.calls.length, 1);
  }
});

test('nested graph and URL-less product require exact canonical title binding', async () => {
  const matched = node({ datePublished: '2026-09-01', sold_count: 25 });
  delete matched.url;
  const good = await enrichPublicProduct({ product: product() }, { ...read([html(script({ '@graph': [matched] }))]), now });
  assert.equal(good.patch.sourceMetrics.soldCount, 25);
  const bad = await enrichPublicProduct({ product: product() }, { ...read([html(script({ '@graph': [matched, node({ url: 'https://brand.example/products/other' })] }))]), now });
  assert.equal(bad.patch.decisionData, undefined);
  assert.equal(bad.patch.sourceMetrics, undefined);
});

test('recommendations, articles, creation/update dates and review or order counts never fill the missing fields', async () => {
  const value = [
    node({ url: 'https://brand.example/products/recommendation', datePublished: '2026-09-01', sold_count: 500 }),
    { '@type': 'Article', url, datePublished: '2026-09-01', sold_count: 600 },
    node({ dateCreated: '2026-09-01', dateModified: '2026-10-01', aggregateRating: { reviewCount: 700 }, orderCount: 800, monthlySales: 900, sales: 1000 }),
  ];
  const result = await enrichPublicProduct({ product: product({ firstSeenAt: '2026-10-23T00:00:00Z' }) }, { ...read([html(script(value))]), now });
  assert.equal(result.empty, true);
  assert.equal(result.patch.decisionData, undefined);
  assert.equal(result.patch.sourceMetrics, undefined);
  assert.equal(result.patch.publicDataEvidence.listing.status, 'missing');
  assert.equal(result.patch.publicDataEvidence.sold.reason, 'not_publicly_provided');
});

test('invalid/future dates, rounded/range/negative sales and monthly periods stay unknown', async () => {
  for (const data of [
    { datePublished: '2026-02-30', sold_count: '1.2K' },
    { datePublished: '2026-10-24', sold_count: '100+' },
    { datePublished: '2026-10-23T06:00:00Z', sold_count: -1 },
    { datePublished: 'unknown', sold_count: 321, period: 'monthly' },
    { datePublished: 'unknown', numberOfItemsSold: { value: 321, unitCode: 'USD' } },
    { datePublished: 'unknown', sold_count: '12-34' },
  ]) {
    const result = await enrichPublicProduct({ product: product() }, { ...read([html(script(node(data)))]), now });
    assert.equal(result.empty, true);
    assert.equal(result.patch.decisionData, undefined);
    assert.equal(result.patch.sourceMetrics, undefined);
  }
});

test('conflicting exact public values remain missing and never silently choose a recommendation', async () => {
  const result = await enrichPublicProduct({ product: product() }, { ...read([html(script([
    node({ datePublished: '2026-09-01', soldCount: 1 }),
    node({ datePublished: '2026-10-01', soldCount: 2 }),
  ]))]), now });
  assert.equal(result.empty, true);
  assert.equal(result.patch.publicDataEvidence.listing.reason, 'conflicting_public_values');
  assert.equal(result.patch.publicDataEvidence.sold.reason, 'conflicting_public_values');
});

test('Shopify embedded product JSON and one bounded same-product endpoint provide missing publication', async () => {
  const reader = read([
    html('<script>Shopify.shop = "brand.example";</script>' + script(node({ dateModified: '2026-09-01' }))),
    JSON.stringify({ handle: 'qa-supplement', title: 'QA Supplement', published_at: '2018-05-06T00:00:00Z', created_at: '2014-01-01', sold_count: 42 }),
  ]);
  const result = await enrichPublicProduct({ product: product() }, { ...reader, now });
  assert.equal(result.providerCalls, 2);
  assert.equal(reader.calls[1].url, 'https://brand.example/products/qa-supplement.js');
  assert.equal(result.patch.decisionData.listing.date, '2018-05-06');
  assert.equal(result.patch.sourceMetrics.soldCount, 42);
  assert.equal(result.patch.decisionData.listing.evidenceUrl, reader.calls[1].url);
  const embedded = await enrichPublicProduct({ product: product() }, { ...read([html(script({ product: { handle: 'qa-supplement', title: 'QA Supplement', published_at: '2025-04-03', soldCount: 1 } }, 'application/json'))]), now });
  assert.equal(embedded.providerCalls, 1);
  assert.equal(embedded.patch.decisionData.listing.date, '2025-04-03');
});

test('Shopify endpoint mismatching handle or URL cannot replace original product', async () => {
  for (const returned of [
    { handle: 'another-product', title: 'QA Supplement', published_at: '2026-01-01', sold_count: 1 },
    { handle: 'qa-supplement', title: 'QA Supplement', url: 'https://brand.example/products/another-product', published_at: '2026-01-01', sold_count: 1 },
  ]) {
    const result = await enrichPublicProduct({ product: product() }, { ...read([html('<script src="https://cdn.shopify.com/theme.js"></script>'), JSON.stringify(returned)]), now });
    assert.equal(result.providerCalls, 2);
    assert.equal(result.empty, true);
    assert.equal(result.patch.sourceMetrics, undefined);
  }
});

test('request budget and redirect budget are bounded; cross-domain/product redirects are not followed', async () => {
  const limited = read([html('<script src="https://cdn.shopify.com/theme.js"></script>')]);
  const result = await enrichPublicProduct({ product: product() }, { ...limited, now, maxRequests: 1 });
  assert.equal(result.providerCalls, 1);
  assert.equal(result.patch.publicDataEvidence.listing.reason, 'request_limit');
  assert.equal(result.patch.publicDataEvidence.sold.reason, 'request_limit');
  for (const redirect of ['https://other.example/products/qa-supplement', 'https://brand.example/products/another', 'http://brand.example/products/qa-supplement']) {
    const reader = read([{ redirect }]);
    const redirected = await enrichPublicProduct({ product: product() }, { ...reader, now });
    assert.equal(redirected.providerCalls, 1);
    assert.equal(redirected.patch.publicDataEvidence.listing.reason, 'product_redirect_mismatch');
  }
  const redirected = read([{ redirect: url }, { redirect: url }]);
  const exhausted = await enrichPublicProduct({ product: product() }, { ...redirected, now });
  assert.equal(exhausted.providerCalls, 2);
  assert.equal(exhausted.patch.publicDataEvidence.requests, 2);
  assert.equal(exhausted.empty, true);
});

test('failures and empty reads keep old values and expose missing source evidence without copying exception text', async () => {
  const existing = product({
    decisionData: { listing: { date: '2020-01-01', provider: 'Prior', platform: '官网', market: 'US', collectedAt: '2026-10-22T00:00:00Z', evidenceUrl: url } },
    sourceMetrics: { soldCount: 123, soldRaw: '123' },
  });
  const error = Object.assign(new Error('secret token must not be echoed'), { status: 429 });
  const result = await enrichPublicProduct({ product: existing }, { ...read([error]), now });
  assert.equal(result.providerCalls, 1);
  assert.equal(result.patch.sourceMetrics, undefined);
  assert.equal(result.patch.decisionData, undefined);
  assert.equal(result.patch.publicDataEvidence.listing.status, 'preserved');
  assert.equal(result.patch.publicDataEvidence.sold.status, 'preserved');
  assert.equal(result.patch.publicDataEvidence.sold.reason, 'rate_limited');
  assert.equal(JSON.stringify(result).includes('secret token'), false);
  const unsupported = await enrichPublicProduct({ product: product({ evidenceUrl: 'https://brand.example' }) }, { ...read([]), now });
  assert.equal(unsupported.providerCalls, 0);
  assert.equal(unsupported.patch.publicDataEvidence.listing.reason, 'unsupported_product_url');
});


test('original official crawler persists exact source dates and sales with their original field names', async () => {
  const { productFromJsonLd } = await import('./collector.js');
  const { normalizeProduct } = await import('./product-jobs.mjs');
  const { shopifyCatalogProducts } = await import('./product-queue.mjs');
  const site = { id: 'site', domain: 'brand.example', market: 'US', brand: 'QA', platform: 'Shopify' };
  for (const sold of [0, '1,234']) {
    const parsed = productFromJsonLd(node({ datePublished: '2020-02-29', soldCount: sold, sales: 888, aggregateRating: { reviewCount: 999 } }), url, 'US', 'QA');
    const saved = normalizeProduct(parsed, site, new Date(now).toISOString());
    assert.equal(saved.decisionData.listing.date, '2020-02-29');
    assert.equal(saved.decisionData.listing.sourceField, 'Product JSON-LD.datePublished');
    assert.equal(saved.sourceMetrics.soldCount, sold === 0 ? 0 : 1234);
    assert.equal(saved.sourceMetrics.soldSourceField, 'Product JSON-LD.soldCount');
    assert.equal(saved.sourceMetrics.soldProvider, '官网公开商品数据');
    assert.equal(saved.sourceMetrics.soldRaw, sold === 0 ? '0' : '1,234');
  }
  const [parsed] = shopifyCatalogProducts({ products: [{ handle: 'qa-supplement', title: 'QA Supplement', published_at: '2018-02-03', sold_count: 12, variants: [] }] }, 'https://brand.example', site);
  const saved = normalizeProduct(parsed, site, new Date(now).toISOString());
  assert.equal(saved.decisionData.listing.date, '2018-02-03');
  assert.equal(saved.decisionData.listing.sourceField, 'Shopify catalog JSON.published_at');
  assert.equal(saved.sourceMetrics.soldSourceField, 'Shopify catalog JSON.sold_count');
  assert.equal(saved.sourceMetrics.soldCount, 12);
  const unknown = normalizeProduct(productFromJsonLd(node({ dateCreated: '2018-01-01', sales: 1200, reviewCount: 123, sold_count: '12.3K' }), url, 'US', 'QA'), site, new Date(now).toISOString());
  assert.equal(unknown.decisionData, undefined);
  assert.equal(unknown.sourceMetrics, undefined);
});

test('worker and server public field helpers have matching conservative extraction behavior', async () => {
  const { publicProductFields: bundled } = await import('./collector.js');
  const { publicProductFields: source } = await import('../workers/site-discovery/src/product-public-fields.js');
  for (const row of [
    { published_at: '2020-02-29', sold_count: 0 },
    { datePublished: '2026-02-30', dateModified: '2026-10-20', sales: 123, reviewCount: 12 },
    { releaseDate: '2020-01-01', numberOfItemsSold: { value: '1,234', unitCode: 'C62' } },
    { soldCount: 100, soldPeriod: 'monthly' },
    { soldCount: 100, period: 'cumulative' },
  ]) assert.deepEqual(bundled(row), source(row));
});

test('public evidence failure reasons have readable Chinese wording and safe fallback', async () => {
  const { publicEvidenceReason, publicEvidenceReasons } = await import('./product-public-evidence.mjs');
  for (const reason of Object.keys(publicEvidenceReasons)) assert.match(publicEvidenceReason(reason), /[\u4e00-\u9fff]/);
  assert.match(publicEvidenceReason('unknown_reason'), /[\u4e00-\u9fff]/);
});
