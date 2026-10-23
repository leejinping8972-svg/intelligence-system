/* oxlint-disable vitest/no-import-node-test, unicorn/no-await-expression-member -- Node HTTP/SQL integration keeps assertions next to requests. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { Readable } from 'node:stream';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  hashPlatformToken,
  newPlatformToken,
  platformLinkConfig,
  PLATFORM_LINK_BASE as base,
} from './platform-link-config.mjs';
import {
  createPlatformLinkStore,
  platformLinkSchema,
} from './platform-link-store.mjs';
import { createPlatformLink } from './platform-link.mjs';

function isolatedPool(db, faults) {
  let tail = Promise.resolve();
  const query = async (statement, params = []) => {
    if (faults.audit && statement.startsWith('INSERT INTO admin_audit'))
      throw new Error('synthetic session audit failure');
    const value =
      params.length > 0
        ? await db.query(statement, params)
        : (await db.exec(statement)).at(-1);
    return {
      ...value,
      rowCount: value.affectedRows ?? value.rows?.length ?? 0,
    };
  };
  async function acquire() {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return { query, release };
  }
  return {
    async query(...args) {
      const connection = await acquire();
      try {
        return await connection.query(...args);
      } finally {
        connection.release();
      }
    },
    connect: acquire,
  };
}

test('platform key protocol uses isolated SQL, real HTTP and existing local authentication', async (t) => {
  const { PGlite } = process.env.HCI_TEST_PGLITE_MODULE
    ? await import(pathToFileURL(process.env.HCI_TEST_PGLITE_MODULE).href)
    : await import('@electric-sql/pglite');
  const databases = [new PGlite(), new PGlite()];
  const faults = [{ audit: false }, { audit: false }];
  const pools = databases.map((db, index) => isolatedPool(db, faults[index]));
  globalThis.__platformLinkQaPools = pools;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      const parent = context.parentURL;
      if (parent?.includes('/auth.mjs?platformLinkQa=')) {
        const side = Number(new URL(parent).searchParams.get('platformLinkQa'));
        if (specifier === './database.mjs')
          return {
            url: `data:text/javascript,${encodeURIComponent(`export const pool=globalThis.__platformLinkQaPools[${side}];export const sql=(pg)=>pg;export const lock=async()=>true;export const unlock=async()=>{};`)}`,
            shortCircuit: true,
          };
        if (specifier === './local-provider.mjs')
          return {
            url: `data:text/javascript,${encodeURIComponent('export const readCredentials=async()=>{throw new Error("No provider or production access in protocol QA")};')}`,
            shortCircuit: true,
          };
      }
      return next(specifier, context);
    },
  });
  const auth = [];
  for (let side = 0; side < 2; side++)
    auth.push(await import(`./auth.mjs?platformLinkQa=${side}`));
  hook.deregister();
  const configs = [
    platformLinkConfig({
      PLATFORM_LINK_ENABLED: 'true',
      PLATFORM_LINK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    platformLinkConfig({
      PLATFORM_LINK_ENABLED: 'true',
      PLATFORM_LINK_PUBLIC_ORIGIN: 'https://ai.chatviva.com',
      PLATFORM_LINK_PEER_ORIGIN: 'https://is.luckdate.com',
      PLATFORM_LINK_SOURCE: 'ai-platform',
      PLATFORM_LINK_PEER_SOURCE: 'selection-platform',
      PLATFORM_LINK_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
  ];
  const ids = [
    [randomUUID(), randomUUID()],
    [randomUUID(), randomUUID()],
  ];
  const password = 'Disposable-platform-link-password';
  const hash = await auth[0].hashPassword(password);
  for (let side = 0; side < 2; side++) {
    await databases[side].exec(`
      CREATE TABLE admin_users (id varchar(36) PRIMARY KEY, username varchar(64) UNIQUE NOT NULL, display_name varchar(100) NOT NULL, password_hash varchar(256) NOT NULL, role varchar(20) NOT NULL, enabled integer NOT NULL DEFAULT 1, created_at bigint NOT NULL, last_login_at bigint, password_changed_at bigint NOT NULL);
      CREATE TABLE admin_sessions (token_hash varchar(64) PRIMARY KEY, user_id varchar(36) NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL);
      CREATE TABLE admin_login_attempts (attempt_key varchar(128) PRIMARY KEY, failures integer NOT NULL, locked_until bigint NOT NULL, updated_at bigint NOT NULL);
      CREATE TABLE admin_audit (id varchar(36) PRIMARY KEY, actor_id varchar(36), action varchar(100) NOT NULL, target_id varchar(64), created_at bigint NOT NULL);
    `);
    for (const statement of platformLinkSchema)
      await pools[side].query(statement);
    for (let account = 0; account < 2; account++)
      await pools[side].query(
        'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)',
        [
          ids[side][account],
          `qa-${account}`,
          `QA ${side}/${account}`,
          hash,
          account ? 'admin' : 'researcher',
          Date.now(),
        ],
      );
  }
  const nativeFetch = globalThis.fetch;
  const urls = [],
    servers = [],
    handlers = [],
    stores = pools.map((pool) => createPlatformLinkStore(pool));
  let injectAuditFailure = false,
    failInspect = false,
    peerRequests = 0;
  for (let side = 0; side < 2; side++) {
    const handler = createPlatformLink({
      config: configs[side],
      store: stores[side],
      sessionUser: auth[side].sessionUser,
      signIn: auth[side].platformLinkSignIn,
      audit: async (...args) => {
        if (injectAuditFailure)
          throw new Error('synthetic audit failure, secret must not escape');
        return auth[side].platformLinkAudit(...args);
      },
      fetchPeer: (input, options) => {
        const target = new URL(input);
        assert.equal(target.origin, configs[side].peerOrigin);
        assert.ok(
          [`${base}/key/inspect`, `${base}/login/tickets`].includes(
            target.pathname,
          ),
        );
        peerRequests += 1;
        if (failInspect && target.pathname.endsWith('/inspect'))
          return Promise.resolve(new Response('unavailable', { status: 503 }));
        return nativeFetch(`${urls[1 - side]}${target.pathname}`, options);
      },
    });
    handlers.push(handler);
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, configs[side].ownOrigin);
      if (url.pathname.startsWith(base)) return handler.handle(req, res, url);
      try {
        let source = '';
        for await (const chunk of req) source += chunk;
        const input = JSON.parse(source);
        const user = await auth[side].sessionUser(req, false);
        const result = await auth[side].authAction(input, req, res, user);
        res.end(JSON.stringify(result));
      } catch (error) {
        res.statusCode = error.status || 400;
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    urls.push(`http://127.0.0.1:${server.address().port}`);
  }
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    for (const db of databases) await db.close();
    delete globalThis.__platformLinkQaPools;
  });
  const browser = () => [new Map(), new Map()];
  const jars = browser();
  async function request(
    side,
    path,
    {
      method = 'GET',
      input,
      jar = jars,
      bearer,
      origin = configs[side].ownOrigin,
    } = {},
  ) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (input !== undefined) headers['content-type'] = 'application/json';
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (jar?.[side]?.size)
      headers.cookie = [...jar[side]]
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');
    const response = await nativeFetch(`${urls[side]}${path}`, {
      method,
      headers,
      body: input === undefined ? undefined : JSON.stringify(input),
      redirect: 'manual',
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const [pair] = setCookie.split(';');
      const index = pair.indexOf('='),
        name = pair.slice(0, index),
        value = pair.slice(index + 1);
      if (jar) value ? jar[side].set(name, value) : jar[side].delete(name);
    }
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      /* Browser bridges return HTML. */
    }
    return { status: response.status, headers: response.headers, json, text };
  }
  async function login(side, account = 0, jar = jars) {
    const result = await request(side, '/api', {
      method: 'POST',
      input: { action: 'auth_login', username: `qa-${account}`, password },
      jar,
    });
    assert.equal(result.status, 200, result.text);
    return result;
  }
  async function ownKey(side, jar = jars) {
    const result = await request(side, `${base}/account-key/generate`, {
      method: 'POST',
      input: { confirm: true },
      jar,
    });
    assert.equal(result.status, 200, result.text);
    assert.match(result.json.key, /^sel_[\w-]{43}$/);
    return result.json.key;
  }
  async function savePeer(side, key, jar = jars) {
    const result = await request(side, `${base}/peer-key`, {
      method: 'POST',
      input: { key },
      jar,
    });
    assert.equal(result.status, 200, result.text);
  }
  async function issue(target, key, jar = jars) {
    const result = await request(
      target,
      `${base}/login/start?source=${configs[target].peerSource}&state=${newPlatformToken()}`,
      { jar },
    );
    assert.equal(result.status, 303, result.text);
    const id = new URL(result.headers.get('location')).searchParams.get(
      'request_id',
    );
    const ticket = await request(target, `${base}/login/tickets`, {
      method: 'POST',
      input: { request_id: id },
      bearer: key,
      jar: null,
    });
    assert.equal(ticket.status, 200, ticket.text);
    return { id, ticket: ticket.json.ticket };
  }
  async function consume(target, ticket, jar = jars) {
    return request(target, `${base}/login/consume`, {
      method: 'POST',
      input: { ticket },
      jar,
    });
  }
  async function fullFlow(source, jar = jars) {
    const target = 1 - source;
    const launch = await request(source, `${base}/launch`, {
      method: 'POST',
      input: {},
      jar,
    });
    assert.equal(launch.status, 200, launch.text);
    const startUrl = new URL(launch.json.redirect);
    assert.equal(startUrl.origin, configs[target].ownOrigin);
    const started = await request(
      target,
      `${startUrl.pathname}${startUrl.search}`,
      { jar },
    );
    assert.equal(started.status, 303, started.text);
    const callback = new URL(started.headers.get('location'));
    const get = await request(
      source,
      `${callback.pathname}${callback.search}`,
      { jar },
    );
    assert.equal(get.status, 200, get.text);
    assert.match(get.text, /history\.replaceState/);
    assert.equal(get.headers.get('referrer-policy'), 'no-referrer');
    const signed = await request(source, callback.pathname, {
      method: 'POST',
      input: Object.fromEntries(callback.searchParams),
      jar,
    });
    assert.equal(signed.status, 200, signed.text);
    const consumedUrl = new URL(signed.json.redirect);
    const targetGet = await request(
      target,
      `${consumedUrl.pathname}${consumedUrl.search}`,
      { jar },
    );
    assert.equal(targetGet.status, 200, targetGet.text);
    const result = await consume(
      target,
      consumedUrl.searchParams.get('ticket'),
      jar,
    );
    assert.equal(result.status, 200, result.text);
    assert.equal(result.json.redirect, '/admin/overview');
    return result;
  }

  let keys;
  await t.test(
    'researcher and admin have separate settings; keys are hashed/encrypted and shown once',
    async () => {
      await login(0);
      await login(1);
      keys = [await ownKey(0), await ownKey(1)];
      await savePeer(0, keys[1]);
      await savePeer(1, keys[0]);
      const result = await request(0, `${base}/settings`);
      assert.equal(result.json.peer.subject, ids[1][0]);
      assert.ok(
        !result.text.includes(keys[0]) && !result.text.includes(keys[1]),
      );
      const stored = await pools[0].query('SELECT * FROM platform_link_keys');
      assert.equal(stored.rows[0].key_hash, hashPlatformToken(keys[0]));
      assert.ok(
        !JSON.stringify(
          (await pools[0].query('SELECT * FROM platform_link_peers')).rows,
        ).includes(keys[1]),
      );
      const other = browser();
      await login(0, 1, other);
      assert.equal(
        (await request(0, `${base}/settings`, { jar: other })).json.peer,
        null,
      );
    },
  );
  await t.test(
    'both directions reach each key owner through launch, callback and browser-bound consume',
    async () => {
      jars[1].delete('__Host-is_session');
      await fullFlow(0);
      jars[0].delete('__Host-is_session');
      await fullFlow(1);
      for (let side = 0; side < 2; side++) {
        const user = await request(side, '/api', {
          method: 'POST',
          input: { action: 'auth_status' },
        });
        assert.equal(user.json.user.id, ids[side][0]);
        assert.equal(user.json.user.role, 'researcher');
      }
    },
  );
  await t.test(
    'bad remote key and provider failure preserve a previous valid configuration',
    async () => {
      const before = await stores[0].getPeer(ids[0][0]);
      const invalid = await request(0, `${base}/peer-key`, {
        method: 'POST',
        input: { key: `sel_${newPlatformToken()}` },
      });
      assert.equal(invalid.json.code, 'PEER_KEY_INVALID');
      failInspect = true;
      const failed = await request(0, `${base}/peer-key`, {
        method: 'POST',
        input: { key: keys[1] },
      });
      failInspect = false;
      assert.equal(failed.status, 502);
      assert.deepEqual(await stores[0].getPeer(ids[0][0]), before);
      const malformed = await request(0, `${base}/peer-key`, {
        method: 'POST',
        input: { key: 'bad' },
      });
      assert.equal(malformed.status, 400);
    },
  );
  await t.test(
    'source callback rejects missing browser marker, altered state and changed login session',
    async () => {
      const launched = await request(0, `${base}/launch`, {
        method: 'POST',
        input: {},
      });
      const target = new URL(launched.json.redirect);
      const started = await request(1, `${target.pathname}${target.search}`);
      const callback = new URL(started.headers.get('location'));
      const input = Object.fromEntries(callback.searchParams);
      const before = peerRequests;
      assert.equal(
        (
          await request(0, callback.pathname, {
            method: 'POST',
            input,
            jar: browser(),
          })
        ).json.code,
        'BROWSER_MISMATCH',
      );
      assert.equal(
        (
          await request(0, callback.pathname, {
            method: 'POST',
            input: { ...input, state: newPlatformToken() },
          })
        ).status,
        400,
      );
      await login(0, 1);
      assert.equal(
        (await request(0, callback.pathname, { method: 'POST', input })).json
          .code,
        'FLOW_SESSION_CHANGED',
      );
      assert.equal(peerRequests, before);
      await login(0);
    },
  );
  await t.test(
    'a revoked source session cannot finish a delayed key-generation request',
    async () => {
      let releaseBody, reachedBody;
      const gate = new Promise((resolve) => {
        releaseBody = resolve;
      });
      const entered = new Promise((resolve) => {
        reachedBody = resolve;
      });
      const req = Readable.from(
        (async function* () {
          reachedBody();
          await gate;
          yield Buffer.from('{"confirm":true}');
        })(),
      );
      req.method = 'POST';
      req.headers = {
        origin: configs[0].ownOrigin,
        'content-type': 'application/json',
        cookie: [...jars[0]]
          .map(([key, value]) => `${key}=${value}`)
          .join('; '),
      };
      req.socket = { remoteAddress: '192.0.2.99' };
      const res = {
        headers: new Map(),
        statusCode: 200,
        setHeader(name, value) {
          this.headers.set(name, value);
        },
        getHeader(name) {
          return this.headers.get(name);
        },
        end(value) {
          this.text = value;
        },
      };
      const before = await stores[0].keyForUser(ids[0][0]);
      const operation = handlers[0].handle(
        req,
        res,
        new URL(`${base}/account-key/generate`, configs[0].ownOrigin),
      );
      await entered;
      await pools[0].query('DELETE FROM admin_sessions WHERE user_id=$1', [
        ids[0][0],
      ]);
      releaseBody();
      await operation;
      assert.equal(res.statusCode, 401);
      assert.deepEqual(await stores[0].keyForUser(ids[0][0]), before);
      await login(0);
    },
  );
  await t.test(
    'request signing and ticket consumption are single use under concurrency',
    async () => {
      const jar = browser(),
        { id, ticket } = await issue(1, keys[1], jar);
      const signedAgain = await request(1, `${base}/login/tickets`, {
        method: 'POST',
        input: { request_id: id },
        bearer: keys[1],
        jar: null,
      });
      assert.equal(signedAgain.status, 409);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consume(1, ticket, jar)),
      );
      assert.equal(results.filter((value) => value.status === 200).length, 1);
      assert.equal(results.filter((value) => value.status === 409).length, 7);
    },
  );
  await t.test(
    'wrong-browser and expired tickets cannot create a session',
    async () => {
      const jar = browser(),
        one = await issue(1, keys[1], jar);
      assert.equal(
        (await consume(1, one.ticket, browser())).json.code,
        'BROWSER_MISMATCH',
      );
      await pools[1].query(
        'UPDATE platform_link_flows SET expires_at=$2 WHERE token_hash=$1',
        [hashPlatformToken(one.ticket), Date.now() - 1],
      );
      assert.equal((await consume(1, one.ticket, jar)).status, 410);
      assert.ok(!jar[1].has('__Host-is_session'));
    },
  );
  await t.test(
    'a different target account requires confirmation; cancel preserves the old session',
    async () => {
      const jar = browser();
      await login(1, 1, jar);
      const original = jar[1].get('__Host-is_session');
      const { ticket } = await issue(1, keys[1], jar);
      const result = await consume(1, ticket, jar);
      assert.equal(result.json.requires_confirmation, true);
      assert.equal(jar[1].get('__Host-is_session'), original);
      assert.equal(result.json.subject, ids[1][0]);
      const cancelled = await request(1, `${base}/login/confirm`, {
        method: 'POST',
        input: { confirm: result.json.confirm, accept: false },
        jar,
      });
      assert.equal(cancelled.json.cancelled, true);
      assert.equal(jar[1].get('__Host-is_session'), original);
    },
  );
  await t.test(
    'confirmation switches only the intended browser account and cannot replay',
    async () => {
      const jar = browser();
      await login(1, 1, jar);
      const { ticket } = await issue(1, keys[1], jar);
      const prompt = await consume(1, ticket, jar);
      const input = { confirm: prompt.json.confirm, accept: true };
      assert.equal(
        (
          await request(1, `${base}/login/confirm`, {
            method: 'POST',
            input,
            jar: browser(),
          })
        ).json.code,
        'BROWSER_MISMATCH',
      );
      const switched = await request(1, `${base}/login/confirm`, {
        method: 'POST',
        input,
        jar,
      });
      assert.equal(switched.status, 200, switched.text);
      const status = await request(1, '/api', {
        method: 'POST',
        input: { action: 'auth_status' },
        jar,
      });
      assert.equal(status.json.user.id, ids[1][0]);
      assert.equal(
        (
          await request(1, `${base}/login/confirm`, {
            method: 'POST',
            input,
            jar,
          })
        ).status,
        409,
      );
    },
  );
  await t.test(
    'key rotation invalidates outstanding ticket and confirmation without logging out existing sessions',
    async () => {
      const jar = browser();
      await login(1, 1, jar);
      const pending = await issue(1, keys[1], jar),
        pending2 = await issue(1, keys[1], jar);
      const prompt = await consume(1, pending.ticket, jar);
      keys[1] = await ownKey(1);
      assert.equal((await consume(1, pending2.ticket, jar)).status, 409);
      assert.equal(
        (
          await request(1, `${base}/login/confirm`, {
            method: 'POST',
            input: { confirm: prompt.json.confirm, accept: true },
            jar,
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request(1, '/api', {
            method: 'POST',
            input: { action: 'auth_status' },
          })
        ).json.user.id,
        ids[1][0],
      );
      await savePeer(0, keys[1]);
    },
  );
  await t.test(
    'key revocation blocks inspect, signing and pending consume',
    async () => {
      const jar = browser(),
        pending = await issue(1, keys[1], jar);
      await request(1, `${base}/account-key/revoke`, {
        method: 'POST',
        input: { confirm: true },
      });
      assert.equal((await consume(1, pending.ticket, jar)).status, 409);
      assert.equal(
        (
          await request(1, `${base}/key/inspect`, {
            method: 'POST',
            input: {},
            bearer: keys[1],
            jar: null,
          })
        ).status,
        401,
      );
      keys[1] = await ownKey(1);
      await savePeer(0, keys[1]);
    },
  );
  await t.test(
    'disabled target account cannot inspect, sign or consume previously issued tickets',
    async () => {
      const jar = browser(),
        pending = await issue(1, keys[1], jar);
      await pools[1].query('UPDATE admin_users SET enabled=0 WHERE id=$1', [
        ids[1][0],
      ]);
      assert.equal(
        (
          await request(1, `${base}/key/inspect`, {
            method: 'POST',
            input: {},
            bearer: keys[1],
            jar: null,
          })
        ).status,
        403,
      );
      assert.equal((await consume(1, pending.ticket, jar)).status, 403);
      await pools[1].query('UPDATE admin_users SET enabled=1 WHERE id=$1', [
        ids[1][0],
      ]);
    },
  );
  await t.test(
    'failed audit rolls back key replacement and returns no secret',
    async () => {
      const before = await stores[1].keyForUser(ids[1][0]);
      injectAuditFailure = true;
      const failed = await request(1, `${base}/account-key/generate`, {
        method: 'POST',
        input: { confirm: true },
      });
      injectAuditFailure = false;
      assert.equal(failed.status, 500);
      assert.deepEqual(await stores[1].keyForUser(ids[1][0]), before);
      assert.ok(!failed.text.includes('synthetic'));
      assert.equal(failed.json.key, undefined);
    },
  );
  await t.test(
    'session creation failure burns the ticket and rolls back partial session writes',
    async () => {
      const jar = browser(),
        pending = await issue(1, keys[1], jar);
      const before = (
        await pools[1].query('SELECT count(*) AS count FROM admin_sessions')
      ).rows[0].count;
      faults[1].audit = true;
      const failed = await consume(1, pending.ticket, jar);
      faults[1].audit = false;
      assert.equal(failed.json.code, 'SESSION_FAILED');
      assert.ok(!jar[1].has('__Host-is_session'));
      assert.equal(
        (await pools[1].query('SELECT count(*) AS count FROM admin_sessions'))
          .rows[0].count,
        before,
      );
      assert.equal((await consume(1, pending.ticket, jar)).status, 409);
    },
  );
  await t.test(
    'removing one direction leaves the reverse configuration and current sessions intact',
    async () => {
      const reverse = await stores[1].getPeer(ids[1][0]);
      const launched = await request(0, `${base}/launch`, {
        method: 'POST',
        input: {},
      });
      await request(0, `${base}/peer-key`, { method: 'DELETE', input: {} });
      assert.equal(
        (await request(0, `${base}/launch`, { method: 'POST', input: {} })).json
          .code,
        'PEER_NOT_CONFIGURED',
      );
      assert.deepEqual(await stores[1].getPeer(ids[1][0]), reverse);
      const target = new URL(launched.json.redirect);
      const started = await request(1, `${target.pathname}${target.search}`);
      const callback = new URL(started.headers.get('location'));
      assert.equal(
        (
          await request(0, callback.pathname, {
            method: 'POST',
            input: Object.fromEntries(callback.searchParams),
          })
        ).json.code,
        'FLOW_SESSION_CHANGED',
      );
    },
  );
  await t.test(
    'local writes require Origin and fixed peer callbacks reject arbitrary URLs',
    async () => {
      assert.equal(
        (
          await request(0, `${base}/account-key/generate`, {
            method: 'POST',
            input: { confirm: true },
            origin: 'https://invalid.example',
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            0,
            `${base}/login/start?source=evil&state=${newPlatformToken()}`,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(
            0,
            `${base}/login/start?source=ai-platform&state=${newPlatformToken()}&callback=https://evil.example`,
          )
        ).status,
        400,
      );
      assert.equal(
        (
          await request(0, `${base}/login/tickets`, {
            method: 'POST',
            input: { request_id: newPlatformToken(), role: 'admin' },
            bearer: keys[0],
            jar: null,
          })
        ).status,
        400,
      );
    },
  );
  await t.test(
    'turning off the feature blocks start, consume and confirmation',
    async () => {
      configs[1].enabled = false;
      assert.equal(
        (
          await request(
            1,
            `${base}/login/start?source=selection-platform&state=${newPlatformToken()}`,
          )
        ).status,
        503,
      );
      assert.equal(
        (
          await request(1, `${base}/login/consume`, {
            method: 'POST',
            input: { ticket: newPlatformToken() },
          })
        ).status,
        503,
      );
      assert.equal(
        (
          await request(1, `${base}/login/confirm`, {
            method: 'POST',
            input: { confirm: newPlatformToken(), accept: true },
          })
        ).status,
        503,
      );
      configs[1].enabled = true;
    },
  );
});
