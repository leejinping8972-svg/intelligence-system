import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  runPlatformProducts,
  validatePlatformProducts,
} from './platform-products-jobs.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';

const noData = { content: [{ type: 'text', text: 'No data available.' }] };
const request = {
  provider: 'sorftime',
  op: 'search',
  term: 'synthetic query',
  market: 'US',
  page: 1,
};

function fixture(response) {
  const calls = [];
  return {
    calls,
    overrides: {
      cache: false,
      collectorEnv: async () => ({}),
      readSorftimeToken: async () => 'synthetic-token',
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
          {
            name: 'product_detail',
            inputSchema: {
              properties: { asin: {}, amz_site: { enum: ['US'] } },
            },
          },
        ],
        rpc: async (method, args) => {
          calls.push({ method, ...args });
          return structuredClone(response);
        },
      }),
    },
  };
}

test('Sorftime explicit no-data search completes empty after exactly one tool call', async () => {
  const f = fixture(noData);
  const result = await platformProductRequest(request, f.overrides);
  assert.deepEqual(result.products, []);
  assert.equal(result.sourceRows, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.sourceMessage, 'No data available.');
  assert.match(result.message, /无数据/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0], {
    method: 'tools/call',
    name: 'product_search_from_name',
    arguments: { name: request.term, query_type: 2, page: 1, amz_site: 'US' },
  });
});

test('Sorftime errors and ambiguous text remain failures without retry', async () => {
  for (const response of [
    { ...noData, isError: true },
    { ...noData, structuredContent: { success: false, message: 'denied' } },
    { content: [{ type: 'text', text: 'No data available. HTTP 429' }] },
    { content: [{ type: 'text', text: 'Invalid API key' }] },
    { content: [{ type: 'text', text: 'not-json' }] },
    { content: [{ type: 'text', text: 17 }] },
    { content: [...noData.content, { type: 'text', text: 'Internal error' }] },
    { content: [] },
  ]) {
    const f = fixture(response);
    await assert.rejects(
      platformProductRequest(request, f.overrides),
      (error) => {
        assert.ok(error.mcpPreview);
        return true;
      },
    );
    assert.equal(f.calls.length, 1);
  }
});

test('no-data text never overrides structured products or accepts missing detail', async () => {
  const f = fixture({
    ...noData,
    structuredContent: {
      data: [{ asin: 'B0EXAMPLE1', title: 'Synthetic Query Supplement' }],
    },
  });
  const result = await platformProductRequest(request, f.overrides);
  assert.equal(result.products.length, 1);
  assert.equal(result.sourceRows, 1);
  assert.equal(result.sourceMessage, undefined);
  const detail = fixture(noData);
  await assert.rejects(
    platformProductRequest(
      { ...request, op: 'detail', product: { sourceProductId: 'B0EXAMPLE1' } },
      detail.overrides,
    ),
    /格式无法识别/,
  );
  assert.equal(detail.calls.length, 1);
});

test('three empty discovery sources finish completed without products, AI or extra pages', async () => {
  const f = fixture(noData);
  const input = validatePlatformProducts({
    requestId: randomUUID(),
    terms: request.term,
    market: 'US',
    providers: ['sorftime', 'semrush', 'tiktok_shop'],
    completeAll: false,
    maxProducts: 100,
    perKeyword: 100,
  });
  let job = { id: randomUUID(), input, checkpoint: {} };
  const calls = [];
  const unexpected = async () =>
    assert.fail('Empty discovery must not write products or invoke AI');
  const io = {
    now: () => Date.parse('2026-11-12T10:00:00Z'),
    isCancelled: async () => false,
    saveCheckpoint: async (current, checkpoint, status) => {
      job = { ...current, checkpoint: structuredClone(checkpoint), status };
    },
    collect: async (_job, step, value) => {
      calls.push(step);
      if (value.provider === 'sorftime')
        return platformProductRequest(value, f.overrides);
      if (value.provider === 'semrush') return { domains: [], apiUnits: 0 };
      assert.equal(value.provider, 'tiktok_shop');
      return {
        products: [],
        hasMore: false,
        sourceRows: 29,
        cached: true,
        providerCalls: 0,
      };
    },
    upsertProduct: unexpected,
    readProduct: unexpected,
    linkKeyword: unexpected,
    translate: unexpected,
  };
  for (let i = 0; i < 3; i += 1) await runPlatformProducts(job, io);
  assert.equal(job.status, 'completed');
  assert.equal(job.checkpoint.index, 3);
  assert.equal(job.checkpoint.work.length, 3);
  assert.equal(job.checkpoint.failures, 0);
  assert.equal(job.checkpoint.products, 0);
  assert.deepEqual(job.checkpoint.productIds, []);
  assert.match(job.checkpoint.logs[0], /无数据/);
  assert.deepEqual(calls, ['platform:0', 'platform:1', 'platform:2']);
  assert.equal(f.calls.length, 1);
});
