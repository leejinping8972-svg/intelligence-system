import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
/* oxlint-disable vitest/no-import-node-test -- Real OIDC provider and disposable PostgreSQL integration. */
/* oxlint-disable unicorn/no-await-expression-member -- Keep protocol assertions beside isolated HTTP and SQL results. */
import test from 'node:test';

import { load } from 'cheerio';

import {
  IDENTITY_BASE,
  identityConfig,
  identityProfile,
} from './identity-config.mjs';
import { identityFixture } from './identity-test-fixture.mjs';

test('identity is opt-in and rejects missing or unsafe configuration', () => {
  assert.equal(identityConfig({}), null);
  for (const origin of [
    'http://example.test',
    'https://example.test/',
    'https://a:b@example.test',
    'https://example.test/path',
  ])
    assert.throws(() =>
      identityConfig({
        IDENTITY_ENABLED: 'true',
        IDENTITY_PUBLIC_ORIGIN: origin,
      }),
    );
  assert.throws(
    () => identityConfig({ IDENTITY_ENABLED: 'true' }),
    /CLIENT_SECRET/,
  );
  const user = {
    id: 'stable-id',
    username: 'renamed',
    display_name: 'User',
    role: 'admin',
    enabled: 1,
  };
  assert.equal(identityProfile(user, { adminIds: [] }).ai_role, 'researcher');
  assert.equal(
    identityProfile(user, { adminIds: ['stable-id'] }).ai_role,
    'admin',
  );
  assert.equal(
    identityProfile(
      { ...user, role: 'researcher' },
      { adminIds: ['stable-id'] },
    ).ai_role,
    'researcher',
  );
  assert.equal(
    identityProfile({ ...user, enabled: 0 }, { adminIds: [] }),
    null,
  );
});

