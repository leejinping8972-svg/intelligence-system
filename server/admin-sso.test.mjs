/* oxlint-disable vitest/no-import-node-test -- Standalone Node security tests. */
/* oxlint-disable unicorn/no-await-expression-member -- Keep protocol response assertions adjacent to requests. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';

import { adminSsoConfig } from './admin-sso-config.mjs';
import { createAdminSso, ssoReturnPath } from './admin-sso.mjs';

const aId = '11111111-1111-4111-8111-111111111111';
const bId = '22222222-2222-4222-8222-222222222222';
const shared = randomBytes(32).toString('base64url');
const env = {
  ADMIN_SSO_ENABLED: 'true',
  ADMIN_SSO_SHARED_SECRET: shared,
  ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ [bId]: aId }),
};
const fresh = () => randomBytes(32).toString('base64url');

function fixture() {
  let now = 0;
  const incoming = [],
    logins = [];
  const configA = adminSsoConfig(env);
  const configB = adminSsoConfig({
    ...env,
    ADMIN_SSO_PUBLIC_ORIGIN: configA.peerOrigin,
    ADMIN_SSO_PEER_ORIGIN: configA.ownOrigin,
    ADMIN_SSO_CLIENT_ID: configA.peerId,
    ADMIN_SSO_PEER_ID: configA.clientId,
    ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ [aId]: bId }),
  });
  const users = new Map([
    ['a', { id: aId, enabled: 1, role: 'admin', token_hash: 'a-session' }],
    ['b', { id: bId, enabled: 1, role: 'admin', token_hash: 'b-session' }],
  ]);
  function store(userKey) {
    const tickets = new Map();
    return {
      tickets,
      async put(kind, value, payload, ttl) {
        tickets.set(`${kind}/${value}`, {
          payload,
          expires: now + ttl,
          used: false,
        });
      },
      async get(kind, value) {
        const entry = tickets.get(`${kind}/${value}`);
        return entry && !entry.used && entry.expires > now
          ? structuredClone(entry.payload)
          : null;
      },
      async consume(kind, value) {
        const entry = tickets.get(`${kind}/${value}`);
        if (!entry || entry.used || entry.expires <= now) return false;
        entry.used = true;
        return true;
      },
      async activeAdmin(id, hash) {
        const user = users.get(userKey);
        return user?.enabled &&
          user.role === 'admin' &&
          user.id === id &&
          user.token_hash === hash
          ? user
          : null;
      },
      async localAdmin(id) {
        const user = users.get(userKey);
        return user?.enabled && user.role === 'admin' && user.id === id
          ? user
          : null;
      },
    };
  }
  const stores = { a: store('a'), b: store('b') };
  const configs = { a: configA, b: configB },
    handlers = {};
  async function call(
    which,
    path,
    { method = 'GET', headers = {}, data } = {},
  ) {
    const req = Readable.from(
      data === undefined
        ? []
        : [Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))],
    );
    Object.assign(req, {
      method,
      headers,
      socket: { remoteAddress: '127.0.0.1' },
    });
    const res = {
      status: 200,
      headers: {},
      text: '',
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = value;
      },
      getHeader(key) {
        return this.headers[key.toLowerCase()];
      },
      writeHead(status, extra = {}) {
        this.status = status;
        for (const [key, value] of Object.entries(extra))
          this.setHeader(key, value);
        return this;
      },
      end(value = '') {
        this.text = value;
        return this;
      },
    };
    await handlers[which].handle(
      req,
      res,
      new URL(path, configs[which].ownOrigin),
    );
    try {
      res.data = JSON.parse(res.text);
    } catch {
      /* HTML or redirect */
    }
    return res;
  }
  let remoteOverride;
  for (const which of ['a', 'b']) {
    handlers[which] = createAdminSso({
      config: configs[which],
      store: stores[which],
      sessionUser: async (req) => {
        if (req.headers.cookie?.includes('local=other'))
          return { id: 'other-account', role: 'admin', enabled: 1 };
        return req.headers.cookie?.includes(`local=${which}`)
          ? users.get(which) || null
          : null;
      },
      signIn: async (user, res, peerId) => {
        logins.push({ which, user, peerId });
        res.setHeader(
          'set-cookie',
          `local=${which}; HttpOnly; Secure; SameSite=Strict`,
        );
      },
      fetchPeer: async (url, options) => {
        incoming.push({ url, options });
        if (remoteOverride) return remoteOverride(url, options);
        assert.equal(options.redirect, 'error');
        const result = await call(which === 'a' ? 'b' : 'a', url, {
          method: options.method,
          headers: options.headers,
          data: options.body,
        });
        return new Response(result.text, { status: result.status });
      },
    });
  }
  const post = (which, path, data, cookie = '', headers = {}) =>
    call(which, path, {
      method: 'POST',
      data,
      headers: {
        origin: configs[which].ownOrigin,
        'content-type': 'application/json',
        cookie,
        ...headers,
      },
    });
  async function begin(target = 'a') {
    const source = target === 'a' ? 'b' : 'a';
    const start = await call(
      target,
      '/api/sso/start?return_to=%2Fadmin%2Fresearch%3Fmarket%3DUS',
    );
    const authUrl = new URL(start.headers.location);
    const params = Object.fromEntries(authUrl.searchParams);
    const cookie = start.headers['set-cookie'][0].split(';')[0];
    const authorized = await post(
      source,
      '/api/sso/authorize',
      params,
      `local=${source}`,
    );
    const reply = Object.fromEntries(
      new URL(authorized.data.redirect).searchParams,
    );
    return { source, target, start, authUrl, params, cookie, reply };
  }
  return {
    call,
    post,
    begin,
    users,
    configs,
    stores,
    logins,
    incoming,
    advance(ms) {
      now += ms;
    },
    override(fn) {
      remoteOverride = fn;
    },
  };
}

