import { hashPlatformToken } from './platform-link-config.mjs';

export const platformLinkPersistentTables = [
  'platform_link_keys',
  'platform_link_peers',
];

export const platformLinkSchema = [
  'CREATE TABLE IF NOT EXISTS platform_link_keys (id varchar(36) PRIMARY KEY, user_id varchar(36) UNIQUE NOT NULL, key_hash varchar(64) UNIQUE NOT NULL, display_hint varchar(32) NOT NULL, created_at bigint NOT NULL, revoked_at bigint, expires_at bigint)',
  'CREATE TABLE IF NOT EXISTS platform_link_peers (local_user_id varchar(36) PRIMARY KEY, peer_subject varchar(128) NOT NULL, peer_display_name varchar(200) NOT NULL, encrypted_key text NOT NULL, version varchar(36) NOT NULL, updated_at bigint NOT NULL)',
  'CREATE TABLE IF NOT EXISTS platform_link_flows (token_hash varchar(64) PRIMARY KEY, kind varchar(16) NOT NULL, payload text NOT NULL, user_id varchar(36), key_id varchar(36), browser_hash varchar(64), expires_at bigint NOT NULL, consumed_at bigint)',
];

const cleanupRetentionMs = 60 * 60_000;
const cleanupBatchSize = 500;

