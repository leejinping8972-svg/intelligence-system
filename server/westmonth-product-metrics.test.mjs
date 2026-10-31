import assert from 'node:assert/strict';
import test from 'node:test';

import { discoveryDecision } from './discovery-newness.mjs';
import { mergeObserved } from './competitor-monitor-domain.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { enrichPublicProduct } from './product-public-enrichment.mjs';
import { fetchWestmonthProduct, westmonthMetricPatch, westmonthProductId } from './westmonth-product-metrics.mjs';

const at = '2026-10-28T03:00:00.000Z';
const evidenceUrl = 'https://api-x.westmonth.com/product-center/shop/products/load-list?page=1';
const row = { product_id: 123, product_addtime: '2026-10-10 09:47:07', month_sale: 3000, total_sale: 9000, total_sale_qty: 5432 };
const product = { id: 'VN-qa', market: 'VN', title: 'QA mascara', evidenceUrl: 'https://www.westmonth.com/products/123', imageUrl: 'https://oss.westmonth.com/products/images/SKU00052853/image.png', catalogEvidenceUrl: evidenceUrl + '&source=rankings' };
const body = (rows) => ({ html: JSON.stringify({ code: 0, data: { total: rows.length, data: rows } }) });
const detail = (patch = {}) => ({ html: JSON.stringify({ code: 0, data: { id: 123, onsale_at: row.product_addtime, month_sale: '3000+', ...patch } }) });

test('listing date and sales follow the official card, preserve plus and do not use other sales fields', () => {
  const patch = westmonthMetricPatch(row, { market: 'VN', at, evidenceUrl });
  assert.equal(patch.decisionData.listing.date, '2026-10-10');
  assert.equal(patch.decisionData.listing.rawDate, row.product_addtime);
  assert.equal(discoveryDecision({ ...product, ...patch }, 'product', Date.parse(at)).evidenceDate, '2026-10-10');
  assert.equal(patch.sourceMetrics.soldRaw, '3000+');
  assert.equal(patch.sourceMetrics.soldPrecision, 'lower_bound');
  assert.equal(patch.sourceMetrics.soldPeriod, 'unspecified');
  assert.equal(patch.sourceMetrics.soldCount, undefined);
  assert.equal(patch.sourceMetrics.monthlySales, undefined);
  for (const [raw, expected] of [[0, '0+'], ['3000+', '3000+'], ['3,000+', '3,000+'], ['3000', '3000+']])
    assert.equal(westmonthMetricPatch({ month_sale: raw }, { market: 'VN', at, evidenceUrl }).sourceMetrics.soldRaw, expected);
});

test('missing and invalid source values remain missing, including future dates and other sales keys', () => {
  for (const product_addtime of ['', null, '2026-02-30', '2026-10-29 00:00:00', '2026-10-01 29:00:00'])
    assert.equal(westmonthMetricPatch({ product_addtime }, { market: 'VN', at, evidenceUrl }).decisionData, undefined);
  for (const month_sale of [undefined, null, '', -1, 1.5, 'unknown', '3000++', '3-4'])
    assert.equal(westmonthMetricPatch({ month_sale, total_sale: 3000, total_sale_qty: 5000 }, { market: 'VN', at, evidenceUrl }).sourceMetrics, undefined);
});

test('only exact official numeric product URLs are accepted', () => {
  assert.equal(westmonthProductId(product.evidenceUrl + '?utm_source=qa'), '123');
  for (const value of ['https://westmonth.com.evil.example/products/123', 'https://api-x.westmonth.com/products/123', 'https://www.westmonth.com/products/all', 'https://user:pass@westmonth.com/products/123', 'http://westmonth.com/products/123'])
    assert.equal(westmonthProductId(value), '');
});

test('completion uses one anonymous GET for the exact product id and retains the plus from the detail', async () => {
  const calls = [];
  const result = await enrichPublicProduct({ product }, { now: Date.parse(at), maxPages: 1, fetchPage: async (url, depth, types, options) => {
    calls.push(url);
    const requested = new URL(url);
    assert.equal(requested.origin, 'https://api-x.westmonth.com');
    assert.equal(requested.pathname, '/product-center/shop/products/detail');
    assert.equal(requested.searchParams.get('product_id'), '123');
    assert.equal(depth, 0);
    assert.deepEqual(types, ['application/json']);
    assert.deepEqual(options, { allowedDomain: 'westmonth.com', manualRedirect: true });
    return detail();
  } });
  assert.equal(calls.length, 1);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.empty, false);
  assert.equal(result.patch.sourceMetrics.soldRaw, '3000+');
  assert.equal(result.patch.publicDataEvidence.listing.status, 'observed');
  assert.equal(result.patch.publicDataEvidence.sold.status, 'observed');
  assert.equal(result.patch.decisionData.listing.evidenceUrl, calls[0]);
});

