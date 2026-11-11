// Bounded operations for ingredient archives only; no configuration or usage
// marker writes are routed through this helper.
export function createTrendDocuments({ pool, sql }) {
  const chunks = (items, size = 150) => {
    const result = [];
    let batch = [],
      bytes = 0;
    for (const item of items) {
      const length = Buffer.byteLength(JSON.stringify(item));
      if (
        batch.length > 0 &&
        (batch.length >= size || bytes + length > 512_000)
      ) {
        result.push(batch);
        batch = [];
        bytes = 0;
      }
      batch.push(item);
      bytes += length;
    }
    if (batch.length > 0) result.push(batch);
    return result;
  };
  const readMany = async (names, connection = pool, locking = false) => {
    const result = new Map();
    for (const batch of chunks([...new Set(names)])) {
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await connection.query(
        `SELECT name,value FROM workspace_documents WHERE name IN (${placeholders})${locking ? ' ORDER BY name FOR UPDATE' : ''}`,
        batch,
      );
      for (const row of rows) result.set(row.name, row.value);
    }
    return result;
  };
  const writeMany = async (entries, connection = pool) => {
    for (const [name] of entries)
      if (!name.startsWith('ingredient-trend:'))
        throw new Error('Invalid ingredient archive key');
    for (const batch of chunks(entries)) {
      const placeholders = batch
        .map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`)
        .join(',');
      await connection.query(
        sql(
          `INSERT INTO workspace_documents(name,value) VALUES ${placeholders} ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,revision=workspace_documents.revision+1`,
          `INSERT INTO workspace_documents(name,value) VALUES ${placeholders} ON DUPLICATE KEY UPDATE value=VALUES(value),revision=revision+1`,
        ),
        batch.flat(),
      );
    }
  };
  return {
    readMany,
    writeMany,
    async transaction(work) {
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const result = await work({
          readMany: (names) => readMany(names, connection, true),
          writeMany: (entries) => writeMany(entries, connection),
        });
        await connection.query('COMMIT');
        return result;
      } catch (error) {
        await connection.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
  };
}