export function createPlatformLinkStore(pool, { now = Date.now } = {}) {
  function methods(connection) {
    return {
      async user(id) {
        const { rows } = await connection.query(
          'SELECT * FROM admin_users WHERE id=$1',
          [id],
        );
        return rows[0] || null;
      },

      async keyForUser(userId) {
        const { rows } = await connection.query(
          'SELECT id,user_id,key_hash,display_hint,created_at,revoked_at,expires_at FROM platform_link_keys WHERE user_id=$1',
          [userId],
        );
        return rows[0] || null;
      },

      async keyByHash(keyHash) {
        const { rows } = await connection.query(
          'SELECT k.id AS id,k.user_id AS user_id,k.key_hash AS key_hash,k.display_hint AS display_hint,k.created_at AS created_at,k.revoked_at AS revoked_at,k.expires_at AS expires_at,u.username AS username,u.display_name AS display_name,u.enabled AS enabled,u.role AS role FROM platform_link_keys k JOIN admin_users u ON u.id=k.user_id WHERE k.key_hash=$1',
          [keyHash],
        );
        return rows[0] || null;
      },

      async replaceKey(userId, { id, keyHash, displayHint }) {
        const previous = await this.keyForUser(userId);
        if (previous) await this.invalidateKeyFlows(previous.id);
        await connection.query(
          'DELETE FROM platform_link_keys WHERE user_id=$1',
          [userId],
        );
        await connection.query(
          'INSERT INTO platform_link_keys(id,user_id,key_hash,display_hint,created_at,revoked_at,expires_at) VALUES($1,$2,$3,$4,$5,NULL,NULL)',
          [id, userId, keyHash, displayHint, now()],
        );
        return this.keyForUser(userId);
      },

      async revokeKey(userId) {
        const previous = await this.keyForUser(userId);
        if (!previous) return null;
        await connection.query(
          'UPDATE platform_link_keys SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1',
          [userId, now()],
        );
        await this.invalidateKeyFlows(previous.id);
        return this.keyForUser(userId);
      },

      async getPeer(userId) {
        const { rows } = await connection.query(
          'SELECT local_user_id,peer_subject,peer_display_name,encrypted_key,version,updated_at FROM platform_link_peers WHERE local_user_id=$1',
          [userId],
        );
        return rows[0] || null;
      },

      async setPeer(userId, { subject, displayName, encryptedKey, version }) {
        const existing = await this.getPeer(userId);
        const updatedAt = now();
        const statement = existing
          ? 'UPDATE platform_link_peers SET peer_subject=$2,peer_display_name=$3,encrypted_key=$4,version=$5,updated_at=$6 WHERE local_user_id=$1'
          : 'INSERT INTO platform_link_peers(local_user_id,peer_subject,peer_display_name,encrypted_key,version,updated_at) VALUES($1,$2,$3,$4,$5,$6)';
        await connection.query(statement, [
          userId,
          subject,
          displayName,
          encryptedKey,
          version,
          updatedAt,
        ]);
        return this.getPeer(userId);
      },

      async removePeer(userId) {
        const result = await connection.query(
          'DELETE FROM platform_link_peers WHERE local_user_id=$1',
          [userId],
        );
        return result.rowCount === 1;
      },

      async putFlow(
        kind,
        rawToken,
        { userId = null, keyId = null, browserHash = null, payload = {} },
        ttlMs,
      ) {
        if (!/^[a-z][a-z0-9_-]{0,15}$/.test(kind))
          throw new Error('Invalid platform flow kind');
        if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 60 * 60_000)
          throw new Error(
            'Platform flow lifetime must be between one millisecond and one hour',
          );
        const tokenHash = hashPlatformToken(rawToken);
        const expiresAt = now() + ttlMs;
        const serialized = JSON.stringify(payload);
        if (typeof serialized !== 'string' || serialized.length > 16_384)
          throw new Error('Invalid platform flow payload');
        await connection.query(
          'INSERT INTO platform_link_flows(token_hash,kind,payload,user_id,key_id,browser_hash,expires_at,consumed_at) VALUES($1,$2,$3,$4,$5,$6,$7,NULL)',
          [tokenHash, kind, serialized, userId, keyId, browserHash, expiresAt],
        );
        return { tokenHash, expiresAt };
      },

      async getFlow(kind, rawToken) {
        const { rows } = await connection.query(
          'SELECT token_hash,kind,payload,user_id,key_id,browser_hash,expires_at,consumed_at FROM platform_link_flows WHERE token_hash=$1 AND kind=$2',
          [hashPlatformToken(rawToken), kind],
        );
        const row = rows[0];
        return row ? { ...row, payload: JSON.parse(row.payload) } : null;
      },

      async consumeFlow(kind, rawToken) {
        const result = await connection.query(
          'UPDATE platform_link_flows SET consumed_at=$3 WHERE token_hash=$1 AND kind=$2 AND expires_at>$3 AND consumed_at IS NULL',
          [hashPlatformToken(rawToken), kind, now()],
        );
        return result.rowCount === 1;
      },

      async invalidateKeyFlows(keyId) {
        const result = await connection.query(
          'UPDATE platform_link_flows SET consumed_at=$2 WHERE key_id=$1 AND consumed_at IS NULL',
          [keyId, now()],
        );
        return result.rowCount;
      },

      async cleanup() {
        // Retain recent failures for precise expiry/replay responses; cap each deletion batch.
        const { rows } = await connection.query(
          'SELECT token_hash FROM platform_link_flows WHERE expires_at<=$1 ORDER BY expires_at,token_hash LIMIT 500',
          [now() - cleanupRetentionMs],
        );
        if (rows.length === 0) return 0;
        const hashes = rows
          .slice(0, cleanupBatchSize)
          .map((row) => row.token_hash);
        const placeholders = hashes
          .map((_, index) => `$${index + 1}`)
          .join(',');
        const result = await connection.query(
          `DELETE FROM platform_link_flows WHERE token_hash IN (${placeholders})`,
          hashes,
        );
        return result.rowCount;
      },
    };
  }

  return {
    ...methods(pool),
    async withUser(userId, callback) {
      const connection = await pool.connect();
      let began = false;
      try {
        await connection.query('BEGIN');
        began = true;
        const { rows } = await connection.query(
          'SELECT * FROM admin_users WHERE id=$1 FOR UPDATE',
          [userId],
        );
        const result = await callback(
          methods(connection),
          rows[0] || null,
          connection,
        );
        await connection.query('COMMIT');
        began = false;
        return result;
      } catch (error) {
        if (began) await connection.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
