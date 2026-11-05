import { jobProgress } from './job-progress.mjs';
import { taskOverview } from './task-overview.mjs';

// Request rows are evidence of actual attempts. Older checkpoints walked the
// skipped remainder after a Semrush failure and counted it as processed.
export async function decorateKeywordTasks(tasks, jobs, pool) {
  const keywordJobs = jobs.filter(
    (job) => job.input?.expansionOnly && job.input.sources?.includes('semrush'),
  );
  if (!keywordJobs.length) return tasks;
  const requests = (
    await pool.query(
      `SELECT job_id,step,status FROM research_requests WHERE job_id IN (${keywordJobs.map((_, i) => `$${i + 1}`).join(',')}) AND step LIKE 'sem-metric:%'`,
      keywordJobs.map((job) => job.id),
    )
  ).rows;
  const byId = new Map(keywordJobs.map((job) => [job.id, {}]));
  for (const row of requests)
    byId.get(row.job_id)[row.step.slice('sem-metric:'.length)] = row.status;
  const projected = new Map(
    keywordJobs.map((job) => {
      const cp = job.checkpoint || {};
      const metricFailures =
        cp.metricFailures ??
        (cp.keywords || []).filter(
          (record) =>
            record.semrushCollection?.jobId === job.id &&
            record.semrushCollection.status === 'failed',
        ).length;
      const metricEvidence = byId.get(job.id);
      const status =
        !job.cancelled &&
        ['awaiting_review', 'completed'].includes(job.status) &&
        cp.semBlocked
          ? 'partial'
          : job.status;
      return [
        job.id,
        {
          ...job,
          status,
          checkpoint: {
            ...cp,
            metricIndex: Object.values(metricEvidence).filter((status) =>
              ['done', 'failed'].includes(status),
            ).length,
            metricEvidence,
            metricFailures,
          },
        },
      ];
    }),
  );
  return tasks.map((task) => {
    const job = projected.get(task.cloudJobId);
    if (!job) return task;
    const progress = jobProgress(job);
    const next = { ...task, status: job.status, progress };
    return { ...next, overview: taskOverview(job, next) };
  });
}
