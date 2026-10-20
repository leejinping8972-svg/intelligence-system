/* oxlint-disable vitest/no-import-node-test -- Backend tests run with node --test. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publicRecoveryPlan,
  publicRetryDelay,
} from './monitor-public-recovery.mjs';
import { scanSite } from './competitor-monitor-providers.mjs';
import { executeMonitor } from './competitor-monitor-engine.mjs';
import { probePublicSite } from './public-site-probe.mjs';
const now = Date.parse('2026-10-20T04:00:00Z');
const site = {
  id: 'site',
  domain: 'example.com',
  market: 'US',
  platform: 'Shopify',
};
const target = {
  id: 'target',
  siteId: site.id,
  enabled: true,
  maxRequests: 10,
  market: 'US',
};
const old = {
  day: '2026-10-20',
  status: 'failed',
  requests: 1,
  added: 0,
  finishedAt: new Date(now - 3_600_000).toISOString(),
  channels: [{ kind: 'products', status: 'failed' }],
  errors: ['官网返回 HTTP 429'],
};
const call = async (_key, fn) => fn();
test('429 exponential backoff never ignores a longer Retry-After', () => {
  assert.equal(publicRetryDelay({ status: 429 }), 30 * 60_000);
  assert.equal(publicRetryDelay({ status: 429 }, 1), 60 * 60_000);
  assert.equal(
    publicRetryDelay({ status: 429, retryAfterSeconds: 86_400 }),
    86_400_000,
  );
  assert.equal(publicRetryDelay({ status: 503 }), 5 * 60_000);
});
test('same-day public recovery requires remaining budget and an elapsed cooldown', () => {
  assert.equal(publicRecoveryPlan(target, old, {}, now).ready, true);
  assert.equal(
    publicRecoveryPlan(target, old, { nextRunAt: now + 1000 }, now).ready,
    false,
  );
  const exhausted = publicRecoveryPlan(
    target,
    { ...old, requests: 10 },
    {},
    now,
  );
  assert.equal(exhausted.eligible, false);
  assert.match(exhausted.reason, /预算/);
  assert.equal(
    publicRecoveryPlan(target, { ...old, publicRecoveryAttempts: 3 }, {}, now)
      .eligible,
    false,
  );
});
test('completed websites, interrupted requests and advertiser-only failures never get replayed', () => {
  for (const last of [
    { ...old, status: 'running' },
    { ...old, status: 'interrupted' },
    { ...old, day: '2026-10-19' },
    {
      ...old,
      channels: [
        { kind: 'products', status: 'completed' },
        { kind: 'ads', status: 'failed' },
      ],
    },
  ])
    assert.equal(publicRecoveryPlan(target, last, {}, now).eligible, false);
  assert.equal(
    publicRecoveryPlan({ ...target, siteId: '' }, old, {}, now).eligible,
    false,
  );
});
test('a rate-limited JSON feed defers all requests and resumes alternate public paths after cooldown', async () => {
  let calls = 0;
  const first = await scanSite(
    site,
    call,
    4,
    async () => {
      calls++;
      throw Object.assign(new Error('HTTP 429'), {
        status: 429,
        retryAfterSeconds: 7200,
      });
    },
    null,
    async () => {},
    { now: () => now },
  );
  assert.equal(calls, 1);
  assert.equal(first.retryAt, now + 7_200_000);
  assert.equal(first.items.length, 0);
  assert.ok(first.progress.queue[0].includes('sitemap.xml'));
  const waiting = await scanSite(
    site,
    call,
    4,
    async () => {
      calls++;
    },
    first.progress,
    async () => {},
    { now: () => now + 1000 },
  );
  assert.equal(calls, 1);
  assert.equal(waiting.requests, 0);
  const second = await scanSite(
    site,
    call,
    1,
    async (url) => {
      calls++;
      assert.ok(url.endsWith('/sitemap.xml'));
      return { url, html: '<urlset></urlset>' };
    },
    first.progress,
    async () => {},
    { now: () => now + 7_200_001 },
  );
  assert.equal(calls, 2);
  assert.equal(second.retryAt, 0);
});
test('dynamic pages get a bounded browser step instead of a false empty baseline', async () => {
  const source = {
    ...site,
    platform: 'unknown',
    evidenceUrl: 'https://example.com/products/x',
  };
  const progress = { queue: [source.evidenceUrl], visited: [] };
  const direct = await scanSite(
    source,
    call,
    1,
    async (url) => ({
      url,
      html: '<html><div id="root"></div><script src="/app.js"></script></html>',
    }),
    progress,
    async () => {},
    { now: () => now },
  );
  assert.equal(direct.complete, false);
  assert.equal(direct.progress.methods[source.evidenceUrl], 'browser');
  assert.equal(direct.progress.visited.length, 0);
  let browser = 0;
  const rendered = await scanSite(
    source,
    call,
    1,
    async () => {
      throw new Error('must not use direct fetch');
    },
    direct.progress,
    async () => {},
    {
      now: () => now + 31_000,
      fetchBrowser: async (url) => {
        browser++;
        return {
          url,
          html: '<script type="application/ld+json">{"@type":"Product","name":"Creatine","url":"https://example.com/products/x"}</script>',
        };
      },
    },
  );
  assert.equal(browser, 1);
  assert.equal(rendered.items.length, 1);
  assert.equal(rendered.complete, true);
});
test('challenge pages and disabled browser rendering cannot become completed empty results', async () => {
  const source = { ...site, platform: 'unknown' };
  const progress = {
    queue: ['https://example.com/products/x'],
    visited: [],
    methods: { 'https://example.com/products/x': 'browser' },
  };
  const challenge = await scanSite(
    source,
    call,
    1,
    async () => {},
    progress,
    async () => {},
    {
      now: () => now,
      fetchBrowser: async (url) => ({
        url,
        html: '<title>Just a moment...</title>',
      }),
    },
  );
  assert.equal(challenge.complete, false);
  assert.equal(challenge.manualRequired, true);
  assert.equal(challenge.items.length, 0);
  const disabled = await scanSite(
    source,
    call,
    1,
    async (url) => ({
      url,
      html: '<div id="root"></div><script src="/app.js"></script>',
    }),
    { queue: ['https://example.com/products/x'], visited: [] },
    async () => {},
    { now: () => now, browserEnabled: false },
  );
  assert.equal(disabled.manualRequired, true);
  assert.equal(disabled.complete, false);
});
test('public-only recovery keeps cumulative requests and never invokes advertiser collection', async () => {
  let scans = 0,
    requests = 0;
  const previous = {
    ...old,
    requests: 4,
    added: 2,
    channels: [
      { kind: 'products', status: 'failed' },
      { kind: 'ads', status: 'completed' },
    ],
  };
  const run = await executeMonitor(
    { ...target, pageId: '123' },
    {
      publicOnly: true,
      previousRun: previous,
      now: () => now,
      at: new Date(now).toISOString(),
      day: '2026-10-20',
      saveRun: async () => {},
      baseline: async () => true,
      seen: async () => true,
      persist: async () => {},
      request: async (_key, fn) => {
        requests++;
        return fn();
      },
      scan: async (kind, request, limit) => {
        assert.equal(kind, 'products');
        assert.equal(limit, 6);
        scans++;
        await request('page', async () => ({}));
        return { items: [], complete: true, errors: [] };
      },
    },
  );
  assert.equal(scans, 1);
  assert.equal(requests, 1);
  assert.equal(run.requests, 5);
  assert.equal(run.added, 2);
  assert.equal(run.channels.find((c) => c.kind === 'ads').status, 'completed');
  assert.equal(run.publicRecoveryAttempts, 1);
});
test('the standalone probe preserves earlier products and refuses early retry, excess budget or a mismatched target', async () => {
  let state = {
    host: 'example.com',
    day: '2026-10-20',
    requests: 1,
    items: [{ id: 'old' }],
    progress: { queue: ['https://example.com/sitemap.xml'] },
  };
  const io = {
    now: () => now,
    read: async () => state,
    save: async (s) => {
      state = structuredClone(s);
    },
    scan: async (_site, request) => {
      await request('new', async () => {});
      return {
        items: [{ id: 'new' }],
        complete: false,
        errors: [],
        progress: { queue: ['more'] },
      };
    },
  };
  const result = await probePublicSite(
    { url: 'https://example.com', maxRequests: 1 },
    io,
  );
  assert.equal(result.requestsToday, 2);
  assert.equal(result.products, 2);
  assert.equal(state.items.length, 2);
  state.progress.nextRunAt = now + 1000;
  const cooling = await probePublicSite({ url: 'https://example.com' }, io);
  assert.equal(cooling.status, 'cooldown');
  assert.equal(state.requests, 2);
  await assert.rejects(
    () => probePublicSite({ url: 'https://other.example' }, io),
    /其他站点/,
  );
  state.progress.nextRunAt = 0;
  state.requests = 10;
  const budget = await probePublicSite({ url: 'https://example.com' }, io);
  assert.equal(budget.status, 'budget');
});

test('a still empty dynamic browser response stays incomplete and requires inspection', async () => {
  const url = 'https://example.com/products/x';
  const result = await scanSite(
    site,
    call,
    1,
    async () => {},
    {
      queue: [url],
      visited: [],
      methods: { [url]: 'browser' },
    },
    async () => {},
    {
      now: () => now,
      fetchBrowser: async () => ({
        url,
        html: '<div id="root"></div><script src="/app.js"></script>',
      }),
    },
  );
  assert.equal(result.manualRequired, true);
  assert.equal(result.complete, false);
  assert.equal(result.progress.visited.length, 0);
});

test('saved browser checkpoints cannot override the probe browser opt-in', async () => {
  const url = 'https://example.com/products/x';
  let calls = 0;
  const result = await scanSite(
    site,
    call,
    1,
    async () => {},
    {
      queue: [url],
      visited: [],
      methods: { [url]: 'browser' },
    },
    async () => {},
    {
      now: () => now,
      browserEnabled: false,
      fetchBrowser: async () => {
        calls++;
        throw new Error('must not render without opt-in');
      },
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.manualRequired, true);
  assert.equal(result.browserPages, 0);
});
