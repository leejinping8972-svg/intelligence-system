import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Server tests use the Node test runner.
import test from 'node:test';
import { randomBytes } from 'node:crypto';

import {
  parseSemrushTrend,
  semrushExportColumns,
  semrushTrendSummary,
} from './semrush-keyword-trends.mjs';
import { collectSemrush, csvRows, rowMetrics } from './semrush-reports.mjs';
import { editableKeywordPatch, validateJob } from './domain.mjs';
import { mergeKeywordMetrics } from './keyword-data.mjs';
import { projectRecord } from './workspace-reads.mjs';
import { researchSignature } from './keyword-submit.mjs';
import { encryptSemrushKey } from './semrush-config.mjs';
import { pool } from './database.mjs';
import { runJob } from './runner.mjs';

const at = '2026-11-09T04:30:00Z';
const values = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.4, 0.4, 0.4, 0.8, 0.8, 1];
const metrics = (patch = {}) => ({
  market: 'US',
  source: 'Semrush MCP',
  collectedAt: at,
  searchTrend: parseSemrushTrend(values, at, 'phrase_this'),
  ...patch,
});

test('all four schemas request only supported columns, including trend and secondary evidence', () => {
  const supported = [
    'keyword',
    'volume',
    'trend',
    'results',
    'relevance',
    'triggered_serp_features',
  ];
  assert.deepEqual(
    new Set(
      semrushExportColumns({
        parameters: { export_columns: { items: { enum: supported } } },
      }),
    ),
    new Set(supported),
  );
  assert.deepEqual(
    semrushExportColumns({
      parameters: {
        export_columns: { items: { enum: ['keyword', 'volume'] } },
      },
    }),
    ['keyword', 'volume'],
  );
  assert.deepEqual(semrushExportColumns({}), []);
});

test('CSV and structured replies retain monthly series, zero values, relevance and SERP evidence', () => {
  const [row] = csvRows(
    `Keyword;Search Volume;Number of Results;Trends;Related Relevance;SERP Features\nsynthetic;0;0;${values.join(',')};0;5,9,13`,
  );
  const result = rowMetrics(row, 'US', at, 'phrase_related');
  assert.equal(result.monthlySearchVolume, 0);
  assert.equal(result.searchResultCount, 0);
  assert.equal(result.relatedRelevance, 0);
  assert.deepEqual(result.serpFeatures, ['5', '9', '13']);
  assert.deepEqual(result.searchTrend.values, values);
  assert.deepEqual(
    rowMetrics(
      { trend: JSON.stringify(values), results: 100, intent: 'commercial' },
      'US',
      at,
    ).searchTrend.values,
    values,
  );
});

test('missing, malformed, sparse, incomplete and unsupported trends never become a zero curve', () => {
  const sparse = [];
  sparse.length = 12;
  for (const raw of [
    '',
    null,
    [],
    [0],
    sparse,
    Array.from({ length: 12 }, () => null),
    Array.from({ length: 12 }, () => ''),
    [...values.slice(0, 11), 2],
    'bad',
  ]) {
    const result = parseSemrushTrend(raw, at, 'phrase_this');
    assert.notEqual(result.status, 'collected');
    assert.equal(result.values, undefined);
  }
  assert.equal(
    parseSemrushTrend(values, at, 'phrase_this', false).status,
    'unsupported',
  );
  const zero = semrushTrendSummary(
    metrics({
      searchTrend: parseSemrushTrend(
        Array.from({ length: 12 }, () => 0),
        at,
        'phrase_this',
      ),
    }),
    'US',
  );
  assert.equal(zero.available, true);
  assert.equal(zero.latestHeat, 0);
  assert.equal(zero.monthChange, null);
  assert.deepEqual(zero.peakPositions, []);
});

test('comparisons use complete same-market monthly periods without inventing dates, daily values or YoY', () => {
  const result = semrushTrendSummary(metrics(), 'US');
  assert.equal(result.monthChange, 25);
  assert.equal(result.quarterChange, 116.7);
  assert.equal(result.halfChange, 216.7);
  assert.deepEqual(result.peakPositions, [12]);
  assert.equal(result.values[0], 20);
  assert.equal(result.yoy, undefined);
  assert.equal(result.months, undefined);
  assert.equal(semrushTrendSummary(metrics(), 'MX').available, false);
});

test('sanitization and list projection preserve trend evidence while missing or stale writes retain the old curve date', () => {
  const original = metrics({
    monthlySearchVolume: 100,
    searchResultCount: 0,
    serpFeatures: ['5'],
  });
  const clean = editableKeywordPatch({ metrics: original }).metrics;
  assert.deepEqual(clean.searchTrend.values, values);
  const current = {
    id: 'qa',
    term: 'synthetic',
    market: 'US',
    source: 'Semrush',
    series: [],
    metrics: original,
  };
  const newer = mergeKeywordMetrics(
    current,
    metrics({
      collectedAt: '2026-11-10T00:00:00Z',
      searchTrend: parseSemrushTrend(
        null,
        '2026-11-10T00:00:00Z',
        'phrase_this',
      ),
      monthlySearchVolume: 0,
    }),
  );
  assert.equal(newer.monthlySearchVolume, 0);
  assert.deepEqual(newer.searchTrend, original.searchTrend);
  assert.deepEqual(
    mergeKeywordMetrics(
      current,
      metrics({ collectedAt: '2026-11-01T00:00:00Z' }),
    ),
    original,
  );
  const list = projectRecord('keywords', { ...current, metrics: newer });
  assert.deepEqual(list.data.metrics.searchTrend, original.searchTrend);
});

