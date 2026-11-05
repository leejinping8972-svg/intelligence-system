import { AsyncLocalStorage } from 'node:async_hooks';

import { putDocument, sql } from './database.mjs';

const context = new AsyncLocalStorage();
export const withAnalysisTask = (id, work) => context.run(id, work);
export const analysisTaskId = () =>
  typeof context.getStore() === 'string' ? context.getStore() : undefined;
export const analysisMonitor = () =>
  typeof context.getStore() === 'object' ? context.getStore() : undefined;
const phase = (status) =>
  status === 'partial' || status === 'failed'
    ? 'failed'
    : ['awaiting_review', 'completed'].includes(status)
      ? 'completed'
      : ['cancelled', 'queued', 'running'].includes(status)
        ? status
        : 'queued';
const number = (v) => Math.max(0, Number(v) || 0);

async function changeParent(connection, parentId, before, after) {
  const parent = (
    await connection.query(
      'SELECT input FROM research_jobs WHERE id=$1 FOR UPDATE',
      [parentId],
    )
  ).rows[0];
  if (!parent || parent.input?.kind === 'source_fields') return;
  const stats = { ...parent.input.sourceAnalysis };
  if (!before) stats.total = number(stats.total) + 1;
  else stats[before] = Math.max(0, number(stats[before]) - 1);
  stats[after] = number(stats[after]) + 1;
  await connection.query(
    'UPDATE research_jobs SET input=$2,updated_at=now() WHERE id=$1',
    [parentId, { ...parent.input, sourceAnalysis: stats }],
  );
}

const monitorKey = (owner) =>
  `source-analysis:monitor:${owner.monitorId}:${owner.day}`;
async function changeMonitor(connection, owner, before, after) {
  const name = monitorKey(owner);
  // Lock an existing key even for the first two concurrent analysis children.
  await connection.query(
    sql(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO NOTHING',
      'INSERT IGNORE INTO workspace_documents(name,value) VALUES($1,$2)',
    ),
    [name, { ...owner, sourceAnalysis: {} }],
  );
  const old = (
    await connection.query(
      'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
      [name],
    )
  ).rows[0]?.value;
  const stats = { ...old?.sourceAnalysis };
  if (!before) stats.total = number(stats.total) + 1;
  else stats[before] = Math.max(0, number(stats[before]) - 1);
  stats[after] = number(stats[after]) + 1;
  await putDocument(
    'workspace_documents',
    name,
    { ...owner, sourceAnalysis: stats },
    false,
    connection,
  );
}

async function transitionChild(connection, child) {
  const before = child.input.parentRecordedStatus || 'queued';
  const after = phase(child.cancelled ? 'cancelled' : child.status);
  if (before !== after) {
    for (const id of [...(child.input.parentJobIds || [])].sort())
      await changeParent(connection, id, before, after);
    for (const owner of child.input.parentMonitors || [])
      await changeMonitor(connection, owner, before, after);
    child.input = { ...child.input, parentRecordedStatus: after };
    await connection.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
      child.id,
      child.input,
    ]);
  }
}

// Called in the same transaction that creates/reuses the internal execution.
// A shared analysis can serve several collection tasks without another paid call.
export async function attachAnalysisParent(connection, child, parentId) {
  if (!parentId || parentId === child.id) return;
  await transitionChild(connection, child);
  const parents = child.input.parentJobIds || [];
  if (parents.includes(parentId)) return;
  const status = phase(child.cancelled ? 'cancelled' : child.status);
  await changeParent(connection, parentId, null, status);
  child.input = {
    ...child.input,
    parentJobIds: [...parents, parentId],
    parentRecordedStatus: status,
  };
  await connection.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
    child.id,
    child.input,
  ]);
}

export async function attachAnalysisMonitor(connection, child, owner) {
  if (!owner?.monitorId || !owner?.day) return;
  await transitionChild(connection, child);
  const monitors = child.input.parentMonitors || [];
  if (monitors.some((item) => monitorKey(item) === monitorKey(owner))) return;
  const status = phase(child.cancelled ? 'cancelled' : child.status);
  await changeMonitor(connection, owner, null, status);
  child.input = {
    ...child.input,
    parentMonitors: [...monitors, owner],
    parentRecordedStatus: status,
  };
  await connection.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
    child.id,
    child.input,
  ]);
}

