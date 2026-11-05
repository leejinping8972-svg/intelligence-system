import { engine, lock, pool, putDocument, sql, unlock } from './database.mjs';
import { prepareSemrushSummary, usageQueries } from './semrush-usage.mjs';
import { prepareUsageSummary } from './source-usage-domain.mjs';
import { encodeUsageSnapshot } from './source-usage-snapshot.mjs';
import { readSourceEvents } from './source-usage.mjs';
import { retryUsageMarker, USAGE_DIRTY_NAME, USAGE_SUMMARY_NAME } from './usage-changes.mjs';

// One lease across processes. The captured dirty revision is saved with the
// result, never deleted/reset: changes during a build require another pass.
export function createUsageSummaryWorker(io) {
  let pending;
  let recovered = false;
  return () => {
    if (pending) return pending;
    pending = (async () => {
      const connection = await io.connect();
      let locked = false;
      let lost = false;
      const onError = () => { lost = true; };
      connection.on?.('error', onError);
      try {
        locked = await io.lock(connection);
        if (!locked) return false;
        const { dirty, saved } = await io.state(connection);
        if (recovered && saved?.summaryVersion === 1 && saved.generation === dirty)
          return false;
        const value = await io.build(connection);
        if (lost) throw new Error('Usage summary lease lost');
        await io.save({ ...value, summaryVersion: 1, generation: dirty }, connection);
        recovered = true;
        return true;
      } finally {
        try {
          if (locked) await io.unlock(connection);
        } finally {
          connection.removeListener?.('error', onError);
          connection.release();
        }
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}

export const updateUsageSummary = createUsageSummaryWorker({
  connect: () => pool.connect(),
  lock: (connection) => lock(connection, 'usage-summary'),
  unlock: (connection) => unlock(connection, 'usage-summary'),
  state: async (connection) => {
    await retryUsageMarker(connection, engine);
    const { rows } = await connection.query(
      `SELECT name,revision,${sql("CASE WHEN name=$2 THEN jsonb_build_object('summaryVersion',value->'summaryVersion','generation',value->'generation') ELSE '{}'::jsonb END", "CASE WHEN name=$2 THEN JSON_OBJECT('summaryVersion',JSON_EXTRACT(value,'$.summaryVersion'),'generation',JSON_EXTRACT(value,'$.generation')) ELSE JSON_OBJECT() END")} AS value FROM workspace_documents WHERE name IN ($1,$2)`,
      [USAGE_DIRTY_NAME, USAGE_SUMMARY_NAME],
    );
    return {
      dirty: String(rows.find((row) => row.name === USAGE_DIRTY_NAME)?.revision || 0),
      saved: rows.find((row) => row.name === USAGE_SUMMARY_NAME)?.value,
    };
  },
  build: buildUsageSummary,
  save: (value, connection) => putDocument('workspace_documents', USAGE_SUMMARY_NAME, value, false, connection),
});

export async function buildUsageSummary(connection) {
    const [events, research, monitor] = await Promise.all([
      readSourceEvents(connection),
      connection.query(sql(usageQueries.research.postgres, usageQueries.research.mysql)),
      connection.query(sql(usageQueries.monitor.postgres, usageQueries.monitor.mysql)),
    ]);
    const { events: ordered, aggregate } = prepareUsageSummary(events);
    const snapshot = await encodeUsageSnapshot({ events: ordered, checkedAt: new Date().toISOString() });
    return { ...snapshot, aggregate, semrush: prepareSemrushSummary(research.rows, monitor.rows) };
}

export function startUsageSummaryWorker(signal, update = updateUsageSummary) {
  let timer;
  const run = async () => {
    try { await update(); }
    catch (error) { console.warn('Usage summary update deferred', error.code || 'UPDATE_FAILED'); }
    if (!signal.aborted) timer = setTimeout(run, 15_000).unref();
  };
  signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (!signal.aborted) void run();
}
