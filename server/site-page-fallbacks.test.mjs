// oxlint-disable vitest/no-import-node-test -- Server regressions use Node's test runner.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  hostedProductPage,
  renderedPageNeeded,
} from './site-page-fallbacks.mjs';
import {
  collectionBudget,
  openFetchKey,
  sealFetchKey,
  siteFetchConfig,
} from './site-fetch-config.mjs';
import { fetchPublicPage } from './safe-web.mjs';

const site = { domain: 'shop.example' },
  url = 'https://shop.example/products/creatine';
const resolver = async () => [{ address: '8.8.8.8', family: 4 }];
test('fallback budgets default to zero paid requests and require admin for nonzero budgets', () => {
  assert.equal(collectionBudget({}).maxPaidRequests, 0);
  assert.equal(collectionBudget({}).maxBrowserPages, 5);
  assert.throws(
    () => collectionBudget({ maxPaidRequests: 1 }, { role: 'researcher' }),
    /管理员/,
  );
  assert.equal(
    collectionBudget({ maxPaidRequests: 1 }, { role: 'admin' }).maxPaidRequests,
    1,
  );
  for (const v of [-1, 1.5, 101, Infinity])
    assert.throws(() =>
      collectionBudget({ maxPaidRequests: v }, { role: 'admin' }),
    );
});
test('config save encrypts and never probes the key; blank keeps it and paid defaults off', async () => {
  let stored = {},
    writes = 0;
  const key = 'fc-fixture-only-not-a-real-token',
    secret = randomBytes(32).toString('base64');
  const io = {
    secret,
    read: async () => stored,
    write: async (v) => {
      stored = v;
      writes++;
    },
  };
  const initial = await siteFetchConfig(
    { action: 'server_site_fetch_status' },
    {},
    io,
  );
  assert.equal(initial.paidEnabled, false);
  await assert.rejects(
    siteFetchConfig(
      { action: 'server_site_fetch_config' },
      { role: 'researcher' },
      io,
    ),
  );
  await assert.rejects(
    siteFetchConfig(
      { action: 'server_site_fetch_config', paidEnabled: true },
      { role: 'admin' },
      io,
    ),
    /Key/,
  );
  const r = await siteFetchConfig(
    { action: 'server_site_fetch_config', apiKey: key, paidEnabled: true },
    { role: 'admin' },
    io,
  );
  assert.equal(r.paidEnabled, true);
  assert.ok(!JSON.stringify([r, stored]).includes(key));
  assert.equal(openFetchKey(stored.key, secret), key);
  await siteFetchConfig(
    { action: 'server_site_fetch_config', apiKey: '', paidEnabled: false },
    { role: 'admin' },
    io,
  );
  assert.equal(openFetchKey(stored.key, secret), key);
  assert.equal(writes, 2);
  const sealed = sealFetchKey(key, secret);
  assert.throws(() =>
    openFetchKey(
      { ...sealed, tag: randomBytes(16).toString('base64') },
      secret,
    ),
  );
});
test('rendering is only selected for dynamic pages, not sitemap, catalog JSON or already complete product pages', () => {
  const page = { html: '<script src="/bundle.js"></script>' };
  assert.equal(renderedPageNeeded(page, url, [], []), true);
  assert.equal(
    renderedPageNeeded(
      page,
      url,
      [{ ingredients: 'Creatine', image: 'x' }],
      [],
    ),
    false,
  );
  assert.equal(
    renderedPageNeeded(page, 'https://shop.example/sitemap.xml', [], []),
    false,
  );
  assert.equal(
    renderedPageNeeded(page, 'https://shop.example/products.json', [], []),
    false,
  );
});
test('hosted requests use fixed endpoint and no advanced options, redact tokens, reject target page 429 despite provider HTTP200', async () => {
  let count = 0;
  const result = await hostedProductPage(
    url,
    site,
    'secret',
    async (target, init) => {
      count++;
      assert.equal(target, 'https://api.firecrawl.dev/v2/scrape');
      assert.equal(init.redirect, 'manual');
      assert.deepEqual(JSON.parse(init.body).formats, ['rawHtml']);
      return Response.json({
        success: true,
        data: {
          rawHtml: '<h1>Creatine</h1>',
          metadata: { statusCode: 200, sourceURL: url },
        },
      });
    },
    resolver,
  );
  assert.equal(result.method, 'hosted');
  assert.equal(count, 1);
  await assert.rejects(
    hostedProductPage(
      url,
      site,
      'secret',
      async () =>
        Response.json({
          success: true,
          data: { metadata: { statusCode: 429 } },
        }),
      resolver,
    ),
    (e) => e.status === 429,
  );
  await assert.rejects(
    hostedProductPage(
      url,
      site,
      'secret',
      async () => {
        throw new Error('secret');
      },
      resolver,
    ),
    (e) => !e.message.includes('secret') && /未知/.test(e.message),
  );
});
test('foreign domains and private network DNS are rejected before a hosted request', async () => {
  const noFetch = () => {
    throw new Error('must not request');
  };
  await assert.rejects(
    hostedProductPage('https://other.example/p', site, 'x', noFetch, resolver),
    /当前公开站点/,
  );
  await assert.rejects(
    hostedProductPage(url, site, 'x', noFetch, async () => [
      { address: '127.0.0.1' },
    ]),
    /非公网/,
  );
  await assert.rejects(
    fetchPublicPage('https://other.example/p', 0, ['text/html'], {
      allowedDomain: site.domain,
    }),
    /其他域名/,
  );
});
