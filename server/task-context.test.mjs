import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { decorateTaskContexts, taskContext } from './task-context.mjs';
import { compactTask } from './workspace-snapshot.mjs';

const job = (input = {}, checkpoint = {}) => ({ id: 'verify-test', input: { kind: 'platform_products', market: 'US', markets: ['US'], manualSalesVerification: true, verifyOnly: true, targetId: 'synthetic-product', sourceProductId: 'B012345678', ...input }, checkpoint });
const task = { id: 'verify-test:US', cloudJobId: 'verify-test', market: 'US', steps: [] };
const receipt = { jobId: 'verify-test', result: 'success', fresh: { asin: 'B012345678', market: 'US', monthlySales: 0, collectedAt: '2026-11-05T10:00:00Z', salesEvidence: { provider: 'Sorftime' } }, previous: { monthlySales: 7 }, providerCalls: 1, modelCalls: 0, usage: { requests: 4 } };

test('verification has an explicit purpose and ID before the product lookup; input is never changed', () => {
  const input = job();
  const before = structuredClone(input);
  const context = taskContext(input);
  assert.equal(context.title, '商品销量核对');
  assert.equal(context.objectCount, 1);
  assert.equal(context.objects[0].sourceId, 'B012345678');
  assert.match(context.scope, /不更新商品库/);
  assert.deepEqual(input, before);
});

test('batch target count survives preview truncation, duplicate IDs and compaction', () => {
  const context = taskContext(job({ targetId: 'p0', productIds: Array.from({ length: 18 }, (_, i) => `p${i}`) }));
  assert.equal(context.objectCount, 18);
  assert.equal(context.objects.length, 8);
  assert.equal(context.hasMore, true);
  assert.equal(compactTask({ ...task, context }).context.objectCount, 18);
});

test('pure keyword, site and historical descriptions do not invent a product', () => {
  const keyword = taskContext({ input: { seeds: ['magnesium'], expansionOnly: true } });
  assert.equal(keyword.title, '关键词发现');
  assert.equal(keyword.objects[0].kind, 'keywords');
  const site = taskContext({ input: { kind: 'products', records: [{ id: 's1', domain: 'example.test' }] } });
  assert.equal(site.objects[0].label, 'example.test');
  assert.equal(site.objects[0].kind, 'sites');
  assert.equal(taskContext({ input: { kind: 'future_kind' } }).title, '任务资料待检查');
  assert.equal(taskContext({}).objectCount, null);
});

test('context hydration reads only explicit target IDs and preserves actual zero values', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb)');
    for (const [id, title] of [['synthetic-product', 'Synthetic Magnesium'], ['unrelated', 'Unrelated product']]) await db.query('INSERT INTO workspace_documents VALUES($1,$2)', [`business:products:${id}`, { id, title, titleZh: id === 'synthetic-product' ? '合成测试镁胶囊' : '', market: 'US', sourcePlatform: 'Amazon', sourceProductId: 'B012345678' }]);
    const calls = [];
    const connection = { query: (sql, params) => { calls.push({ sql, params }); return db.query(sql, params); } };
    const input = job({}, { receipt });
    const original = structuredClone(input);
    const [result] = await decorateTaskContexts([task], [input], connection, { detail: true });
    assert.deepEqual(calls[0].params, ['business:products:synthetic-product']);
    assert.equal(calls.length, 1);
    assert.equal(result.context.objects[0].label, '合成测试镁胶囊');
    assert.equal(result.context.objects[0].original, 'Synthetic Magnesium');
    assert.equal(result.context.objects[0].identifierLabel, 'ASIN');
    assert.equal(result.context.result.metrics[0].value, '0');
    assert.deepEqual(result.context.result.usage.at(-1), { label: '模型调用', value: 0 });
    assert.match(result.context.result.notice, /未覆盖/);
    assert.deepEqual(input, original);
  } finally { await db.close(); }
});

test('deleted target falls back to its recorded ASIN; another market cannot supply its name', async () => {
  for (const rows of [[], [{ name: 'business:products:synthetic-product', value: { title: 'Wrong country', market: 'MX' } }]]) {
    const [result] = await decorateTaskContexts([task], [job()], { query: async () => ({ rows }) });
    assert.equal(result.context.objects[0].label, '名称未记录');
    assert.equal(result.context.objects[0].sourceId, 'B012345678');
    assert.equal(result.context.objects[0].identifierLabel, 'ASIN');
  }
});

test('a foreign receipt or ASIN cannot become this task’s result', async () => {
  for (const patch of [{ jobId: 'another-job' }, { fresh: { ...receipt.fresh, asin: 'B099999999' } }, { fresh: { ...receipt.fresh, market: 'MX' } }, { result: 'failed' }]) {
    const [result] = await decorateTaskContexts([task], [job({}, { receipt: { ...receipt, ...patch } })], { query: async () => ({ rows: [] }) }, { detail: true });
    assert.equal(result.context.result, undefined);
  }
});

test('keyword-only pages need no document lookup and no result payload', async () => {
  const input = { id: 'verify-test', input: { seeds: ['test'] } };
  const [result] = await decorateTaskContexts([task], [input], { query: () => { throw new Error('Unexpected lookup'); } });
  assert.equal(result.context.objects[0].label, 'test');
  assert.equal(result.context.result, undefined);
});

test('non-Amazon source IDs are not labelled ASIN', async () => {
  const [result] = await decorateTaskContexts([task], [job({ manualSalesVerification: false })], { query: async () => ({ rows: [{ name: 'business:products:synthetic-product', value: { title: 'Synthetic item', sourcePlatform: 'Shopee', sourceProductId: '1234567890', market: 'US' } }] }) });
  assert.equal(result.context.objects[0].identifierLabel, '来源编号');
});
