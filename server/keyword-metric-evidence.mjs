// Repair the presentation of legacy blanket failures from saved request evidence.
// This reads only the referenced jobs; it never retries or rewrites a result.
export async function keywordMetricEvidence(records, pool, sql) {
  const ids = [
    ...new Set(
      records
        .filter((record) => record.semrushCollection?.status === 'failed')
        .map((record) => record.semrushCollection.jobId)
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return records;
  const field = (key) =>
    sql(
      `j.checkpoint->>'${key}'`,
      `JSON_UNQUOTE(JSON_EXTRACT(j.checkpoint,'$.${key}'))`,
    );
  const recordId = sql(
    "j.checkpoint->'keywords'->(split_part(r.step,':',2)::integer)->>'id'",
    "JSON_UNQUOTE(JSON_EXTRACT(j.checkpoint,CONCAT('$.keywords[',SUBSTRING_INDEX(r.step,':',-1),'].id')))",
  );
  const rows = (
    await pool.query(
      `SELECT j.id,${field('semBlocked')} AS blocked,${field('semBlockedError')} AS block_error,${field('logs')} AS logs,r.status,r.error,${recordId} AS keyword_id FROM research_jobs j LEFT JOIN research_requests r ON r.job_id=j.id AND r.step LIKE 'sem-metric:%' WHERE j.id IN (${ids.map((_, i) => `$${i + 1}`).join(',')})`,
      ids,
    )
  ).rows;
  const owners = new Map();
  for (const row of rows) {
    const owner = owners.get(row.id) || {
      reason: row.block_error || row.blocked || '',
      attempts: new Map(),
    };
    if (row.keyword_id) owner.attempts.set(row.keyword_id, row);
    owners.set(row.id, owner);
  }
  return records.map((record) => {
    const state = record.semrushCollection;
    const owner = state?.status === 'failed' && owners.get(state.jobId);
    if (!owner) return record;
    const attempt = owner.attempts.get(record.id);
    if (attempt?.status === 'failed')
      return {
        ...record,
        semrushCollection: {
          ...state,
          message: attempt.error || owner.reason || state.message,
        },
      };
    if (!attempt && owner.reason)
      return {
        ...record,
        semrushCollection: {
          ...state,
          status: 'not_started',
          finishedAt: undefined,
          message: `月搜索量未执行：${owner.reason}`,
        },
      };
    return record;
  });
}
