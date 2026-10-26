import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advertiserSites,
  runSemrushSites,
  validateSemrushSites,
} from './semrush-sites.mjs';
import { collectSemrushSites } from './semrush-sites-provider.mjs';
import { summarizeSemrushUsage } from './semrush-usage.mjs';

const request = {
  requestId: '00000000-0000-4000-8000-000000000001',
  terms: 'Magnesium\nmagnesium',
  market: 'US',
  perPage: 2,
  maxPages: 3,
  maxSites: 20,
  semrushUnitLimit: 200,
};
const at = '2026-10-21T00:00:00Z';
function harness(pages, patch = {}, checkpoint = {}) {
  const calls = [],
    sites = new Map(),
    linked = [],
    checkpoints = [];
  let status;
  const job = {
    id: 'synthetic',
    input: validateSemrushSites({ ...request, ...patch }),
    checkpoint,
  };
  const io = {
    isCancelled: async () => false,
    collect: async (_job, step, input) => {
      calls.push({ step, ...input });
      const p = pages[calls.length - 1];
      if (p instanceof Error) throw p;
      return { collectedAt: at, ...p };
    },
    saveSite: async (site) => sites.set(site.id, site),
    linkKeywords: async (...args) => linked.push(args),
    saveCheckpoint: async (_job, cp, s) => {
      job.checkpoint = structuredClone(cp);
      checkpoints.push(cp);
      if (s) status = s;
    },
  };
  return {
    job,
    io,
    calls,
    sites,
    linked,
    checkpoints,
    get status() {
      return status;
    },
  };
}
test('validates bounded jobs and deduplicates normalized terms', () => {
  assert.deepEqual(validateSemrushSites(request).seeds, ['magnesium']);
  for (const patch of [
    { perPage: 0 },
    { maxPages: 11 },
    { maxSites: 1001 },
    { market: 'ALL' },
  ])
    assert.throws(() => validateSemrushSites({ ...request, ...patch }));
});
test('filters marketplaces, invalid domains and unrelated landing URLs without fetching sites', () => {
  const rows = [
    { domain: 'www.brand.com', url: 'https://evil.example/steal' },
    { domain: 'brand.com', url: 'https://brand.com/product' },
    { domain: 'amazon.com' },
    { domain: 'localhost' },
    { domain: '127.0.0.1' },
  ];
  const sites = advertiserSites(rows, 'magnesium', 'US', at);
  assert.equal(sites.length, 1);
  assert.equal(sites[0].id, 'US-brand.com');
  assert.equal(sites[0].sourceEvidence.length, 2);
  assert.equal(sites[0].sourceEvidence[0].landingUrl, 'https://brand.com/');
  assert.match(sites[0].type, /待核验/);
  assert.equal(sites[0].metrics, undefined);
  assert.equal(sites[0].confidence, undefined);
});
test('paginates only Semrush, merges domains and links each keyword', async () => {
  const h = harness([
    { rows: [{ domain: 'brand.com' }, { domain: 'other.com' }], apiUnits: 40 },
    { rows: [{ domain: 'brand.com' }], apiUnits: 20 },
  ]);
  await runSemrushSites(h.job, h.io);
  assert.equal(h.status, 'completed');
  assert.equal(h.sites.size, 2);
  assert.deepEqual(
    h.calls.map((c) => c.offset),
    [0, 2],
  );
  assert.ok(h.calls.every((c) => c.sources.join() === 'semrush_sites'));
  assert.equal(h.job.checkpoint.semrushUnits, 60);
  assert.equal(h.job.checkpoint.semrushReserved, 60);
  assert.equal(h.linked.length, 2);
});
test('ignores legacy unit caps and requests complete pages until the report ends', async () => {
  const h = harness([
    { rows: [{ domain: 'one.com' }, { domain: 'two.com' }], apiUnits: 40 },
    { rows: [{ domain: 'three.com' }], apiUnits: 20 },
  ], {
    semrushUnitLimit: 20,
  });
  assert.equal(h.job.input.semrushUnitLimit, 0);
  // Older persisted tasks may still contain their former unit cap.
  h.job.input.semrushUnitLimit = 20;
  await runSemrushSites(h.job, h.io);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].limit, 2);
  assert.equal(h.status, 'completed');
  assert.equal(h.job.checkpoint.semrushReserved, 60);
});
test('stops at the unique-site cap and preserves an empty report as completed', async () => {
  const cap = harness(
    [{ rows: [{ domain: 'one.com' }, { domain: 'two.com' }], apiUnits: 40 }],
    { maxSites: 1 },
  );
  await runSemrushSites(cap.job, cap.io);
  assert.equal(cap.sites.size, 1);
  assert.equal(cap.status, 'partial');
  const empty = harness([{ rows: [], apiUnits: 0 }]);
  await runSemrushSites(empty.job, empty.io);
  assert.equal(empty.status, 'completed');
  assert.equal(empty.job.checkpoint.semrushUnits, 0);
});
test('unknown charges and provider failures retain reservations and stop further calls', async () => {
  for (const response of [
    { rows: [{ domain: 'one.com' }] },
    new Error('result unknown'),
  ]) {
    const h = harness([response]);
    await runSemrushSites(h.job, h.io);
    assert.equal(h.calls.length, 1);
    assert.equal(h.status, 'partial');
    assert.equal(h.job.checkpoint.unknownCharges, 1);
    assert.equal(h.job.checkpoint.semrushReserved, 40);
  }
  const resumed = harness(
    [],
    {},
    { unknownCharges: 1, semrushReserved: 40, page: 1 },
  );
  await runSemrushSites(resumed.job, resumed.io);
  assert.equal(resumed.calls.length, 0);
  assert.equal(resumed.status, 'partial');
});
test('resumes a journaled in-flight page without reserving or counting the request twice', async () => {
  const h = harness(
    [{ rows: [], apiUnits: 20 }],
    {},
    {
      index: 0,
      page: 1,
      requests: 2,
      semrushReserved: 80,
      semrushUnits: 40,
      inFlight: { limit: 2, offset: 2 },
    },
  );
  await runSemrushSites(h.job, h.io);
  assert.equal(h.calls[0].step, 'sem-sites:0:1');
  assert.equal(h.job.checkpoint.requests, 2);
  assert.equal(h.job.checkpoint.semrushUnits, 60);
  assert.equal(h.job.checkpoint.semrushReserved, 60);
});
test('cancels before a report and preserves returned evidence when cancelled during a report', async () => {
  const before = harness([]);
  before.io.isCancelled = async () => true;
  await runSemrushSites(before.job, before.io);
  assert.equal(before.calls.length, 0);
  assert.equal(before.status, 'cancelled');
  const during = harness([{ rows: [{ domain: 'one.com' }], apiUnits: 20 }]);
  during.io.isCancelled = async () => during.calls.length > 0;
  await runSemrushSites(during.job, during.io);
  assert.equal(during.status, 'cancelled');
  assert.equal(during.sites.size, 1);
});
test('Semrush provider validates report schema and passes page offset without other tools', async () => {
  const calls = [];
  let closed = false;
  const connect = async () => ({
    key: 'synthetic-key',
    semrushKeyId: 'synthetic-id',
    c: {
      close: async () => {
        closed = true;
      },
      rpc: async (_method, input) => {
        calls.push(input);
        return {
          structuredContent:
            input.name === 'get_report_schema'
              ? {
                  report: 'phrase_adwords',
                  parameters: {
                    database: { enum: ['us'] },
                    display_offset: {},
                    export_columns: { items: { enum: ['domain', 'url'] } },
                  },
                }
              : {
                  data: 'Domain;Url\nbrand.com;https://brand.com/',
                  metadata: { usage: { api_units: 20 } },
                },
        };
      },
    },
  });
  const result = await collectSemrushSites(
    { term: 'magnesium', market: 'US', offset: 20, limit: 20 },
    connect,
  );
  assert.equal(result.rows[0].Domain, 'brand.com');
  assert.equal(result.apiUnits, 20);
  assert.equal(calls[1].arguments.params.display_offset, 20);
  assert.ok(closed);
});
test('unsupported pagination stops before a charged execution and closes the client', async () => {
  let executions = 0;
  await assert.rejects(
    collectSemrushSites({ market: 'US', offset: 20 }, async () => ({
      key: 'synthetic',
      c: {
        close: async () => {},
        rpc: async (_method, input) => {
          executions += input.name === 'execute_report' ? 1 : 0;
          return {
            structuredContent: {
              report: 'phrase_adwords',
              parameters: { database: { enum: ['us'] } },
            },
          };
        },
      },
    })),
    /翻页/,
  );
  assert.equal(executions, 0);
});
test('site discovery charges participate in existing key-attributed usage totals', () => {
  const usage = summarizeSemrushUsage(
    [
      {
        job_id: 'job',
        step: 'sem-sites:0:0',
        status: 'done',
        record: { apiUnits: 40, semrushKeyId: 'key' },
      },
    ],
    [],
    new Date(),
    { currentKeyId: 'key' },
  );
  assert.equal(usage.confirmedUnits, 40);
  assert.equal(
    usage.breakdown.find((v) => v.id === 'sites').confirmedUnits,
    40,
  );
});
