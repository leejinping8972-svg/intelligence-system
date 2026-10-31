import assert from 'node:assert/strict';
import test from 'node:test';

import { runProductResourceDiscovery } from './product-resource-engine.mjs';

const at = '2026-10-22T08:00:00.000Z';
const budget = (patch = {}) => ({
  requests: 20, providerCalls: 20, sorftimeCalls: 20, scrapeCredits: 20,
  semrushUnits: 2000, braveRequests: 10, browserPages: 0, modelTokens: 0,
  maxPages: 10, maxDetailProducts: 3, ...patch,
});
const plan = (patch = {}) => ({
  routeId: 'amazon-sorftime', platform: 'amazon', provider: 'sorftime',
  market: 'US', mode: 'keyword', terms: ['creatine'], urls: [],
  salesWindowDays: 90, ranking: 'sample', maxProducts: 100,
  includeDetails: false, includeHistory: false, researchCategory: 'supplements',
  budget: budget(), ...patch,
});
const product = (sourceProductId, patch = {}) => ({
  id: `product-${sourceProductId}`, title: 'Same source title',
  sourceProductId, sourceProvider: 'Sorftime', sourcePlatform: 'amazon',
  market: 'US', sourceUrl: `https://www.amazon.com/dp/${sourceProductId}`,
  price: 12.34, currency: 'USD', collectionFields: ['price'],
  sourceMetrics: { collectedAt: at, monthlySales: 42 }, ...patch,
});

function harness(resourcePlan, responder) {
  const job = { id: 'resource-job', input: { kind: 'platform_products', resourceDiscovery: true, market: resourcePlan.market, seeds: resourcePlan.terms, resourcePlan }, checkpoint: {} };
  const products = new Map();
  const journal = new Map();
  const requests = [];
  const checkpoints = [];
  let time = Date.parse(at);
  let cancelled = false;
  let status;
  const io = {
    now: () => time,
    isCancelled: async () => cancelled,
    readProduct: async (id) => structuredClone(products.get(id)),
    upsertProduct: async (patch) => {
      const old = products.get(patch.id) || {};
      const value = { ...old, ...structuredClone(patch), dataCompletion: { ...old.dataCompletion, ...patch.dataCompletion } };
      products.set(patch.id, value);
      return value;
    },
    saveCheckpoint: async (_job, cp, nextStatus) => {
      job.checkpoint = structuredClone(cp);
      checkpoints.push({ checkpoint: structuredClone(cp), status: nextStatus });
      status = nextStatus;
    },
    collect: async (_job, step, request) => {
      if (journal.has(step)) {
        const saved = journal.get(step);
        if (saved.error) throw new Error('上次请求结果未知，不自动重复可能扣费的请求');
        return structuredClone(saved.result);
      }
      requests.push(structuredClone(request));
      journal.set(step, { started: true });
      try {
        const raw = await responder(request, requests.length);
        const result = { ...raw, usage: { requests: 1, ...raw.usage } };
        journal.set(step, { result: structuredClone(result) });
        return result;
      } catch (error) {
        journal.set(step, { error: error.message });
        throw error;
      }
    },
  };
  const step = async () => {
    time = Math.max(time, job.checkpoint.nextRunAt || 0);
    await runProductResourceDiscovery(job, io);
  };
  const drain = async () => {
    for (let index = 0; index < 500; index++) {
      await step();
      if (['completed', 'partial', 'cancelled'].includes(status)) return;
    }
    throw new Error('resource execution did not terminate within bounded steps');
  };
  return { job, io, requests, products, journal, checkpoints, step, drain, get status() { return status; }, cancel(value) { cancelled = value; }, advance(ms) { time += ms; } };
}