export async function syncAnalysisStage(job, pool, existingConnection) {
  const connection = existingConnection || (await pool.connect());
  try {
    if (!existingConnection) await connection.query('BEGIN');
    const child = (
      await connection.query(
        'SELECT id,status,cancelled,input FROM research_jobs WHERE id=$1 FOR UPDATE',
        [job.id],
      )
    ).rows[0];
    if (child) await transitionChild(connection, child);
    if (!existingConnection) await connection.query('COMMIT');
  } catch (error) {
    if (!existingConnection) await connection.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (!existingConnection) connection.release();
  }
}

export function analysisSummary(input = {}) {
  const value = input.sourceAnalysis;
  if (!value?.total) return null;
  const summary = Object.fromEntries(
    ['total', 'queued', 'running', 'completed', 'failed', 'cancelled'].map(
      (key) => [key, number(value[key])],
    ),
  );
  summary.pending = summary.queued + summary.running;
  summary.processed = summary.completed + summary.failed + summary.cancelled;
  return summary;
}

export async function decorateMonitorAnalysis(runs, pool) {
  if (!runs.length) return runs;
  const names = [
    ...new Set(
      runs.map((run) => monitorKey({ monitorId: run.id, day: run.day })),
    ),
  ];
  const rows = (
    await pool.query(
      `SELECT name,value FROM workspace_documents WHERE name IN (${names.map((_, i) => `$${i + 1}`).join(',')})`,
      names,
    )
  ).rows;
  const byName = new Map(
    rows.map((row) => [row.name, analysisSummary(row.value)]),
  );
  return runs.map((run) => ({
    ...run,
    sourceAnalysis:
      byName.get(monitorKey({ monitorId: run.id, day: run.day })) || undefined,
  }));
}

export function analysisDisplayStatus(job) {
  if (job.cancelled) return 'cancelled';
  const stats = analysisSummary(job.input);
  const status = job.collection_status || job.status;
  if (
    ['awaiting_review', 'completed'].includes(status) &&
    job.checkpoint?.semBlocked &&
    !stats?.pending
  )
    return 'partial';
  if (!stats || !['awaiting_review', 'completed'].includes(status))
    return status;
  return stats.pending
    ? 'running'
    : stats.failed
      ? 'partial'
      : stats.cancelled
        ? 'partial'
        : status;
}

// Only the presentation status changes; the collection runner keeps its own state.
// Filtering, pagination, counts and active-priority all use the same expression.
export function visibleTaskSource(sql) {
  const field = (key) =>
    sql(
      `COALESCE((input->'sourceAnalysis'->>'${key}')::integer,0)`,
      `COALESCE(CAST(JSON_UNQUOTE(JSON_EXTRACT(input,'$.sourceAnalysis.${key}')) AS UNSIGNED),0)`,
    );
  const kind = sql(
    "COALESCE(input->>'kind','')",
    "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind')),'')",
  );
  return `(SELECT id,request_id,input,checkpoint,cancelled,created_at,updated_at,status AS collection_status,
    CASE WHEN cancelled THEN 'cancelled'
      WHEN status IN ('completed','awaiting_review') AND (${field('queued')}+${field('running')})>0 THEN 'running'
      WHEN status IN ('completed','awaiting_review') AND (${field('failed')}+${field('cancelled')})>0 THEN 'partial'
      WHEN status IN ('completed','awaiting_review') AND ${sql("COALESCE(checkpoint->>'semBlocked','')", "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(checkpoint,'$.semBlocked')),'')")}<>'' THEN 'partial'
      ELSE status END AS status
    FROM research_jobs WHERE ${kind}<>'source_fields') visible_jobs`;
}

