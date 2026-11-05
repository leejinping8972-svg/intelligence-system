import { pool, sql } from './database.mjs';
import { restoreUsageSummary } from './source-usage-domain.mjs';
import { decodeUsageSnapshot } from './source-usage-snapshot.mjs';
import { USAGE_SUMMARY_NAME } from './usage-changes.mjs';

// Checking one revision is independent of journal size. A refresh only reloads
// saved data; this module has no journal reader or rebuild callback.
export function createSavedUsageReader({ revision, load, loadEvents }) {
  const states = new WeakMap();
  return async (connection, { events = false } = {}) => {
    const current = String(await revision(connection));
    let state = states.get(connection);
    if (!state || state.revision !== current) {
      state = { revision: current, value: Promise.resolve().then(() => load(connection)) };
      states.set(connection, state);
      state.value.catch(() => {
        if (states.get(connection) === state) states.delete(connection);
      });
    }
    const value = await state.value;
    if (value?.summaryVersion !== 1 || !value.semrush)
      throw new Error('消耗汇总尚未保存，后台正在整理，请稍后刷新');
    if (!events) return value;
    state.decoded ||= Promise.resolve(loadEvents ? loadEvents(connection) : value).then(async (full) => {
      const snapshot = await decodeUsageSnapshot(full);
      if (!snapshot || !full.aggregate) throw new Error('已保存消耗汇总暂不可用，请稍后重试');
      restoreUsageSummary(snapshot.events, full.aggregate);
      return { ...snapshot, aggregate: full.aggregate };
    }).catch((error) => {
      state.decoded = null;
      throw error;
    });
    return state.decoded;
  };
}

export const readSavedUsage = createSavedUsageReader({
  revision: async (connection) =>
    (await connection.query('SELECT revision FROM workspace_documents WHERE name=$1', [USAGE_SUMMARY_NAME])).rows[0]?.revision,
  load: async (connection) =>
    (await connection.query(
      `SELECT ${sql("jsonb_build_object('summaryVersion',value->'summaryVersion','checkedAt',value->'checkedAt','semrush',value->'semrush')", "JSON_OBJECT('summaryVersion',JSON_EXTRACT(value,'$.summaryVersion'),'checkedAt',JSON_EXTRACT(value,'$.checkedAt'),'semrush',JSON_EXTRACT(value,'$.semrush'))")} AS value FROM workspace_documents WHERE name=$1`,
      [USAGE_SUMMARY_NAME],
    )).rows[0]?.value,
  loadEvents: async (connection) =>
    (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [USAGE_SUMMARY_NAME])).rows[0]?.value,
});

export const readSavedSourceUsage = (connection = pool) =>
  readSavedUsage(connection, { events: true });