test('refresh is explicit, scoped to selected Semrush words and preserved in the runner request', async () => {
  const raw = {
    seeds: [],
    existingRecords: [
      { id: 'qa', term: 'synthetic', market: 'US', source: 'test' },
    ],
    markets: ['US'],
    sources: ['semrush'],
    limit: 1,
  };
  const input = validateJob({ ...raw, semrushRefreshMetrics: true });
  assert.equal(input.semrushRefreshMetrics, true);
  assert.equal(validateJob(raw).semrushRefreshMetrics, undefined);
  assert.throws(
    () => validateJob({ ...raw, sources: [], semrushRefreshMetrics: true }),
    /Semrush/,
  );
  assert.notEqual(
    researchSignature(input),
    researchSignature(validateJob(raw)),
  );
  const job = { id: 'qa', input, checkpoint: {}, status: 'running' };
  const requests = [];
  await runJob(job, {
    collect: async (_job, step, request) => {
      requests.push({ step, request });
      return { complete: true, metrics: metrics(), message: 'synthetic' };
    },
    saveKeyword: async (r) => r,
    saveCheckpoint: async (_job, cp, status) => {
      Object.assign(job.checkpoint, cp);
      if (status) job.status = status;
    },
    patchCollection: async () => {},
    checkCancelled: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    now: () => Date.parse(at),
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].step, 'sem-metric:0');
  assert.equal(requests[0].request.semrushRefreshMetrics, true);
  assert.equal(job.status, 'awaiting_review');
  assert.equal(job.checkpoint.trendQueueVersion, undefined);
});

test('legacy cache stays free by default; explicit refresh queries once with trend and extra fields', async () => {
  const query = pool.query,
    fetcher = globalThis.fetch;
  const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
  const stored = encryptSemrushKey(
    'synthetic-trend-key-not-live',
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
  );
  let reportCalls = 0,
    cached;
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT'))
      return {
        rows: [
          {
            value:
              params[0] === 'provider:semrush:mcp:v1'
                ? stored
                : {
                    cachedAt: at,
                    result: {
                      metrics: { monthlySearchVolume: 100 },
                      apiUnits: 20,
                    },
                  },
          },
        ],
      };
    cached = params[1];
    return { rows: [] };
  };
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
            export_columns: {
              items: {
                enum: [
                  'keyword',
                  'volume',
                  'keyword_difficulty',
                  'trend',
                  'results',
                  ...(params.arguments.report === 'phrase_related'
                    ? ['relevance']
                    : []),
                ],
              },
            },
          },
        },
      };
    if (params.name === 'execute_report') {
      reportCalls++;
      assert.deepEqual(params.arguments.params.export_columns, [
        'keyword',
        'volume',
        'keyword_difficulty',
        'results',
        'trend',
        ...(params.arguments.report === 'phrase_related' ? ['relevance'] : []),
      ]);
      result = {
        structuredContent: {
          data: [
            {
              keyword: 'synthetic',
              volume: 100,
              keyword_difficulty: 25,
              trend: ['phrase_this', 'phrase_related'].includes(
                params.arguments.report,
              )
                ? values
                : undefined,
              results: 500,
              ...(params.arguments.report === 'phrase_related'
                ? { relevance: 0.8 }
                : {}),
            },
          ],
          metadata: { usage: { api_units: 10 } },
        },
      };
    }
    return Response.json({ jsonrpc: '2.0', id, result });
  };
  try {
    const request = { keywords: ['synthetic'], markets: ['US'] };
    const old = await collectSemrush(request);
    assert.equal(old.cached, true);
    assert.equal(old.apiUnits, 0);
    assert.equal(reportCalls, 0);
    assert.match(old.message, /历史缓存/);
    const next = await collectSemrush({
      ...request,
      semrushRefreshMetrics: true,
    });
    assert.equal(reportCalls, 1);
    assert.equal(next.apiUnits, 10);
    assert.equal(next.metrics.searchTrend.status, 'collected');
    assert.deepEqual(next.metrics.searchTrend.values, values);
    assert.equal(cached.result.metrics.searchResultCount, 500);
    const expansion = await collectSemrush({
      ...request,
      keywords: ['synthetic seed'],
      semExpansion: true,
      limit: 10,
    });
    assert.equal(reportCalls, 4);
    const expanded = expansion.suggestions[0].items[0].metrics;
    assert.equal(expanded.relatedTo, 'synthetic seed');
    assert.equal(expanded.relatedRelevance, 0.8);
    assert.deepEqual(expanded.searchTrend.values, values);
    assert.equal(expanded.searchTrend.report, 'phrase_related');
    assert.equal(
      editableKeywordPatch({ metrics: expanded }).metrics.relatedTo,
      'synthetic seed',
    );
  } finally {
    pool.query = query;
    globalThis.fetch = fetcher;
    if (secret === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
    else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = secret;
  }
});
