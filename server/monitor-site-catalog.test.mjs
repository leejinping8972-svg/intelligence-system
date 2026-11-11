/* oxlint-disable vitest/no-import-node-test -- Backend tests run with node --test. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { executeMonitor } from './competitor-monitor-engine.mjs';
import { scanSite } from './competitor-monitor-providers.mjs';
import {
  monitorProductUrl,
  monitorSitemapLinks,
} from './monitor-site-catalog.mjs';

const site = {
  id: 'site',
  domain: 'example.com',
  platform: 'Shopify',
  market: 'US',
};
const base = 'https://example.com';
const request = async (_key, run) => run();
const wait = async () => {};
const options = { now: () => Date.parse('2026-11-11T04:00:00Z') };
const product = (handle) => ({
  handle,
  title: `Product ${handle}`,
  variants: [{ price: '10' }],
});
const feed = (url, products) => ({ url, html: JSON.stringify({ products }) });
const sitemap = (links) =>
  `<sitemapindex>${links.map((url) => `<sitemap><loc>${url.replaceAll('&', '&amp;')}</loc></sitemap>`).join('')}</sitemapindex>`;

test('a complete paginated feed replaces a legacy truncated HTML crawl only at its terminal page', async () => {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    assert.equal(new URL(url).pathname, '/products.json');
    const page = Number(new URL(url).searchParams.get('page'));
    return feed(url, page === 1 ? [product('one'), product('two')] : []);
  };
  const old = {
    queue: [
      `${base}/collections/all/products/one?variant=1`,
      `${base}/products/two`,
    ],
    visited: [`${base}/products.json?limit=50&page=1`],
    truncated: true,
    lastHttpStatus: 429,
  };
  const first = await scanSite(site, request, 1, fetchPage, old, wait, options);
  assert.equal(first.complete, false);
  assert.equal(first.progress.truncated, true);
  assert.equal(first.progress.shopifyFeed.nextPage, 2);
  assert.equal(first.items.length, 2);
  const last = await scanSite(
    site,
    request,
    1,
    fetchPage,
    first.progress,
    wait,
    options,
  );
  assert.equal(last.complete, true);
  assert.equal(last.progress.truncated, false);
  assert.equal(last.progress.queue.length, 0);
  assert.equal(last.progress.lastHttpStatus, 200);
  assert.equal(calls.length, 2);
  assert.equal(old.truncated, true);
});

test('short catalog pages keep advancing until empty and establish one baseline without false launches', async () => {
  let progress = null;
  let baseline = false;
  const persisted = [];
  let baselines = 0;
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    assert.equal(new URL(url).pathname, '/products.json');
    const page = Number(new URL(url).searchParams.get('page'));
    return feed(url, page <= 2 ? [product(`page-${page}`)] : []);
  };
  for (let i = 0; i < 3; i++) {
    const run = await executeMonitor(
      { id: 'monitor', siteId: site.id, maxPages: 1 },
      {
        ...options,
        at: '2026-11-11T04:00:00Z',
        day: '2026-11-11',
        baseline: async () => baseline,
        setBaseline: async () => {
          baseline = true;
          baselines++;
        },
        seen: async () => false,
        persist: async (_kind, item, event) => {
          assert.equal(event, null);
          persisted.push(item.id);
        },
        saveProgress: async (_kind, value) => {
          progress = structuredClone(value);
        },
        saveRun: async () => {},
        request,
        scan: async (_kind, req, limit) =>
          scanSite(site, req, limit, fetchPage, progress, wait, options),
      },
    );
    assert.equal(run.status, i === 2 ? 'completed' : 'partial');
    assert.equal(baseline, i === 2);
  }
  assert.equal(baselines, 1);
  assert.equal(progress, null);
  assert.equal(new Set(persisted).size, 2);
  assert.equal(calls.length, 3);
});

test('an initially empty feed keeps fallback discovery and cannot erase old truncation', async () => {
  const result = await scanSite(
    site,
    request,
    1,
    async (url) => feed(url, []),
    {
      queue: [`${base}/sitemap.xml`],
      visited: [],
      truncated: true,
    },
    wait,
    options,
  );
  assert.equal(result.complete, false);
  assert.equal(result.progress.truncated, true);
  assert.equal(result.progress.queue[0], `${base}/sitemap.xml`);
  assert.equal(result.progress.shopifyFeed.complete, false);
});

test('malformed and partially invalid feeds retain coverage gaps and the original cursor', async () => {
  for (const data of [
    {},
    { products: [product('ok'), { title: 'Missing handle' }] },
    { products: [product('bad/handle')] },
  ]) {
    const result = await scanSite(
      site,
      request,
      1,
      async (url) => ({ url, html: JSON.stringify(data) }),
      null,
      wait,
      options,
    );
    assert.equal(result.complete, false);
    assert.equal(result.progress.shopifyFeed.nextPage, 1);
    assert.equal(result.progress.shopifyFeed.products, 0);
    assert.equal(result.items.length, 0);
    assert.ok(result.errors.length > 0);
  }
});

test('repeated feed pages cannot turn a stuck pagination endpoint into complete coverage', async () => {
  const result = await scanSite(
    site,
    request,
    2,
    async (url) => feed(url, [product('same')]),
    null,
    wait,
    options,
  );
  assert.equal(result.complete, false);
  assert.equal(result.progress.shopifyFeed.nextPage, 2);
  assert.equal(result.progress.shopifyFeed.products, 1);
  assert.match(result.errors.join(' '), /重复返回同一页/);
});

test('rate limits retain Retry-After and try alternate sources only after cooling down', async () => {
  let calls = 0;
  const first = await scanSite(
    site,
    request,
    3,
    async () => {
      calls++;
      throw Object.assign(new Error('HTTP 429'), {
        status: 429,
        retryAfterSeconds: 86_400,
      });
    },
    null,
    wait,
    options,
  );
  assert.equal(calls, 1);
  assert.equal(first.retryAt, options.now() + 86_400_000);
  const waiting = await scanSite(
    site,
    request,
    3,
    async () => {
      calls++;
    },
    first.progress,
    wait,
    options,
  );
  assert.equal(waiting.requests, 0);
  assert.equal(calls, 1);
  const resumed = await scanSite(
    site,
    request,
    1,
    async (url) => {
      assert.equal(url, `${base}/sitemap.xml`);
      return { url, html: '<urlset></urlset>' };
    },
    waiting.progress,
    wait,
    { now: () => first.retryAt + 1 },
  );
  assert.equal(resumed.progress.shopifyFeed.nextPage, 1);
  assert.equal(resumed.complete, false);
});

test('an unconfirmed request is not converted into a complete catalog or bypassed', async () => {
  let calls = 0;
  const result = await scanSite(
    site,
    async () => {
      throw new Error('该请求已尝试但结果未确认，本日不重复调用');
    },
    1,
    async () => {
      calls++;
    },
    { queue: [`${base}/products/old`], truncated: true },
    wait,
    options,
  );
  assert.equal(calls, 0);
  assert.equal(result.complete, false);
  assert.equal(result.progress.truncated, true);
  assert.equal(result.progress.shopifyFeed.nextPage, 1);
});

test('missing feeds keep public sitemap fallback and cross-site responses stay rejected', async () => {
  const fallback = await scanSite(
    site,
    request,
    2,
    async (url) => {
      if (new URL(url).pathname === '/products.json')
        throw Object.assign(new Error('HTTP 404'), { status: 404 });
      assert.equal(url, `${base}/sitemap.xml`);
      return {
        url,
        html: `<urlset><url><loc>${base}/products/one</loc></url></urlset>`,
      };
    },
    null,
    wait,
    options,
  );
  assert.equal(fallback.complete, false);
  assert.ok(fallback.progress.queue.includes(`${base}/products/one`));
  const redirected = await scanSite(
    site,
    request,
    1,
    async () => feed('https://other.example/products.json', [product('one')]),
    null,
    wait,
    options,
  );
  assert.equal(redirected.complete, false);
  assert.equal(redirected.items.length, 0);
  assert.equal(redirected.progress.shopifyFeed.nextPage, 1);
});

test('Shopify collection and variant links collapse to one product while other platforms retain variants', () => {
  assert.equal(
    monitorProductUrl(
      `${base}/collections/all/products/one?variant=123`,
      base,
      true,
    ),
    `${base}/products/one`,
  );
  assert.equal(
    monitorProductUrl(
      'https://www.example.com/fr/collections/all/products/one/?variant=456',
      base,
      true,
    ),
    `${base}/fr/products/one`,
  );
  assert.equal(
    monitorProductUrl(`${base}/products/one?variant=123`, base, false),
    `${base}/products/one?variant=123`,
  );
  assert.equal(
    monitorProductUrl('https://other.example/products/one', base, true),
    null,
  );
  assert.equal(monitorProductUrl(`${base}/assets/app.js`, base, true), null);
});

test('product sitemap selection drops equivalent languages but retains distinct product ranges', () => {
  const one = `${base}/sitemap_products_1.xml?from=1&to=100`;
  const two = `${base}/sitemap_products_2.xml?from=101&to=200`;
  const distinct = `${base}/fr/sitemap_products_1.xml?from=201&to=250`;
  const html = sitemap([
    one,
    two,
    `${base}/fr/sitemap_products_1.xml?from=1&to=100`,
    distinct,
    `${base}/sitemap_pages_1.xml`,
    `${base}/sitemap_blogs_1.xml`,
  ]);
  assert.deepEqual(monitorSitemapLinks(html, `${base}/sitemap.xml`), [
    one,
    two,
    distinct,
  ]);
});

test('localized and generic sitemap indexes preserve their own product scope', () => {
  const localized = `${base}/fr/sitemap_products_1.xml`;
  const root = `${base}/sitemap_products_1.xml`;
  assert.deepEqual(
    monitorSitemapLinks(sitemap([localized, root]), `${base}/fr/sitemap.xml`),
    [localized],
  );
  const unknown = [`${base}/sitemap-catalog.xml`, `${base}/sitemap-shop.xml`];
  assert.deepEqual(
    monitorSitemapLinks(sitemap(unknown), `${base}/sitemap.xml`),
    unknown,
  );
});

test('a multilingual index with thousands of alternate maps does not overflow the monitor queue', async () => {
  const root = `${base}/sitemap_products_1.xml?from=1&to=100`;
  const links = [
    root,
    ...Array.from(
      { length: 5100 },
      (_, i) => `${base}/lang-${i}/sitemap_products_1.xml?from=1&to=100`,
    ),
  ];
  const result = await scanSite(
    { ...site, platform: 'unknown' },
    request,
    1,
    async (url) => ({ url, html: sitemap(links) }),
    { queue: [`${base}/sitemap.xml`] },
    wait,
    options,
  );
  assert.deepEqual(result.progress.queue, [root]);
  assert.equal(result.progress.truncated, false);
  assert.equal(result.complete, false);
});
