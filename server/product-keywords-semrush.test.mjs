import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';

import { pool } from './database.mjs';
import { encryptSemrushKey } from './semrush-config.mjs';
import { collectSemrush } from './semrush-reports.mjs';

test('non-trend Semrush reports omit trend, reuse normal or dedicated cache, and preserve missing metrics', async () => {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const stored = encryptSemrushKey('synthetic-product-keyword-not-live', process.env.PROVIDER_CONFIG_ENCRYPTION_KEY);
  const cache = new Map();
  const base = (term) => `semrush:metrics:US:${createHash('sha256').update(term).digest('hex')}`;
  let calls = 0;
  let empty = false;
  pool.query = async (statement, args) => {
    if (statement.startsWith('SELECT')) {
      const value = args[0] === 'provider:semrush:mcp:v1' ? stored : cache.get(args[0]);
      return { rows: value ? [{ value }] : [] };
    }
    cache.set(args[0], args[1]);
    return { rows: [] };
  };
  globalThis.fetch = async (_url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    let result = { protocolVersion: '2025-03-26', tools: [] };
    if (params?.name === 'get_report_schema') result = { structuredContent: {
      report: 'phrase_this', parameters: { database: { enum: ['us'] }, export_columns: { items: { enum: ['keyword', 'volume', 'keyword_difficulty', 'cpc', 'trend', 'results'] } } },
    } };
    if (params?.name === 'execute_report') {
      calls++;
      assert.equal(params.arguments.report, 'phrase_this');
      assert.equal(params.arguments.params.export_columns.includes('trend'), false);
      result = { structuredContent: {
        data: empty ? [] : [{ keyword: params.arguments.params.phrase, volume: 100, keyword_difficulty: 25, cpc: 1.5, results: 500 }],
        metadata: { usage: { api_units: 10 } },
      } };
    }
    return Response.json({ jsonrpc: '2.0', id, result });
  };
  try {
    const request = { keywords: ['magnesium glycinate'], markets: ['US'], nonTrendOnly: true };
    const first = await collectSemrush(request);
    assert.equal(calls, 1); assert.equal(first.metrics.monthlySearchVolume, 100);
    assert.equal(first.metrics.searchTrend, undefined);
    assert.ok(cache.has(`${base('magnesium glycinate')}:metrics-only`));
    assert.equal(cache.has(base('magnesium glycinate')), false);
    const repeated = await collectSemrush(request);
    assert.equal(calls, 1); assert.equal(repeated.cached, true); assert.equal(repeated.apiUnits, 0);
    const original = { cachedAt: new Date().toISOString(), result: { complete: true, metrics: {
      market: 'US', monthlySearchVolume: 25, collectedAt: '2026-11-12T00:00:00Z', searchTrend: { values: [1, 2] },
    } } };
    cache.set(base('vitamin c'), original);
    const normalCache = await collectSemrush({ ...request, keywords: ['vitamin c'] });
    assert.equal(normalCache.metrics.monthlySearchVolume, 25);
    assert.equal(normalCache.metrics.searchTrend, undefined);
    assert.equal(normalCache.metrics.collectedAt, '2026-11-12T00:00:00Z');
    assert.deepEqual(cache.get(base('vitamin c')), original);
    assert.equal(calls, 1);
    empty = true;
    const unknown = await collectSemrush({ ...request, keywords: ['synthetic absent keyword'] });
    assert.equal(unknown.metrics, null); assert.match(unknown.message, /不能当成搜索量为0/);
  } finally {
    pool.query = originalQuery; globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = originalSecret;
    await pool.end();
  }
});