test('wrong product, login, redirects and rate limits preserve existing values', async () => {
  const existing = { ...product, favorite: true, reviewed: true, ingredient: 'Saved formula', size: '60 pcs',
    sourceMetrics: { soldRaw: '2000+', soldPrecision: 'lower_bound', rating: 4.7 },
    decisionData: { listing: { date: '2026-09-01', provider: 'Prior', platform: '西之月', market: 'VN', collectedAt: at, evidenceUrl: product.evidenceUrl }, series: [] },
  };
  for (const response of [detail({ id: 999 }), body([row, row]), { html: '{"code":10001}' }, { redirect: 'https://www.westmonth.com/login' }, Object.assign(new Error('private error text'), { status: 429 })]) {
    const result = await enrichPublicProduct({ product: existing }, { now: Date.parse(at), fetchPage: async () => {
      if (response instanceof Error) throw response;
      return response;
    } });
    assert.equal(result.empty, true);
    assert.equal(result.patch.sourceMetrics, undefined);
    assert.equal(result.patch.decisionData, undefined);
    assert.equal(result.patch.publicDataEvidence.listing.status, 'preserved');
    assert.equal(result.patch.publicDataEvidence.sold.status, 'preserved');
    assert.equal(JSON.stringify(result).includes('private error text'), false);
  }
  const updated = mergePlatformProduct(existing, { id: existing.id, ...westmonthMetricPatch(row, { market: 'VN', at, evidenceUrl }) });
  assert.equal(updated.sourceMetrics.soldRaw, '3000+');
  assert.equal(updated.sourceMetrics.rating, 4.7);
  for (const key of ['favorite', 'reviewed', 'ingredient', 'size']) assert.deepEqual(updated[key], existing[key]);
  await assert.rejects(fetchWestmonthProduct({ ...product, evidenceUrl: 'https://evil.example/products/123' }, async () => { throw new Error('must not fetch'); }), /精确链接/);
});

test('daily Westmonth observations update the two fields and preserve human and enriched data', () => {
  const metrics = westmonthMetricPatch(row, { market: 'VN', at, evidenceUrl });
  const old = { ...product, favorite: true, reviewed: true, size: 'Saved size',
    sourceMetrics: { soldRaw: '1000+', rating: 4.5 }, decisionData: { series: [{ marker: 'preserve' }] },
  };
  const updated = mergeObserved(old, { ...product, ...metrics, siteId: 'VN-westmonth.com', favorite: false, size: '官网未公开' }, at);
  assert.equal(updated.sourceMetrics.soldRaw, '3000+');
  assert.equal(updated.sourceMetrics.rating, 4.5);
  assert.equal(updated.decisionData.listing.date, '2026-10-10');
  assert.deepEqual(updated.decisionData.series, old.decisionData.series);
  assert.equal(updated.favorite, true);
  assert.equal(updated.reviewed, true);
  assert.equal(updated.size, 'Saved size');
});

test('completion writes already captured catalog listing with its original evidence even on a detail failure', async () => {
  const p = { ...product, catalogListedAtRaw: '2026-10-09 09:00:00', lastCollectedAt: '2026-10-27T00:00:00Z' };
  const result = await enrichPublicProduct({ product: p }, { now: Date.parse(at), fetchPage: async () => { throw Object.assign(new Error('HTTP 429'), { status: 429 }); } });
  assert.equal(result.patch.decisionData.listing.date, '2026-10-09');
  assert.equal(result.patch.decisionData.listing.collectedAt, p.lastCollectedAt);
  assert.equal(result.patch.decisionData.listing.evidenceUrl, p.catalogEvidenceUrl);
  assert.equal(result.patch.sourceMetrics, undefined);
  assert.equal(result.patch.publicDataEvidence.sold.reason, 'rate_limited');
});
