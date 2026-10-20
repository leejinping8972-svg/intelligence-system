/* oxlint-disable vitest/no-import-node-test -- Node server tests run without Vitest. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { test } from 'node:test';

import { pool } from './database.mjs';
import {
  decryptSemrushKey,
  encryptSemrushKey,
  semrushAction,
  semrushKeyIdentifier,
} from './semrush-config.mjs';
import { collectSemrush } from './semrush-reports.mjs';
import { semrushUsage, summarizeSemrushUsage } from './semrush-usage.mjs';

const request = (
  step,
  record = {},
  status = 'done',
  job_id = 'synthetic-job',
) => ({
  job_id,
  step,
  record,
  status,
  created_at: '2026-10-01T00:00:00Z',
});
const current = { currentKeyId: 'current-key', keyConfigured: true };
test('usage separates current, previous and unassigned keys while counting original journals once', () => {
  const same = request('sem-metric:0', {
    apiUnits: 10,
    semrushKeyId: 'current-key',
  });
  const summary = summarizeSemrushUsage(
    [
      same,
      same,
      request('sem-metric:1', { apiUnits: 900, cached: true }),
      request(
        'metrics:0',
        { apiUnits: 0, semrushKeyId: 'current-key' },
        'done',
        'another-market',
      ),
      request('domain:0', { apiUnits: 20, semrushKeyId: 'current-key' }),
      request('site-score:s1', { apiUnits: 30, semrushKeyId: 'current-key' }),
      request('platform:0', {
        apiUnits: 40,
        provider: 'semrush',
        semrushKeyId: 'current-key',
      }),
      request('platform:1', { apiUnits: 5000, provider: 'sorftime' }),
      request('ad:0', { apiUnits: 9999 }),
      request('metrics:old', { apiUnits: 500, semrushKeyId: 'old-key' }),
      request('metrics:legacy', { apiUnits: 80 }),
    ],
    [
      {
        name: 'competitor:request:qa',
        step: 'semrush:creatine',
        status: 'completed',
        record: { apiUnits: 50, semrushKeyId: 'current-key' },
      },
    ],
    new Date(),
    current,
  );
  assert.equal(summary.currentKey.confirmedUnits, 150);
  assert.equal(summary.currentKey.confirmedRecords, 6);
  assert.equal(summary.otherKeys.confirmedUnits, 500);
  assert.equal(summary.unassigned.confirmedUnits, 80);
  assert.equal(summary.cachedRecords, 1);
  assert.equal(summary.unknownRecords, 0);
  assert.equal(
    summary.currentKey.breakdown.find((g) => g.id === 'sites').confirmedUnits,
    50,
  );
  assert.equal(summary.firstRecordedAt, '2026-10-01T00:00:00.000Z');
});

test('missing, malformed, failed and in-flight charges remain unknown; unclassified platforms are separate', () => {
  const records = [null, undefined, -1, '10', 1.5, Infinity].map(
    (apiUnits, i) =>
      request(`sem-metric:${i}`, { apiUnits, semrushKeyId: 'current-key' }),
  );
  records.push(
    request(
      'metrics:20',
      { apiUnits: 999, semrushKeyId: 'current-key' },
      'failed',
    ),
    request('metrics:21', { semrushKeyId: 'current-key' }, 'started'),
    request('platform:30', { apiUnits: 99 }),
  );
  const summary = summarizeSemrushUsage(records, [], new Date(), current);
  assert.equal(summary.currentKey.confirmedUnits, 0);
  assert.equal(summary.currentKey.confirmedRecords, 0);
  assert.equal(summary.currentKey.unknownRecords, 8);
  assert.equal(summary.unclassifiedRecords, 1);
});

test('legacy and partially charged expansions expose gaps without discarding confirmed subtotals', () => {
  const summary = summarizeSemrushUsage(
    [
      request('sem-discover:0', { apiUnits: 60, semrushKeyId: 'current-key' }),
      request('sem-discover:1', {
        apiUnits: 20,
        unknownCharges: 1,
        semrushKeyId: 'current-key',
      }),
      request('sem-discover:2', {
        apiUnits: 0,
        unknownCharges: 0,
        semrushKeyId: 'current-key',
      }),
    ],
    [],
    new Date(),
    current,
  );
  assert.equal(summary.currentKey.confirmedUnits, 80);
  assert.equal(summary.currentKey.unknownRecords, 2);
  assert.equal(summary.currentKey.confirmedRecords, 3);
});

test('admin refresh identifies the configured key locally without writing config or calling providers', async () => {
  let calls = 0;
  const secret = randomBytes(32).toString('base64');
  const stored = encryptSemrushKey('synthetic-current-key', secret);
  const expected = summarizeSemrushUsage([], [], new Date(), current);
  const io = {
    read: async () => stored,
    write: async () => assert.fail('usage refresh must not write config'),
    secret,
    balance: async () => assert.fail('usage refresh must not call balance API'),
    status: async () => assert.fail('usage refresh must not connect to MCP'),
    usage: async (options) => {
      calls++;
      assert.equal(options.keyConfigured, true);
      assert.equal(
        options.currentKeyId,
        semrushKeyIdentifier(decryptSemrushKey(stored, secret), secret),
      );
      return expected;
    },
  };
  await assert.rejects(
    () =>
      semrushAction(
        { action: 'server_semrush_usage' },
        { role: 'researcher' },
        io,
      ),
    /管理员/,
  );
  assert.deepEqual(
    await semrushAction(
      { action: 'server_semrush_usage' },
      { role: 'admin' },
      io,
    ),
    expected,
  );
  assert.equal(calls, 1);
});

test('query only projects billing metadata and reads each original journal source once', async () => {
  const statements = [];
  const result = await semrushUsage(current, {
    query: async (statement) => {
      statements.push(statement);
      assert.match(statement, /^SELECT/);
      assert.doesNotMatch(
        statement,
        /INSERT|UPDATE|DELETE|provider_configs|SELECT \*/,
      );
      return {
        rows: statement.includes('research_requests')
          ? [
              request('sem-metric:0', {
                apiUnits: 20,
                semrushKeyId: 'current-key',
              }),
            ]
          : [],
      };
    },
  });
  assert.equal(result.currentKey.confirmedUnits, 20);
  assert.equal(statements.length, 2);
});

