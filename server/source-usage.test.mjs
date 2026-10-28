import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { migrateCredentials, readCredentials, saveBraveCredential } from './local-provider.mjs';
import {
  contentEvents,
  researchEvents,
  sourceCharge,
  summarizeUsage,
  usageDay,
  validateQuota,
} from './source-usage-domain.mjs';
import { publicUsageFetch } from './source-usage-public-hook.mjs';
import {
  readSourceEvents,
  recordSourceCall,
  sourceUsageAction,
} from './source-usage.mjs';
import { collect, pool } from './store.mjs';

const admin = { id: 'qa', role: 'admin' };
const now = new Date('2026-10-26T04:00:00Z');
test('Brave key editing preserves encrypted research credentials and Sorftime fallback', async () => {
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const originalSecret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
  let stored;
  const statements = [];
  const connection = { query: async (statement, params) => {
    statements.push(statement);
    if (statement.startsWith('SELECT')) return { rows: [{ value: stored }] };
    if (statement.startsWith('INSERT')) stored = params[1];
    return { rows: [] };
  }, release() {} };
  try {
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = 'cXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXFxcXE=';
    pool.query = connection.query;
    pool.connect = async () => connection;
    await migrateCredentials({ RESEARCH_ACCESS_KEY: 'synthetic-research', SORFTIME_MCP_TOKEN: 'synthetic-sorftime', BRAVE_SEARCH_API_KEY: 'synthetic-old-brave' });
    await saveBraveCredential('synthetic-new-brave');
    const result = await readCredentials(connection);
    assert.deepEqual(result, { RESEARCH_ACCESS_KEY: 'synthetic-research', SORFTIME_MCP_TOKEN: 'synthetic-sorftime', BRAVE_SEARCH_API_KEY: 'synthetic-new-brave' });
    assert.equal(JSON.stringify(stored).includes('synthetic-new-brave'), false);
    assert(statements.some((statement) => statement.endsWith('FOR UPDATE')));
    assert(statements.includes('COMMIT'));
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (originalSecret === undefined) delete process.env.PROVIDER_CONFIG_ENCRYPTION_KEY; else process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = originalSecret;
  }
});
test('research collection persists original request timing without exposing internal metadata on replay', async () => {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.COLLECTOR_URL;
  let saved;
  let cached = false;
  let calls = 0;
  try {
    process.env.COLLECTOR_URL = 'https://collector.invalid';
    pool.query = async (statement, params) => {
      if (statement.startsWith('SELECT')) return { rows: cached ? [{ status: 'done', response: saved }] : [] };
      if (statement.startsWith('INSERT')) { saved = params[3]; assert(saved.requestUsage.startedAt); }
      if (statement.startsWith('UPDATE')) saved = params[2];
      return { rows: [] };
    };
    globalThis.fetch = async () => { calls++; return Response.json({ items: [], usage: { sorftimeCalls: 0 } }); };
    const request = { sources: ['google_suggest'], apiKey: 'do-not-store', op: 'search' };
    const result = await collect({ id: 'j' }, 'seed:0', request);
    assert.equal(result.requestUsage, undefined);
    assert.equal(saved.requestUsage.operation, 'search');
    assert.equal(JSON.stringify(saved).includes('do-not-store'), false);
    cached = true;
    assert.equal((await collect({ id: 'j' }, 'seed:0', request)).requestUsage, undefined);
    assert.equal(calls, 1);
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.COLLECTOR_URL; else process.env.COLLECTOR_URL = originalUrl;
  }
});
test('interrupted research retains its original source and started timestamp', async () => {
  const originalQuery = pool.query;
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.COLLECTOR_URL;
  let saved;
  try {
    process.env.COLLECTOR_URL = 'https://collector.invalid';
    pool.query = async (statement, params) => {
      if (statement.startsWith('SELECT')) return { rows: [] };
      if (statement.startsWith('INSERT')) saved = params[3];
      return { rows: [] };
    };
    globalThis.fetch = async () => { throw new Error('network'); };
    await assert.rejects(collect({ id: 'j' }, 'seed:1', { sources: ['google_suggest'] }));
    assert.deepEqual(saved.requestUsage.sources, ['google_suggest']);
    assert(saved.requestUsage.startedAt);
  } finally {
    pool.query = originalQuery;
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.COLLECTOR_URL; else process.env.COLLECTOR_URL = originalUrl;
  }
});
test('scheduled public collection records each real attempt without retaining secret query parameters', async () => {
  const contexts = [];
  let requests = 0;
  const wrapped = publicUsageFetch(async () => { requests++; return new Response('{}'); }, async (context, callback) => { contexts.push(context); return callback(); }, 'scheduled-job');
  await wrapped('https://api.fda.gov/food/enforcement.json?api_key=never-retain');
  await wrapped('https://api.fda.gov/food/enforcement.json?api_key=never-retain');
  await wrapped('https://example.com/previous.json');
  assert.equal(requests, 3);
  assert.equal(contexts.length, 2);
  assert.equal(contexts[0].sourceId, 'openfda');
  assert.equal(contexts[0].jobId, 'scheduled-job');
  assert.equal(contexts[0].project().requests, 1);
  assert.equal(JSON.stringify(contexts).includes('never-retain'), false);
});
const record = (id, step, response, status = 'done') => ({
  id,
  job_id: 'job-1',
  step,
  record: response,
  status,
  task: '关键词研究',
  market: 'US',
});
test('Shanghai calendar boundary and historical time gaps are kept distinct', () => {
  assert.equal(usageDay('2026-10-25T16:01:00Z'), '2026-10-26');
  assert.equal(usageDay('2026-10-25T15:59:00Z'), '2026-10-25');
  const events = researchEvents([
    record('1', 'sem-metric:1', { apiUnits: 12 }),
    record('2', 'sem-metric:2', {
      apiUnits: 8,
      requestUsage: { startedAt: '2026-10-25T16:01:00Z' },
    }),
  ]);
  const result = summarizeUsage(events, {}, {}, {}, now);
  assert.equal(result.sources[0].cumulative, 20);
  assert.equal(result.sources[0].today, 8);
  assert.equal(result.undated, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(
    summarizeUsage(events, {}, {}, { undated: true }, now).entries[0].amount,
    12,
  );
});
test('cache, unknown, partial expansion and confirmed zero remain distinguishable', () => {
  assert.deepEqual(
    sourceCharge('semrush', { apiUnits: 900, cached: true }, 'done'),
    { amount: 0, billing: 'cached' },
  );
  assert.deepEqual(sourceCharge('semrush', { apiUnits: 900 }, 'failed'), {
    amount: null,
    billing: 'unknown',
  });
  assert.deepEqual(sourceCharge('semrush', { apiUnits: 0 }, 'done'), {
    amount: 0,
    billing: 'confirmed',
  });
  assert.equal(
    sourceCharge('semrush', { apiUnits: 10, unknownCharges: 1 }, 'done')
      .billing,
    'partial',
  );
  assert.equal(
    sourceCharge('scrapecreators', { creditsCharged: '1' }, 'done').amount,
    null,
  );
});
test('providers use separate units, original task and operation attribution', () => {
  const events = researchEvents([
    record('a', 'platform:0', {
      provider: 'sorftime',
      providerCalls: 1,
      requestUsage: { operation: 'detail', startedAt: now.toISOString() },
    }),
    record('b', 'platform:1', { provider: 'tiktok_shop', creditsCharged: 3 }),
    record('c', 'model-report', { usage: { total_tokens: 230 } }),
  ]);
  assert.deepEqual(
    events.map((e) => [e.sourceId, e.amount]),
    [
      ['sorftime', 1],
      ['scrapecreators', 3],
      ['analysis', 230],
    ],
  );
  assert.equal(events[0].jobId, 'job-1');
  assert.equal(events[0].operation, 'detail');
});
test('manual quota validates zeros, negatives and contradictory totals', () => {
  assert.equal(
    validateQuota({ sourceId: 'semrush', remaining: 0, total: 10 }).remaining,
    0,
  );
  assert.throws(() =>
    validateQuota({ sourceId: 'semrush', remaining: -1, total: 10 }),
  );
  assert.throws(() =>
    validateQuota({ sourceId: 'semrush', remaining: 20, total: 10 }),
  );
  assert.throws(() =>
    validateQuota({ sourceId: 'unknown', remaining: 0, total: null }),
  );
});
test('quota prefers usable account snapshots and permits explicit manual override', () => {
  const quota = {
    manual: { remaining: 50, origin: 'manual' },
    automatic: { remaining: 0, origin: 'automatic' },
  };
  assert.equal(
    summarizeUsage([], {}, { semrush: quota }, {}, now).sources[0].quota
      .remaining,
    0,
  );
  assert.equal(
    summarizeUsage(
      [],
      {},
      { semrush: { ...quota, preferManual: true } },
      {},
      now,
    ).sources[0].quota.remaining,
    50,
  );
});
test('details apply source, date, task and billing filters before stable pagination', () => {
  const events = researchEvents(
    Array.from({ length: 31 }, (_, i) =>
      record(`r${i}`, `sem-metric:${i}`, {
        apiUnits: 2,
        requestUsage: { startedAt: now.toISOString() },
      }),
    ),
  );
  const page2 = summarizeUsage(
    events,
    {},
    {},
    { page: 2, query: 'job-1', sourceId: 'semrush', billing: 'confirmed' },
    now,
  );
  assert.equal(page2.total, 31);
  assert.equal(page2.entries.length, 6);
  assert.equal(
    page2.daily.at(-1).sources.find((s) => s.sourceId === 'semrush').amount,
    62,
  );
  assert.throws(() => summarizeUsage(events, {}, {}, { days: 999 }, now));
  assert.throws(() =>
    summarizeUsage(
      events,
      {},
      {},
      { start: '2020-01-01', end: '2026-10-26' },
      now,
    ),
  );
});
test('public content attribution separates platform API, paid discovery and academic requests', () => {
  const events = contentEvents([
    {
      name: 'content:job:j',
      value: {
        id: 'j',
        steps: [
          {
            source: 'youtube',
            status: 'success',
            accounted: true,
            quotaUnits: 100,
          },
          {
            source: 'web_articles',
            status: 'success',
            accounted: true,
            creditsCharged: 2,
          },
          {
            source: 'europepmc',
            status: 'success',
            accounted: true,
            actualRequests: 1,
          },
          { source: 'reddit', status: 'pending' },
        ],
      },
    },
  ]);
  assert.deepEqual(
    events.map((e) => [e.sourceId, e.amount]),
    [
      ['youtube', 100],
      ['scrapecreators', 2],
      ['pubmed', 1],
    ],
  );
});
test('usage endpoints reject nonadministrators before accessing storage or providers', async () => {
  for (const action of [
    'server_source_usage',
    'server_source_quota_save',
    'server_source_quota_refresh',
    'server_source_credential_save',
  ])
    await assert.rejects(sourceUsageAction({ action }, { role: 'researcher' }));
});
test('direct journal reserves before calling, settles once and retains failed uncertainty', async () => {
  const writes = [];
  const io = {
    write: async (_, value) => {
      writes.push(value);
    },
  };
  await recordSourceCall(
    { jobId: 'j', sourceId: 'firecrawl', step: 'hosted' },
    async () => {
      assert.equal(writes[0].billing, 'unknown');
      return { creditsCharged: 2 };
    },
    io,
  );
  assert.deepEqual(
    writes.map((e) => e.billing),
    ['unknown', 'confirmed'],
  );
  assert.equal(writes[0].id, writes[1].id);
  await assert.rejects(
    recordSourceCall(
      { jobId: 'j', sourceId: 'firecrawl' },
      async () => {
        throw new Error('network');
      },
      io,
    ),
  );
  assert.equal(writes.at(-1).billing, 'unknown');
  assert.equal(writes.at(-1).status, 'failed');
});
test('quota failures preserve prior snapshots and automatic refresh uses only account action', async () => {
  let saved;
  const old = { automatic: { remaining: 7, origin: 'automatic' } };
  const io = {
    pool: {
      query: async (_, params) => ({
        rows: [
          {
            value: params[0].startsWith('source-usage')
              ? old
              : { ciphertext: 'sealed' },
          },
        ],
      }),
    },
    write: async (_, value) => {
      saved = value;
    },
    semrush: async (input) => {
      assert.equal(input.action, 'server_semrush_balance');
      return { balance: { status: 'unavailable', message: '无权限' } };
    },
  };
  const result = await sourceUsageAction(
    { action: 'server_source_quota_refresh', sourceId: 'semrush' },
    admin,
    io,
  );
  assert.equal(result.available, false);
  assert.equal(saved.automatic.remaining, 7);
  await sourceUsageAction(
    {
      action: 'server_source_quota_save',
      sourceId: 'semrush',
      remaining: 0,
      total: null,
    },
    admin,
    io,
  );
  assert.equal(saved.manual.remaining, 0);
});
test('SQL reader projects billing metadata, excludes secrets and deduplicates original events', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE research_jobs(id text primary key,input jsonb); CREATE TABLE research_requests(job_id text,step text,status text,paid_allowance int,response jsonb); CREATE TABLE workspace_documents(name text primary key,value jsonb,revision bigint not null default 1);',
    );
    await db.query('INSERT INTO research_jobs VALUES($1,$2)', [
      'j',
      { kind: 'platform_products', market: 'MX', apiKey: 'must-not-leak' },
    ]);
    await db.query('INSERT INTO research_requests VALUES($1,$2,$3,$4,$5)', [
      'j',
      'platform:0',
      'done',
      0,
      {
        provider: 'sorftime',
        providerCalls: 1,
        apiKey: 'must-not-leak',
        products: [{ huge: true }],
        requestUsage: { startedAt: now.toISOString() },
      },
    ]);
    await db.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)', [
      'competitor:request:2026-10-26:monitor:digest',
      {
        at: now.toISOString(),
        step: 'semrush:0',
        status: 'completed',
        response: { apiUnits: 5, secret: 'must-not-leak' },
      },
    ]);
    const events = await readSourceEvents(db);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((e) => e.amount).sort(), [1, 5]);
    assert.equal(JSON.stringify(events).includes('must-not-leak'), false);
    assert.equal(JSON.stringify(events).includes('huge'), false);
  } finally {
    await db.close();
  }
});
