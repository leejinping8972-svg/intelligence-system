import { createHash } from 'node:crypto';
import { healthCategoryKey, healthCategoryWork, HEALTH_COVERAGE_VERSION } from './health-category-domain.mjs';
import { stableId } from './discovery-monitor-domain.mjs';

const intakeKey = id => `intake:${createHash('sha256').update(id).digest('hex').slice(0, 24)}`;
export const healthRequestStep = (cp, step) => cp.healthRequestSteps?.[step] || step;
export const healthSourceStep = (cp, work) => cp.healthSourceSteps?.[`${healthCategoryKey(work)}:${work.page}`] ||
  `source:${stableId(JSON.stringify(work))}`;
export const isHealthDiscovery = job => job.input?.kind === 'discovery_monitor' &&
  job.input.plan?.healthCoverageVersion === HEALTH_COVERAGE_VERSION;

// Called under the job row lock. No requests or receipts are deleted. Only the
// latest confirmed failed step (or invalid analysis) gets a new attempt key.
export async function prepareHealthRetry(job, connection) {
  const cp = structuredClone(job.checkpoint);
  if (cp.work?.length || cp.pending?.length)
    throw new Error('任务仍有未完成内容，请先继续采集，再重试异常');
  const requestResult = await connection.query(
    'SELECT step,status,response,error FROM research_requests WHERE job_id=$1', [job.id],
  );
  const requests = requestResult.rows;
  if (requests.some(r => r.status === 'started')) throw new Error('任务存在结果未确认的请求，为避免重复扣费暂不能重试');
  const byStep = new Map(requests.map(r => [r.step, r]));
  const round = (cp.healthRetryRound || 0) + 1;
  const priorSteps = cp.healthRequestSteps || {};
  cp.healthRequestSteps = { ...priorSteps };
  const latest = step => byStep.get(priorSteps[step] || step);
  const retryStep = step => { cp.healthRequestSteps[step] = `retry:${round}:${step}`; };
  const allWork = healthCategoryWork(job.input.plan);
  cp.work = [];
  cp.healthSourceSteps = { ...cp.healthSourceSteps };
  const sourceHandled = new Set();
  for (const work of allWork) {
    const category = cp.healthCoverage?.[healthCategoryKey(work)];
    if (!category?.error) continue;
    // Legacy coverage stored only successful page count; the failed page was
    // the immediately following page. New runners also save its exact work.
    const failed = category.failedWork || { ...work, page: category.firstPage === 'failed' ? 1 : (category.pages || 0) + 1 };
    // MySQL/Pg JSON storage can reorder work keys. Match the legacy journal's
    // actual key before creating a retry; never guess a new request identity.
    const variants = [failed,
      Object.fromEntries(Object.entries(failed).toSorted(([a],[b]) => a.length - b.length || a.localeCompare(b))),
      Object.fromEntries(Object.entries(failed).toSorted(([a],[b]) => a.localeCompare(b)))];
    const step = [healthSourceStep(cp, failed), ...variants.map(w => `source:${stableId(JSON.stringify(w))}`)]
      .find(key => latest(key));
    if (!step) throw new Error('失败类目缺少请求记录，未创建重复请求');
    cp.healthSourceSteps[`${healthCategoryKey(failed)}:${failed.page}`] = step;
    sourceHandled.add(priorSteps[step] || step);
    retryStep(step);
    cp.work.push(failed);
  }
  const documentResult = await connection.query('SELECT name,value FROM workspace_documents WHERE name LIKE $1',
    [`discovery:health-candidate:${job.id}:%`]);
  const docs = documentResult.rows;
  const reviews = new Map(docs.filter(r => r.value.status === 'pending').map(r => [r.value.product.id, r.value]));
  const products = new Map();
  // The original category response is retained so product identity and the
  // frozen listing window survive enrichment and retries.
  for (const r of requests.filter(r => r.status === 'done' && (r.step.startsWith('source:') || /^retry:\d+:source:/.test(r.step))))
    for (const p of r.response?.products || []) products.set(p.id, p);
  for (const [id, review] of reviews) if (!products.has(id)) products.set(id, review.product);
  cp.pending = [];
  const handled = new Set();
  for (const [id, original] of products) {
    const key = intakeKey(id);
    const review = reviews.get(id);
    const baseSteps = new Set(requests.map(r => r.step.replace(/^retry:\d+:/, '')).filter(s => s.startsWith(`${key}:`)));
    const failedSteps = [...baseSteps].filter(s => latest(s)?.status === 'failed');
    if (!review && failedSteps.length === 0) continue;
    for (const step of failedSteps) { retryStep(step); handled.add(priorSteps[step] || step); }
    const forceAnalysis = Boolean(review && review.decision?.reason !== 'listing_or_sales_evidence_changed');
    if (forceAnalysis) for (const step of baseSteps) if (step.startsWith(`${key}:fields:`) &&
      !['accepted', 'excluded'].includes(latest(step)?.response?.analysis?.healthProduct?.status)) retryStep(step);
    const accepted = cp.accepted?.includes(id);
    let product = original;
    if (accepted) {
      const saved = await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [`business:products:${id}`]);
      product = saved.rows[0]?.value || original;
    }
    // A product seen from both conditional and unrestricted entries retains
    // unrestricted eligibility. New archives explicitly save this context.
    const powderOnly = review?.powderOnly ?? !(cp.seen || []).includes(`${id}:health`);
    const sellerOnly = Boolean(accepted && failedSteps.every(step => /:seller_(?:identity|detail):/.test(step)));
    cp.pending.push({ product, powderOnly, retry: true, accepted: Boolean(accepted), forceAnalysis, sellerOnly });
  }
  const unhandled = requests.filter(r => r.status === 'failed' &&
    (priorSteps[r.step.replace(/^retry:\d+:/, '')] || r.step.replace(/^retry:\d+:/, '')) === r.step &&
    !handled.has(r.step) && !sourceHandled.has(r.step));
  if (unhandled.length > 0) throw new Error('部分异常缺少可恢复的商品或类目资料，未重置任务，请检查请求记录');
  if (cp.work.length === 0 && cp.pending.length === 0) throw new Error('没有可重试的失败项或待确认商品');
  cp.healthFailureHistory = [...(cp.healthFailureHistory || []), {
    round, at: new Date().toISOString(), failures: cp.failures || [],
    categories: cp.work.length, products: cp.pending.length,
  }];
  cp.failures = [];
  cp.healthRetryRound = round;
  delete cp.finishedAt;
  delete cp.nextRunAt;
  cp.logs = [...(cp.logs || []), `仅重试异常（第${round}轮）：${cp.work.length}个失败类目、${cp.pending.length}件异常或待确认商品；成功请求复用，原时间范围保留`];
  return cp;
}
