/* oxlint-disable vitest/no-import-node-test -- Node server tests run without Vitest. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { pool } from './database.mjs';
import { encryptSemrushKey, semrushAction } from './semrush-config.mjs';
import { collectSemrush } from './semrush-reports.mjs';
import process from 'node:process';
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
test('original journals count once across resumes, caches, sources and markets; explicit zero is confirmed', () => {
  const same = request('sem-metric:0', { apiUnits: 10 });
  const summary = summarizeSemrushUsage(
    [
      same,
      same,
      request('sem-metric:1', { apiUnits: 900, cached: true }),
      request('metrics:0', { apiUnits: 0 }, 'done', 'another-market'),
      request('domain:0', { apiUnits: 20 }),
      request('site-score:s1', { apiUnits: 30 }),
      request('platform:0', { apiUnits: 40, provider: 'semrush' }),
      request('platform:1', { apiUnits: 5000, provider: 'sorftime' }),
      request('ad:0', { apiUnits: 9999 }),
    ],
    [
      {
        name: 'competitor:request:qa',
        step: 'semrush:creatine',
        status: 'completed',
        record: { apiUnits: 50 },
      },
    ],
  );
  assert.equal(summary.confirmedUnits, 150);
  assert.equal(summary.confirmedRecords, 6);
  assert.equal(summary.cachedRecords, 1);
  assert.equal(summary.unknownRecords, 0);
  assert.equal(
    summary.breakdown.find((g) => g.id === 'sites').confirmedUnits,
    50,
  );
  assert.equal(summary.firstRecordedAt, '2026-10-01T00:00:00.000Z');
});

test('missing, malformed, failed and in-flight charges remain unknown; unclassified platforms are separate', () => {
  const records = [null, undefined, -1, '10', 1.5, Infinity].map(
    (apiUnits, i) => request(`sem-metric:${i}`, { apiUnits }),
  );
  records.push(
    request('metrics:20', { apiUnits: 999 }, 'failed'),
    request('metrics:21', {}, 'started'),
    request('platform:30', { apiUnits: 99 }),
  );
  const summary = summarizeSemrushUsage(records, []);
  assert.equal(summary.confirmedUnits, 0);
  assert.equal(summary.confirmedRecords, 0);
  assert.equal(summary.unknownRecords, 8);
  assert.equal(summary.unclassifiedRecords, 1);
});

test('legacy and partially charged expansions expose gaps without discarding confirmed subtotals', () => {
  const summary = summarizeSemrushUsage(
    [
      request('sem-discover:0', { apiUnits: 60 }),
      request('sem-discover:1', { apiUnits: 20, unknownCharges: 1 }),
      request('sem-discover:2', { apiUnits: 0, unknownCharges: 0 }),
    ],
    [],
  );
  assert.equal(summary.confirmedUnits, 80);
  assert.equal(summary.unknownRecords, 2);
  assert.equal(summary.confirmedRecords, 3);
});

test('admin refresh does not read/decrypt credentials, write config or call external providers', async () => {
  let calls = 0;
  const expected = summarizeSemrushUsage([], []);
  const fail = async () => {
    throw new Error('must not access credentials or external providers');
  };
  const io = {
    read: fail,
    write: fail,
    balance: fail,
    status: fail,
    usage: async () => {
      calls++;
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
  const result = await semrushUsage({
    query: async (statement) => {
      statements.push(statement);
      assert.match(statement, /^SELECT/);
      assert.doesNotMatch(
        statement,
        /INSERT|UPDATE|DELETE|provider_configs|SELECT \*/,
      );
      return {
        rows: statement.includes('research_requests')
          ? [request('sem-metric:0', { apiUnits: 20 })]
          : [],
      };
    },
  });
  assert.equal(result.confirmedUnits, 20);
  assert.equal(statements.length, 2);
});

test('storage failure fails refresh instead of reporting a false zero or partial total', async () => {
  await assert.rejects(
    () =>
      semrushUsage({
        query: async (statement) => {
          if (statement.includes('workspace_documents'))
            throw new Error('synthetic storage unavailable');
          return { rows: [request('sem-metric:0', { apiUnits: 20 })] };
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
