const count = (value) =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
export function ingredientTrendProgress(job) {
  if (
    job.input?.kind !== 'discovery_monitor' ||
    job.input.plan?.sourceMode !== 'ingredient_trends'
  )
    return null;
  const cp = job.checkpoint || {},
    plan = job.input.plan;
  const operation = cp.operation || job.input.trendOperation || 'collect';
  const samples = cp.samples || [];
  const normalized = samples.map((sample) => ({
    observed: count(
      sample.observed ?? sample.runIds?.length ?? sample.ids?.length,
    ),
    pending:
      count(sample.pendingCount ?? sample.pending?.length) +
      (sample.pendingCount === undefined && sample.bufferedPage ? 1 : 0),
    blocked: Boolean(sample.blocked),
    visited: Boolean(
      sample.pages ||
      sample.observed ||
      sample.runIds?.length ||
      sample.ids?.length ||
      sample.blocked,
    ),
  }));
  const terminal =
    Boolean(job.cancelled) || !['queued', 'running'].includes(job.status);
  const waiting =
    !terminal &&
    operation === 'analyze' &&
    !cp.analysisRecords &&
    !cp.analysisRecordKeys &&
    Boolean(
      cp.waitingForCollectionId ||
      cp.logs?.at(-1) === '等待本监控的当日采集保存后再分析',
    );
  let total =
    operation === 'analyze'
      ? count(cp.analysisRecordCount ?? cp.analysisRecords?.length)
      : samples.length;
  if (operation === 'collect' && (cp.phase === 'posts' || !cp.phase)) total = 0;
  const processed =
    operation === 'analyze'
      ? Math.min(total, count(cp.analysisOffset))
      : normalized.filter(
          (sample) =>
            !sample.pending ||
            sample.blocked ||
            sample.observed >= plan.maxCommentsPerPost,
        ).length;
  const timings = {};
  for (const field of [
    'lastSourceMs',
    'lastProviderMs',
    'lastArchiveMs',
    'lastCheckpointMs',
    'lastQueueMs',
    'lastSchedulingMs',
  ])
    timings[field] = Number.isFinite(cp.timings?.[field])
      ? Math.max(0, Math.round(cp.timings[field]))
      : null;
  let phase = '帖子采集中';
  if (cp.phase === 'comments') phase = '评论回访中';
  if (cp.phase === 'done') phase = '每日采集结束';
  if (operation === 'analyze') {
    phase = total ? '周分析进行中' : '准备分析资料';
    if (cp.phase === 'done') phase = '周分析结束';
  }
  if (waiting) phase = '等待当日采集';
  return {
    operation,
    waiting,
    total,
    processed,
    percent:
      waiting || !total
        ? null
        : Math.min(terminal ? 100 : 99, Math.floor((processed / total) * 100)),
    phase,
    posts: count(cp.posts),
    newPosts: count(cp.newPosts),
    comments: count(
      cp.comments ??
        normalized.reduce((sum, sample) => sum + sample.observed, 0),
    ),
    commentPosts: samples.length,
    visitedPosts: normalized.filter((sample) => sample.visited).length,
    pendingPosts: normalized.filter((sample) => sample.pending > 0).length,
    blockedPosts: normalized.filter((sample) => sample.blocked).length,
    pages: Object.values(cp.communityPages || {}).reduce(
      (sum, pages) => sum + count(pages),
      0,
    ),
    requests: count(cp.sourceRequests),
    modelCalls: count(cp.modelCalls),
    timings,
  };
}