test('storage failure fails refresh instead of reporting a false zero or partial total', async () => {
  await assert.rejects(
    () =>
      semrushUsage(current, {
        query: async (statement) => {
          if (statement.includes('workspace_documents'))
            throw new Error('synthetic storage unavailable');
          return {
            rows: [
              request('sem-metric:0', {
                apiUnits: 20,
                semrushKeyId: 'current-key',
              }),
            ],
          };
        },
      }),
    /storage unavailable/,
  );
});

test('expansion retains confirmed units and marks missing metadata or failed reports as unconfirmed', async () => {
  const previousQuery = pool.query;
  const previousFetch = globalThis.fetch;
  const previousSecret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  const secret = randomBytes(32).toString('base64');
  const stored = encryptSemrushKey('synthetic-usage-mcp-key', secret);
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = secret;
  let reports = 0;
  pool.query = async () => ({ rows: [{ value: stored }] });
  globalThis.fetch = async (_url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    if (method === 'notifications/initialized')
      return new Response(null, { status: 202 });
    let result = { protocolVersion: '2025-03-26', tools: [] };
    if (params.name === 'get_report_schema')
      result = {
        structuredContent: {
          report: params.arguments.report,
          parameters: {
            database: { enum: ['us'] },
            export_columns: { items: { enum: ['keyword', 'volume'] } },
          },
        },
      };
    if (params.name === 'execute_report') {
      reports++;
      result =
        reports === 3
          ? {
              isError: true,
              content: [{ type: 'text', text: 'Semrush HTTP 429' }],
            }
          : {
              structuredContent: {
                data: [{ keyword: `synthetic ${reports}`, volume: 100 }],
                ...(reports === 1
                  ? { metadata: { usage: { api_units: 20 } } }
                  : {}),
              },
            };
    }
    return Response.json({ jsonrpc: '2.0', id, result });
  };
  try {
    const result = await collectSemrush({
      keywords: ['synthetic'],
      markets: ['US'],
      semExpansion: true,
      limit: 10,
    });
    assert.equal(result.apiUnits, 20);
    assert.equal(typeof result.semrushKeyId, 'string');
    assert.notEqual(result.semrushKeyId, 'synthetic-usage-mcp-key');
    assert.equal(result.semrushUnknownCharges, 2);
    assert.equal(reports, 3);
    assert.equal(result.suggestions[0].items.length, 2);
  } finally {
    pool.query = previousQuery;
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined)
      delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = previousSecret;
  }
});
