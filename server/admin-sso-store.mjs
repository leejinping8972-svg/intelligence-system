import { createHash } from 'node:crypto';

export const ssoSchema =
  'CREATE TABLE IF NOT EXISTS admin_sso_tickets (ticket_hash varchar(64) PRIMARY KEY, kind varchar(16) NOT NULL, payload text NOT NULL, expires_at bigint NOT NULL, consumed integer NOT NULL DEFAULT 0)';
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function createSsoStore(pool, now = Date.now) {
  return {
    async put(kind, token, payload, ttl) {
      await pool.query('DELETE FROM admin_sso_tickets WHERE expires_at<$1', [
        now(),
      ]);
      await pool.query(
        'INSERT INTO admin_sso_tickets(ticket_hash,kind,payload,expires_at,consumed) VALUES($1,$2,$3,$4,0)',
        [hash(token), kind, JSON.stringify(payload), now() + ttl],
      );
    },
    async get(kind, token) {
      const { rows } = await pool.query(
        'SELECT payload FROM admin_sso_tickets WHERE ticket_hash=$1 AND kind=$2 AND expires_at>$3 AND consumed=0',
        [hash(token), kind, now()],
      );
      return rows[0] ? JSON.parse(rows[0].payload) : null;
    },
    async consume(kind, token) {
      const result = await pool.query(
        'UPDATE admin_sso_tickets SET consumed=1 WHERE ticket_hash=$1 AND kind=$2 AND expires_at>$3 AND consumed=0',
        [hash(token), kind, now()],
      );
      return result.rowCount === 1;
    },
    async activeAdmin(id, tokenHash) {
      const { rows } = await pool.query(
        "SELECT u.* FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE u.id=$1 AND s.token_hash=$2 AND s.expires_at>$3 AND s.last_seen_at>$4 AND u.enabled=1 AND u.role='admin'",
        [id, tokenHash, now(), now() - 30 * 60_000],
      );
      return rows[0] || null;
    },
    async localAdmin(id) {
      const { rows } = await pool.query(
        "SELECT * FROM admin_users WHERE id=$1 AND enabled=1 AND role='admin'",
        [id],
      );
      return rows[0] || null;
    },
  };
}
