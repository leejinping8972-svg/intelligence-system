/* eslint-disable vitest/no-import-node-test, no-nested-ternary -- Server tests run with node:test; compact request fixture routing. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  normalizeAmazon,
  normalizeShopping,
  normalizeAmazonContent,
  normalizeAmazonTrend,
  matchesProductTerm,
  mergePlatformProduct,
  protectPlatformClientEdit,
  payload,
  records,
  publicUrl,
} from './platform-product-data.mjs';
import {
  validatePlatformProducts,
  runPlatformProducts,
} from './platform-products-jobs.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';
const at = '2026-10-19T08:00:00Z';
const amz = (asin = 'B0EXAMPLE1', patch = {}) =>
  normalizeAmazon(
    {
      asin,
      title: 'Creatine Gummies',
      brand: 'QA brand',
      price: 25,
      main_image: 'https://images.example.com/item.jpg',
      monthly_sale_volume: 200,
      star_rating: 4.5,
      review_count: 10,
      online_date: '2026-09-01',
      ...patch,
    },
    'US',
    at,
  );
const pla = (title) =>
  normalizeShopping(
    {
      Title: title,
      'Product Price': 159,
      Url: 'http://shop.example.com/',
      'Shop Name': 'QA shop',
      Position: 2,
      Timestamp: 1_787_921_241,
    },
    'US',
    at,
  );
const request = (patch) =>
  validatePlatformProducts({
    requestId: randomUUID(),
    terms: 'creatine gummies',
    market: 'US',
    providers: ['sorftime', 'semrush'],
    maxRequests: 20,
    completeAll: false, enrich: false, trend: false,
    ...patch,
  });
test('observed Sorftime snake_case fields preserve sentinels as unknown and never infer launch from collection', () => {
  const p = amz();
  assert.equal(p.sourceMetrics.monthlySales, 200);
  assert.equal(p.sourceMetrics.rating, 4.5);
  assert.equal(p.sourceMetrics.reviewCount, 10);
  assert.ok(p.imageUrl);
  assert.equal(p.decisionData.listing.date, '2026-09-01');
  const unknown = amz('B0EXAMPLE1', {
    price: 0,
    monthly_sale_volume: -1,
    potential_index: -99,
    online_date: '',
  });
  assert.equal(unknown.sourceMetrics.monthlySales, undefined);
  assert.equal(unknown.sourceMetrics.platformPotential, undefined);
  assert.equal(unknown.decisionData.listing, undefined);
  assert.ok(!unknown.collectionFields.includes('price'));
  assert.equal(
    normalizeAmazon({ asin: 'B0EXAMPLE1', title: 'x' }, 'VN', at),
    null,
  );
});
test('PLA records retain indexed snapshot, HTTP merchant landing, and separate product identity at shared homepage', () => {
  const first = pla('Creatine Gummy 30 count'),
    second = pla('Creatine Gummy 90 count');
  assert.notEqual(first.id, second.id);
  assert.equal(first.price, 159);
  assert.equal(first.sourceUrl, 'http://shop.example.com/');
  assert.equal(first.sourceMetrics.urlKind, 'merchant_landing');
  assert.ok(first.sourceMetrics.observedAt.startsWith('2026-08-28'));
  assert.deepEqual(first.decisionData.series, []);
});
test('title relevance rejects powder, unrelated gummies, and partial-word collisions', () => {
  assert.equal(
    matchesProductTerm(
      { title: 'Creatine Monohydrate Powder' },
      'creatine gummies',
    ),
    false,
  );
  assert.equal(
    matchesProductTerm({ title: 'Multivitamin Gummies' }, 'creatine gummies'),
    false,
  );
  assert.equal(
    matchesProductTerm(
      { title: 'Creatine Gummy for Women' },
      'creatine gummies',
    ),
    true,
  );
  assert.equal(
    matchesProductTerm(
      { title: 'Creatine Gummy for Women' },
      'creatine gummies men',
    ),
    false,
  );
});
test('product content parses observed escaped alternating attributes and preserves raw claims without invented dose', () => {
  const p = amz();
  const content = normalizeAmazonContent(
    {
      data: {
        asin: p.sourceProductId,
        description: 'Claim<br>More claim',
        main_image: ['https://images.example.com/a.jpg'],
        property:
          '[\\"Item Form\\",\\"Gummy\\",\\"Unit Count\\",\\"60 Count\\",\\"Special Ingredients\\",\\"Creatine Monohydrate\\"]',
      },
    },
    p,
    at,
  );
  assert.equal(content.form, 'Gummy');
  assert.equal(content.size, '60 Count');
  assert.equal(content.ingredient, undefined);
  assert.match(JSON.stringify(content.sourceContent), /Creatine Monohydrate/);
  assert.equal(content.dose, undefined);
  assert.equal(content.claim, 'Claim\nMore claim');
  assert.ok(content.imageUrl);
  assert.equal(content.ingredientInsights, undefined);
  assert.throws(
    () => normalizeAmazonContent({ data: { asin: 'B0WRONG123' } }, p, at),
    /不一致/,
  );
});
test('observed flat yyyyMM history excludes missing -1 and marks ongoing month partial; scope cannot switch to parent', () => {
  const p = amz(),
    s = normalizeAmazonTrend(
      {
        data: {
          asin: p.sourceProductId,
          type: 'AsinSalesVolume',
          data: [202_607, 100, 202_608, -1, 202_609, 130, 202_610, 80],
        },
      },
      p,
      at,
    );
  assert.equal(s.points.length, 3);
  assert.equal(s.points[0].end, '2026-07-31');
  assert.equal(s.points[2].partial, true);
  assert.throws(
    () =>
      normalizeAmazonTrend(
        { data: { type: 'SalesVolume', data: [202_609, 90] } },
        p,
        at,
      ),
    /口径不一致/,
  );
});
test('refresh preserves manual state, prior enrichment, exact keyword links, and complete history', () => {
  const old = {
    ...amz(),
    favorite: true,
    reviewed: true,
    ingredient: 'Verified raw label',
    keywordIds: ['one'],
    queryTerms: ['first'],
    decisionData: {
      series: [
        {
          provider: 'Sorftime',
          platform: 'Amazon',
          market: 'US',
          productId: 'B0EXAMPLE1',
          metric: 'sales_volume',
          period: 'month',
          points: [{ start: '2026-08-01', end: '2026-08-31', value: 100 }],
        },
      ],
    },
  };
  const updated = mergePlatformProduct(old, {
    ...amz(),
    keywordIds: ['two'],
    queryTerms: ['second'],
    decisionData: {
      series: [
        {
          ...old.decisionData.series[0],
          points: [{ start: '2026-09-01', end: '2026-09-30', value: 150 }],
        },
      ],
    },
  });
  assert.equal(updated.favorite, true);
  assert.equal(updated.reviewed, true);
  assert.equal(updated.ingredient, 'Verified raw label');
  assert.deepEqual(updated.keywordIds, ['one', 'two']);
  assert.equal(updated.decisionData.series[0].points.length, 2);
  assert.equal(
    protectPlatformClientEdit(updated, { ...old, favorite: false }).decisionData
      .series[0].points.length,
    2,
  );
  assert.equal(
    protectPlatformClientEdit(updated, { ...old, favorite: false }).favorite,
    false,
  );
});
test('invalid URLs and error envelopes are not accepted as product data', () => {
  for (const url of [
    'https://127.0.0.1/a',
    'https://user:pass@example.com/a',
    'javascript:alert(1)',
    'https://x.internal/a',
  ])
    assert.equal(publicUrl(url), '');
  assert.throws(() => payload({ isError: true }), /错误/);
  assert.deepEqual(
    records({ Data: JSON.stringify({ Items: [{ asin: 'B0EXAMPLE1' }] }) }),
    [{ asin: 'B0EXAMPLE1' }],
  );
});
test('validation keeps full seed list and rejects insufficient starting budget or cross-country Amazon substitution', () => {
  const terms = Array.from({ length: 34 }, (_, i) => `keyword ${i}`).join('\n');
  const v = request({ terms, maxRequests: 100 });
  assert.equal(v.seeds.length, 34);
  assert.equal(request({ terms, maxRequests: 0 }).seeds.length, 34);
  assert.throws(() => request({ market: 'VN' }), /不支持越南/);
});
function harness(input, handler) {
  const docs = new Map(),
    calls = [],
    links = [];
  let job = { id: randomUUID(), input, checkpoint: {} },
    cancelled = false;
  const io = {
    now: () => Date.parse(at),
    isCancelled: async () => cancelled,
    readProduct: async (id) => docs.get(id),
    upsertProduct: async (p) => {
      const value = mergePlatformProduct(docs.get(p.id), p);
      docs.set(p.id, value);
      return value;
    },
    linkKeyword: async (k, ids) => links.push([k.id, ids]),
    saveCheckpoint: async (j, cp, status) => {
      job = { ...j, status, checkpoint: structuredClone(cp) };
    },
    collect: async (j, step, r) => {
      calls.push({ step, request: r });
      return handler(r);
    },
  };
  return {
    docs,
    calls,
    links,
    io,
    get job() {
      return job;
    },
    cancel: () => {
      cancelled = true;
    },
    async run() {
      for (let i = 0; i < 40; i++) {
        await runPlatformProducts(job, io);
        if (['completed', 'partial', 'cancelled'].includes(job.status)) return;
      }
      throw new Error('queue did not settle');
    },
  };
}
test('one word obtains both platforms, no website crawler, then enriches exact ASIN and history', async () => {
  const v = request({
    perKeyword: 1,
    maxDomains: 1,
    enrich: true,
    trend: true,
    maxDetailProducts: 1,
  });
  v.keywordRecords = [
    { id: 'kw', term: 'creatine gummies', naturalKey: 'US:key' },
  ];
  const h = harness(v, async (r) =>
    r.op === 'search'
      ? { products: [amz()] }
      : r.op === 'domains'
        ? { domains: ['shop.example.com'], apiUnits: 20 }
        : r.op === 'shopping'
          ? { products: [pla('Creatine Gummies')], apiUnits: 30 }
          : r.op === 'content'
            ? {
                patch: {
                  ingredient: 'Creatine',
                  imageUrl: 'https://images.example.com/new.jpg',
                },
              }
            : {
                series: normalizeAmazonTrend(
                  {
                    data: {
                      asin: 'B0EXAMPLE1',
                      type: 'AsinSalesVolume',
                      data: [202_608, 100, 202_609, 150],
                    },
                  },
                  amz(),
                  at,
                ),
              },
  );
  await h.run();
  assert.equal(h.job.status, 'completed');
  assert.equal(h.docs.size, 2);
  assert.equal(h.job.checkpoint.semrushUnits, 50);
  assert.equal(h.docs.get(amz().id).decisionData.series[0].points.length, 2);
  assert.equal(h.links.length, 2);
  assert.ok(h.calls.every((c) => c.request.sources[0] === 'platform_products'));
});
test('legacy request ceiling does not truncate product enrichment', async () => {
  const h = harness(
    request({ maxRequests: 2, enrich: true, trend: true }),
    async (r) =>
      r.op === 'search'
        ? { products: [amz()] }
        : { domains: ['shop.example.com'], apiUnits: 20 },
  );
  await h.run();
  assert.equal(h.calls.length, 5);
  assert.equal(h.docs.size, 1);
  assert.equal(h.job.status, 'completed');
});
test('one provider auth failure does not prevent other source; duplicate ASIN preserves multi-keyword provenance', async () => {
  const h = harness(
    request({ terms: 'creatine gummies\ncreatine gummy', maxRequests: 20 }),
    async (r) => {
      if (r.provider === 'sorftime') throw new Error('Sorftime HTTP 401');
      return r.op === 'domains'
        ? { domains: ['shop.example.com'], apiUnits: 20 }
        : { products: [pla('Creatine Gummies')], apiUnits: 30 };
    },
  );
  await h.run();
  assert.equal(h.job.status, 'partial');
  assert.equal(
    h.calls.filter((c) => c.request.provider === 'sorftime').length,
    1,
  );
  assert.equal(h.docs.size, 1);
  assert.deepEqual([...h.docs.values()][0].queryTerms, [
    'creatine gummies',
    'creatine gummy',
  ]);
});
test('cancelled task issues no additional request and preserves products', async () => {
  const h = harness(request({ enrich: true }), async () => ({
    products: [amz()],
  }));
  await runPlatformProducts(h.job, h.io);
  h.cancel();
  await h.run();
  assert.equal(h.calls.length, 1);
  assert.equal(h.docs.size, 1);
  assert.equal(h.job.status, 'cancelled');
});
test('persisted in-flight checkpoint resumes without consuming request allowance a second time', async () => {
  const input = request({ providers: ['sorftime'], maxRequests: 1 });
  const job = {
    id: randomUUID(),
    input,
    checkpoint: {
      work: [
        {
          provider: 'sorftime',
          op: 'search',
          term: 'creatine gummies',
          page: 1,
        },
      ],
      index: 0,
      requests: 1,
      inFlight: { index: 0, units: 0 },
    },
  };
  let saved;
  const docs = new Map();
  await runPlatformProducts(job, {
    collect: async () => ({ products: [amz()], cached: true }),
    readProduct: async () => null,
    upsertProduct: async (p) => docs.set(p.id, p),
    linkKeyword: async () => {},
    isCancelled: async () => false,
    saveCheckpoint: async (j, cp, status) => {
      saved = { cp, status };
    },
  });
  assert.equal(saved.cp.requests, 1);
  assert.equal(saved.status, 'completed');
  assert.equal(docs.size, 1);
});
test('identical searches use a shared cache and source mismatch is filtered before detail calls', async () => {
  const cache = new Map();
  let paidCalls = 0;
  const overrides = {
    cache: {
      read: async (k) => cache.get(k),
      write: async (k, v) => cache.set(k, v),
    },
    collectorEnv: async () => ({}),
    readSorftimeToken: async () => 'qa-not-live',
    connectSorftime: async () => ({
      tools: [
        {
          name: 'product_search_from_name',
          inputSchema: {
            properties: {
              name: {},
              query_type: {},
              page: {},
              amz_site: { enum: ['US'] },
            },
          },
        },
      ],
      rpc: async () => {
        paidCalls++;
        return {
          structuredContent: {
            data: [
              { asin: 'B0EXAMPLE1', title: 'Creatine Gummies' },
              { asin: 'B0EXAMPLE2', title: 'Creatine Powder' },
            ],
          },
        };
      },
    }),
  };
  const req = {
    provider: 'sorftime',
    op: 'search',
    term: 'creatine gummies',
    market: 'US',
    page: 1,
  };
  const first = await platformProductRequest(req, overrides),
    next = await platformProductRequest(req, overrides);
  assert.equal(first.products.length, 1);
  assert.equal(first.rejected, 1);
  assert.equal(next.cached, true);
  assert.equal(next.providerCalls, 0);
  assert.equal(paidCalls, 1);
});

test('Semrush PLA adapter validates schema, preserves actual usage, and only executes the intended report', async () => {
  const calls = [];
  const schema = {
    report: 'domain_shopping',
    parameters: {
      database: { enum: ['us'] },
      export_columns: {
        items: {
          enum: [
            'keyword',
            'position',
            'volume',
            'shop_name',
            'url',
            'ad_title',
            'price',
            'timestamp',
          ],
        },
      },
    },
  };
  const result = await platformProductRequest(
    {
      provider: 'semrush',
      op: 'shopping',
      market: 'US',
      term: 'creatine gummies',
      domain: 'shop.example.com',
      limit: 1,
    },
    {
      cache: false,
      semrushClient: async () => ({
        key: 'qa-redaction-key',
        c: {
          rpc: async (method, input) => {
            calls.push({ method, ...input });
            return {
              structuredContent:
                input.name === 'get_report_schema'
                  ? schema
                  : {
                      metadata: { usage: { api_units: 30 } },
                      data: [
                        {
                          keyword: 'creatine gummies',
                          ad_title: 'Creatine Gummies 60 Count',
                          url: 'https://shop.example.com/',
                          price: 25,
                        },
                      ],
                    },
            };
          },
        },
      }),
    },
  );
  assert.equal(result.apiUnits, 30);
  assert.equal(result.products.length, 1);
  assert.equal(calls[1].arguments.report, 'domain_shopping');
  assert.equal(
    calls[1].arguments.params.display_filter[0].value,
    'creatine gummies',
  );
  await assert.rejects(
    platformProductRequest(
      { provider: 'semrush', op: 'shopping', market: 'US' },
      {
        cache: false,
        semrushClient: async () => ({
          key: 'qa-redaction-key',
          c: {
            rpc: async () => {
              throw new Error('HTTP 401 qa-redaction-key');
            },
          },
        }),
      },
    ),
    (error) =>
      !JSON.stringify(error).includes('qa-redaction-key') &&
      !error.cause &&
      error.message.includes('401'),
  );
});

test('Sorftime raw transport error and cause never expose a token', async () => {
  await assert.rejects(
    platformProductRequest(
      { provider: 'sorftime', op: 'search', market: 'US' },
      {
        cache: false,
        collectorEnv: async () => ({}),
        readSorftimeToken: async () => 'qa-secret-token',
        connectSorftime: async () => {
          throw new Error(
            'failed https://mcp.sorftime.com/qa-secret-token qa-secret-token',
          );
        },
      },
    ),
    (error) => !error.message.includes('qa-secret-token') && !error.cause,
  );
});
