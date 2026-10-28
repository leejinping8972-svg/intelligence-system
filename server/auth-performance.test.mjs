import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
/* oxlint-disable vitest/no-import-node-test -- Runs real authentication SQL in disposable PostgreSQL. */
import test from 'node:test';
import {
  setImmediate as nextTurn,
  setTimeout as sleep,
} from 'node:timers/promises';

import { PGlite } from '@electric-sql/pglite';
import { identitySchema } from './identity-store.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const request = {
  headers: { 'x-forwarded-for': '192.0.2.1' },
  socket: { remoteAddress: '192.0.2.1' },
};
const login = (username = 'owner', password = 'QA-owner-password-123') => ({
  action: 'auth_login',
  username,
  password,
});
function response() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
  };
}
const cookieRequest = (reply) => ({
  headers: { cookie: reply.headers['set-cookie'].split(';')[0] },
});

test('authentication keeps security checks while removing serial login work', async (t) => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE admin_users (
      id varchar(36) PRIMARY KEY, username varchar(64) UNIQUE NOT NULL,
      display_name varchar(100) NOT NULL, password_hash varchar(256) NOT NULL,
      role varchar(20) NOT NULL, enabled integer NOT NULL DEFAULT 1,
      created_at bigint NOT NULL, last_login_at bigint, password_changed_at bigint NOT NULL
    );
    CREATE TABLE admin_sessions (
      token_hash varchar(64) PRIMARY KEY, user_id varchar(36) NOT NULL,
      created_at bigint NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL
    );
    CREATE TABLE admin_login_attempts (
      attempt_key varchar(128) PRIMARY KEY, failures integer NOT NULL,
      locked_until bigint NOT NULL, updated_at bigint NOT NULL
    );
    CREATE TABLE admin_audit (
      id varchar(36) PRIMARY KEY, actor_id varchar(36), action text NOT NULL,
      target_id varchar(36), created_at bigint NOT NULL
    );
  `);
  const queries = [];
  for (const statement of identitySchema) await db.query(statement);
  const pending = new Set();
  let active = 0;
  let maxActive = 0;
  let failAudit = false;
  let failCleanup = false;
  let sessionWriteGate = null;
  let onAuditFailure = null;
  const pool = {
    query(statement, params) {
      queries.push(statement);
      const operation = (async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        try {
          await sleep(5);
          if (
            sessionWriteGate &&
            statement.startsWith('INSERT INTO admin_sessions')
          )
            await sessionWriteGate;
          if (failAudit && statement.startsWith('INSERT INTO admin_audit')) {
            onAuditFailure?.();
            throw new Error('synthetic audit failure');
          }
          if (
            failCleanup &&
            statement.startsWith('DELETE FROM admin_sessions WHERE expires_at')
          )
            throw new Error('synthetic cleanup failure');
          return await db.query(statement, params);
        } finally {
          active -= 1;
        }
      })();
      pending.add(operation);
      operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    },
    async connect() {
      return { query: (...args) => pool.query(...args), release() {} };
    },
  };
  const drain = async () => {
    await nextTurn();
    while (pending.size > 0) await Promise.allSettled([...pending]);
  };
  const moduleUrl = (source) =>
    `data:text/javascript,${encodeURIComponent(source)}`;
  globalThis.__authPerformanceTestPool = pool;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.split('?')[0].endsWith('/auth.mjs')) {
        if (specifier === './database.mjs')
          return {
            url: moduleUrl(`
              export const pool = globalThis.__authPerformanceTestPool;
              export const sql = (postgres) => postgres;
              export const lock = async () => true;
              export const unlock = async () => {};
            `),
            shortCircuit: true,
          };
        if (specifier === './local-provider.mjs')
          return {
            url: moduleUrl(
              'export const readCredentials=async()=>({RESEARCH_ACCESS_KEY:"QA-bootstrap-only"});',
            ),
            shortCircuit: true,
          };
      }
      return next(specifier, context);
    },
  });
  try {
    const { authAction, sessionUser, setupRequired } =
      await import('./auth.mjs');
    await t.test(
      'first-account setup remains protected and status uses a bounded lookup',
      async () => {
        queries.length = 0;
        assert.equal(await setupRequired(), true);
        assert.match(queries[0], /LIMIT 1$/);
        await assert.rejects(
          authAction(
            {
              ...login(),
              action: 'auth_setup',
              setupCode: 'wrong',
              displayName: 'QA owner',
            },
            request,
            response(),
            null,
          ),
          /无法创建首位管理员/,
        );
        const reply = response();
        const result = await authAction(
          {
            ...login(),
            action: 'auth_setup',
            setupCode: 'QA-bootstrap-only',
            displayName: 'QA owner',
          },
          request,
          reply,
          null,
        );
        assert.equal(result.user.role, 'admin');
        assert.match(
          reply.headers['set-cookie'],
          /HttpOnly; Secure; SameSite=Strict/,
        );
        assert.equal(
          queries.some((q) => q.startsWith('DELETE FROM admin_sessions')),
          false,
        );
        await drain();
        assert.equal(
          queries.filter((q) => q.startsWith('DELETE FROM admin_sessions'))
            .length,
          1,
        );
        assert.equal(await setupRequired(), false);
        await assert.rejects(
          authAction(
            { ...login(), action: 'auth_setup' },
            request,
            response(),
            null,
          ),
          /管理员已创建/,
        );
      },
    );

    const owners = await db.query(
      "SELECT * FROM admin_users WHERE username='owner'",
    );
    const owner = owners.rows[0];
    await t.test(
      'authenticated status needs no second database read',
      async () => {
        queries.length = 0;
        const result = await authAction(
          { action: 'auth_status' },
          request,
          response(),
          owner,
        );
        assert.equal(result.setupRequired, false);
        assert.equal(result.user.id, owner.id);
        assert.equal(queries.length, 0);
        assert.equal(JSON.stringify(result).includes('password_hash'), false);
      },
    );

    let signedRequest;
    await t.test(
      'login uses one lookup and concurrent writes; cleanup is throttled',
      async () => {
        await db.query(
          'INSERT INTO admin_login_attempts VALUES($1,2,0,$2) ON CONFLICT(attempt_key) DO UPDATE SET failures=2,locked_until=0,updated_at=EXCLUDED.updated_at',
          [sha('192.0.2.1|owner'), Date.now()],
        );
        queries.length = 0;
        maxActive = 0;
        const reply = response();
        const result = await authAction(login(), request, reply, null);
        assert.equal(
          queries.length,
          5,
          'one credential/lockout read and four durable writes',
        );
        assert.ok(
          maxActive >= 4,
          'independent writes must overlap database round trips',
        );
        assert.equal(
          active,
          0,
          'cookie is issued only after all writes finish',
        );
        assert.match(
          queries[0],
          /EXISTS.*admin_login_attempts.*LEFT JOIN admin_users/,
        );
        assert.equal(
          queries.some((q) => q.startsWith('DELETE FROM admin_sessions')),
          false,
        );
        signedRequest = cookieRequest(reply);
        await drain();
        assert.equal(
          queries.length,
          5,
          'recent successful setup already scheduled cleanup',
        );
        const signedUser = await sessionUser(signedRequest);
        assert.equal(signedUser.id, owner.id);
        const savedUser = await db.query(
          'SELECT last_login_at FROM admin_users WHERE id=$1',
          [owner.id],
        );
        assert.equal(
          result.user.lastLoginAt,
          Number(savedUser.rows[0].last_login_at),
        );
        const remainingAttempts = await db.query(
          'SELECT * FROM admin_login_attempts WHERE attempt_key=$1',
          [sha('192.0.2.1|owner')],
        );
        assert.equal(remainingAttempts.rows.length, 0);
        const loginAudit = await db.query(
          "SELECT * FROM admin_audit WHERE action='登录' AND actor_id=$1",
          [owner.id],
        );
        assert.equal(loginAudit.rows.length, 1);
      },
    );

    await t.test(
      'unknown accounts retain failed-attempt accounting and lockout',
      async () => {
        for (let i = 0; i < 5; i++)
          await assert.rejects(
            authAction(login('unknown'), request, response(), null),
            /账号或密码错误/,
          );
        queries.length = 0;
        await assert.rejects(
          authAction(login('unknown'), request, response(), null),
          (error) => error.status === 429,
        );
        assert.equal(
          queries.length,
          1,
          'locked accounts cannot reach password or session writes',
        );
        await db.query(
          'INSERT INTO admin_login_attempts VALUES($1,20,$2,$3) ON CONFLICT(attempt_key) DO UPDATE SET locked_until=EXCLUDED.locked_until',
          [sha('ip|192.0.2.1'), Date.now() + 60_000, Date.now()],
        );
        await assert.rejects(
          authAction(login(), request, response(), null),
          (error) => error.status === 429,
        );
        await db.query('DELETE FROM admin_login_attempts');
      },
    );

    await t.test(
      'disabled, expired and revoked sessions are checked on every request',
      async () => {
        assert.ok(await sessionUser(signedRequest));
        await db.query('UPDATE admin_users SET enabled=0 WHERE id=$1', [
          owner.id,
        ]);
        assert.equal(await sessionUser(signedRequest), null);
        await assert.rejects(
          authAction(login(), request, response(), null),
          /账号或密码错误/,
        );
        await db.query('UPDATE admin_users SET enabled=1 WHERE id=$1', [
          owner.id,
        ]);
        await db.query(
          'UPDATE admin_sessions SET last_seen_at=$1 WHERE user_id=$2',
          [Date.now() - 31 * 60_000, owner.id],
        );
        assert.equal(await sessionUser(signedRequest), null);
        await db.query(
          'UPDATE admin_sessions SET last_seen_at=$1,expires_at=$1 WHERE user_id=$2',
          [Date.now() - 1, owner.id],
        );
        assert.equal(await sessionUser(signedRequest), null);
        const reply = response();
        await authAction(login(), request, reply, null);
        const loggedRequest = cookieRequest(reply);
        const user = await sessionUser(loggedRequest);
        await authAction({ action: 'auth_logout' }, request, reply, user);
        assert.match(reply.headers['set-cookie'], /Max-Age=0$/);
        assert.equal(await sessionUser(loggedRequest), null);
        const revoked = await db.query(
          'SELECT * FROM admin_sessions WHERE token_hash=$1',
          [user.token_hash],
        );
        assert.equal(revoked.rows.length, 0);
      },
    );

    await t.test('an audit failure cannot issue a login cookie', async () => {
      failAudit = true;
      const reply = response();
      await assert.rejects(
        authAction(login(), request, reply, null),
        /synthetic audit failure/,
      );
      assert.equal(active, 0);
      assert.equal(reply.headers['set-cookie'], undefined);
      failAudit = false;
    });

    await t.test(
      'failed login waits for every pending authentication write before returning',
      async () => {
        let releaseSession;
        sessionWriteGate = new Promise((resolve) => {
          releaseSession = resolve;
        });
        const auditRejected = new Promise((resolve) => {
          onAuditFailure = resolve;
        });
        failAudit = true;
        const reply = response();
        let finished = false;
        const result = authAction(login(), request, reply, null).then(
          () => {
            finished = true;
            return null;
          },
          (error) => {
            finished = true;
            return error;
          },
        );
        try {
          await auditRejected;
          await nextTurn();
          assert.equal(
            finished,
            false,
            'request must remain active while session insertion is pending',
          );
          assert.ok(active > 0);
          assert.equal(reply.headers['set-cookie'], undefined);
        } finally {
          releaseSession();
          sessionWriteGate = null;
          onAuditFailure = null;
          await result;
          failAudit = false;
        }
        const error = await result;
        assert.match(error.message, /synthetic audit failure/);
        assert.equal(
          active,
          0,
          'no authentication writes may outlive a failed request',
        );
        assert.equal(reply.headers['set-cookie'], undefined);
      },
    );

    await t.test(
      'changing a password revokes all prior sessions and rejects the old password',
      async () => {
        const first = response();
        const second = response();
        await authAction(login(), request, first, null);
        await authAction(login(), request, second, null);
        const firstRequest = cookieRequest(first);
        const secondRequest = cookieRequest(second);
        const user = await sessionUser(firstRequest);
        await authAction(
          {
            action: 'auth_change_password',
            currentPassword: 'QA-owner-password-123',
            password: 'QA-owner-password-456',
          },
          request,
          response(),
          user,
        );
        assert.equal(await sessionUser(firstRequest), null);
        assert.equal(await sessionUser(secondRequest), null);
        await assert.rejects(
          authAction(login(), request, response(), null),
          /账号或密码错误/,
        );
        const reply = response();
        await authAction(
          login('owner', 'QA-owner-password-456'),
          request,
          reply,
          null,
        );
        const signedUser = await sessionUser(cookieRequest(reply));
        assert.equal(signedUser.id, owner.id);
      },
    );

    await t.test(
      'cleanup failures stay outside sign-in and retry after one minute',
      async (st) => {
        let now = Date.now() + 16 * 60_000;
        st.mock.method(Date, 'now', () => now);
        const warning = st.mock.method(console, 'warn', () => {});
        await db.query('INSERT INTO admin_sessions VALUES($1,$2,$3,$4,$5)', [
          'expired-synthetic-token',
          owner.id,
          now - 60 * 60_000,
          now - 1,
          now - 31 * 60_000,
        ]);
        failCleanup = true;
        queries.length = 0;
        const reply = response();
        await authAction(
          login('owner', 'QA-owner-password-456'),
          request,
          reply,
          null,
        );
        assert.match(reply.headers['set-cookie'], /Max-Age=43200$/);
        assert.equal(queries.length, 5);
        await drain();
        assert.equal(queries.length, 6);
        assert.equal(warning.mock.calls.length, 1);
        assert.ok(await sessionUser(cookieRequest(reply)));

        failCleanup = false;
        now += 59_000;
        queries.length = 0;
        await authAction(
          login('owner', 'QA-owner-password-456'),
          request,
          response(),
          null,
        );
        await drain();
        assert.equal(
          queries.length,
          5,
          'failed cleanup must not retry on every login',
        );
        now += 2000;
        queries.length = 0;
        await authAction(
          login('owner', 'QA-owner-password-456'),
          request,
          response(),
          null,
        );
        await drain();
        assert.equal(queries.length, 6);
        const expired = await db.query(
          "SELECT * FROM admin_sessions WHERE token_hash='expired-synthetic-token'",
        );
        assert.equal(expired.rows.length, 0);
      },
    );
  } finally {
    await drain();
    hook.deregister();
    delete globalThis.__authPerformanceTestPool;
    await db.close();
  }
});