export async function decorateAnalysisTasks(
  tasks,
  jobs,
  pool,
  sql,
  detail = false,
) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const results = [];
  for (let task of tasks) {
    const job = byId.get(task.cloudJobId);
    if (job) task = { ...task, canContinue: (job.collection_status || job.status) === 'partial' || Boolean(job.checkpoint?.semBlocked) };
    const summary = analysisSummary(job?.input);
    if (!summary) {
      results.push(task);
      continue;
    }
    const stage = `AI分析：完成 ${summary.completed}/${summary.total}，执行中 ${summary.running}，排队 ${summary.queued}，失败 ${summary.failed}，取消 ${summary.cancelled}`;
    const next = {
      ...task,
      status: analysisDisplayStatus(job),
      sourceAnalysis: summary,
      steps: [...task.steps, stage],
    };
    if (task.overview) {
      const base = task.overview;
      const total = base.total + summary.total;
      const processed = base.processed + summary.processed;
      const collected = ['awaiting_review', 'completed'].includes(
        job.collection_status || job.status,
      );
      next.overview = {
        ...base,
        status: next.status,
        total,
        processed,
        remaining: Math.max(0, total - processed),
        percent: total
          ? Math.min(100, Math.floor((100 * processed) / total))
          : null,
        succeeded:
          base.succeeded === null ? null : base.succeeded + summary.completed,
        failed: base.failed + summary.failed,
        outcome: collected
          ? summary.pending
            ? '采集完成 · AI分析未完成'
            : summary.failed || summary.cancelled
              ? '采集完成 · AI分析部分完成'
              : '采集与AI分析完成'
          : base.outcome,
        reason: [base.reason, stage].filter(Boolean).join('；'),
      };
    }
    if (detail) {
      const children = (
        await pool.query(
          sql(
            "SELECT id,status,cancelled,input,checkpoint FROM research_jobs WHERE input->>'kind'='source_fields' AND (input->'parentJobIds') ? $1 ORDER BY created_at,id LIMIT 1000",
            "SELECT id,status,cancelled,input,checkpoint FROM research_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind'))='source_fields' AND JSON_CONTAINS(JSON_EXTRACT(input,'$.parentJobIds'),JSON_QUOTE($1)) ORDER BY created_at,id LIMIT 1000",
          ),
          [job.id],
        )
      ).rows;
      next.collections = [
        ...(task.collections || []),
        ...children.map((child) => ({
          id: `analysis:${child.id}`,
          title: `AI分析 · ${(child.input.sample?.sources?.find((source) => source.id === 'title')?.text || child.input.targetId).slice(0, 160)}`,
          status: phase(child.cancelled ? 'cancelled' : child.status),
          done: ['cancelled', 'completed', 'failed'].includes(
            phase(child.cancelled ? 'cancelled' : child.status),
          )
            ? 1
            : 0,
          total: 1,
          message: child.checkpoint.logs?.at(-1) || '资料已保存，等待AI分析',
          executions: (child.checkpoint.logs || [])
            .slice(-10)
            .map((message) => ({
              message,
              status: child.status,
              step: 'AI字段分析',
              at: child.checkpoint.updatedAt || '',
            })),
        })),
      ];
      if (summary.total > children.length)
        next.steps.push(
          `AI分析共${summary.total}项，详情仅展示前${children.length}项`,
        );
    }
    results.push(next);
  }
  return results;
}

export async function cancelAnalysisChildren(parentId, pool, sql) {
  const children = (
    await pool.query(
      sql(
        "SELECT id,input FROM research_jobs WHERE input->>'kind'='source_fields' AND (input->'parentJobIds') ? $1 AND status IN ('queued','running','partial')",
        "SELECT id,input FROM research_jobs WHERE JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind'))='source_fields' AND JSON_CONTAINS(JSON_EXTRACT(input,'$.parentJobIds'),JSON_QUOTE($1)) AND status IN ('queued','running','partial')",
      ),
      [parentId],
    )
  ).rows;
  for (const child of children) {
    // A shared execution remains available to other uncancelled parents.
    if (child.input.parentMonitors?.length) continue;
    const others = child.input.parentJobIds.filter((id) => id !== parentId);
    if (others.length) {
      const live = await pool.query(
        `SELECT id FROM research_jobs WHERE cancelled=false AND id IN (${others.map((_, i) => `$${i + 1}`).join(',')}) LIMIT 1`,
        others,
      );
      if (live.rows.length) continue;
    }
    await pool.query(
      "UPDATE research_jobs SET cancelled=true,status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running','partial')",
      [child.id],
    );
    await syncAnalysisStage(child, pool);
  }
}
