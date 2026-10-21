// Disposable SQL, real HTTP, real local password/session/audit. No production access.
/* oxlint-disable unicorn/no-await-expression-member -- Compact assertions in disposable SQL/HTTP integration QA. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

if (
  process.env.ADMIN_SSO_QA !== 'disposable-only' ||
  (!process.env.PGLITE_RUNTIME &&
    process.env.QA_MYSQL_HOST !== 'admin-sso-qa-db')
) {
  throw new Error(
    'Use ADMIN_SSO_QA=disposable-only with an isolated PGLITE_RUNTIME or admin-sso-qa-db',
  );
}
const mysql = process.env.QA_MYSQL_HOST;
if (mysql && mysql !== 'admin-sso-qa-db') throw new Error('Unexpected QA host');
process.env.DATABASE_URL = 'postgres://disposable-only@127.0.0.1:1/not-used';
process.env.DATABASE_CONFIG_FILE = mysql
  ? '/tmp/admin-sso-qa-config.json'
  : `${process.cwd()}/.artifacts/nonexistent-sso-${randomUUID()}.json`;
if (mysql) {
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
  const { encryptConfig } = await import('./secrets.mjs');
  await writeFile(
    process.env.DATABASE_CONFIG_FILE,
    JSON.stringify(
      encryptConfig({
        host: mysql,
        port: 3306,
        database: 'admin_sso_qa',
        user: 'qa',
        password: 'disposable-qa-only',
        tlsMode: 'plain',
      }),
    ),
    { mode: 0o600 },
  );
}
const memory = mysql
  ? null
  : new (await import(pathToFileURL(process.env.PGLITE_RUNTIME).href)).PGlite();
const { pool } = await import('./database.mjs');
if (memory)
  pool.query = async (sql, params = []) => {
    const result =
      params.length > 0
        ? await memory.query(sql, params)
        : (await memory.exec(sql)).at(-1);
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  };
const { ssoSchema, createSsoStore } = await import('./admin-sso-store.mjs');
const { authSchema } = await import('./store.mjs');
const { authAction, adminSsoSignIn, sessionUser, hashPassword } =
  await import('./auth.mjs');
const { adminSsoConfig } = await import('./admin-sso-config.mjs');
const { createAdminSso } = await import('./admin-sso.mjs');
for (const statement of authSchema) await pool.query(statement);
await pool.query(ssoSchema); // startup migration is idempotent

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  if (url.hostname !== '127.0.0.1')
    throw new Error('External network disabled in SSO QA');
  return nativeFetch(input, options);
};
const ids = [randomUUID(), randomUUID()];
const password = 'disposable-Sso-QA-password';
const hash = await hashPassword(password);
for (let i = 0; i < ids.length; i++)
  await pool.query(
    'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)',
    [ids[i], `qa-owner-${i}`, `SSO QA ${i}`, hash, 'admin', Date.now()],
  );
const shared = randomBytes(32).toString('base64url');
const configA = adminSsoConfig({
  ADMIN_SSO_ENABLED: 'true',
  ADMIN_SSO_SHARED_SECRET: shared,
  ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ [ids[1]]: ids[0] }),
});
const configs = [
  configA,
  adminSsoConfig({
    ADMIN_SSO_ENABLED: 'true',
    ADMIN_SSO_SHARED_SECRET: shared,
    ADMIN_SSO_PUBLIC_ORIGIN: configA.peerOrigin,
    ADMIN_SSO_PEER_ORIGIN: configA.ownOrigin,
    ADMIN_SSO_CLIENT_ID: configA.peerId,
    ADMIN_SSO_PEER_ID: configA.clientId,
    ADMIN_SSO_ACCOUNT_MAP: JSON.stringify({ [ids[0]]: ids[1] }),
  }),
];
const bases = [],
  servers = [];
const store = createSsoStore(pool);
for (let i = 0; i < 2; i++) {
  const handler = createAdminSso({
    config: configs[i],
    store,
    sessionUser,
    signIn: adminSsoSignIn,
    fetchPeer: (url, options) => {
      assert.equal(url, `${configs[i].peerOrigin}/api/sso/exchange`);
      return fetch(`${bases[1 - i]}/api/sso/exchange`, options);
    },
  });
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/sso/'))
      return handler.handle(req, res, new URL(req.url, configs[i].ownOrigin));
    let text = '';
    for await (const chunk of req) text += chunk;
    try {
      const user = await sessionUser(req);
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify(await authAction(JSON.parse(text), req, res, user)),
      );
    } catch (error) {
      res
        .writeHead(error.status || 400)
        .end(JSON.stringify({ error: error.message }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  bases.push(`http://127.0.0.1:${server.address().port}`);
}
const cookiePart = (res, name) =>
  res.headers
    .getSetCookie()
    .find((value) => value.startsWith(name))
    ?.split(';')[0];
async function post(i, path, data, cookie = '') {
  return fetch(`${bases[i]}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      origin: configs[i].ownOrigin,
      'content-type': 'application/json',
      cookie,
    },
    body: JSON.stringify(data),
  });
}
const cookies = [];
try {
  for (let i = 0; i < 2; i++) {
    const result = await post(i, '/api', {
      action: 'auth_login',
      username: `qa-owner-${i}`,
      password,
    });
    assert.equal(result.status, 200);
    const cookie = cookiePart(result, '__Host-is_session=');
    assert.ok(cookie);
    cookies.push(cookie);
  }
  for (const target of [0, 1]) {
    const source = 1 - target;
    const start = await fetch(
      `${bases[target]}/api/sso/start?return_to=%2Fadmin%2Fresearch`,
      { redirect: 'manual' },
    );
    assert.equal(start.status, 303);
    const authorization = new URL(start.headers.get('location'));
    const stateCookie = cookiePart(start, '__Host-is_sso_');
    const signed = await post(
      source,
      '/api/sso/authorize',
      Object.fromEntries(authorization.searchParams),
      cookies[source],
    );
    assert.equal(signed.status, 200);
    const callback = new URL((await signed.json()).redirect);
    const response = await post(
      target,
      '/api/sso/callback',
      Object.fromEntries(callback.searchParams),
      stateCookie,
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).redirect, '/admin/research');
    const localCookie = cookiePart(response, '__Host-is_session=');
    const local = await sessionUser({ headers: { cookie: localCookie } });
    assert.equal(local.id, ids[target]);
    assert.equal(local.role, 'admin');
    const status = await post(
      target,
      '/api',
      { action: 'auth_status' },
      localCookie,
    );
    assert.equal((await status.json()).user.id, ids[target]);
    assert.equal(
      (
        await post(
          target,
          '/api/sso/callback',
          Object.fromEntries(callback.searchParams),
          stateCookie,
        )
      ).status,
      400,
    );
    const logout = await post(
      target,
      '/api',
      { action: 'auth_logout' },
      localCookie,
    );
    assert.equal(logout.status, 200);
    assert.equal(await sessionUser({ headers: { cookie: localCookie } }), null);
  }
  const audit = await pool.query(
    "SELECT action FROM admin_audit WHERE action LIKE '单点登录 %'",
  );
  assert.equal(audit.rows.length, 2);

  const code = randomBytes(32).toString('base64url');
  await store.put('code', code, { safe: true }, 60_000);
  const claims = await Promise.all(
    Array.from({ length: 12 }, () => store.consume('code', code)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await store.get('code', code), null);
  const stored = await pool.query('SELECT ticket_hash FROM admin_sso_tickets');
  assert.ok(stored.rows.every((row) => /^[a-f0-9]{64}$/.test(row.ticket_hash)));
  assert.ok(stored.rows.every((row) => row.ticket_hash !== code));
  let clock = Date.now();
  const timed = createSsoStore(pool, () => clock);
  const expiring = randomBytes(32).toString('base64url');
  await timed.put('state', expiring, {}, 10);
  clock += 11;
  assert.equal(await timed.get('state', expiring), null);
  assert.equal(await timed.consume('state', expiring), false);
  console.warn(
    `SSO isolated ${mysql ? 'MySQL' : 'PostgreSQL'} QA passed: bidirectional HTTP, real password/local sessions, audit, logout, atomic single-use and expiry`,
  );
} finally {
  for (const server of servers)
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    });
  if (memory) await memory.close();
  await pool.end();
  if (mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
}
