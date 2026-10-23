import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import process from 'node:process';
/* oxlint-disable vitest/no-import-node-test -- Native Node tests include isolated SQL integration. */
/* oxlint-disable unicorn/no-await-expression-member -- Compact assertions read isolated SQL results directly. */
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  hashPlatformToken,
  newPlatformToken,
  openPeerKey,
  PLATFORM_LINK_BASE,
  platformLinkConfig,
  sealPeerKey,
  validatePeerKey,
} from './platform-link-config.mjs';
import {
  createPlatformLinkStore,
  platformLinkPersistentTables,
  platformLinkSchema,
} from './platform-link-store.mjs';

test('platform link is disabled by default and requires a canonical encryption key when enabled', () => {
  assert.deepEqual(platformLinkConfig({}), {
    enabled: false,
    ownOrigin: 'https://is.luckdate.com',
    peerOrigin: 'https://ai.chatviva.com',
    source: 'selection-platform',
    peerSource: 'ai-platform',
    home: '/admin/overview',
    trustProxy: false,
    encryptionKey: '',
  });
  assert.equal(PLATFORM_LINK_BASE, '/api/platform-link/v1');
  assert.equal(
    platformLinkConfig({ PLATFORM_LINK_ENABLED: '1' }).enabled,
    false,
  );
  assert.throws(
    () => platformLinkConfig({ PLATFORM_LINK_ENABLED: 'true' }),
    /ENCRYPTION_KEY/,
  );
  const key = randomBytes(32).toString('base64');
  assert.equal(
    platformLinkConfig({
      PLATFORM_LINK_ENABLED: 'true',
      PLATFORM_LINK_ENCRYPTION_KEY: key,
    }).encryptionKey,
    key,
  );
  for (const invalid of [
    key.slice(0, -1),
    `${key}\n`,
    randomBytes(31).toString('base64'),
    'x'.repeat(44),
  ])
    assert.throws(
      () => platformLinkConfig({ PLATFORM_LINK_ENCRYPTION_KEY: invalid }),
      /canonical base64/,
    );
});

test('platform origins and fixed source identifiers reject credentials, redirect paths and ambiguous peers', () => {
  for (const invalid of [
    'http://qa.example.test',
    'https://qa.example.test/callback',
    'https://user:password@qa.example.test',
    'https://qa.example.test/?x=1',
    'https://qa.example.test/#fragment',
    'not a URL',
  ])
    assert.throws(
      () => platformLinkConfig({ PLATFORM_LINK_PUBLIC_ORIGIN: invalid }),
      /HTTPS origin/,
    );
  assert.throws(
    () =>
      platformLinkConfig({
        PLATFORM_LINK_PEER_ORIGIN: 'https://is.luckdate.com/',
      }),
    /distinct origins/,
  );
  assert.throws(
    () =>
      platformLinkConfig({ PLATFORM_LINK_PEER_SOURCE: 'selection-platform' }),
    /distinct origins/,
  );
  for (const invalid of [
    'ab',
    'UPPERCASE',
    '../peer',
    'peer with spaces',
    'a'.repeat(65),
  ])
    assert.throws(
      () => platformLinkConfig({ PLATFORM_LINK_SOURCE: invalid }),
      /platform identifiers/,
    );
  const config = platformLinkConfig({
    PLATFORM_LINK_PUBLIC_ORIGIN: 'https://selection.qa.test/',
    PLATFORM_LINK_PEER_ORIGIN: 'https://ai.qa.test/',
    PLATFORM_LINK_SOURCE: 'selection-qa',
    PLATFORM_LINK_PEER_SOURCE: 'ai-qa',
  });
  assert.equal(config.ownOrigin, 'https://selection.qa.test');
  assert.equal(config.source, 'selection-qa');
});

