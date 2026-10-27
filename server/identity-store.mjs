import { AsyncLocalStorage } from 'node:async_hooks';
import { Buffer } from 'node:buffer';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

export const identitySchema = [
  'CREATE TABLE IF NOT EXISTS identity_artifacts (id_hash varchar(64) PRIMARY KEY, model varchar(64) NOT NULL, payload text NOT NULL, grant_hash varchar(64), uid_hash varchar(64), account_id varchar(36), local_session_hash varchar(64), expires_at bigint NOT NULL, consumed_at bigint)',
];
export const identityTables = ['identity_artifacts'];
const digest = (value) =>
  value ? createHash('sha256').update(value).digest('hex') : null;

export function createIdentityStore(
  pool,
  { encryptionKey, sql = (pg) => pg, now = Date.now },
) {
  const context = new AsyncLocalStorage();
  const key = Buffer.from(encryptionKey, 'base64');
  function seal(value, id) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`identity:${id}`));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64'))
      .join('.');
  }
  function open(value, id) {
    const [iv, tag, data] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`identity:${id}`));
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([cipher.update(data), cipher.final()]).toString(),
    );
  }
  async function user(id) {
    const result = await pool.query('SELECT * FROM admin_users WHERE id=$1', [
      id,
    ]);
    return result.rows[0];
  }
  async function load(row) {
    if (!row || Number(row.expires_at) <= now()) return undefined;
    if (row.account_id) {
      const account = await user(row.account_id);
      if (!account?.enabled || !['admin', 'researcher'].includes(account.role))
        return undefined;
      if (row.model === 'Session') {
        const local = context.getStore()?.user;
        if (local && local.id !== row.account_id) return undefined;
        if (!row.local_session_hash) return undefined;
        const active = await pool.query(
          'SELECT user_id FROM admin_sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>$3 AND last_seen_at>$4',
          [row.local_session_hash, row.account_id, now(), now() - 30 * 60_000],
        );
        if (active.rows.length === 0) return undefined;
      }
    }
    const payload = open(row.payload, row.id_hash);
    if (row.consumed_at) payload.consumed = Number(row.consumed_at);
    return payload;
  }
  class Adapter {
    constructor(model) {
      this.model = model;
    }
    async consume(id) {
      await pool.query(
        'UPDATE identity_artifacts SET consumed_at=$2 WHERE id_hash=$1 AND consumed_at IS NULL',
        [this.id(id), Math.floor(now() / 1000)],
      );
    }
    async destroy(id) {
      await pool.query('DELETE FROM identity_artifacts WHERE id_hash=$1', [
        this.id(id),
      ]);
    }
    async find(id) {
      const result = await pool.query(
        'SELECT * FROM identity_artifacts WHERE id_hash=$1',
        [this.id(id)],
      );
      return load(result.rows[0]);
    }
    async findByUid(uid) {
      const result = await pool.query(
        'SELECT * FROM identity_artifacts WHERE model=$1 AND uid_hash=$2 AND expires_at>$3',
        [this.model, digest(uid), now()],
      );
      return load(result.rows[0]);
    }
    async findByUserCode() {
      return undefined;
    }
    id(id) {
      return digest(`${this.model}:${id}`);
    }
    async revokeByGrantId(id) {
      await pool.query(
        'DELETE FROM identity_artifacts WHERE grant_hash=$1 OR id_hash=$2',
        [digest(id), digest(`Grant:${id}`)],
      );
    }
    async upsert(id, payload, expiresIn) {
      const idHash = this.id(id);
      const local = context.getStore()?.user;
      // Preserve the original browser binding on ordinary session updates.
      let old;
      if (this.model === 'Session') {
        const result = await pool.query(
          'SELECT local_session_hash FROM identity_artifacts WHERE id_hash=$1',
          [idHash],
        );
        old = result.rows[0];
      }
      const binding =
        local && local.id === payload.accountId
          ? local.token_hash
          : old?.local_session_hash || null;
      await pool.query(
        sql(
          'INSERT INTO identity_artifacts(id_hash,model,payload,grant_hash,uid_hash,account_id,local_session_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT(id_hash) DO UPDATE SET payload=EXCLUDED.payload,grant_hash=EXCLUDED.grant_hash,uid_hash=EXCLUDED.uid_hash,account_id=EXCLUDED.account_id,local_session_hash=EXCLUDED.local_session_hash,expires_at=EXCLUDED.expires_at',
          'INSERT INTO identity_artifacts(id_hash,model,payload,grant_hash,uid_hash,account_id,local_session_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON DUPLICATE KEY UPDATE payload=VALUES(payload),grant_hash=VALUES(grant_hash),uid_hash=VALUES(uid_hash),account_id=VALUES(account_id),local_session_hash=VALUES(local_session_hash),expires_at=VALUES(expires_at)',
        ),
        [
          idHash,
          this.model,
          seal(payload, idHash),
          digest(payload.grantId),
          digest(payload.uid),
          payload.accountId || null,
          binding,
          now() + expiresIn * 1000,
        ],
      );
    }
  }
  return {
    Adapter,
    context,
    user,
    async directory() {
      const result = await pool.query(
        'SELECT * FROM admin_users ORDER BY created_at',
      );
      return result.rows;
    },
    async cleanup() {
      await pool.query(
        'DELETE FROM identity_artifacts WHERE id_hash IN (SELECT id_hash FROM (SELECT id_hash FROM identity_artifacts WHERE expires_at<$1 LIMIT 500) expired)',
        [now() - 60_000],
      );
    },
  };
}
