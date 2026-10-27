import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';

import { PGlite } from '@electric-sql/pglite';

import { identityConfig } from './identity-config.mjs';
import { createIdentityStore, identitySchema } from './identity-store.mjs';
import { createIdentity } from './identity.mjs';

export async function identityFixture(origin = 'https://is.example.test') {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE admin_users (id varchar(36) PRIMARY KEY,username varchar(64) UNIQUE,display_name varchar(100),password_hash varchar(256),role varchar(20),enabled integer,created_at bigint,last_login_at bigint,password_changed_at bigint);
    CREATE TABLE admin_sessions (token_hash varchar(64) PRIMARY KEY,user_id varchar(36),created_at bigint,expires_at bigint,last_seen_at bigint);
    CREATE TABLE admin_login_attempts (attempt_key varchar(128) PRIMARY KEY,failures integer,locked_until bigint,updated_at bigint);
    CREATE TABLE admin_audit (id varchar(36) PRIMARY KEY,actor_id varchar(36),action varchar(100),target_id varchar(64),created_at bigint);
  `);
  for (const statement of [...identitySchema, ...identitySchema])
    await db.query(statement);
  let locked = false;
  const pool = {
    async query(...args) {
      const result = await db.query(...args);
      return { ...result, rowCount: result.affectedRows ?? result.rows.length };
    },
    async connect() {
      return { query: (...args) => pool.query(...args), release() {} };
    },
  };
  const ref = `__identityTest${randomUUID().replaceAll('-', '')}`;
  globalThis[ref] = pool;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.split('?')[0].endsWith('/auth.mjs')) {
        if (specifier === './database.mjs')
          return {
            url: `data:text/javascript,${encodeURIComponent(`export const pool=globalThis.${ref};export const sql=(pg)=>pg;export const lock=async()=>true;export const unlock=async()=>{};`)}`,
            shortCircuit: true,
          };
        if (specifier === './local-provider.mjs')
          return {
            url: 'data:text/javascript,export const readCredentials=async()=>({});',
            shortCircuit: true,
          };
      }
      return next(specifier, context);
    },
  });
  const auth = await import(`./auth.mjs?test=${ref}`);
  hook.deregister();
  const { generateKeyPairSync } = await import('node:crypto');
  const jwk = {
    ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      format: 'jwk',
    }),
    alg: 'RS256',
    use: 'sig',
    kid: randomUUID(),
  };
  const env = {
    IDENTITY_ENABLED: 'true',
    IDENTITY_PUBLIC_ORIGIN: origin,
    IDENTITY_AI_CLIENT_SECRET: randomBytes(32).toString('base64url'),
    IDENTITY_COOKIE_KEYS: JSON.stringify([
      randomBytes(32).toString('base64url'),
    ]),
    IDENTITY_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    PROVIDER_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  };
  const config = identityConfig(env);
  const store = createIdentityStore(pool, config);
  const errors = [];
  const create = () =>
    createIdentity({
      config,
      store,
      pool,
      sessionUser: auth.sessionUser,
      authAction: auth.authAction,
      onError: (error) => errors.push(error),
      lock: async () => {
        if (locked) return false;
        locked = true;
        return true;
      },
      unlock: async () => {
        locked = false;
      },
    });
  const user = {
    id: randomUUID(),
    username: 'qa-owner',
    display_name: 'Synthetic QA',
    role: 'admin',
    enabled: 1,
  };
  const password = 'Synthetic-only-password-123';
  await pool.query(
    'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at,password_changed_at) VALUES($1,$2,$3,$4,$5,1,$6,$6)',
    [
      user.id,
      user.username,
      user.display_name,
      await auth.hashPassword(password),
      user.role,
      Date.now(),
    ],
  );
  return {
    db,
    pool,
    store,
    config,
    env,
    user,
    password,
    auth,
    create,
    errors,
    async close() {
      Reflect.deleteProperty(globalThis, ref);
      await db.close();
    },
  };
}
