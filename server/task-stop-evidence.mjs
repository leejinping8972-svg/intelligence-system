import {
  checkpointStopReason,
  safeTaskError,
  unrecordedStopReason,
} from './task-stop-reason.mjs';

const stopped = (status) => ['failed', 'partial'].includes(status);
const collected = (job) =>
  ['awaiting_review', 'completed'].includes(
    job.collection_status || job.status,
  );
const summaryOnly = (reason) =>
  /历史记录未|本轮已停止，部分采集未完成/.test(reason || '');

// Enrich only the selected tasks, using saved journals and analysis children.
// This is a read model: it never changes a task or retries a provider request.
export async function decorateTaskStopEvidence(tasks, jobs, pool, sql) {
  const byId = new Map(jobs.map((job) => [job.id, job]));
  const selected = [
    ...new Set(
      tasks
        .filter((task) => stopped(task.status))
        .map((task) => task.cloudJobId)
        .filter((id) => byId.has(id)),
    ),
  ];
  if (!selected.length) return tasks;
  const reasons = new Map(selected.map((id) => [id, []]));
  const requestsFor = selected.filter(
    (id) =>
      !collected(byId.get(id)) &&
      !checkpointStopReason(byId.get(id).checkpoint || {}),
  );
  if (requestsFor.length) {
    const rows = (
      await pool.query(
        `SELECT job_id,step,status,error FROM research_requests WHERE job_id IN (${requestsFor.map((_, i) => `$${i + 1}`).join(',')}) AND status IN ('failed','started') ORDER BY job_id,step`,
        requestsFor,
      )
    ).rows;
    for (const row of rows) {
      const message =
        safeTaskError(row.error) ||
        (row.status === 'started'
          ? '请求结果未确认，未自动重放'
          : '请求失败，历史记录未保存具体错误');
      reasons.get(row.job_id)?.push(`采集步骤 ${row.step}：${message}`);
    }
  }
  const analysisFor = selected.filter((id) => {
    const stats = byId.get(id).input?.sourceAnalysis;
    return stats?.failed || stats?.cancelled;
  });
  if (analysisFor.length) {
    const conditions = analysisFor
      .map((_, i) =>
        sql(
          `(input->'parentJobIds') ? $${i + 1}`,
          `JSON_CONTAINS(JSON_EXTRACT(input,'$.parentJobIds'),JSON_QUOTE($${i + 1}))`,
        ),
      )
      .join(' OR ');
    const children = (
      await pool.query(
        `SELECT id,status,cancelled,checkpoint,${sql("input->'parentJobIds'", "JSON_EXTRACT(input,'$.parentJobIds')")} AS parent_ids FROM research_jobs WHERE ${sql("input->>'kind'", "JSON_UNQUOTE(JSON_EXTRACT(input,'$.kind'))")}='source_fields' AND (status IN ('partial','failed','cancelled') OR cancelled=true) AND (${conditions}) ORDER BY id`,
        analysisFor,
      )
    ).rows;
    const grouped = new Map();
    for (const child of children) {
      const cancelled = child.cancelled || child.status === 'cancelled';
      const message = cancelled
        ? '分析已取消，采集资料保留'
        : checkpointStopReason(child.checkpoint || {}) || unrecordedStopReason;
      for (const id of child.parent_ids || []) {
        if (!reasons.has(id)) continue;
        const key = `${id}:${cancelled ? 'cancelled' : 'failed'}:${message}`;
        const entry = grouped.get(key) || { id, cancelled, message, count: 0 };
        entry.count++;
        grouped.set(key, entry);
      }
    }
    for (const entry of [...grouped.values()].sort(
      (a, b) => Number(a.cancelled) - Number(b.cancelled),
    ))
      reasons
        .get(entry.id)
        .push(
          `AI分析${entry.cancelled ? '取消' : '失败'} ${entry.count}项：${entry.message}`,
        );
  }
  return tasks.map((task) => {
    const evidence = reasons.get(task.cloudJobId);
    if (!evidence || !task.overview) return task;
    const job = byId.get(task.cloudJobId);
    const messages = [...new Set(evidence)];
    let base = task.overview.reason || '';
    if (messages.length && summaryOnly(base))
      base = base
        .replace(unrecordedStopReason, '')
        .replace('本轮已停止，部分采集未完成；历史记录未提供更具体原因', '')
        .replace(/^；/, '');
    const own = collected(job)
      ? ''
      : checkpointStopReason(job.checkpoint || {});
    if (own && !base.includes(own)) messages.unshift(own);
    const reason =
      [
        ...messages.slice(0, 3),
        messages.length > 3
          ? `另有 ${messages.length - 3} 项异常/取消，详见处理步骤与执行记录`
          : '',
        base,
      ]
        .filter(Boolean)
        .join('；') || unrecordedStopReason;
    return {
      ...task,
      overview: { ...task.overview, reason },
      steps: [...task.steps],
    };
  });
}