test('tokens have 256 random bits and keys accept bounded opaque printable ASCII only', () => {
  const tokens = Array.from({ length: 100 }, () => newPlatformToken());
  assert.equal(new Set(tokens).size, tokens.length);
  for (const token of tokens) {
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hashPlatformToken(token), /^[a-f0-9]{64}$/);
    assert.equal(Buffer.from(token, 'base64url').length, 32);
  }
  assert.equal(validatePeerKey('a'.repeat(16)), true);
  assert.equal(validatePeerKey('~'.repeat(512)), true);
  assert.equal(validatePeerKey('opaque/key+with:punctuation=='), true);
  for (const invalid of [
    null,
    {},
    '',
    'a'.repeat(15),
    'a'.repeat(513),
    ' a'.repeat(16),
    `${'a'.repeat(16)}\n`,
    `${'a'.repeat(16)}\u00E9`,
  ])
    assert.equal(validatePeerKey(invalid), false);
});

test('peer keys use randomized AES-GCM with account-bound authenticated context', () => {
  const key = randomBytes(32).toString('base64');
  const peerKey = newPlatformToken();
  const context = 'platform-link:account:qa-user-a';
  const first = sealPeerKey(peerKey, key, context);
  const second = sealPeerKey(peerKey, key, context);
  assert.notEqual(first, second);
  assert.equal(first.includes(peerKey), false);
  assert.equal(openPeerKey(first, key, context), peerKey);
  assert.equal(openPeerKey(second, key, context), peerKey);
  assert.throws(
    () => openPeerKey(first, key, 'platform-link:account:qa-user-b'),
    /cannot be decrypted/,
  );
  assert.throws(
    () => openPeerKey(first, randomBytes(32).toString('base64'), context),
    /cannot be decrypted/,
  );
  const envelope = JSON.parse(first);
  for (const field of ['nonce', 'tag', 'ciphertext']) {
    const changed = Buffer.from(envelope[field], 'base64');
    changed[0] ^= 1;
    assert.throws(
      () =>
        openPeerKey(
          JSON.stringify({ ...envelope, [field]: changed.toString('base64') }),
          key,
          context,
        ),
      /cannot be decrypted/,
    );
  }
  for (const invalid of [
    'null',
    '[]',
    '{',
    'x'.repeat(2049),
    JSON.stringify({ ...envelope, version: 2 }),
    JSON.stringify({ ...envelope, extra: true }),
    JSON.stringify({ ...envelope, nonce: `${envelope.nonce}\n` }),
  ])
    assert.throws(
      () => openPeerKey(invalid, key, context),
      /cannot be decrypted/,
    );
  assert.throws(() => sealPeerKey('short', key, context), /16 to 512/);
  assert.throws(() => sealPeerKey(peerKey, key, ''), /account context/);
});