test('disabled by default; enabling requires HTTPS origins, dedicated secret and explicit one-to-one immutable ID mapping', () => {
  assert.equal(adminSsoConfig({}), null);
  assert.equal(adminSsoConfig({ ADMIN_SSO_ENABLED: 'false' }), null);
  for (const patch of [
    { ADMIN_SSO_SHARED_SECRET: 'weak' },
    { ADMIN_SSO_ACCOUNT_MAP: '{}' },
    { ADMIN_SSO_ACCOUNT_MAP: '[]' },
    { ADMIN_SSO_ACCOUNT_MAP: 'invalid' },
    { ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ owner: 'admin' }) },
    { ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ one: aId, two: aId }) },
    { ADMIN_SSO_PUBLIC_ORIGIN: 'http://is.luckdate.com' },
    { ADMIN_SSO_PEER_ORIGIN: 'https://ai.chatviva.com/path' },
    { ADMIN_SSO_PEER_ORIGIN: 'https://ai.chatviva.com/?x=1' },
    { ADMIN_SSO_PEER_ORIGIN: 'https://is.luckdate.com' },
    { ADMIN_SSO_PEER_ID: 'intelligence-system' },
  ])
    assert.throws(() => adminSsoConfig({ ...env, ...patch }));
  assert.equal(adminSsoConfig(env).accounts.get(bId), aId);
});

test('return targets cannot leave the local admin application or reenter authentication', () => {
  for (const path of [
    'https://evil.test',
    '//evil.test',
    '/api',
    '/admin/../api',
    '/admin/auth/login',
    String.raw`/admin/\evil.test`,
    '/admin/\n',
  ]) {
    assert.equal(
      ssoReturnPath(path, 'https://is.luckdate.com'),
      '/admin/overview',
    );
  }
  assert.equal(
    ssoReturnPath('/admin/research?market=US#term', 'https://is.luckdate.com'),
    '/admin/research?market=US#term',
  );
});

