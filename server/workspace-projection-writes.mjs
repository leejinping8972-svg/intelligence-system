const buckets = [
  'keywords',
  'products',
  'sites',
  'ads',
  'advertisers',
  'insightReports',
  'other',
];
export const projectionCollection = (item) =>
  item.kind === 'keywords'
    ? 'keywords'
    : item.source_key.slice(9).split(':')[0];

// Each transaction contains one list. Rotate even after a failed transaction.
export function createDirtyBatchReader() {
  let cursor = 0;
  return async (connection) => {
    for (let checked = 0; checked < buckets.length; checked++) {
      const bucket = buckets[cursor];
      cursor = (cursor + 1) % buckets.length;
      const condition =
        bucket === 'keywords'
          ? "kind='keywords'"
          : bucket === 'other'
            ? `kind='business' AND ${buckets
                .slice(1, -1)
                .map(() => 'source_key NOT LIKE $PLACEHOLDER')
                .join(' AND ')}`
            : "kind='business' AND source_key LIKE $1";
      let position = 0;
      const statement = condition.replaceAll(
        '$PLACEHOLDER',
        () => `$${++position}`,
      );
      const params =
        bucket === 'keywords'
          ? []
          : bucket === 'other'
            ? buckets.slice(1, -1).map((name) => `business:${name}:%`)
            : [`business:${bucket}:%`];
      const { rows } = await connection.query(
        `SELECT kind,source_key,revision FROM workspace_read_dirty WHERE ${statement} ORDER BY kind,source_key LIMIT 100`,
        params,
      );
      if (rows.length) return rows;
    }
    return [];
  };
}

const rowFailure = (error) =>
  /^(?:22|23)/.test(error.code || '') ||
  [
    'ER_BAD_NULL_ERROR',
    'ER_CHECK_CONSTRAINT_VIOLATED',
    'ER_DATA_TOO_LONG',
    'ER_DUP_ENTRY',
    'ER_TRUNCATED_WRONG_VALUE',
    'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
  ].includes(error.code);

export async function replaceProjections(
  connection,
  projected,
  replacements,
  save,
) {
  if (!replacements.length) return;
  const condition = replacements
    .map((_, i) => `(collection=$${i * 2 + 1} AND source_key=$${i * 2 + 2})`)
    .join(' OR ');
  const old = (
    await connection.query(
      `SELECT collection,id FROM workspace_read_rows WHERE ${condition}`,
      replacements.flat(),
    )
  ).rows;
  if (old.length)
    await connection.query(
      `DELETE FROM workspace_read_links WHERE ${old.map((_, i) => `(collection=$${i * 2 + 1} AND id=$${i * 2 + 2})`).join(' OR ')}`,
      old.flatMap((r) => [r.collection, r.id]),
    );
  await connection.query(
    `DELETE FROM workspace_read_rows WHERE ${condition}`,
    replacements.flat(),
  );
  await save(connection, projected);
}

// Retry local writes inside savepoints only; never run a collector or model here.
// A bad record keeps its last projection while the other records can commit.
export async function isolateProjectionWrites(
  connection,
  projected,
  replacements,
  save,
  failed,
) {
  if (!replacements.length) return [];
  await connection.query('SAVEPOINT projection_batch');
  try {
    await replaceProjections(connection, projected, replacements, save);
    await connection.query('RELEASE SAVEPOINT projection_batch');
    return replacements;
  } catch (error) {
    if (!rowFailure(error)) throw error;
    await connection.query('ROLLBACK TO SAVEPOINT projection_batch');
    await connection.query('RELEASE SAVEPOINT projection_batch');
  }
  const successful = [];
  for (const replacement of replacements) {
    await connection.query('SAVEPOINT projection_record');
    try {
      await replaceProjections(
        connection,
        projected.filter(
          (p) =>
            p.collection === replacement[0] && p.sourceKey === replacement[1],
        ),
        [replacement],
        save,
      );
      await connection.query('RELEASE SAVEPOINT projection_record');
      successful.push(replacement);
    } catch (error) {
      if (!rowFailure(error)) throw error;
      await connection.query('ROLLBACK TO SAVEPOINT projection_record');
      await connection.query('RELEASE SAVEPOINT projection_record');
      await failed(replacement, error);
    }
  }
  return successful;
}