test('category discovery retains native category and requested sales window without inventing historical sales', async () => {
  const category = { id: '3760901', path: ['Health', 'Supplements'], market: 'US', mapping: 'supplements' };
  const h = harness(plan({ mode: 'category', category, salesWindowDays: 180, ranking: 'platform_bestsellers' }), async () => ({ products: [product('B0RESOURCE1')], providerCalls: 1, collectedAt: at }));
  await h.drain();
  assert.equal(h.status, 'completed');
  assert.equal(h.requests[0].op, 'bestsellers');
  assert.deepEqual(h.requests[0].category, category);
  assert.equal(h.requests[0].windowDays, 180);
  const saved = h.products.get('product-B0RESOURCE1');
  assert.equal(saved.sourceMetrics.orderCount, undefined);
  assert.equal(saved.sourceMetrics.sales180Days, undefined);
  assert.equal(saved.resourceEvidence.ranking.sourceRank, undefined);
  assert.equal(h.job.checkpoint.resourceProgress.completeMarketCoverage, false);
  assert.equal(h.job.checkpoint.resourceProgress.coverage, 'collected_sample');
});

test('source identity deduplicates pages while equal titles remain separate products and markets cannot leak', async () => {
  const h = harness(plan(), async () => ({
    products: [product('A'), product('A', { id: 'other-local-id' }), product('B'), product('C', { market: 'MX' })],
    providerCalls: 1, hasMore: true, pageFingerprint: 'same-page', collectedAt: at,
  }));
  await h.drain();
  assert.equal(h.requests.length, 2);
  assert.deepEqual(h.job.checkpoint.productIds, ['product-A', 'product-B']);
  assert.equal(h.products.has('other-local-id'), false);
  assert.equal(h.products.has('product-C'), false);
  assert.ok(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'repeated_page'));
});

test('page and request limits count discovery before the call and stop bounded pagination', async () => {
  const h = harness(plan({ budget: budget({ maxPages: 2, requests: 6 }) }), async (_request, index) => ({ products: [product(String(index))], providerCalls: 1, hasMore: true }));
  await h.drain();
  assert.equal(h.requests.length, 2);
  assert.equal(h.job.checkpoint.requests, 2);
  assert.equal(h.job.checkpoint.discoveryPages, 2);
  assert.ok(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'page_limit'));
  assert.equal(h.status, 'partial');
});

test('legacy zero provider caps permit collection and keep usage accounting', async () => {
  const h = harness(plan({ provider: 'tiktok_shop', platform: 'tiktok_shop', routeId: 'tiktok-scrapecreators', budget: budget({ scrapeCredits: 0, providerCalls: 0, requests: 0 }) }), async () => ({ products: [product('A')], usage: { scrapeCredits: 1, providerCalls: 1 } }));
  await h.drain();
  assert.equal(h.requests.length, 1);
  assert.equal(h.job.checkpoint.requests, 1);
  assert.equal(h.products.size, 1);
  assert.equal(h.job.checkpoint.stopReasons.length, 0);
  assert.equal(h.job.checkpoint.reserved.browserPages, 0);
  assert.equal(h.job.checkpoint.reserved.modelTokens, 0);
});

test('physical Sorftime usage can exceed the old cap while unknown results still stop the source', async () => {
  const h = harness(plan({ budget: budget({ requests: 5 }) }), async () => ({ products: [product('A')], providerCalls: 1, usage: { requests: 4 }, hasMore: true }));
  await h.drain();
  assert.equal(h.requests.length, 2);
  assert.equal(h.checkpoints[0].checkpoint.inFlight.cost.requests, 5);
  assert.equal(h.job.checkpoint.reserved.requests, 8);
  assert.equal(h.job.checkpoint.confirmedUsage.requests, 8);
  assert.ok(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'repeated_page'));
  const unknown = harness(plan({ terms: ['one', 'two'] }), async () => ({ products: [product('A')], providerCalls: 1, usage: { requests: undefined } }));
  await unknown.drain();
  assert.equal(unknown.requests.length, 1);
  assert.equal(unknown.job.checkpoint.reserved.requests, 5);
  assert.equal(unknown.job.checkpoint.sourceStates.sorftime.reason, 'charge_unknown');
});

test('explicit source variants retain separate source identities and never overwrite one another', async () => {
  const h = harness(plan(), async () => ({ products: [product('A', { sourceVariantId: 'sku1', size: '30 count' }), product('A', { sourceVariantId: 'sku2', size: '60 count' })], providerCalls: 1 }));
  await h.drain();
  assert.equal(h.products.size, 2);
  assert.equal(h.job.checkpoint.productIds.length, 2);
  assert.notEqual(h.job.checkpoint.productIds[0], h.job.checkpoint.productIds[1]);
  assert.deepEqual([...h.products.values()].map((p) => p.size).toSorted(), ['30 count', '60 count']);
});

