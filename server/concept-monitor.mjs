import {BATCH_SETTINGS, batchRecord} from './collection-batch-domain.mjs';
import {conceptMemberKey} from './concept-members.mjs';
import { conceptMonitorRows } from './concept-monitor-domain.mjs';
import { shanghaiDay } from './collection-time.mjs';
import { statisticsRefreshSchedule } from './workspace-statistics.mjs';

const KIND = 'concept-monitor';
const VERSION = 3;
const CATCHUP_INTERVAL_MS = 5 * 60_000;
const MARKER = 'read:concept-monitor-version';
const snapshotKey = (market) => `read:statistics:${KIND}:${market}:all`;
const numericSorts = new Set([
  'keywords',
  'ads',
  'sites',
  'products',
  'keywordsToday',
  'adsToday',
  'sitesToday',
  'productsToday',
]);

export function createConceptMonitor({ pool, sql, putDocument }) {
  let nextCheck = 0;
  // Called by the background worker independently of whether its queue drains.
  // The surrounding transaction and workspace-reads lock publish every market atomically.
  async function rebuild(connection, revision, indexing = false) {
    const now = Date.now();
    if (now < nextCheck) return;
    const marker = await connection.query(
      'SELECT value FROM workspace_documents WHERE name=$1',
      [MARKER],
    );
    const previous = marker.rows[0]?.value;
    const schedule = statisticsRefreshSchedule(previous, now);
    const catchup =
      previous?.indexing &&
      (!indexing ||
        (String(previous.revision) !== String(revision) &&
          now - Number(previous.at) >= CATCHUP_INTERVAL_MS));
    if (previous?.version === VERSION && !schedule.due && !catchup) {
      nextCheck = Math.min(now + 60_000, schedule.nextAt);
      return;
    }
    const settings = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [BATCH_SETTINGS])).rows[0]?.value;
    const state = { keywords: [], ads: [], sites: [], products: [] };
    for (const kind of Object.keys(state)) {
      let cursor = '';
      for (;;) {
        const result = await connection.query(
          'SELECT id,payload FROM workspace_read_rows WHERE collection=$1 AND id>$2 ORDER BY id LIMIT 200',
          [kind, cursor],
        );
        const rows = result.rows;
        state[kind].push(...rows.map((row) => batchRecord(kind, row.payload, settings?.aliases)));
        if (rows.length < 200) break;
        cursor = rows.at(-1).id;
      }
    }
    const metadata = {
      generatedAt: new Date(now).toISOString(),
      day: shanghaiDay(now),
      revision: String(revision),
      version: VERSION,
      indexing,
      batchRevision: settings?.revision || 0,
    };
    await connection.query("DELETE FROM workspace_documents WHERE name LIKE 'read:concept-members:%'");
    for (const market of ['ALL', 'US', 'MX', 'VN']) {
      const scoped = Object.fromEntries(
        Object.entries(state).map(([kind, rows]) => [
          kind,
          market === 'ALL' ? rows : rows.filter((row) => row.market === market),
        ]),
      );
      const members = [];
      const rows = conceptMonitorRows(scoped, now, (batch, groups) => {
        for (const [kind, value] of Object.entries(groups)) members.push([conceptMemberKey(market, batch, kind), value]);
      });
      for (const [key, value] of members) await putDocument('workspace_documents', key, value, false, connection);
      await connection.query(
        'DELETE FROM workspace_statistic_rows WHERE kind=$1 AND market=$2 AND variant=$3',
        [KIND, market, 'all'],
      );
      for (let start = 0; start < rows.length; start += 100) {
        const batch = rows.slice(start, start + 100);
        await connection.query(
          `INSERT INTO workspace_statistic_rows(kind,market,variant,position,subtype,payload) VALUES ${batch.map((_, i) => `(${Array.from({ length: 6 }, (_, j) => `$${i * 6 + j + 1}`).join(',')})`).join(',')}`,
          batch.flatMap((row, i) => [KIND, market, 'all', start + i, '', row]),
        );
      }
      await putDocument(
        'workspace_documents',
        snapshotKey(market),
        { ...metadata, total: rows.length },
        false,
        connection,
      );
    }
    await putDocument(
      'workspace_documents',
      MARKER,
      { version: VERSION, at: now, revision: String(revision), indexing },
      false,
      connection,
    );
    // Do not advance the in-memory timer until the caller has committed.
  }
  async function read(input) {
    const connection = await pool.connect();
    try {
      await connection.query(
        sql(
          'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
          'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY',
        ),
      );
      const market = ['US', 'MX', 'VN'].includes(input.market)
        ? input.market
        : 'ALL';
      const saved = await connection.query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [snapshotKey(market)],
      );
      const snapshot = saved.rows[0]?.value || null;
      const params = [KIND, market, 'all'];
      let where = 'kind=$1 AND market=$2 AND variant=$3';
      const field = (name) =>
        sql(
          `payload->>'${name}'`,
          `JSON_UNQUOTE(JSON_EXTRACT(payload,'$.${name}'))`,
        );
      const search = String(input.search || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .slice(0, 100);
      if (search) {
        params.push(
          `%${search.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`,
        );
        where += ` AND LOWER(${field('batch')}) LIKE $${params.length} ESCAPE '!'`;
      }
      const sort =
        numericSorts.has(input.sort) ||
        ['batch', 'markets', 'collectedAt'].includes(input.sort)
          ? input.sort
          : 'collectedAt';
      const order = input.order === 'ascend' ? 'ASC' : 'DESC';
      const value = numericSorts.has(sort)
        ? `CAST(${field(sort)} AS DECIMAL(20,0))`
        : field(sort);
      const ordering = `${sort === 'collectedAt' ? `CASE WHEN ${value}='' THEN 1 ELSE 0 END,` : ''}${value} ${order},position ASC`;
      const count = snapshot
        ? await connection.query(
            `SELECT COUNT(*) AS total FROM workspace_statistic_rows WHERE ${where}`,
            params,
          )
        : null;
      const total = Number(count?.rows[0].total || 0);
      const pageSize = Math.max(
        1,
        Math.min(100, Math.floor(Number(input.pageSize) || 20)),
      );
      const page = Math.max(
        1,
        Math.min(
          Math.ceil(total / pageSize) || 1,
          Math.floor(Number(input.page) || 1),
        ),
      );
      const result = snapshot
        ? await connection.query(
            `SELECT payload FROM workspace_statistic_rows WHERE ${where} ORDER BY ${ordering} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, pageSize, (page - 1) * pageSize],
          )
        : null;
      const rows = result?.rows.map((row) => row.payload) || [];
      await connection.query('COMMIT');
      return {
        rows,
        total,
        page,
        pageSize,
        snapshot,
        indexing: !snapshot || Boolean(snapshot.indexing),
      };
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally {
      connection.release();
    }
  }
  return {
    rebuild,
    read,
    due: () => Date.now() >= nextCheck,
    retryLater: () => {
      nextCheck = Date.now() + 60_000;
    },
  };
}
