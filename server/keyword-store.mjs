import { cleanKeyword, naturalKey } from './domain.mjs';
import { mergeKeyword } from './keyword-data.mjs';

export function createKeywordSaver({ pool, sql }) {
  return async function saveKeyword(value, importOnly = false, connection) {
    const record = cleanKeyword(value);
    const key = naturalKey(record);
    const ownTransaction = !connection || connection === pool;
    const c = ownTransaction ? await pool.connect() : connection;
    try {
      if (ownTransaction) await c.query('BEGIN');
      // The unique natural key serializes both first inserts and concurrent reruns.
      await c.query(
        sql(
          'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2) ON CONFLICT(natural_key) DO NOTHING',
          'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2) ON DUPLICATE KEY UPDATE natural_key=natural_key',
        ),
        [key, record],
      );
      const current = (
        await c.query(
          'SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
          [key],
        )
      ).rows[0].data;
      const merged = mergeKeyword(current, record, importOnly);
      await c.query(
        'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
        [key, merged],
      );
      if (ownTransaction) await c.query('COMMIT');
      return merged;
    } catch (error) {
      if (ownTransaction) await c.query('ROLLBACK');
      throw error;
    } finally {
      if (ownTransaction) c.release();
    }
  };
}