for (const target of ['a', 'b'])
  test(`bidirectional code exchange authenticates ${target}, preserves return route and issues a local cookie`, async () => {
    const f = fixture(),
      flow = await f.begin(target);
    assert.equal(flow.start.status, 303);
    assert.equal(flow.authUrl.origin, f.configs[flow.source].ownOrigin);
    assert.match(
      flow.start.headers['set-cookie'][0],
      /HttpOnly; Secure; SameSite=Lax; Max-Age=300/,
    );
    const landing = await f.call(flow.source, flow.authUrl.href);
    assert.equal(landing.status, 200);
    assert.match(landing.text, /credentials:'same-origin'/);
    assert.match(
      landing.headers['content-security-policy'],
      /frame-ancestors 'none'/,
    );
    assert.equal(landing.headers['set-cookie'], undefined);
    const callbackLanding = await f.call(
      target,
      `/api/sso/callback?${new URLSearchParams(flow.reply)}`,
    );
    assert.equal(callbackLanding.status, 200);
    assert.match(callbackLanding.text, /fetch\(location.pathname/);
    const result = await f.post(
      target,
      '/api/sso/callback',
      flow.reply,
      flow.cookie,
    );
    assert.equal(result.data.redirect, '/admin/research?market=US');
    assert.equal(f.logins.length, 1);
    assert.equal(f.logins[0].which, target);
    assert.equal(result.headers['set-cookie'].length, 2);
    assert.match(result.headers['set-cookie'][0], /SameSite=Strict/);
    assert.match(result.headers['set-cookie'][1], /Max-Age=0/);
    assert.equal(
      f.incoming[0].options.headers.authorization,
      `Bearer ${shared}`,
    );
    assert.equal(result.headers['referrer-policy'], 'no-referrer');
  });

test('authorization landing and browser POST reject unregistered callbacks, client IDs, weak PKCE and cross-origin submissions', async () => {
  const f = fixture(),
    flow = await f.begin();
  for (const patch of [
    { redirect_uri: 'https://evil.test/callback' },
    { client_id: 'evil' },
    { code_challenge_method: 'plain' },
    { code_challenge: 'short' },
    { response_type: 'token' },
    { prompt: 'login' },
  ]) {
    const data = { ...flow.params, ...patch };
    assert.equal(
      (await f.post('b', '/api/sso/authorize', data, 'local=b')).status,
      400,
    );
    assert.equal(
      (await f.call('b', `/api/sso/authorize?${new URLSearchParams(data)}`))
        .status,
      400,
    );
  }
  assert.equal(
    (
      await f.post('b', '/api/sso/authorize', flow.params, 'local=b', {
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
});

for (const condition of ['missing', 'researcher', 'disabled'])
  test(`source ${condition} session cannot issue an administrator code`, async () => {
    const f = fixture(),
      flow = await f.begin();
    if (condition === 'researcher') f.users.get('b').role = 'researcher';
    if (condition === 'disabled') f.users.get('b').enabled = 0;
    const result = await f.post(
      'b',
      '/api/sso/authorize',
      flow.params,
      condition === 'missing' ? '' : 'local=b',
    );
    const params = new URL(result.data.redirect).searchParams;
    assert.equal(params.get('code'), null);
    assert.equal(
      params.get('error'),
      condition === 'missing' ? 'login_required' : 'access_denied',
    );
  });

test('missing peer session returns local password login once, with no sign-in or recursive authorization', async () => {
  const f = fixture(),
    flow = await f.begin();
  const result = await f.post(
    'a',
    '/api/sso/callback',
    { state: flow.reply.state, error: 'login_required' },
    flow.cookie,
  );
  assert.equal(result.data.redirect, '/admin/auth/login?sso=unavailable');
  assert.equal(f.logins.length, 0);
  assert.equal(f.incoming.length, 0);
});

test('stolen state without matching browser cookie cannot consume a legitimate flow', async () => {
  const f = fixture(),
    flow = await f.begin();
  assert.equal(
    (await f.post('a', '/api/sso/callback', flow.reply)).status,
    400,
  );
  assert.equal(
    (
      await f.post(
        'a',
        '/api/sso/callback',
        flow.reply,
        flow.cookie.replace(/=.*/, `=${fresh()}`),
      )
    ).status,
    400,
  );
  assert.equal(
    (await f.post('a', '/api/sso/callback', flow.reply, flow.cookie)).data
      .redirect,
    '/admin/research?market=US',
  );
});

test('callback origin and JSON are mandatory; malformed and oversized requests fail closed', async () => {
  const f = fixture(),
    flow = await f.begin();
  assert.equal(
    (
      await f.post('a', '/api/sso/callback', flow.reply, flow.cookie, {
        origin: 'https://evil.test',
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.post('a', '/api/sso/callback', 'broken', flow.cookie)).status,
    400,
  );
  assert.equal(
    (await f.post('a', '/api/sso/callback', 'x'.repeat(8193), flow.cookie))
      .status,
    413,
  );
  assert.equal(f.logins.length, 0);
});

test('code exchange requires secret, exact client and callback, and matching verifier; wrong attempts do not redeem code', async () => {
  const f = fixture(),
    flow = await f.begin();
  const state = await f.stores.a.get('state', flow.reply.state);
  const input = {
    grant_type: 'authorization_code',
    client_id: f.configs.a.clientId,
    redirect_uri: `${f.configs.a.ownOrigin}/api/sso/callback`,
    code: flow.reply.code,
    code_verifier: state.verifier,
  };
  assert.equal((await f.post('b', '/api/sso/exchange', input)).status, 401);
  for (const patch of [
    { code_verifier: fresh() },
    { client_id: 'evil' },
    { redirect_uri: 'https://evil.test' },
    { grant_type: 'password' },
  ]) {
    assert.equal(
      (
        await f.post('b', '/api/sso/exchange', { ...input, ...patch }, '', {
          authorization: `Bearer ${shared}`,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await f.post('a', '/api/sso/callback', flow.reply, flow.cookie)).data
      .redirect,
    '/admin/research?market=US',
  );
});

test('authorization code can be redeemed once and concurrent callbacks create one local session', async () => {
  const f = fixture(),
    flow = await f.begin();
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      f.post('a', '/api/sso/callback', flow.reply, flow.cookie),
    ),
  );
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert.equal(f.logins.length, 1);
  const reused = await f.call('a', '/api/sso/start');
  const params = Object.fromEntries(
    new URL(reused.headers.location).searchParams,
  );
  const secondCookie = reused.headers['set-cookie'][0].split(';')[0];
  const replay = await f.post(
    'a',
    '/api/sso/callback',
    { state: params.state, code: flow.reply.code },
    secondCookie,
  );
  assert.equal(replay.data.redirect, '/admin/auth/login?sso=failed');
  assert.equal(f.logins.length, 1);
});

for (const change of ['disabled', 'role', 'logout'])
  test(`source ${change} after issuing code is rechecked at redemption`, async () => {
    const f = fixture(),
      flow = await f.begin();
    if (change === 'disabled') f.users.get('b').enabled = 0;
    if (change === 'role') f.users.get('b').role = 'researcher';
    if (change === 'logout') f.users.get('b').token_hash = 'revoked';
    assert.equal(
      (await f.post('a', '/api/sso/callback', flow.reply, flow.cookie)).data
        .redirect,
      '/admin/auth/login?sso=failed',
    );
    assert.equal(f.logins.length, 0);
  });

test('code and state expire separately', async () => {
  const f = fixture(),
    flow = await f.begin();
  f.advance(60_001);
  assert.equal(
    (await f.post('a', '/api/sso/callback', flow.reply, flow.cookie)).data
      .redirect,
    '/admin/auth/login?sso=failed',
  );
  const next = await f.begin();
  f.advance(300_001);
  assert.equal(
    (await f.post('a', '/api/sso/callback', next.reply, next.cookie)).status,
    400,
  );
  assert.equal(f.logins.length, 0);
});

for (const patch of [
  { issuer: 'https://evil.test' },
  { audience: 'wrong' },
  { protocol_version: '2' },
  { role: 'researcher' },
  { sub: 'unmapped-admin' },
])
  test(`untrusted peer identity ${Object.keys(patch)[0]} cannot create an account or log in`, async () => {
    const f = fixture(),
      flow = await f.begin();
    f.override(async () =>
      Response.json({
        protocol_version: '1',
        issuer: f.configs.b.ownOrigin,
        audience: f.configs.a.clientId,
        sub: bId,
        role: 'admin',
        ...patch,
      }),
    );
    assert.equal(
      (await f.post('a', '/api/sso/callback', flow.reply, flow.cookie)).data
        .redirect,
      '/admin/auth/login?sso=failed',
    );
    assert.equal(f.logins.length, 0);
  });

test('local disabled/researcher and a different active browser account cannot be switched by SSO', async () => {
  for (const mode of ['disabled', 'researcher', 'other']) {
    const f = fixture(),
      flow = await f.begin();
    if (mode === 'disabled') f.users.get('a').enabled = 0;
    if (mode === 'researcher') f.users.get('a').role = 'researcher';
    assert.equal(
      (
        await f.post(
          'a',
          '/api/sso/callback',
          flow.reply,
          `${flow.cookie}; local=${mode === 'other' ? 'other' : 'a'}`,
        )
      ).data.redirect,
      '/admin/auth/login?sso=failed',
    );
    assert.equal(f.logins.length, 0);
  }
});

test('peer network error is not retried and falls back to password login', async () => {
  const f = fixture(),
    flow = await f.begin();
  f.override(async () => {
    throw new Error('network unavailable');
  });
  const result = await f.post(
    'a',
    '/api/sso/callback',
    flow.reply,
    flow.cookie,
  );
  assert.equal(result.data.redirect, '/admin/auth/login?sso=failed');
  assert.equal(f.incoming.length, 1);
  assert.equal(f.logins.length, 0);
  assert.match(result.headers['set-cookie'][0], /Max-Age=0/);
});

test('parallel browser tabs use independent state cookies', async () => {
  const f = fixture(),
    one = await f.begin(),
    two = await f.begin();
  assert.notEqual(one.cookie.split('=')[0], two.cookie.split('=')[0]);
  for (const flow of [one, two])
    assert.equal(
      (
        await f.post(
          'a',
          '/api/sso/callback',
          flow.reply,
          `${one.cookie}; ${two.cookie}`,
        )
      ).data.redirect,
      '/admin/research?market=US',
    );
});

test('disabled endpoints are unavailable and anonymous flow creation is bounded', async () => {
  const disabled = createAdminSso({ config: null });
  let status;
  await disabled.handle(
    { method: 'GET' },
    {
      setHeader() {},
      writeHead(value) {
        status = value;
      },
      end() {},
    },
    new URL('https://is.luckdate.com/api/sso/start'),
  );
  assert.equal(status, 404);
  const f = fixture();
  for (let i = 0; i < 30; i++)
    assert.equal((await f.call('a', '/api/sso/start')).status, 303);
  assert.equal((await f.call('a', '/api/sso/start')).status, 429);
});
