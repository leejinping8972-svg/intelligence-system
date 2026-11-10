import { healthCategoryWork, HEALTH_COVERAGE_VERSION, supportsHealthCoverage } from './health-category-domain.mjs';
import { checkpointFailureCount } from './task-stop-reason.mjs';

const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

// Project saved work without changing the execution checkpoint or request journal.
export function healthDiscoveryProgress(job) {
  const plan = job.input?.plan;
  if (job.input?.kind !== 'discovery_monitor' ||
      plan?.healthCoverageVersion !== HEALTH_COVERAGE_VERSION || !supportsHealthCoverage(plan)) return;
  const cp = job.checkpoint || {};
  const saved = Object.values(cp.healthCoverage || {});
  // Before the first execution the frozen plan already defines the full scope.
  const entries = saved.length > 0 ? saved : healthCategoryWork(plan).map(() => ({ firstPage: 'pending' }));
  const succeeded = entries.filter(c => c.firstPage === 'done').length;
  const failed = entries.filter(c => c.firstPage === 'failed').length;
  const processed = succeeded + failed;
  const remaining = entries.length - processed;
  const work = cp.work || [];
  const pending = cp.pending?.length || 0;
  let phase = '正在汇总结果';
  if (pending > 0) phase = '商品资料处理中';
  else if (remaining > 0) phase = '类目首屏查询中';
  else if (work.length > 0) phase = '后续分页采集中';
  return {
    categories: { total: entries.length, processed, succeeded, failed, remaining },
    pages: {
      processed: entries.reduce((n, c) => n + count(c.pages), 0),
      pending: work.filter(w => w.page > 1).length,
      failed: entries.filter(c => c.error).length,
      truncated: entries.filter(c => c.truncated).length,
    },
    products: {
      returned: count(cp.sourceRows), accepted: count(cp.products),
      excluded: count(cp.healthExcluded), review: count(cp.healthReviewCount), pending,
      evidenceSkipped: count(cp.healthEvidenceSkipped), limitSkipped: count(cp.healthLimitSkipped),
    },
    issues: checkpointFailureCount(cp.failures),
    remainingWork: saved.length > 0 ? work.length + pending : entries.length,
    phase,
  };
}
