import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

export const SOURCE_ANALYSIS_LOCK = 'source-fields-runner';
export const MAX_SOURCE_ANALYSIS_CONCURRENCY = 3;
export function sourceAnalysisConcurrency(
  value = process.env.SOURCE_FIELD_CONCURRENCY,
) {
  const number =
    value === undefined || value === ''
      ? MAX_SOURCE_ANALYSIS_CONCURRENCY
      : Number(value);
  return Number.isFinite(number)
    ? Math.max(1, Math.min(MAX_SOURCE_ANALYSIS_CONCURRENCY, Math.trunc(number)))
    : MAX_SOURCE_ANALYSIS_CONCURRENCY;
}
export function sourceAnalysisFilter(sql, analysis = true) {
  return sql(
    `COALESCE(input->>'kind','')${analysis ? '=' : '<>'}'source_fields'`,
    `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind')),'')${analysis ? '=' : '<>'}'source_fields'`,
  );
}

// One session owns the entire bounded batch. The deployment guard acquires this
// same lease and can only restart the API after all in-flight workers settle.
export async function runSourceAnalysisBatch(io, signal) {
  const connection = await io.pool.connect();
  let acquired = false;
  const lostConnection = io.onLeaseLost || (() => process.exit(1));
  try {
    acquired = await io.lock(connection, SOURCE_ANALYSIS_LOCK);
    if (!acquired || signal?.aborted) return { acquired, started: 0 };
    connection.on?.('error', lostConnection);
    const nextAt = io.sql(
      "COALESCE(checkpoint->>'nextRunAt','0')::bigint",
      "CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(checkpoint,'$.nextRunAt')),'0') AS UNSIGNED)",
    );
    const jobs = (
      await io.pool.query(
        `SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false AND ${sourceAnalysisFilter(io.sql)} AND ${nextAt}<=$1 ORDER BY updated_at,id LIMIT $2`,
        [(io.now || Date.now)(), sourceAnalysisConcurrency(io.concurrency)],
      )
    ).rows;
    let started = 0;
    const outcomes = await Promise.allSettled(
      jobs.map(async (job) => {
        if (signal?.aborted) return;
        const claimed = await io.pool.query(
          "UPDATE research_jobs SET status='running',updated_at=now() WHERE id=$1 AND status IN ('queued','running') AND cancelled=false",
          [job.id],
        );
        if (!claimed.rowCount || signal?.aborted) return;
        started++;
        await io.run({ ...job, status: 'running' });
      }),
    );
    for (const outcome of outcomes)
      if (outcome.status === 'rejected') io.onError?.(outcome.reason);
    return {
      acquired,
      started,
      failed: outcomes.filter((outcome) => outcome.status === 'rejected')
        .length,
    };
  } finally {
    if (acquired)
      await io.unlock(connection, SOURCE_ANALYSIS_LOCK).catch(() => {});
    connection.removeListener?.('error', lostConnection);
    connection.release();
  }
}

export async function runSourceAnalysisQueue(signal, io) {
  while (!signal.aborted) {
    try {
      await runSourceAnalysisBatch(io, signal);
    } catch (error) {
      io.onError?.(error);
    }
    await sleep(1500, undefined, { signal }).catch(() => {});
  }
}
