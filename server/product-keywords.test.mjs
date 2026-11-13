import assert from 'node:assert/strict';
import test from 'node:test';

import { productKeywordSample, validateProductKeywords } from './product-keywords-domain.mjs';
import { runProductKeywordJob } from './product-keywords-engine.mjs';
import { semrushExportColumns } from './semrush-keyword-trends.mjs';

const product = () => ({
  id: 'p1', market: 'US', brand: 'Example', dataNature: 'collected',
  title: 'Example Magnesium Glycinate Capsules for Sleep Support, Iron-Free, 60 Capsules',
  sourceUrl: 'https://example.test/product', sourceProductId: 'B000000001',
});
const candidate = (term, patch = {}) => ({
  term, termZh: '甘氨酸镁', kind: 'ingredient', sourceId: 'title', quote: product().title, ...patch,
});

test('only source-backed phrases survive, with brands, packaging, negated ingredients and substring guesses rejected', () => {
  const sample = productKeywordSample(product());
  const result = validateProductKeywords({ keywords: [
    candidate('Magnesium Glycinate'), candidate('MAGNESIUM   GLYCINATE'),
    candidate('Sleep Support', { kind: 'benefit', termZh: '睡眠支持' }),
    candidate('Example'), candidate('Capsules'), candidate('60 Capsules'), candidate('Iron'),
    candidate('Vitamin C'), candidate('Magnesium', { sourceId: 'other-product' }),
    candidate('Glycinate', { quote: 'This is invented text' }),
  ] }, sample);
  assert.deepEqual(result.map((item) => item.term), ['Magnesium Glycinate', 'Sleep Support']);
  assert.equal(result[0].evidence.productId, 'p1');
  assert.equal(result[0].evidence.basis, 'product_text_candidate');
  assert.throws(() => validateProductKeywords({ keywords: [candidate('Iron')] }, sample), /原文依据/);
  assert.deepEqual(validateProductKeywords({ keywords: [] }, sample), []);
  assert.throws(() => validateProductKeywords({}, sample), /格式无效/);
  const environment = productKeywordSample({ ...product(), title: 'Environmental support' });
  assert.throws(() => validateProductKeywords({ keywords: [candidate('iron', { quote: 'Environmental support' })] }, environment), /原文依据/);
  const without = productKeywordSample({ ...product(), title: 'Without Iron, with Magnesium Glycinate' });
  assert.throws(() => validateProductKeywords({ keywords: [candidate('Iron', { quote: without.sources[0].text })] }, without), /原文依据/);
  for (const title of ['Without Iron', 'No added Iron', 'Iron-Free', 'Free of Iron', '不含Iron']) {
    const sample = productKeywordSample({ ...product(), title });
    assert.throws(() => validateProductKeywords({ keywords: [candidate('Iron', { quote: 'Iron' })] }, sample), /原文依据/);
  }
});

test('fingerprint follows original sources and market, while translations and collection timestamps do not cause new jobs', () => {
  const original = productKeywordSample(product());
  assert.equal(original.fingerprint, productKeywordSample({ ...product(), titleZh: '商品中文', lastCollectedAt: '2030-01-01' }).fingerprint);
  assert.notEqual(original.fingerprint, productKeywordSample({ ...product(), market: 'MX' }).fingerprint);
  assert.notEqual(original.fingerprint, productKeywordSample({ ...product(), title: 'Changed source' }).fingerprint);
});

