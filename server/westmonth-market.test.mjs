import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchWestmonthCatalog, westmonthEntry } from './westmonth-catalog.mjs';
import { scanSite } from './competitor-monitor-providers.mjs';
import {
  canonicalCatalogUrl,
  initialProductWork,
  initializeProducts,
} from './product-queue.mjs';
import {
  westmonthCatalogScope,
  westmonthChannelKey,
  westmonthRegion,
} from './westmonth-market.mjs';
import { fetchWestmonthSavedPrice } from './westmonth-price.mjs';
import { westmonthMetricPatch } from './westmonth-product-metrics.mjs';
const site = {
  id: 'VN-westmonth.com',
  domain: 'westmonth.com',
  market: 'VN',
  brand: 'QA',
};
const response = (url, region = 9, total = 1, page = 1) => ({
  url,
  html: JSON.stringify({
    code: 0,
    data: {
      page,
      pagesize: 60,
      total,
      data: [
        {
          product_id: 123,
          product_sku_id: 456,
          delivery_region_id: region,
          product_name: 'QA item',
        },
      ],
    },
  }),
});
test('all configured markets reach the exact official delivery filter and retain it on the next page', async () => {
  for (const [market, id] of [
    ['VN', 9],
    ['US', 3],
    ['MX', 21],
  ]) {
    const entry = westmonthEntry(false, market);
    assert.equal(new URL(entry).searchParams.get('regionSelect'), String(id));
    const result = await fetchWestmonthCatalog(
      entry,
      { ...site, market },
      async (url) => {
        const q = new URL(url).searchParams;
        assert.equal(q.get('delivery_region_id'), String(id));
        assert.equal(q.get('source'), 'all_products');
        assert.equal(q.get('sort_field'), '3');
        assert.equal(q.get('sort_mode'), '2');
        return response(url, id, 61);
      },
    );
    assert.equal(
      new URL(result.catalogLinks[0]).searchParams.get('regionSelect'),
      String(id),
    );
    assert.match(
      canonicalCatalogUrl(result.catalogLinks[0], 'https://www.westmonth.com'),
      new RegExp('regionSelect=' + id),
    );
    assert.equal(result.catalogProducts[0].catalogDeliveryRegionId, id);
    assert.equal(result.catalogProducts[0].catalogSkuId, 456);
  }
  assert.throws(() => westmonthRegion('GB'), /停止/);
});
test('wrong request or response regions are rejected instead of archived as the chosen market', async () => {
  let calls = 0;
  await assert.rejects(
    fetchWestmonthCatalog(westmonthEntry(false, 'US'), site, async () => {
      calls++;
    }),
    /不一致/,
  );
  assert.equal(calls, 0);
  for (const region of [3, undefined])
    await assert.rejects(
      fetchWestmonthCatalog(westmonthEntry(), site, async (url) =>
        response(url, region === undefined ? null : region),
      ),
      /不匹配/,
    );
});
test('old unfiltered monitor progress restarts scoped coverage while preserving host cooldown', async () => {
  const old = {
    queue: ['https://www.westmonth.com/products/ranking?page=20'],
    visited: [westmonthEntry()],
    nextRunAt: 0,
  };
  const calls = [];
  const result = await scanSite(
    site,
    async (_key, fn) => fn(),
    1,
    async (url) => {
      calls.push(url);
      return response(url);
    },
    old,
    async () => {},
  );
  assert.equal(new URL(calls[0]).searchParams.get('page'), '1');
  assert.equal(new URL(calls[0]).searchParams.get('source'), 'all_products');
  assert.equal(result.complete, true);
  assert.equal(result.progress.catalogScopeKey, westmonthCatalogScope(site));
  const waiting = await scanSite(
    site,
    async () => {
      throw Error('no request expected');
    },
    1,
    async () => {},
    { ...old, nextRunAt: Date.now() + 60000 },
  );
  assert.equal(waiting.requests, 0);
  assert.match(waiting.progress.queue[0], /regionSelect=9/);
});
test('old active product work stops without replay or losing its counters and saved products', () => {
  const work = initialProductWork(site);
  delete work.catalogScopeKey;
  work.requests = 2;
  work.productIds = ['saved'];
  work.detailTargets = ['https://www.westmonth.com/products/123'];
  const job = {
    input: { records: [site] },
    checkpoint: {
      productQueueVersion: 2,
      requests: 2,
      products: 1,
      siteWork: [work],
      inFlight: {
        index: 0,
        url: 'https://www.westmonth.com/products/all?page=2',
      },
    },
  };
  const cp = initializeProducts(job);
  assert.equal(cp.siteWork[0].status, 'partial');
  assert.equal(cp.siteWork[0].stopReason, 'catalog_scope_changed');
  assert.deepEqual(cp.siteWork[0].productIds, ['saved']);
  assert.equal(cp.requests, 2);
  assert.equal(cp.inFlight, null);
  assert.equal(cp.requestLog[0].status, 'unknown');
  const terminal = initializeProducts({
    ...job,
    checkpoint: {
      ...job.checkpoint,
      inFlight: null,
      siteWork: [{ ...work, status: 'completed' }],
    },
  });
  assert.equal(terminal.siteWork[0].status, 'completed');
});
test('price recheck keeps region and sku identity, and multiregion detail never supplies an unscoped price', async () => {
  const product = {
    market: 'VN',
    catalogSkuId: 456,
    evidenceUrl: 'https://www.westmonth.com/products/123',
    catalogEvidenceUrl:
      'https://api-x.westmonth.com/product-center/shop/products/load-list?page=1&pagesize=60&source=all_products',
  };
  const result = await fetchWestmonthSavedPrice(product, async (url) => {
    assert.equal(new URL(url).searchParams.get('delivery_region_id'), '9');
    return {
      url,
      html: JSON.stringify({
        code: 0,
        data: {
          data: [
            {
              product_id: 123,
              product_sku_id: 456,
              delivery_region_id: 3,
              member_price: 1,
              price_currency: 'USD',
            },
            {
              product_id: 123,
              product_sku_id: 789,
              delivery_region_id: 9,
              member_price: 2,
              price_currency: 'VND',
            },
            {
              product_id: 123,
              product_sku_id: 456,
              delivery_region_id: 9,
              member_price: 22000,
              price_currency: 'VND',
            },
          ],
        },
      }),
    };
  });
  assert.equal(result.price, 22000);
  assert.equal(result.currency, 'VND');
  assert.equal(
    westmonthMetricPatch(
      { member_price: 1, price_currency: 'USD' },
      { market: 'VN', kind: 'detail' },
    ).price,
    undefined,
  );
  assert.notEqual(westmonthChannelKey('products', site), 'products');
  assert.equal(westmonthChannelKey('ads', site), 'ads');
  assert.equal(
    westmonthChannelKey('products', { domain: 'other.test' }),
    'products',
  );
});
