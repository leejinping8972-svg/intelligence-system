import { createWeeklyAccumulator } from './weekly-summary-domain.mjs';

const KIND = 'weekly-summary';
const MARKER = 'read:weekly-summary-version';
const VERSION = 1;
const INTERVAL = 5 * 60_000;
const keyOf = (market) => `read:statistics:${KIND}:${market}:all`;
const dayOf = (now) => new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);

export function createWeeklySummary({ pool, sql, putDocument }) {
  let nextCheck = 0;
  async function rebuild(connection, revision, indexing = false) {
    const now = Date.now();
    if (now < nextCheck) return;
    const previous = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [MARKER])).rows[0]?.value;
    const day = dayOf(now);
    const changed = String(previous?.revision) !== String(revision);
    if (previous?.version === VERSION && previous.day === day &&
      !(previous.indexing && !indexing) && !(changed && now - Number(previous.at) >= INTERVAL)) {
      nextCheck = now + 60_000;
      return;
    }
    const summary = createWeeklyAccumulator(now);
    for (const kind of ['products', 'ads']) {
      let cursor = '';
      for (;;) {
        const rows = (await connection.query('SELECT id,payload FROM workspace_read_rows WHERE collection=$1 AND id>$2 ORDER BY id LIMIT 200', [kind, cursor])).rows;
        for (const row of rows) summary.add(kind, { ...row.payload, id: row.id });
        if (rows.length < 200) break;
        cursor = rows.at(-1).id;
      }
    }
    const metadata = { generatedAt: new Date(now).toISOString(), day, revision: String(revision), indexing, version: VERSION };
    for (const [market, { rows, missingDiscovery, missingLaunch }] of Object.entries(summary.results())) {
      await connection.query('DELETE FROM workspace_statistic_rows WHERE kind=$1 AND market=$2 AND variant=$3', [KIND, market, 'all']);
      for (let start = 0; start < rows.length; start += 100) {
        const batch = rows.slice(start, start + 100);
        await connection.query(`INSERT INTO workspace_statistic_rows(kind,market,variant,position,subtype,payload) VALUES ${batch.map((_, i) => `(${Array.from({ length: 6 }, (_, j) => `$${i * 6 + j + 1}`).join(',')})`).join(',')}`,
          batch.flatMap((row, i) => [KIND, market, 'all', start + i, '', row]));
      }
      await putDocument('workspace_documents', keyOf(market), { ...metadata, total: rows.length, missingDiscovery, missingLaunch }, false, connection);
    }
    await putDocument('workspace_documents', MARKER, { ...metadata, at: now }, false, connection);
    // The caller commits all markets and the marker together; do not throttle a rollback.
  }
  async function read(input) {
    const connection = await pool.connect();
    try {
      await connection.query(sql('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
      const market = ['MX', 'US', 'VN'].includes(input.market) ? input.market : 'ALL';
      const snapshot = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [keyOf(market)])).rows[0]?.value || null;
      const total = Number(snapshot?.total || 0);
      const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize) || 12)));
      const page = Math.max(1, Math.min(Math.ceil(total / pageSize) || 1, Math.floor(Number(input.page) || 1)));
      const rows = snapshot ? (await connection.query('SELECT payload FROM workspace_statistic_rows WHERE kind=$1 AND market=$2 AND variant=$3 ORDER BY position LIMIT $4 OFFSET $5', [KIND, market, 'all', pageSize, (page - 1) * pageSize])).rows.map((row) => row.payload) : [];
      await connection.query('COMMIT');
      return { rows, total, page, pageSize, snapshot };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
  }
  return { rebuild, read, due: () => Date.now() >= nextCheck, retryLater: () => { nextCheck = Date.now() + 60_000; } };
}
