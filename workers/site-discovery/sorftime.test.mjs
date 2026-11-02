import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Worker package uses Node's built-in test runner
import test from 'node:test';

import worker from './src/index.js';
import { readSorftimeToken, saveSorftimeToken } from './src/provider-config.js';
import {
  parseMcpResponse,
  parseSorftimeKeywords,
  readMcpResult,
  sorftimeStatus,
  sorftimeSuggestions,
} from './src/sorftime.js';

function configEnv() {
  const saved = new Map();
  return {
    saved,
    PROVIDER_CONFIG_ENCRYPTION_KEY: btoa(
      String.fromCodePoint(...crypto.getRandomValues(new Uint8Array(32))),
    ),
    PROVIDER_CONFIG: {
      get: async (key) => (saved.has(key) ? JSON.parse(saved.get(key)) : null),
      put: async (key, value) => {
        saved.set(key, value);
      },
    },
  };
}

test('provider tokens are encrypted and never returned in configuration responses', async () => {
  const env = configEnv();
  const token = 'private-mcp-token-for-test';
  const result = await saveSorftimeToken({ sorftimeToken: token }, env);
  assert.equal(result.configured, true);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal([...env.saved.values()].join(',').includes(token), false);
  assert.equal(await readSorftimeToken(env), token);
  const status = await sorftimeStatus({ SORFTIME_MCP_TOKEN: token });
  assert.equal(status.configured, true);
});

test('blank or URL credentials do not overwrite the existing token', async () => {
  const env = configEnv();
  await saveSorftimeToken({ sorftimeToken: 'existing-private-token' }, env);
  for (const sorftimeToken of ['', 'https://mcp.sorftime.com?key=private'])
    await assert.rejects(
      () => saveSorftimeToken({ sorftimeToken }, env),
      /TOKEN/,
    );
  assert.equal(await readSorftimeToken(env), 'existing-private-token');
});

test('configuration writes require the existing workspace access key', async () => {
  const env = {
    ...configEnv(),
    ALLOWED_ORIGINS: 'https://app.example',
    RESEARCH_ACCESS_KEY: 'workspace-key',
  };
  const request = (accessKey) =>
    new Request('https://worker.example', {
      method: 'POST',
      headers: {
        origin: 'https://app.example',
        'x-research-key': accessKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: 'keyword_sources_config',
        sorftimeToken: 'private-mcp-token-test',
      }),
    });
  const denied = await worker.fetch(request('wrong'), env);
  assert.equal(denied.status, 401);
  assert.equal(env.saved.size, 0);
  const response = await worker.fetch(request('workspace-key'), env);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.equal(body.includes('private-mcp-token-test'), false);
});

test('parses JSON and SSE MCP envelopes without mixing notification messages', () => {
  assert.deepEqual(
    parseMcpResponse('{"jsonrpc":"2.0","id":2,"result":{"tools":[]}}', 2),
    { tools: [] },
  );
  assert.deepEqual(
    parseMcpResponse(
      'event: message\ndata: {"method":"notifications/progress"}\n\nevent: message\ndata: {"id":2,"result":{"tools":[]}}\n\n',
      2,
    ),
    { tools: [] },
  );
  assert.throws(
    () => parseMcpResponse('{"id":2,"error":{"message":"denied"}}', 2),
    /denied/,
  );
});

test('only extracts explicit keyword records, not product names or descriptive prose', () => {
  const result = parseSorftimeKeywords(
    {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            Data: {
              List: [
                { Keyword: 'magnesium gummies' },
                { keyword: 'magnesium gummies' },
                { keyword: 'sleep magnesium' },
                { title: 'Product marketing text' },
              ],
            },
          }),
        },
      ],
    },
    10,
  );
  assert.deepEqual(
    result.map((item) => item.term),
    ['magnesium gummies', 'sleep magnesium'],
  );
  assert.ok(result.every((item) => item.source === 'Sorftime · Amazon'));
  assert.deepEqual(
    parseSorftimeKeywords(
      {
        content: [
          {
            type: 'text',
            text: 'No data available. Please try another keyword.',
          },
        ],
      },
      10,
    ),
    [],
  );
  assert.throws(
    () => parseSorftimeKeywords({ isError: true }, 10),
    /工具返回错误/,
  );
});

test('reads matching results from a long-lived SSE stream without waiting for disconnect', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(
          'event: message\ndata: {"id":4,"result":{"tools":[]}}\n\n',
        ),
      );
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.deepEqual(await readMcpResult(new Response(body), 4), { tools: [] });
  assert.equal(cancelled, true);
});

test('normalizes Sorftime nonbreaking spaces before keyword deduplication and trend lookup', () => {
  const items = parseSorftimeKeywords(
    {
      structuredContent: {
        data: [
          { keyword: 'magnesium\u202Fglycinate' },
          { keyword: ' magnesium  glycinate ' },
        ],
      },
    },
    10,
  );
  assert.deepEqual(items, [
    { term: 'magnesium glycinate', source: 'Sorftime · Amazon' },
  ]);
});