function isolatedPool(db) {
  let tail = Promise.resolve();
  async function acquire() {
    let release;
    const previous = tail;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }
  async function query(statement, params = []) {
    const result = await db.query(statement, params);
    return {
      ...result,
      rowCount: result.affectedRows ?? result.rows?.length ?? 0,
    };
  }
  // PGlite has one connection, so reserve it across each BEGIN/COMMIT pair.
  return {
    async query(statement, params) {
      const release = await acquire();
      try {
        return await query(statement, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      return { query, release };
    },
  };
}

test('isolated SQL persists account key lifecycle, transactions, encrypted peers and one-time flows', async (t) => {
  const runtime =
    process.env.HCI_TEST_PGLITE_MODULE ||
    'D:/项目代码/Intelligence_System/.artifacts/public-content-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
  try {
    await access(runtime);
  } catch (error) {
    if (!process.env.HCI_TEST_PGLITE_MODULE && error.code === 'ENOENT') {
      t.skip(
        'Optional isolated PGlite runtime is not installed; set HCI_TEST_PGLITE_MODULE to its absolute entry file',
      );
      return;
    }
    throw error;
  }
  const { PGlite } = await import(pathToFileURL(runtime).href);
  const db = new PGlite();
  const pool = isolatedPool(db);
  let clock = 1_800_000_000_000;
  const store = createPlatformLinkStore(pool, { now: () => clock });
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const keyId = randomUUID();
  const ownKey = newPlatformToken();
  try {
    await pool.query(
      'CREATE TABLE admin_users (id varchar(36) PRIMARY KEY, username varchar(64), display_name varchar(100), password_hash varchar(256), role varchar(20), enabled integer, created_at bigint)',
    );
    for (const statement of [...platformLinkSchema, ...platformLinkSchema])
      await pool.query(statement);
    for (const id of [userId, otherUserId])
      await pool.query(
        'INSERT INTO admin_users(id,username,display_name,password_hash,role,enabled,created_at) VALUES($1,$2,$3,$4,$5,1,$6)',
        [id, id, 'Synthetic user', 'not-a-real-hash', 'researcher', clock],
      );
    assert.deepEqual(platformLinkPersistentTables, [
      'platform_link_keys',
      'platform_link_peers',
    ]);
    assert.equal(await store.user('missing'), null);
    await store.withUser(userId, async (tx, user, connection) => {
      assert.equal(user.password_hash, 'not-a-real-hash');
      assert.equal(typeof connection.query, 'function');
      assert.notEqual(connection, pool);
      await tx.replaceKey(userId, {
        id: keyId,
        keyHash: hashPlatformToken(ownKey),
        displayHint: 'qa-hint',
      });
    });
    const joined = await store.keyByHash(hashPlatformToken(ownKey));
    assert.equal(joined.id, keyId);
    assert.equal(joined.user_id, userId);
    assert.equal(joined.role, 'researcher');
    assert.equal(joined.enabled, 1);
    assert.equal(joined.password_hash, undefined);
    assert.equal(await store.keyByHash(hashPlatformToken('missing')), null);
    assert.equal(
      JSON.stringify(
        await pool.query('SELECT * FROM platform_link_keys'),
      ).includes(ownKey),
      false,
    );

    const rawTicket = newPlatformToken();
    const pending = newPlatformToken();
    const browserHash = hashPlatformToken(newPlatformToken());
    const written = await store.putFlow(
      'ticket',
      rawTicket,
      {
        userId,
        keyId,
        browserHash,
        payload: { source: 'ai-platform', nonce: 'qa-nonce' },
      },
      60_000,
    );
    assert.equal(written.expiresAt, clock + 60_000);
    assert.equal(written.tokenHash, hashPlatformToken(rawTicket));
    await store.putFlow(
      'pending',
      pending,
      { userId, keyId, payload: { subject: userId } },
      120_000,
    );
    assert.equal(await store.getFlow('other-kind', rawTicket), null);
    assert.equal(await store.consumeFlow('other-kind', rawTicket), false);
    const stored = await store.getFlow('ticket', rawTicket);
    assert.deepEqual(stored.payload, {
      source: 'ai-platform',
      nonce: 'qa-nonce',
    });
    assert.equal(stored.browser_hash, browserHash);
    assert.equal(stored.consumed_at, null);
    assert.equal(
      JSON.stringify(
        await pool.query('SELECT * FROM platform_link_flows'),
      ).includes(rawTicket),
      false,
    );

    await assert.rejects(
      store.withUser(userId, async (tx) => {
        await tx.revokeKey(userId);
        throw new Error('synthetic rollback');
      }),
      /synthetic rollback/,
    );
    assert.equal((await store.keyForUser(userId)).revoked_at, null);
    assert.equal((await store.getFlow('pending', pending)).consumed_at, null);

    const attempts = await Promise.all([
      store.withUser(userId, (tx) => tx.consumeFlow('ticket', rawTicket)),
      store.withUser(userId, (tx) => tx.consumeFlow('ticket', rawTicket)),
    ]);
    assert.deepEqual(attempts, [true, false]);
    assert.equal(
      Number((await store.getFlow('ticket', rawTicket)).consumed_at),
      clock,
    );

    const encryptionKey = randomBytes(32).toString('base64');
    const peerKey = newPlatformToken();
    const context = `platform-link:${userId}`;
    await store.withUser(userId, (tx) =>
      tx.setPeer(userId, {
        subject: 'qa-peer-a',
        displayName: 'QA peer A',
        encryptedKey: sealPeerKey(peerKey, encryptionKey, context),
        version: randomUUID(),
      }),
    );
    const peer = await store.getPeer(userId);
    assert.equal(
      openPeerKey(peer.encrypted_key, encryptionKey, context),
      peerKey,
    );
    const secondVersion = randomUUID();
    await store.withUser(userId, (tx) =>
      tx.setPeer(userId, {
        subject: 'qa-peer-b',
        displayName: 'QA peer B',
        encryptedKey: peer.encrypted_key,
        version: secondVersion,
      }),
    );
    assert.equal((await store.getPeer(userId)).version, secondVersion);
    assert.equal((await store.getPeer(userId)).peer_subject, 'qa-peer-b');

    await store.withUser(userId, (tx) => tx.revokeKey(userId));
    assert.equal(Number((await store.keyForUser(userId)).revoked_at), clock);
    assert.equal(
      Number((await store.getFlow('pending', pending)).consumed_at),
      clock,
    );
    assert.equal(await store.consumeFlow('pending', pending), false);
    assert.equal((await store.getPeer(userId)).peer_subject, 'qa-peer-b');

    const rotatedKeyId = randomUUID();
    const rotatedKeyHash = hashPlatformToken(newPlatformToken());
    await store.withUser(userId, (tx) =>
      tx.replaceKey(userId, {
        id: rotatedKeyId,
        keyHash: rotatedKeyHash,
        displayHint: 'new-hint',
      }),
    );
    assert.equal(await store.keyByHash(hashPlatformToken(ownKey)), null);
    assert.equal((await store.keyForUser(userId)).revoked_at, null);
    const rotatePending = newPlatformToken();
    await store.putFlow(
      'pending',
      rotatePending,
      { userId, keyId: rotatedKeyId },
      60_000,
    );
    await store.withUser(userId, (tx) =>
      tx.replaceKey(userId, {
        id: randomUUID(),
        keyHash: hashPlatformToken(newPlatformToken()),
        displayHint: 'third-hint',
      }),
    );
    assert.equal(await store.consumeFlow('pending', rotatePending), false);

    await store.withUser(otherUserId, (tx) =>
      tx.replaceKey(otherUserId, {
        id: randomUUID(),
        keyHash: rotatedKeyHash,
        displayHint: 'other-hint',
      }),
    );
    const beforeCollision = await store.keyForUser(userId);
    await assert.rejects(
      store.withUser(userId, (tx) =>
        tx.replaceKey(userId, {
          id: randomUUID(),
          keyHash: rotatedKeyHash,
          displayHint: 'collision',
        }),
      ),
      /unique/i,
    );
    assert.equal((await store.keyForUser(userId)).id, beforeCollision.id);

    const expired = newPlatformToken();
    await store.putFlow('ticket', expired, { userId, payload: {} }, 100);
    clock += 100;
    assert.ok(await store.getFlow('ticket', expired));
    assert.equal(await store.consumeFlow('ticket', expired), false);
    assert.equal(await store.removePeer(userId), true);
    assert.equal(await store.removePeer(userId), false);
    assert.equal(await store.getPeer(userId), null);

    for (let i = 0; i < 503; i++)
      await pool.query(
        'INSERT INTO platform_link_flows(token_hash,kind,payload,expires_at) VALUES($1,$2,$3,$4)',
        [
          hashPlatformToken(`stale-${i}`),
          'ticket',
          '{}',
          clock - 60 * 60_000 - 1,
        ],
      );
    assert.equal(await store.cleanup(), 500);
    assert.equal(await store.cleanup(), 3);
    assert.equal(await store.cleanup(), 0);
    assert.ok(await store.getFlow('ticket', expired));
    assert.equal(
      Number(
        (await pool.query('SELECT COUNT(*) AS total FROM platform_link_keys'))
          .rows[0].total,
      ),
      2,
    );
  } finally {
    await db.close();
  }
});