test('real provider completes shared login with PKCE, stable identity, revocation and persistent SQL', async (t) => {
  const f = await identityFixture();
  let identity = await f.create();
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    void identity.handle(
      request,
      response,
      new URL(request.url, f.config.origin),
    );
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const cookies = new Map();
  const authorization = `Basic ${Buffer.from(`${f.config.clientId}:${f.config.secret}`).toString('base64')}`;
  const call = async (
    path,
    { method = 'GET', data, useCookies = true, headers = {} } = {},
  ) => {
    const url = new URL(path, f.config.origin);
    const body = data ? new URLSearchParams(data).toString() : undefined;
    const response = await new Promise((resolve, reject) => {
      const request = httpRequest(
        `${origin}${url.pathname}${url.search}`,
        {
          method,
          headers: {
            host: new URL(f.config.origin).host,
            'x-forwarded-proto': 'https',
            ...(useCookies
              ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
              : {}),
            ...(data
              ? {
                  origin: f.config.origin,
                  'content-type': 'application/x-www-form-urlencoded',
                }
              : {}),
            ...headers,
          },
        },
        (incoming) => {
          const chunks = [];
          incoming.on('data', (chunk) => chunks.push(chunk));
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode,
              headers: {
                get: (name) => incoming.headers[name] || null,
                getSetCookie: () => incoming.headers['set-cookie'] || [],
              },
              text: async () => Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      request.on('error', reject);
      request.end(body);
    });
    if (useCookies)
      for (const value of response.headers.getSetCookie()) {
        const pair = value.split(';')[0];
        const pos = pair.indexOf('=');
        const content = pair.slice(pos + 1);
        const name = pair.slice(0, pos);
        if (/max-age=0/i.test(value) || !content) cookies.delete(name);
        else cookies.set(name, content);
        assert.match(value, /secure/i);
      }
    return {
      status: response.status,
      location: response.headers.get('location'),
      text: await response.text(),
      headers: response.headers,
    };
  };
  const authParams = (verifier) => ({
    client_id: f.config.clientId,
    redirect_uri: f.config.redirectUri,
    response_type: 'code',
    scope: 'openid profile platform_access',
    state: randomBytes(24).toString('base64url'),
    nonce: randomBytes(24).toString('base64url'),
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  });
  async function follow(response, { login = true } = {}) {
    for (let step = 0; step < 12; step++) {
      if (response.location?.startsWith(f.config.redirectUri))
        return new URL(response.location);
      if (response.location) {
        response = await call(response.location);
        continue;
      }
      const $ = load(response.text);
      const form = $('form').first();
      assert.ok(
        form.length,
        `Expected login form, got ${response.status}: ${response.text.slice(0, 500)}`,
      );
      const data = Object.fromEntries(
        form
          .find('input[type=hidden]')
          .map((_index, input) => [
            [$(input).attr('name'), $(input).attr('value')],
          ])
          .get(),
      );
      if (form.find('input[name=username]').length > 0 && login)
        Object.assign(data, {
          username: f.user.username,
          password: f.password,
        });
      response = await call(form.attr('action'), { method: 'POST', data });
    }
    throw new Error('Authorization redirect loop');
  }
  const exchange = (code, verifier, extra = {}) =>
    call(`${IDENTITY_BASE}/token`, {
      method: 'POST',
      useCookies: false,
      data: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: f.config.redirectUri,
        code_verifier: verifier,
      },
      headers: { authorization, origin: '', ...extra },
    });
  try {
    const discovery = JSON.parse(
      (await call(`${IDENTITY_BASE}/.well-known/openid-configuration`)).text,
    );
    assert.equal(discovery.issuer, f.config.issuer);
    assert.equal(discovery.authorization_endpoint, `${f.config.issuer}/auth`);
    assert.deepEqual(discovery.response_types_supported, ['code']);
    assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
    assert.ok(!discovery.grant_types_supported.includes('password'));
    assert.ok(!discovery.grant_types_supported.includes('refresh_token'));
    const verifier = randomBytes(32).toString('base64url');
    const params = authParams(verifier);
    const target = await follow(
      await call(`${IDENTITY_BASE}/auth?${new URLSearchParams(params)}`),
    );
    assert.equal(target.searchParams.get('state'), params.state);
    assert.equal(target.searchParams.get('error'), null);
    assert.equal(
      (
        await exchange(target.searchParams.get('code'), verifier, {
          authorization: `Basic ${Buffer.from(`${f.config.clientId}:invalid-secret`).toString('base64')}`,
        })
      ).status,
      401,
    );
    const exchanged = await exchange(target.searchParams.get('code'), verifier);
    assert.equal(exchanged.status, 200, exchanged.text);
    const tokens = JSON.parse(exchanged.text);
    const [header, payload, signature] = tokens.id_token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url'));
    const jwks = JSON.parse((await call(discovery.jwks_uri)).text);
    assert.ok(jwks.keys.every((key) => !key.d));
    assert.ok(
      verify(
        'RSA-SHA256',
        Buffer.from(`${header}.${payload}`),
        createPublicKey({ key: jwks.keys[0], format: 'jwk' }),
        Buffer.from(signature, 'base64url'),
      ),
    );
    assert.equal(claims.sub, f.user.id);
    assert.equal(claims.iss, f.config.issuer);
    assert.equal(claims.aud, f.config.clientId);
    assert.equal(claims.nonce, params.nonce);
    assert.equal(claims.ai_role, 'researcher');
    assert.ok(claims.exp > claims.iat && claims.exp - claims.iat <= 300);
    const me = await call(discovery.userinfo_endpoint, {
      useCookies: false,
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    assert.equal(JSON.parse(me.text).sub, f.user.id);
    const introspect = (token) =>
      call(discovery.introspection_endpoint, {
        method: 'POST',
        useCookies: false,
        data: { token },
        headers: { authorization, origin: '' },
      });
    assert.equal(
      JSON.parse((await introspect(tokens.access_token)).text).active,
      true,
    );
    const stored = JSON.stringify(
      (await f.pool.query('SELECT * FROM identity_artifacts')).rows,
    );
    assert.ok(!stored.includes(tokens.access_token));
    assert.ok(!stored.includes(f.password));
    identity = await f.create();
    const silentVerifier = randomBytes(32).toString('base64url');
    const silent = await follow(
      await call(
        `${IDENTITY_BASE}/auth?${new URLSearchParams({ ...authParams(silentVerifier), prompt: 'none' })}`,
      ),
      { login: false },
    );
    assert.ok(silent.searchParams.get('code'), silent.href);
    assert.equal(
      (
        await exchange(
          silent.searchParams.get('code'),
          randomBytes(32).toString('base64url'),
        )
      ).status,
      400,
    );
    const noPkce = { ...authParams(verifier) };
    delete noPkce.code_challenge;
    delete noPkce.code_challenge_method;
    const denied = await follow(
      await call(`${IDENTITY_BASE}/auth?${new URLSearchParams(noPkce)}`),
    );
    assert.equal(denied.searchParams.get('error'), 'invalid_request');
    const evil = await call(
      `${IDENTITY_BASE}/auth?${new URLSearchParams({ ...params, redirect_uri: 'https://evil.test/' })}`,
    );
    assert.equal(evil.location, null);
    assert.ok(evil.status >= 400);
    assert.equal(
      (
        await call(`${IDENTITY_BASE}/auth`, {
          method: 'POST',
          data: params,
          headers: { origin: 'https://evil.test' },
        })
      ).status,
      403,
    );
    assert.equal(
      (await call(`${IDENTITY_BASE}/jwks`, { headers: { host: 'evil.test' } }))
        .status,
      400,
    );
    await assert.rejects(
      identity.directory({ id: f.user.id, role: 'researcher' }),
      /管理员/,
    );
    const directory = await identity.directory(f.user);
    assert.equal(directory.users[0].sub, f.user.id);
    assert.ok(!JSON.stringify(directory).includes('password'));
    assert.equal(
      (await exchange(target.searchParams.get('code'), verifier)).status,
      400,
    );
    const finalVerifier = randomBytes(32).toString('base64url');
    const finalCode = await follow(
      await call(
        `${IDENTITY_BASE}/auth?${new URLSearchParams(authParams(finalVerifier))}`,
      ),
      { login: false },
    );
    const redemption = await Promise.all([
      exchange(finalCode.searchParams.get('code'), finalVerifier),
      exchange(finalCode.searchParams.get('code'), finalVerifier),
    ]);
    assert.equal(redemption.filter((entry) => entry.status === 200).length, 1);
    assert.ok(redemption.some((entry) => entry.status === 400));
    const logoutVerifier = randomBytes(32).toString('base64url');
    const logoutCode = await follow(
      await call(
        `${IDENTITY_BASE}/auth?${new URLSearchParams(authParams(logoutVerifier))}`,
      ),
      { login: false },
    );
    const logoutTokens = JSON.parse(
      (await exchange(logoutCode.searchParams.get('code'), logoutVerifier))
        .text,
    );
    assert.equal(
      JSON.parse((await introspect(logoutTokens.access_token)).text).active,
      true,
    );
    const logout = await call(`${IDENTITY_BASE}/logout`, {
      method: 'POST',
      data: {},
    });
    assert.equal(logout.status, 303);
    assert.equal(
      (
        await f.pool.query(
          'SELECT * FROM identity_artifacts WHERE account_id=$1',
          [f.user.id],
        )
      ).rows.length,
      0,
    );
    const afterLogout = await follow(
      await call(
        `${IDENTITY_BASE}/auth?${new URLSearchParams({ ...authParams(verifier), prompt: 'none' })}`,
      ),
      { login: false },
    );
    assert.equal(afterLogout.searchParams.get('error'), 'login_required');
    assert.equal(
      JSON.parse((await introspect(logoutTokens.access_token)).text).active,
      false,
    );
    const invalidToken = await call(discovery.userinfo_endpoint, {
      useCookies: false,
      headers: { authorization: `Bearer ${logoutTokens.access_token}` },
    });
    assert.equal(invalidToken.status, 401);
    await t.test(
      'account changes preserve subject and revoke issuer artifacts',
      async () => {
        await f.pool.query('UPDATE admin_users SET username=$2 WHERE id=$1', [
          f.user.id,
          'renamed-owner',
        ]);
        assert.equal(
          (await identity.directory(f.user)).users[0].sub,
          f.user.id,
        );
        const artifact = new f.store.Adapter('Grant');
        await artifact.upsert('qa-grant', { accountId: f.user.id }, 60);
        await f.pool.query('UPDATE admin_users SET enabled=0 WHERE id=$1', [
          f.user.id,
        ]);
        assert.equal(await artifact.find('qa-grant'), undefined);
        await f.pool.query('UPDATE admin_users SET enabled=1 WHERE id=$1', [
          f.user.id,
        ]);
        await artifact.upsert('expired', { accountId: f.user.id }, -60);
        assert.equal(await artifact.find('expired'), undefined);
        await f.store.cleanup();
        await artifact.upsert('password-revoked', { accountId: f.user.id }, 60);
        const user = await f.store.user(f.user.id);
        await f.auth.authAction(
          {
            action: 'auth_change_password',
            currentPassword: f.password,
            password: 'Synthetic-replacement-password-456',
          },
          { headers: {}, socket: { remoteAddress: '192.0.2.4' } },
          { setHeader() {} },
          user,
        );
        assert.equal(await artifact.find('password-revoked'), undefined);
      },
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await f.close();
  }
});