function mcpMock(calls, error = false) {
  return async (_url, options) => {
    assert.equal(options.redirect, 'manual');
    const request = JSON.parse(options.body);
    calls.push(request);
    if (!request.id) return new Response(null, { status: 202 });
    let result = {};
    if (request.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'keyword_related_words',
            inputSchema: { properties: { amzSite: {}, searchKeyword: {} } },
          },
        ],
      };
    if (request.method === 'tools/call') {
      if (error) return new Response('upstream unavailable', { status: 429 });
      result = {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              Data: [
                { Keyword: 'magnesium gummies' },
                { Keyword: 'magnesium powder' },
              ],
            }),
          },
        ],
      };
    }
    return new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n\n`,
      {
        headers: {
          'content-type': 'text/event-stream',
          'mcp-session-id': 'session',
        },
      },
    );
  };
}

test('connection checks only discover tools and never consume keyword calls', async () => {
  const calls = [];
  const result = await sorftimeStatus(
    { SORFTIME_MCP_TOKEN: 'private' },
    true,
    mcpMock(calls),
  );
  assert.equal(result.ready, true);
  assert.equal(
    calls.some((item) => item.method === 'tools/call'),
    false,
  );
});

test('redirects stop on Workers-compatible manual mode without forwarding the token', async () => {
  let calls = 0;
  const result = await sorftimeStatus(
    { SORFTIME_MCP_TOKEN: 'private-test-token' },
    true,
    async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      calls += 1;
      return new Response(null, {
        status: 302,
        headers: { location: 'https://untrusted.example' },
      });
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.ready, false);
  assert.match(result.message, /重定向/);
  assert.equal(JSON.stringify(result).includes('private-test-token'), false);
});

test('Sorftime respects its call budget and never invokes product tools', async () => {
  const calls = [];
  const budget = { remaining: 1, used: 0 };
  const result = await sorftimeSuggestions(
    'magnesium',
    'US',
    2,
    100,
    budget,
    { SORFTIME_MCP_TOKEN: 'private' },
    mcpMock(calls),
  );
  assert.equal(result.status, 'success');
  assert.equal(result.items.length, 2);
  assert.equal(budget.used, 1);
  const invoked = calls.filter((item) => item.method === 'tools/call');
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].params.name, 'keyword_related_words');
  assert.deepEqual(invoked[0].params.arguments, {
    amzSite: 'US',
    searchKeyword: 'magnesium',
  });
});

test('adapts the current keyword_extends schema and stateless metadata gateway', async () => {
  const calls = [];
  const budget = { remaining: 1, used: 0 };
  const result = await sorftimeSuggestions(
    'collagen',
    'MX',
    1,
    10,
    budget,
    { SORFTIME_MCP_TOKEN: 'private' },
    async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request);
      if (request.method === 'initialize')
        return new Response('request error', { status: 400 });
      const response =
        request.method === 'tools/list'
          ? {
              tools: [
                {
                  name: 'keyword_extends',
                  inputSchema: {
                    properties: {
                      keyword: { type: 'string' },
                      keyword_support_site: { enum: ['us', 'mx'] },
                      page: { type: 'integer' },
                    },
                  },
                },
              ],
            }
          : {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    Data: [{ keyword: 'colageno hidrolizado' }],
                  }),
                },
              ],
            };
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: response,
      });
    },
  );
  assert.equal(result.status, 'success');
  assert.equal(budget.used, 1);
  assert.deepEqual(
    calls
      .filter((item) => item.method === 'tools/call')
      .map((item) => item.params),
    [
      {
        name: 'keyword_extends',
        arguments: { keyword_support_site: 'mx', keyword: 'collagen', page: 1 },
      },
    ],
  );
});

test('unsupported markets and exhausted budgets make no upstream calls', async () => {
  const calls = [];
  const unsupported = await sorftimeSuggestions(
    'magnesium',
    'VN',
    1,
    10,
    { remaining: 3, used: 0 },
    {},
    mcpMock(calls),
  );
  const exhausted = await sorftimeSuggestions(
    'magnesium',
    'MX',
    1,
    10,
    { remaining: 0, used: 0 },
    {},
    mcpMock(calls),
  );
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(exhausted.status, 'error');
  assert.equal(calls.length, 0);
});

test('failed data calls count towards the quota and are not automatically retried', async () => {
  const calls = [];
  const budget = { remaining: 3, used: 0 };
  const result = await sorftimeSuggestions(
    'magnesium',
    'MX',
    2,
    100,
    budget,
    { SORFTIME_MCP_TOKEN: 'private' },
    mcpMock(calls, true),
  );
  assert.equal(result.status, 'error');
  assert.equal(budget.used, 1);
  assert.match(result.message, /429/);
  assert.equal(calls.filter((item) => item.method === 'tools/call').length, 1);
});

test('second-level expansion follows the keyword target beyond six calls and stops when filled', async () => {
  const calls = [];
  const metadata = mcpMock(calls);
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.method !== 'tools/call') return metadata(url, options);
    calls.push(request);
    const word = request.params.arguments.searchKeyword;
    const keywords = word === 'seed' ? Array.from({length: 8}, (_, i) => `child-${i}`) : [`extra-${word}`];
    return Response.json({ jsonrpc: '2.0', id: request.id, result: { structuredContent: { keywords } } });
  };
  const budget = { remaining: 100, used: 0 };
  const result = await sorftimeSuggestions('seed', 'US', 2, 15, budget, {SORFTIME_MCP_TOKEN: 'QA-only'}, fetcher);
  assert.equal(result.items.length, 15);
  assert.equal(budget.used, 8);
  assert.equal(calls.filter(call => call.method === 'tools/call').length, 8);
  const smallBudget = {remaining: 100, used: 0};
  const small = await sorftimeSuggestions('seed', 'US', 2, 3, smallBudget, {SORFTIME_MCP_TOKEN: 'QA-only'}, fetcher);
  assert.equal(small.items.length, 3);
  assert.equal(smallBudget.used, 1);
});
