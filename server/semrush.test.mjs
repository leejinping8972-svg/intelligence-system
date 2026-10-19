import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  connectSemrush,
  SEMRUSH_MCP_URL,
  semrushConnectionStatus,
  validateSemrushKey,
} from './semrush-mcp.mjs';
import {
  decryptSemrushKey,
  encryptSemrushKey,
  semrushAction,
} from './semrush-config.mjs';

const token = 'qa-sem-test-key-not-a-live-credential';
const toolNames = ['keyword_research', 'get_report_schema', 'execute_report'];
function gateway({
  status = 200,
  tools = toolNames,
  sse = false,
  paginate = false,
} = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    if (status !== 200)
      return new Response('', {
        status,
        headers:
          status === 302 ? { location: 'https://untrusted.example' } : {},
      });
    if (body.method === 'notifications/initialized')
      return new Response(null, { status: 202 });
    const result =
      body.method === 'initialize'
        ? { protocolVersion: '2025-03-26' }
        : {
            tools: (paginate
              ? body.params.cursor
                ? tools.slice(1)
                : tools.slice(0, 1)
              : tools
            ).map((name) => ({ name, inputSchema: { type: 'object' } })),
            ...(paginate && !body.params.cursor
              ? { nextCursor: 'page-2' }
              : {}),
          };
    const payload = { jsonrpc: '2.0', id: body.id, result };
    return new Response(
      sse
        ? `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/test' })}\n\nevent: message\ndata: ${JSON.stringify(payload)}\n\n`
        : JSON.stringify(payload),
      { headers: { 'mcp-session-id': 'qa-session' } },
    );
  };
  return { calls, fetcher };
}
test('official remote MCP uses header authentication and metadata only', async () => {
  const g = gateway();
  const result = await semrushConnectionStatus(token, true, g.fetcher);
  assert.equal(result.ready, true);
  assert.equal(result.toolCount, 3);
  assert.deepEqual(
    g.calls.map((c) => c.body.method),
    ['initialize', 'notifications/initialized', 'tools/list'],
  );
  for (const c of g.calls) {
    assert.equal(c.url, SEMRUSH_MCP_URL);
    assert.ok(!c.url.includes(token));
    assert.equal(c.options.headers.authorization, `Apikey ${token}`);
    assert.equal(c.options.redirect, 'manual');
    assert.ok(!JSON.stringify(c.body).includes(token));
  }
  assert.equal(g.calls.at(-1).options.headers['mcp-session-id'], 'qa-session');
  assert.ok(!JSON.stringify(result).includes(token));
});
test('SSE responses and paginated tool discovery retain all required tools', async () => {
  const g = gateway({ sse: true, paginate: true });
  assert.equal(
    (await semrushConnectionStatus(token, true, g.fetcher)).ready,
    true,
  );
  assert.equal(g.calls.filter((c) => c.body.method === 'tools/list').length, 2);
});
test('missing keyword tools are not reported as ready', async () => {
  const g = gateway({ tools: ['traffic_overview'] });
  const result = await semrushConnectionStatus(token, true, g.fetcher);
  assert.equal(result.connected, true);
  assert.equal(result.ready, false);
  assert.match(result.message, /keyword_research/);
});
test('no key and passive status checks issue no network requests', async () => {
  const g = gateway();
  assert.equal(
    (await semrushConnectionStatus('', true, g.fetcher)).configured,
    false,
  );
  assert.equal(
    (await semrushConnectionStatus(token, false, g.fetcher)).ready,
    false,
  );
  assert.equal(g.calls.length, 0);
  for (const key of [
    '',
    'https://example.com/key',
    'Authorization: Apikey abc',
    'short',
  ])
    assert.throws(() => validateSemrushKey(key));
});
test('redirects stop and 401/403/429 errors remain distinguishable', async () => {
  for (const code of [302, 401, 403, 429]) {
    const g = gateway({ status: code });
    const result = await semrushConnectionStatus(token, true, g.fetcher);
    assert.equal(result.ready, false);
    assert.equal(g.calls.length, 1);
    assert.match(
      result.message,
      code === 302 ? /重定向/ : new RegExp(`HTTP ${code}`),
    );
  }
});
test('protocol failures redact the key and never execute arbitrary report tools', async () => {
  const fetcher = async (url, options) =>
    new Response(
      JSON.stringify({
        id: JSON.parse(options.body).id,
        error: { message: `Failure ${token}` },
      }),
    );
  await assert.rejects(
    () => connectSemrush(token, fetcher),
    (error) =>
      !error.message.includes(token) && error.message.includes('已隐藏'),
  );
});
test('API key is encrypted at rest and blank saves preserve previous configuration', async () => {
  const secret = randomBytes(32).toString('base64');
  let saved;
  const io = {
    secret,
    read: async () => saved,
    write: async (value) => {
      saved = value;
    },
  };
  const admin = { role: 'admin' };
  const result = await semrushAction(
    { action: 'server_semrush_config', apiKey: token },
    admin,
    io,
  );
  assert.equal(result.configured, true);
  assert.ok(!JSON.stringify(saved).includes(token));
  assert.equal(decryptSemrushKey(saved, secret), token);
  assert.throws(() =>
    decryptSemrushKey(saved, randomBytes(32).toString('base64')),
  );
  const prior = structuredClone(saved);
  await assert.rejects(() =>
    semrushAction({ action: 'server_semrush_config', apiKey: '' }, admin, io),
  );
  assert.deepEqual(saved, prior);
  assert.ok(
    !JSON.stringify(
      await semrushAction({ action: 'server_semrush_status' }, admin, io),
    ).includes(token),
  );
});
test('only administrators can save keys or verify the external connection', async () => {
  const io = {
    read: async () => {
      throw new Error('must not read storage');
    },
  };
  for (const input of [
    { action: 'server_semrush_config', apiKey: token },
    { action: 'server_semrush_status', verify: true },
  ]) {
    await assert.rejects(
      () => semrushAction(input, { role: 'researcher' }, io),
      /管理员/,
    );
  }
});
test('successful metadata verification is persisted without exposing the key', async () => {
  const secret = randomBytes(32).toString('base64');
  let stored = {
    ...encryptSemrushKey(token, secret),
    updatedAt: new Date().toISOString(),
  };
  const g = gateway();
  const io = {
    secret,
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    status: (key, verify) => semrushConnectionStatus(key, verify, g.fetcher),
  };
  const result = await semrushAction(
    { action: 'server_semrush_status', verify: true },
    { role: 'admin' },
    io,
  );
  assert.equal(result.ready, true);
  assert.ok(stored.lastCheck.checkedAt);
  assert.ok(!JSON.stringify(result).includes(token));
  assert.ok(!JSON.stringify(stored).includes(token));
});
