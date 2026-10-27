import assert from 'node:assert/strict';
import test from 'node:test';

import { scanSite } from './competitor-monitor-providers.mjs';
import { normalizeProduct } from './product-jobs.mjs';
import { canonicalCatalogUrl, fallbackProductUrls, runProductsJob } from './product-queue.mjs';
import { fetchWestmonthCatalog, westmonthEntry } from './westmonth-catalog.mjs';

const site = { id: 'VN-westmonth.com', domain: 'westmonth.com', market: 'VN', brand: '西之月', platform: '其他' };
const row = (id) => ({ product_id: id, product_name: `Test item ${id}`, product_image: 'https://oss.westmonth.com/example.png', product_addtime: '2026-10-01 12:00:00', real_price: 0, total_sale: 400, month_sale: 200 });
const response = (rows, page = 1, total = rows.length) => ({ html: JSON.stringify({ code: 0, data: { page, pagesize: 60, total, data: rows } }), url: 'https://api-x.westmonth.com/product-center/shop/products/load-list' });

test('uses the public new-item feed with fixed host, bounded paging and no credentials', async () => {
  let requested;
  const page = await fetchWestmonthCatalog(westmonthEntry(true), site, async (url, _depth, types, options) => {
    requested = new URL(url);
    assert.deepEqual(types, ['application/json']);
    assert.deepEqual(options, { allowedDomain: 'westmonth.com' });
    return response([row(123)], 1, 61);
  });
  assert.equal(requested.hostname, 'api-x.westmonth.com');
  assert.equal(requested.searchParams.get('ranking_type'), 'new');
  assert.equal(page.catalogLinks.length, 1);
  assert.equal(new URL(page.catalogLinks[0]).searchParams.get('page'), '2');
  assert.equal(canonicalCatalogUrl(page.catalogLinks[0], 'https://www.westmonth.com'), 'https://www.westmonth.com/products/ranking?page=2&ranking_type=new');
  assert.deepEqual(fallbackProductUrls(site), [westmonthEntry()]);
});
test('unknown price, ambiguous sales and raw listing time do not become confirmed metrics', async () => {
  const page = await fetchWestmonthCatalog(westmonthEntry(), site, async () => response([row(123)]));
  const raw = page.catalogProducts[0];
  assert.equal(raw.price, undefined);
  assert.equal(raw.publishedAt, undefined);
  const item = normalizeProduct(raw, site);
  assert.equal(item.brand, '品牌未公开');
  assert.equal(item.sourceMetrics, undefined);
  assert.equal(item.decisionData, undefined);
  assert.equal(item.catalogListedAtRaw, '2026-10-01 12:00:00');
  assert.equal(item.catalogScope, '官网公开全部商品目录');
  assert.ok(item.catalogEvidenceUrl.startsWith('https://api-x.westmonth.com/'));
});
test('authentication, schema changes and missing pages fail instead of establishing an empty baseline', async () => {
  for (const body of [{ code: 10001, data: [] }, { code: 0, data: { data: [] } }, { code: 0, data: { page: 1, pagesize: 60, total: 5, data: [] } }])
    await assert.rejects(fetchWestmonthCatalog(westmonthEntry(), site, async () => ({ html: JSON.stringify(body) })), /异常|缺失/);
  await assert.rejects(fetchWestmonthCatalog('https://other.example/products/all', site, async () => {}));
});
test('monitor resumes new-feed pages across request budgets before completing a baseline', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    return new URL(url).searchParams.get('page') === '1'
      ? response(Array.from({ length: 60 }, (_, i) => row(i + 1)), 1, 61)
      : response([row(61)], 2, 61);
  };
  const request = async (_key, call) => call();
  const first = await scanSite(site, request, 1, fetcher, null, async () => {});
  assert.equal(first.complete, false);
  assert.equal(first.items.length, 60);
  const second = await scanSite(site, request, 1, fetcher, first.progress, async () => {});
  assert.equal(second.complete, true);
  assert.equal(second.items.length, 1);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((url) => new URL(url).searchParams.get('ranking_type') === 'new'));
});

test('the normal product job saves public Westmonth items within its product and request limits', async () => {
  const items = new Map();
  let saved;
  const job = { id: 'synthetic-westmonth', input: { kind: 'products', records: [site], siteIds: [site.id], markets: ['VN'], maxProducts: 2, maxDetailProducts: 0, maxRequests: 3, maxRequestsPerSite: 3, collectionPolicyVersion: 4, maxBrowserPages: 0, maxPaidRequests: 0 }, checkpoint: {} };
  await runProductsJob(job, {
    now: () => Date.now(), random: () => 0, cancelled: async () => false,
    getHostGate: async () => ({}), setHostGate: async () => {},
    patchSite: async () => {}, linkKeywords: async () => {}, readProduct: async () => undefined,
    mergeBusiness: async (key, item) => items.set(key, item),
    saveCheckpoint: async (_job, cp, status) => { saved = structuredClone({ cp, status }); },
    fetchPage: async (url) => { assert.equal(new URL(url).hostname, 'api-x.westmonth.com'); return response([row(1), row(2), row(3)]); },
    fetchFallback: async () => { throw new Error('No fallback calls expected'); },
  });
  assert.equal(items.size, 2);
  assert.equal(saved.cp.requests, 1);
  assert.equal(saved.cp.products, 2);
  assert.ok([...items.values()].every((item) => item.catalogEvidenceUrl && item.market === 'VN'));
});