test('unknown scraper credits preserve data and reservation but stop that source', async () => {
  const h = harness(plan({ provider: 'tiktok_shop', platform: 'tiktok_shop', routeId: 'tiktok-scrapecreators', terms: ['first', 'second'] }), async () => ({ products: [product('TK1', { sourcePlatform: 'tiktok_shop' })], providerCalls: 1 }));
  await h.drain();
  assert.equal(h.requests.length, 1);
  assert.equal(h.products.size, 1);
  assert.equal(h.job.checkpoint.reserved.scrapeCredits, 1);
  assert.equal(h.job.checkpoint.sourceStates.tiktok_shop.reason, 'charge_unknown');
  assert.equal(h.job.checkpoint.unknownCharges, 1);
  assert.equal(h.job.checkpoint.confirmedUsage.scrapeCredits, 0);
  assert.equal(h.status, 'partial');
});

test('journal replay after a checkpoint crash neither charges nor reserves the same request twice', async () => {
  const h = harness(plan(), async () => ({ products: [product('A')], providerCalls: 1, collectedAt: at }));
  const save = h.io.saveCheckpoint;
  let crash = true;
  h.io.saveCheckpoint = async (job, cp, status) => {
    if (cp.inFlight?.accounted && crash) { crash = false; throw new Error('simulated checkpoint failure'); }
    return save(job, cp, status);
  };
  await assert.rejects(h.step(), /checkpoint failure/);
  assert.equal(h.job.checkpoint.inFlight.accounted, undefined);
  await h.drain();
  assert.equal(h.requests.length, 1);
  assert.equal(h.job.checkpoint.requests, 1);
  assert.equal(h.job.checkpoint.reserved.sorftimeCalls, 1);
  assert.equal(h.job.checkpoint.confirmedUsage.sorftimeCalls, 1);
  assert.equal(h.products.size, 1);
});

test('storage failure after a confirmed response resumes locally and keeps its original observation timestamp', async () => {
  const h = harness(plan(), async () => ({ products: [product('A')], providerCalls: 1, collectedAt: at }));
  const upsert = h.io.upsertProduct;
  let crash = true;
  h.io.upsertProduct = async (patch) => {
    if (crash) { crash = false; throw new Error('simulated product write failure'); }
    return upsert(patch);
  };
  await assert.rejects(h.step(), /product write failure/);
  assert.equal(h.job.checkpoint.inFlight.accounted, true);
  h.advance(100_000);
  await h.drain();
  assert.equal(h.requests.length, 1);
  assert.equal(h.job.checkpoint.confirmedUsage.sorftimeCalls, 1);
  assert.equal(h.products.get('product-A').sourceMetrics.collectedAt, at);
});

test('paid timeout is never replayed and a second keyword cannot restart the blocked source', async () => {
  const h = harness(plan({ terms: ['one', 'two'] }), async () => { throw new Error('provider timeout'); });
  await h.drain();
  await h.drain();
  assert.equal(h.requests.length, 1);
  assert.equal(h.job.checkpoint.sourceStates.sorftime.reason, 'charge_unknown');
  assert.equal(h.job.checkpoint.reserved.sorftimeCalls, 1);
  assert.equal(h.status, 'partial');
});

test('cancel retains confirmed products and resume advances the remaining journal steps', async () => {
  let h;
  h = harness(plan(), async (_request, index) => {
    if (index === 1) h.cancel(true);
    return { products: [product(String(index))], providerCalls: 1, hasMore: index === 1 };
  });
  await h.step();
  assert.equal(h.status, 'cancelled');
  assert.equal(h.requests.length, 1);
  assert.equal(h.products.size, 1);
  assert.equal(h.job.checkpoint.index, 1);
  h.cancel(false);
  await h.drain();
  assert.equal(h.status, 'completed');
  assert.equal(h.requests.length, 2);
  assert.equal(h.products.size, 2);
});

