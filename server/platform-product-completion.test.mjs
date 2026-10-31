/* eslint-disable vitest/no-import-node-test -- Server suite uses node --test. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  mergePlatformProduct,
  normalizeAmazon,
  normalizeAmazonTrend,
} from './platform-product-data.mjs';
import {
  runPlatformProducts,
  validatePlatformProducts,
} from './platform-products-jobs.mjs';
import {
  completionKey,
  completionProgress,
  productCompletionWork,
} from './platform-product-completion.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';
const at = '2026-10-19T10:00:00Z';
const product = (i = 0, market = 'US') =>
  normalizeAmazon(
    {
      asin: `B0T${String(i).padStart(7, '0')}`,
      title: `Fiber gummies ${i}`,
      brand: 'QA',
      price: 20,
    },
    market,
    at,
  );
function harness(input, docs = new Map()) {
  let job = { id: randomUUID(), input, checkpoint: {} },
    cancelled = false;
  const calls = [];
  const io = {
    now: () => Date.parse(at),
    isCancelled: async () => cancelled,
    readProduct: async (id) => docs.get(id),
    upsertProduct: async (p) => {
      const merged = mergePlatformProduct(docs.get(p.id), p);
      docs.set(p.id, merged);
      return merged;
    },
    linkKeyword: async () => {},
    saveCheckpoint: async (j, cp, status) => {
      job = { ...j, checkpoint: structuredClone(cp), status };
    },
    collect: async (_job, step, r) => {
      calls.push({ step, r });
      if (r.op === 'search')
        return {
          products: Array.from({ length: 20 }, (_, i) => product(i)),
          hasMore: true,
        };
      if (r.op === 'detail')
        return { product: { ...r.product, brand: 'QA full' } };
      if (r.op === 'content')
        return {
          patch: {
            sourceContent: { descriptions: ['QA material'] },
            ingredient: 'QA fiber',
          },
        };
      return {
        series: normalizeAmazonTrend(
          {
            data: {
              asin: r.product.sourceProductId,
              type: r.trendType,
              data: [202_608, 100, 202_609, 120],
            },
          },
          r.product,
          at,
          r.trendType,
        ),
      };
    },
  };
  return {
    io,
    docs,
    calls,
    get job() {
      return job;
    },
    cancel() {
      cancelled = true;
    },
    setJob(value) {
      job = value;
    },
    async run() {
      for (let i = 0; i < 300; i++) {
        await runPlatformProducts(job, io);
        if (['completed', 'partial', 'cancelled'].includes(job.status)) return;
      }
      throw new Error('did not finish');
    },
  };
}
const input = (patch) =>
  validatePlatformProducts({
    requestId: randomUUID(),
    terms: 'fiber gummies',
    market: 'US',
    providers: ['sorftime'],
    ...patch,
  });

test('complete-all mode completes the selected products beyond legacy request caps', async () => {
  const v = input({});
  assert.equal(v.completeAll, true);
  assert.equal(v.maxRequests, undefined);
  const h = harness(v);
  await h.run();
  assert.equal(h.job.status, 'completed');
  assert.equal(h.docs.size, 20);
  assert.equal(h.calls.length, 101); // one search + five operations for every product
  for (const p of h.docs.values()) {
    assert.equal(p.decisionData.series.length, 3);
    assert.equal(Object.keys(p.dataCompletion).length, 5);
    assert.ok(
      Object.values(p.dataCompletion).every((s) => s.status === 'completed'),
    );
  }
  assert.equal(completionProgress(h.job.checkpoint).withHistory, 20);
  const bounded = harness(input({ maxRequests: 1, maxDetailProducts: 1 }));
  await bounded.run();
  assert.equal(bounded.job.status, 'completed');
  assert.equal(bounded.calls.length, 101);
  assert.equal(bounded.docs.size, 20);
});

test('empty ASIN sales still fetches rank and review history without changing the metric scope', async () => {
  const p = product(),
    v = {
      ...input({}),
      mode: 'enrich',
      productIds: [p.id],
      seeds: [],
      initialWork: productCompletionWork(p, input({})),
    };
  const h = harness(v, new Map([[p.id, p]])),
    collect = h.io.collect;
  h.io.collect = async (...args) => {
    const result = await collect(...args);
    if (args[2].trendType === 'AsinSalesVolume') result.series.points = [];
    return result;
  };
  await h.run();
  const saved = h.docs.get(p.id);
  assert.equal(saved.dataCompletion.trend_AsinSalesVolume.status, 'empty');
  assert.deepEqual(saved.decisionData.series.map((s) => s.metric).toSorted(), [
    'review_count',
    'sales_rank',
  ]);
  assert.equal(h.calls.filter((c) => c.r.op === 'trend').length, 3);
});

test('completion-only jobs use each product market and never repeat product search', async () => {
  const a = product(0, 'US'),
    b = product(1, 'MX'),
    v = input({});
  const h = harness(
    {
      ...v,
      mode: 'enrich',
      productIds: [a.id, b.id],
      seeds: [],
      initialWork: [
        ...productCompletionWork(a, v),
        ...productCompletionWork(b, v),
      ],
    },
    new Map([
      [a.id, a],
      [b.id, b],
    ]),
  );
  await h.run();
  assert.equal(h.calls.length, 10);
  assert.ok(
    h.calls
      .filter((c) => c.r.product.id === b.id)
      .every((c) => c.r.market === 'MX'),
  );
  assert.ok(h.calls.every((c) => c.r.op !== 'search'));
});

test('one product step fails explicitly while every other step continues; resume does not replay committed work', async () => {
  const p = product(),
    v = input({}),
    h = harness(
      {
        ...v,
        seeds: [],
        productIds: [p.id],
        initialWork: productCompletionWork(p, v),
      },
      new Map([[p.id, p]]),
    );
  const collect = h.io.collect;
  h.io.collect = async (...args) => {
    if (args[2].op === 'content') throw new Error('HTTP 500 content failure');
    return collect(...args);
  };
  await runPlatformProducts(h.job, h.io);
  const resumed = structuredClone(h.job);
  h.setJob(resumed);
  await h.run();
  assert.equal(h.job.status, 'partial');
  assert.equal(h.calls.filter((c) => c.r.op === 'detail').length, 1);
  assert.equal(h.docs.get(p.id).dataCompletion.content.status, 'failed');
  assert.equal(h.docs.get(p.id).decisionData.series.length, 3);
});

test('cancellation records pending operations and preserves newer job ownership and prior histories', async () => {
  const p = product(),
    v = input({}),
    work = productCompletionWork(p, v);
  const states = Object.fromEntries(
    work.map((w) => [completionKey(w), { status: 'queued', jobId: 'same' }]),
  );
  const h = harness(
    { ...v, seeds: [], productIds: [p.id], initialWork: work },
    new Map([[p.id, { ...p, dataCompletion: states }]]),
  );
  h.setJob({
    ...h.job,
    id: 'same',
    checkpoint: { completion: { [p.id]: states } },
  });
  h.cancel();
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.ok(
    Object.values(h.docs.get(p.id).dataCompletion).every(
      (s) => s.status === 'cancelled',
    ),
  );
  const protectedState = mergePlatformProduct(
    { ...p, dataCompletion: { detail: { status: 'queued', jobId: 'newer' } } },
    {
      id: p.id,
      dataCompletion: { detail: { status: 'completed', jobId: 'older' } },
    },
  );
  assert.equal(protectedState.dataCompletion.detail.jobId, 'newer');
});

test('separate trend types use separate cache entries; empty history can be refreshed explicitly', async () => {
  const store = new Map(),
    types = [];
  const overrides = {
    cache: {
      read: async (k) => store.get(k),
      write: async (k, v) => store.set(k, v),
    },
    collectorEnv: async () => ({}),
    readSorftimeToken: async () => 'qa-only',
    connectSorftime: async () => ({
      tools: [
        {
          name: 'product_trend',
          inputSchema: {
            properties: { asin: {}, type: {}, amz_site: { enum: ['US'] } },
          },
        },
      ],
      rpc: async (_method, call) => {
        types.push(call.arguments.type);
        return {
          structuredContent: {
            data: {
              asin: product().sourceProductId,
              type: call.arguments.type,
              data: [],
            },
          },
        };
      },
    }),
  };
  const r = {
    provider: 'sorftime',
    op: 'trend',
    market: 'US',
    product: product(),
  };
  for (const trendType of ['AsinSalesVolume', 'Rank', 'ReviewCount'])
    await platformProductRequest({ ...r, trendType }, overrides);
  await platformProductRequest({ ...r, trendType: 'Rank' }, overrides);
  assert.deepEqual(types, ['AsinSalesVolume', 'Rank', 'ReviewCount']);
  await platformProductRequest(
    { ...r, trendType: 'Rank', refreshEmpty: true },
    overrides,
  );
  assert.equal(types.length, 4);
});

test('normalization preserves exact monthly metrics and rejects mixed ASIN or types', () => {
  for (const type of ['Rank', 'ReviewCount']) {
    const s = normalizeAmazonTrend(
      {
        data: {
          asin: product().sourceProductId,
          type,
          data: ['202608', 100, '202609', 120, '202610', 130],
        },
      },
      product(),
      at,
      type,
    );
    assert.equal(s.points.length, 3);
    assert.equal(s.points.at(-1).partial, true);
  }
  assert.throws(
    () =>
      normalizeAmazonTrend(
        { data: { type: 'SalesVolume', data: [] } },
        product(),
        at,
      ),
    /口径不一致/,
  );
  assert.deepEqual(
    productCompletionWork(
      { ...product(), sourceProvider: 'Semrush' },
      input({}),
    ),
    [],
  );
});


test('nonempty unrecognized history is an explicit parsing failure, missing values stay empty', () => {
  assert.throws(() => normalizeAmazonTrend({data: {type: 'Rank', data: ['not-a-month', 12]}}, product(), at, 'Rank'), /结构无法识别/);
  assert.equal(normalizeAmazonTrend({data: {type: 'Rank', data: ['202608', -1, '202609', null]}}, product(), at, 'Rank').points.length, 0);
});


test('repeated discovery pages stop pagination while all unique products still complete', async () => {
  const h = harness(input({perKeyword: 60}));
  const collect = h.io.collect;
  h.io.collect = async (...args) => {
    const r = await collect(...args);
    if (args[2].op === 'search') r.pageFingerprint = 'same-page';
    return r;
  };
  await h.run();
  assert.equal(h.calls.filter(c => c.r.op === 'search').length, 2);
  assert.equal(h.docs.size,20);
  assert.ok([...h.docs.values()].every(p => p.decisionData.series.length === 3));
});

test('full source history remains preserved beyond the previous 36-month storage cut', () => {
  const p = product();
  const points = Array.from({length:48}, (_,i) => ({start: new Date(Date.UTC(2022, i, 1)).toISOString().slice(0,10),end: new Date(Date.UTC(2022, i+1,0)).toISOString().slice(0,10),value:i+1}));
  const series = {provider:'Sorftime',platform:'Amazon',market:'US',productId:p.sourceProductId,metric:'sales_volume',period:'month',points};
  const saved = mergePlatformProduct(p, {id:p.id,decisionData:{series:[series]}});
  assert.equal(saved.decisionData.series[0].points.length,48);
});


test('cancel during an in-flight response preserves the result and clears queued follow-up states', async () => {
  const h = harness(input({}));
  const collect=h.io.collect;
  h.io.collect=async (...args)=> {const r=await collect(...args);h.cancel();return r;};
  await h.run();
  assert.equal(h.job.status,'cancelled');
  assert.equal(h.calls.length,1);
  assert.equal(h.docs.size,20);
  assert.ok([...h.docs.values()].every(p => Object.values(p.dataCompletion).every(s=>s.status==='cancelled')));
});
