import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTikTokShopSearch,
  tikTokSold,
  tikTokPrice,
} from './tiktok-shop-provider.mjs';
import {
  appendCoreEvidence,
  archiveCoreEvidence,
  exactProductLinks,
} from './core-evidence.mjs';
import { coreListAction, normalizeUsdRates } from './core-list-service.mjs';
const at = '2026-10-22T01:00:00Z';
const raw = {
  product_id: '123',
  title: 'Collagen gummies',
  product_price_info: { sale_price_decimal: '250.000', currency_name: 'VND' },
  sold_info: { sold_count: '12,345' },
  rate_info: { score: 4.5, review_count: 25 },
  seller_info: { shop_name: 'QA shop' },
  seo_url: { canonical_url: 'https://www.tiktok.com/shop/pdp/123' },
  product_image: { url: 'https://img.example/product.jpg' },
};
test('official TikTok parser handles nested VN response and preserves real units', () => {
  const {
    products: [p],
  } = normalizeTikTokShopSearch({ data: { products: [raw] } }, 'VN', at);
  assert.equal(p.price, 250000);
  assert.equal(p.currency, 'VND');
  assert.equal(p.sourceMetrics.soldCount, 12345);
  assert.equal(p.sourceMetrics.rating, 4.5);
  assert.equal(p.sourceMetrics.reviewCount, 25);
  assert.equal(p.sourceMetrics.shopName, 'QA shop');
  assert.equal(p.sourceUrl, raw.seo_url.canonical_url);
  assert.equal(p.imageUrl, raw.product_image.url);
  assert.equal(p.sourceMetrics.monthlySales, undefined);
  assert.equal(p.sourceMetrics.orderCount, undefined);
});
test('US and MX decimal prices and flat responses stay compatible', () => {
  for (const market of ['US', 'MX']) {
    const {
      products: [p],
    } = normalizeTikTokShopSearch(
      {
        products: [{ id: '1', title: 'Gummy', price: '12.99', sold_count: 0 }],
      },
      market,
      at,
    );
    assert.equal(p.price, 12.99);
    assert.equal(p.sourceMetrics.soldCount, 0);
  }
  assert.equal(tikTokPrice('1.234', 'USD'), 1.234);
  assert.equal(tikTokPrice('1.234', 'VND'), 1234);
});
test('explicit TikTok ingredients, dose, specifications and selling copy survive parsing', () => {
  const p = normalizeTikTokShopSearch(
    {
      products: [
        {
          ...raw,
          ingredients: 'Collagen peptide',
          serving_size: '2500 mg / serving',
          specification: '60 gummies',
          selling_points: ['Beauty support', 'Convenient format'],
          description: 'Brand description',
        },
      ],
    },
    'VN',
    at,
  ).products[0];
  assert.equal(p.ingredient, 'Collagen peptide');
  assert.equal(p.dose, '2500 mg / serving');
  assert.equal(p.size, '60 gummies');
  assert.deepEqual(p.sourceContent.sellingPoints, [
    'Beauty support',
    'Convenient format',
  ]);
  assert(p.collectionFields.includes('ingredients'));
  assert.equal(p.sourceContent.descriptions[0], 'Brand description');
  const nested = normalizeTikTokShopSearch(
    { products: [{ ...raw, product_info: { ingredients: 'Vitamin C' } }] },
    'VN',
    at,
  ).products[0];
  assert.equal(nested.ingredient, 'Vitamin C');
  assert.equal(nested.sourceMetrics.soldCount, 12345);
});
test('rounded sale displays and order fields never become exact sold counts', () => {
  assert.deepEqual(tikTokSold('10K+'), {
    soldRaw: '10K+',
    soldPrecision: 'lower_bound',
  });
  const {
    products: [p],
  } = normalizeTikTokShopSearch(
    { products: [{ id: '1', title: 'Gummy', sales: 100, order_count: 5 }] },
    'VN',
    at,
  );
  assert.equal(p.sourceMetrics.soldCount, undefined);
  assert.equal(p.sourceMetrics.reportedSales, undefined);
  assert.equal(p.sourceMetrics.orderCount, 5);
});
test('unknown response structure fails visibly instead of successful empty import', () => {
  assert.throws(
    () => normalizeTikTokShopSearch({ data: {} }, 'VN'),
    /未返回商品数组/,
  );
  assert.throws(
    () => normalizeTikTokShopSearch({ products: [{ unrecognized: 1 }] }, 'VN'),
    /字段已变化/,
  );
});
test('immutable observations deduplicate retries, retain revisions and do not restamp old counts', async () => {
  const p = normalizeTikTokShopSearch({ products: [raw] }, 'VN', at)
    .products[0];
  const first = appendCoreEvidence('products', null, p);
  const retry = appendCoreEvidence('products', first, p);
  assert.equal(retry.coreEvidence.history.length, 1);
  const next = {
    ...p,
    sourceMetrics: { collectedAt: '2026-10-23T01:00:00Z', rating: 5 },
  };
  const second = appendCoreEvidence('products', first, { ...p, ...next }, next);
  assert.equal(second.coreEvidence.history.length, 2);
  assert.equal(second.coreEvidence.history[1].sold, undefined);
  const writes = [];
  await archiveCoreEvidence(
    'products',
    p.id,
    second,
    async (...args) => writes.push(args),
    first,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][2], true);
});
test('ad link association requires exact same-market product URL and excludes homepages', () => {
  const a = {
    market: 'VN',
    landingUrls: ['https://shop.example/p/gummy?utm_source=meta'],
  };
  assert.deepEqual(
    exactProductLinks(a, [
      { id: 'p', market: 'VN', sourceUrl: 'https://shop.example/p/gummy' },
      { id: 'other', market: 'US', sourceUrl: 'https://shop.example/p/gummy' },
    ]),
    ['p'],
  );
  assert.deepEqual(
    exactProductLinks(
      { market: 'VN', landingUrls: ['https://shop.example/'] },
      [{ id: 'p', market: 'VN', sourceUrl: 'https://shop.example/' }],
    ),
    [],
  );
});
test('frequent observations cannot exceed browser document limits and retain the original count', () => {
  let value = {
    id: 'frequent',
    market: 'VN',
    sourceProvider: 'QA',
    sourcePlatform: 'TikTok Shop',
    sourceProductId: '1',
  };
  for (let i = 0; i < 650; i++) {
    const patch = {
      ...value,
      sourceMetrics: {
        collectedAt: new Date(Date.parse(at) + i * 3600000).toISOString(),
        soldCount: i,
      },
    };
    value = appendCoreEvidence('products', value, patch, patch);
  }
  assert.equal(value.coreEvidence.historyCount, 650);
  assert.equal(value.coreEvidence.historyTruncated, true);
  assert(value.coreEvidence.history.length <= 600);
  assert(JSON.stringify(value.coreEvidence.history).length <= 160000);
  assert.equal(value.coreEvidence.history.at(-1).sold, 649);
  const retry = appendCoreEvidence('products', value, value);
  assert.equal(retry.coreEvidence.historyCount, 650);
});
test('a partial refresh does not restamp preserved product fields', () => {
  const p = normalizeTikTokShopSearch(
    {
      products: [{ ...raw, ingredients: 'Collagen', serving_size: '2500 mg' }],
    },
    'VN',
    at,
  ).products[0];
  const old = appendCoreEvidence('products', null, p);
  const patch = {
    ...p,
    price: 0,
    ingredient: '平台未返回可核验配方',
    dose: '平台未返回每份剂量',
    collectionFields: [],
    sourceContent: {
      collectedAt: '2026-10-23T01:00:00Z',
      descriptions: [],
      attributes: {},
    },
  };
  const next = appendCoreEvidence('products', old, patch, patch);
  assert.equal(next.coreEvidence.fieldUpdatedAt.ingredient, at);
  assert.equal(next.coreEvidence.fieldUpdatedAt.dose, at);
  assert.equal(next.coreEvidence.fieldUpdatedAt.price, at);
});
test('USD rate source validation requires dated positive VN/MX rates', () => {
  const value = {
    result: 'success',
    base_code: 'USD',
    time_last_update_unix: Date.parse(at) / 1000,
    rates: { VND: 25000, MXN: 20 },
  };
  assert.equal(normalizeUsdRates(value, at).rates.VND, 25000);
  assert.throws(
    () => normalizeUsdRates({ ...value, rates: { VND: 0 } }, at),
    /有效/,
  );
  assert.throws(
    () => normalizeUsdRates({ ...value, time_last_update_unix: 1 }, at),
    /日期/,
  );
});
test('free FX source reserves one daily request before network; no retries after unknown outcome', async () => {
  let stored,
    calls = 0;
  const connection = {
    query: async () => ({ rows: stored ? [{ value: stored }] : [] }),
    release() {},
  };
  const io = {
    pool: { connect: async () => connection },
    lock: async () => true,
    unlock: async () => {},
    write: async (v) => {
      stored = v;
    },
    fetcher: async () => {
      calls++;
      throw new Error('synthetic network failure');
    },
  };
  await assert.rejects(
    coreListAction({ action: 'server_core_rates_refresh', maxRequests: 1 }, io),
    /synthetic/,
  );
  await assert.rejects(
    coreListAction({ action: 'server_core_rates_refresh', maxRequests: 1 }, io),
    /未自动重试/,
  );
  await assert.rejects(
    coreListAction(
      { action: 'server_core_rates_refresh', maxRequests: 10 },
      io,
    ),
    /1次/,
  );
  assert.equal(calls, 1);
});