test('Brave leads require separately budgeted public pages and never become products by themselves', async () => {
  const h = harness(plan({ provider: 'brave', routeId: 'temu-brave', platform: 'temu', budget: budget({ maxPages: 4 }) }), async (request) => {
    if (request.provider === 'brave') return { leads: [{ url: 'https://www.temu.com/goods.html?id=1' }, { url: 'https://www.temu.com/goods.html?id=2' }], providerCalls: 1, usage: { braveRequests: 1 } };
    if (request.url.endsWith('=1')) return { products: [], message: 'no product structure' };
    return { products: [product('TEMU2', { sourcePlatform: 'temu', sourceProvider: 'public_web' })] };
  });
  await h.drain();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[1].provider, 'public_web');
  assert.equal(h.requests[1].op, 'public_page');
  assert.equal(h.job.checkpoint.reserved.braveRequests, 1);
  assert.equal(h.job.checkpoint.reserved.requests, 3);
  assert.equal(h.products.size, 1);
  assert.equal(h.job.checkpoint.reserved.browserPages, 0);
});

test('one hundred independent public URLs use the HTTP budget without consuming search pagination', async () => {
  const urls = Array.from({ length: 100 }, (_, index) => `https://brand.example/products/${index}`);
  const h = harness(plan({ provider: 'public_web', routeId: 'website-public', platform: 'website', mode: 'urls', urls, budget: budget({ requests: 100, maxPages: 1 }) }), async (_request, index) => ({
    products: [product(String(index), { sourcePlatform: 'Website', sourceProvider: 'public_web' })],
  }));
  await h.drain();
  assert.equal(h.status, 'completed');
  assert.equal(h.requests.length, 100);
  assert.equal(h.products.size, 100);
  assert.equal(h.job.checkpoint.discoveryPages, 0);
  assert.equal(h.job.checkpoint.publicPages, 100);
  assert.equal(h.job.checkpoint.resourceProgress.publicPages, 100);
  assert.equal(h.job.checkpoint.reserved.requests, 100);
});

test('Brave landing pages remain runnable after all keyword search pages consume their page budget', async () => {
  const terms = ['one', 'two', 'three', 'four', 'five'];
  const h = harness(plan({ provider: 'brave', routeId: 'temu-brave', platform: 'temu', terms, budget: budget({ requests: 15, maxPages: 5, braveRequests: 5 }) }), async (request, index) => request.provider === 'brave'
    ? { leads: [{ url: `https://www.temu.com/${request.term}-1` }, { url: `https://www.temu.com/${request.term}-2` }], providerCalls: 1, usage: { braveRequests: 1 } }
    : { products: [product(String(index), { sourcePlatform: 'Temu', sourceProvider: 'public_web' })] });
  await h.drain();
  assert.equal(h.status, 'completed');
  assert.equal(h.requests.filter((request) => request.provider === 'brave').length, 5);
  assert.equal(h.requests.filter((request) => request.provider === 'public_web').length, 10);
  assert.equal(h.products.size, 10);
  assert.equal(h.job.checkpoint.discoveryPages, 5);
  assert.equal(h.job.checkpoint.publicPages, 10);
  assert.equal(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'page_limit'), false);
});

test('public category pagination still stops at the per-scope page depth', async () => {
  const h = harness(plan({ provider: 'public_web', routeId: 'website-public', platform: 'website', mode: 'urls', urls: ['https://brand.example/category'], budget: budget({ maxPages: 2 }) }), async (request) => ({
    products: [product(String(request.page), { sourcePlatform: 'Website', sourceProvider: 'public_web' })],
    hasMore: true,
    nextUrl: `https://brand.example/category?page=${request.page + 1}`,
  }));
  await h.drain();
  assert.deepEqual(h.requests.map((request) => request.page), [1, 2]);
  assert.equal(h.job.checkpoint.discoveryPages, 0);
  assert.equal(h.job.checkpoint.publicPages, 2);
  assert.ok(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'page_limit'));
  assert.equal(h.status, 'partial');
});