function fixture() {
  const p = product();
  const sample = productKeywordSample(p);
  const job = { id: 'j1', input: { kind: 'product_keywords', targetId: p.id, market: p.market, sample }, checkpoint: {}, status: 'queued' };
  const requests = [];
  const saved = [];
  const states = [];
  const io = {
    now: () => '2026-11-13T12:00:00Z', cancelled: async () => false,
    hasConfig: async () => true, readProduct: async () => p,
    updateProduct: async (_job, value) => states.push(value),
    collect: async (_job, step, request) => {
      requests.push({ step, request });
      if (step === 'product-keywords') return {
        keywords: validateProductKeywords({ keywords: [candidate('Magnesium Glycinate'), candidate('Sleep Support', { kind: 'benefit' })] }, sample), model: 'synthetic',
      };
      return { complete: true, metrics: { market: 'US', source: 'Semrush MCP', monthlySearchVolume: 0, difficulty: 25 }, message: 'synthetic metrics' };
    },
    linkKeywords: async (_job, candidates) => candidates.map((item, index) => ({ id: `k${index}`, term: item.term, market: 'US' })),
    saveMetrics: async (...args) => saved.push(args),
    saveCheckpoint: async (_job, cp, status) => { job.checkpoint = structuredClone(cp); if (status) job.status = status; },
  };
  return { p, job, io, requests, saved, states };
}

test('product keywords run without expansion or trend calls and a completed checkpoint never recollects', async () => {
  const f = fixture();
  await runProductKeywordJob(f.job, f.io);
  assert.equal(f.job.status, 'completed');
  assert.equal(f.requests.length, 3);
  assert.equal(f.saved.length, 2);
  for (const { request } of f.requests.slice(1)) {
    assert.deepEqual(request.sources, ['semrush']);
    assert.equal(request.nonTrendOnly, true);
    assert.equal(request.semExpansion, undefined);
  }
  assert.equal(f.saved[0][2].monthlySearchVolume, 0);
  await runProductKeywordJob(f.job, f.io);
  assert.equal(f.requests.length, 3);
});

test('missing search configuration leaves keywords linked and later completion resumes without extracting again', async () => {
  const f = fixture();
  f.io.hasConfig = async (name) => name !== 'provider:semrush:mcp:v1';
  await runProductKeywordJob(f.job, f.io);
  assert.equal(f.job.status, 'partial');
  assert.equal(f.job.checkpoint.linked, true);
  assert.equal(f.requests.length, 1);
  f.io.hasConfig = async () => true;
  await runProductKeywordJob(f.job, f.io);
  assert.equal(f.job.status, 'completed');
  assert.equal(f.requests.filter((item) => item.step === 'product-keywords').length, 1);
});

test('changed or deleted product and cancellation do not start provider requests', async () => {
  for (const mode of ['changed', 'deleted', 'cancelled', 'unconfigured']) {
    const f = fixture();
    if (mode === 'changed') f.p.title = 'Changed original';
    if (mode === 'deleted') f.io.readProduct = async () => undefined;
    if (mode === 'cancelled') f.io.cancelled = async () => true;
    if (mode === 'unconfigured') f.io.hasConfig = async () => false;
    await runProductKeywordJob(f.job, f.io);
    assert.equal(f.requests.length, 0);
  }
});

test('unknown model outcome stops, while mismatched-market metrics never reach persistence', async () => {
  const failed = fixture();
  failed.io.collect = async () => { throw Error('结果未知'); };
  await runProductKeywordJob(failed.job, failed.io);
  assert.equal(failed.job.status, 'failed');
  assert.match(failed.job.checkpoint.logs.at(-1), /未自动重放/);
  const mismatch = fixture();
  const original = mismatch.io.collect;
  mismatch.io.collect = async (...args) => args[1] === 'product-keywords' ? original(...args) : { metrics: { market: 'MX' } };
  await runProductKeywordJob(mismatch.job, mismatch.io);
  assert.equal(mismatch.job.status, 'partial');
  assert.equal(mismatch.saved.length, 1);
  assert.equal(mismatch.saved[0][1].status, 'failed');
  assert.equal(mismatch.saved[0][2], undefined);
});

test('non-trend reports request all supported metrics while explicitly omitting trend', () => {
  const schema = { parameters: { export_columns: { items: { enum: ['keyword', 'volume', 'keyword_difficulty', 'cpc', 'trend', 'results'] } } } };
  assert.deepEqual(semrushExportColumns(schema, false), ['keyword', 'volume', 'keyword_difficulty', 'cpc', 'results']);
  assert.ok(semrushExportColumns(schema).includes('trend'));
});
