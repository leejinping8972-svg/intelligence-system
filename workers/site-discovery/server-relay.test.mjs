import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Standalone Worker test runner.
import test from 'node:test';

import worker from './src/index.js';
import { serverRelay } from './src/server-relay.js';

test('server relay requires HTTPS and stops redirects without forwarding its credential', async () => {
  await assert.rejects(
    () =>
      serverRelay(
        {},
        { SERVER_API_URL: 'http://example.com', SERVER_BRIDGE_KEY: 'private' },
      ),
    /HTTPS/,
  );
  let calls = 0;
  await assert.rejects(
    () =>
      serverRelay(
        { action: 'server_status' },
        {
          SERVER_API_URL: 'https://example.com/api',
          SERVER_BRIDGE_KEY: 'private',
        },
        async (_url, options) => {
          calls += 1;
          assert.equal(options.redirect, 'manual');
          assert.equal(options.headers['x-server-key'], 'private');
          return new Response(null, { status: 302 });
        },
      ),
    /重定向/,
  );
  assert.equal(calls, 1);
});
test('browser credentials cannot invoke internal collectors and internal credentials cannot invoke admin APIs', async () => {
  const env = {
    ALLOWED_ORIGINS: 'https://app.example',
    RESEARCH_ACCESS_KEY: 'browser-private',
    SERVER_BRIDGE_KEY: 'server-private',
  };
  const request = (action, internal) =>
    new Request('https://worker.example', {
      method: 'POST',
      headers: internal
        ? { 'x-server-key': 'server-private' }
        : {
            origin: 'https://app.example',
            'x-research-key': 'browser-private',
          },
      body: JSON.stringify({
        action,
        keywords: ['magnesium'],
        markets: ['US'],
        sources: ['site_discovery'],
      }),
    });
  const browser = await worker.fetch(request('server_collect', false), env);
  const internal = await worker.fetch(
    request('server_clear_keywords', true),
    env,
  );
  assert.equal(browser.status, 400);
  assert.equal(internal.status, 400);
  const result = await worker.fetch(request('server_collect', true), env);
  assert.equal(result.status, 400);
  assert.match(await result.text(), /尚未配置搜索密钥/);
  const keywordOnly = await worker.fetch(
    request('keyword_research', false),
    env,
  );
  assert.equal(keywordOnly.status, 400);
  assert.match(await keywordOnly.text(), /不接受站点或商品采集/);
});