test('Instagram content stays in the existing content store and explicit landing provenance reaches public product discovery', async () => {
  const savedContents = new Map();
  const h = harness(plan({ provider: 'scrapecreators', routeId: 'instagram-scrapecreators', platform: 'instagram', initialOperation: 'instagram_search' }), async (request) => {
    if (request.op === 'instagram_search') return {
      contents: [{ id: 'ig-content-1', platform: 'instagram', summary: 'Brand product https://brand.example/item' }], products: [],
      leads: [{ url: 'https://brand.example/item', platform: 'website', websiteDomain: 'brand.example', fromContentId: 'ig-content-1' }],
      providerCalls: 1, usage: { scrapeCredits: 1 },
    };
    return { products: [product('brand-item', { sourcePlatform: 'Website', sourceProvider: 'public_web' })] };
  });
  h.io.upsertContent = async (content) => savedContents.set(content.id, content);
  await h.drain();
  assert.equal(savedContents.size, 1);
  assert.equal(h.job.checkpoint.contents, 1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].platform, 'website');
  assert.equal(h.requests[1].websiteDomain, 'brand.example');
  assert.equal(h.requests[1].fromContentId, 'ig-content-1');
  const saved = h.products.get('product-brand-item');
  assert.equal(saved.resourceEvidence.provider, 'public_web');
  assert.equal(saved.resourceEvidence.platform, 'website');
  assert.equal(saved.sourceMetrics.orderCount, undefined);
});

test('public domain throttling does not stop another domain and persisted cooldown prevents an early call', async () => {
  const h = harness(plan({ provider: 'public_web', routeId: 'amazon-public', mode: 'urls', urls: ['https://one.example/a', 'https://one.example/b', 'https://two.example/c'] }), async (request) => {
    if (request.url.includes('/a')) throw new Error('HTTP 403');
    return { products: [product('B')] };
  });
  await h.drain();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, 'https://two.example/c');
  const cooldown = harness(plan({ terms: ['one', 'two'] }), async () => ({ products: [], providerCalls: 1 }));
  await cooldown.step();
  await runProductResourceDiscovery(cooldown.job, cooldown.io);
  assert.equal(cooldown.requests.length, 1);
  assert.ok(cooldown.job.checkpoint.nextRunAt > Date.parse(at));
  await cooldown.drain();
  assert.equal(cooldown.requests.length, 2);
});

test('detail and history share the product cap but each consumes its own reserved request', async () => {
  const h = harness(plan({ includeDetails: true, includeHistory: true, budget: budget({ maxDetailProducts: 1 }) }), async (request) => {
    if (request.op === 'search') return { products: [product('A'), product('B')], providerCalls: 1 };
    if (request.op === 'history') return { series: { kind: 'sales', points: [] }, empty: true, providerCalls: 1, message: 'not indexed for this period' };
    return { patch: { size: '60 gummies' }, providerCalls: 1 };
  });
  await h.drain();
  assert.deepEqual(h.requests.map((request) => request.op), ['search', 'detail', 'history']);
  assert.equal(h.job.checkpoint.reserved.sorftimeCalls, 3);
  assert.equal(h.products.get('product-A').size, '60 gummies');
  assert.equal(h.products.get('product-A').sourceMetrics.orderCount, undefined);
  assert.equal(h.job.checkpoint.completion['product-A'].history.status, 'not_found');
  assert.equal(h.products.get('product-A').dataCompletion.resourceHistory.status, 'empty');
  assert.equal(h.products.get('product-B').dataCompletion.resourceHistory.status, 'failed');
});

test('enrichment rejects changed source identity before writing returned products or fields', async (t) => {
  const original = product('A', { sourceVariantId: 'sku1', resourceRaw: { variantId: 'sku1', priceRaw: '12.34' }, size: '30 gummies' });
  const cases = [
    ['product ID', { product: { ...original, sourceProductId: 'B' } }],
    ['product platform', { product: { ...original, sourcePlatform: 'TikTok Shop' } }],
    ['product country', { product: { ...original, market: 'MX' } }],
    ['product variant', { product: { ...original, sourceVariantId: 'sku2' } }],
    ['product missing variant', { product: product('A') }],
    ['patch product ID', { patch: { sourceProductId: 'B' } }],
    ['patch platform', { patch: { sourcePlatform: 'TikTok Shop' } }],
    ['patch country', { patch: { market: 'MX' } }],
    ['patch variant', { patch: { sourceVariantId: 'sku2' } }],
    ['patch raw variant', { patch: { resourceRaw: { variantId: 'sku2' } } }],
    ['unrelated discovery products', { products: [product('B')] }],
  ];
  for (const [name, response] of cases) await t.test(name, async () => {
    const h = harness(plan({ includeDetails: true }), async (request) => request.op === 'search'
      ? { products: [original], providerCalls: 1 }
      : { ...response, patch: { ...response.patch, title: 'Unexpected replacement', price: 99 }, providerCalls: 1 });
    await h.drain();
    const id = h.job.checkpoint.productIds[0];
    const saved = h.products.get(id);
    assert.equal(h.products.size, 1);
    for (const field of ['sourceProductId', 'sourcePlatform', 'sourceVariantId', 'market', 'title', 'price', 'size']) assert.equal(saved[field], original[field]);
    assert.deepEqual(saved.resourceRaw, original.resourceRaw);
    assert.equal(h.job.checkpoint.completion[id].detail.status, 'failed');
    assert.equal(saved.dataCompletion.resourceDetail.status, 'failed');
    assert.ok(h.job.checkpoint.stopReasons.some((reason) => reason.reason === 'identity_mismatch'));
    assert.equal(h.job.checkpoint.confirmedUsage.sorftimeCalls, 2);
    assert.equal(h.status, 'partial');
  });
});

test('matching enrichment retains the source variant and never inserts a second discovery product', async () => {
  const original = product('A', { sourceVariantId: 'sku1', resourceRaw: { variantId: 'sku1' } });
  const h = harness(plan({ includeDetails: true }), async (request) => request.op === 'search'
    ? { products: [original], providerCalls: 1 }
    : { product: { ...original, size: '60 gummies' }, products: [{ ...original, id: 'different-local-id' }], patch: { sourceProductId: 'A', sourcePlatform: 'amazon', market: 'US', sourceVariantId: 'sku1' }, providerCalls: 1 });
  await h.drain();
  assert.equal(h.products.size, 1);
  assert.equal(h.products.has('different-local-id'), false);
  const saved = h.products.get(h.job.checkpoint.productIds[0]);
  assert.equal(saved.size, '60 gummies');
  assert.equal(saved.sourceVariantId, 'sku1');
  assert.equal(saved.dataCompletion.resourceDetail.status, 'completed');
});

test('Semrush discovery and shopping keep separate usage records without a unit cap', async () => {
  const h = harness(plan({ provider: 'semrush', routeId: 'shopping-semrush', maxProducts: 1, budget: budget({ semrushUnits: 0 }) }), async (request) => request.op === 'domains'
    ? { domains: ['merchant.example'], apiUnits: 20, providerCalls: 1 }
    : { products: [product('PLA1', { sourceProvider: 'Semrush' })], apiUnits: 30, providerCalls: 1 });
  await h.drain();
  assert.deepEqual(h.requests.map((request) => request.op), ['domains', 'shopping']);
  assert.equal(h.job.checkpoint.reserved.semrushUnits, 50);
  assert.equal(h.job.checkpoint.confirmedUsage.semrushUnits, 50);
  assert.equal(h.products.size, 1);
});

test('reported Semrush units above estimates are accounted without stopping later requests', async () => {
  const h = harness(plan({ provider: 'semrush', routeId: 'shopping-semrush', maxProducts: 1, budget: budget({ semrushUnits: 20 }) }), async (request) => request.op === 'domains'
    ? { domains: ['merchant.example'], apiUnits: 21, providerCalls: 1 }
    : { products: [product('PLA1', { sourceProvider: 'Semrush' })], apiUnits: 31, providerCalls: 1 });
  await h.drain();
  assert.equal(h.requests.length, 2);
  assert.equal(h.job.checkpoint.reserved.semrushUnits, 52);
  assert.equal(h.job.checkpoint.confirmedUsage.semrushUnits, 52);
  assert.notEqual(h.job.checkpoint.sourceStates.semrush.blocked, true);
});
