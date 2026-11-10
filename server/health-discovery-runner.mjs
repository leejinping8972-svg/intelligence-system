import { healthCategoryKey, healthCategoryWork, HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';
import { healthProductDecision } from './health-product-domain.mjs';
import { newProductEvidence, stableId } from './discovery-monitor-domain.mjs';
import { prepareProductIntake } from './product-intake.mjs';
import { healthRequestStep, healthSourceStep } from './health-discovery-retry.mjs';

// Independent versioned runner: legacy frozen jobs retain their original work
// and journal keys. Each invocation makes at most one source page or intake.
export async function runHealthDiscovery(job, io) {
  const plan = job.input.plan;
  const cp = structuredClone(job.checkpoint);
  const collect = (task, step, request) => io.collect(task, healthRequestStep(cp, step), request);
  cp.asOf ||= io.now();
  cp.logs ||= [];
  cp.failures ||= [];
  cp.products ||= 0;
  cp.calls ||= 0;
  if (!cp.healthCoverage) {
    cp.work = healthCategoryWork(plan);
    cp.healthCoverage = Object.fromEntries(cp.work.map(w => [healthCategoryKey(w), {
      channel: w.channel, nodeId: w.nodeId, name: w.categoryName,
      powderOnly: w.powderOnly, firstPage: 'pending', pages: 0,
    }]));
  }
  cp.pending ||= [];
  cp.seen ||= [];
  cp.accepted ||= [];
  const cancelled = async () => {
    const result = await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [job.id]);
    return result.rows[0]?.cancelled;
  };
  const save = status => {
    cp.logs = cp.logs.slice(-200);
    cp.nextRunAt = io.now() + 1000;
    return io.saveCheckpoint(job, cp, status);
  };
  const review = async (product, decision, powderOnly) => {
    const name = `discovery:health-candidate:${job.id}:${stableId(product.id)}`;
    await io.putDocument('workspace_documents', name, {
      jobId: job.id, product, decision, powderOnly, asOf: cp.asOf, status: 'pending',
    }, false);
    cp.healthReviewIds ||= [];
    if (!cp.healthReviewIds.includes(product.id)) cp.healthReviewIds.push(product.id);
    cp.healthReviewCount = cp.healthReviewIds.length;
    cp.logs.push(`${product.title?.slice(0, 60) || product.id}：保健品资料待确认，原始资料已保留`);
  };
  const resolveReview = async (product, decision) => {
    if (!cp.healthReviewIds?.includes(product.id)) return;
    await io.putDocument('workspace_documents', `discovery:health-candidate:${job.id}:${stableId(product.id)}`, {
      jobId: job.id, product, decision, asOf: cp.asOf, status: decision.status,
    }, false);
    cp.healthReviewIds = cp.healthReviewIds.filter(id => id !== product.id);
    cp.healthReviewCount = cp.healthReviewIds.length;
  };
  try {
    if (await cancelled()) return save('cancelled');
    if (cp.products >= plan.maxProducts && cp.pending.length > 0) {
      const skipped = cp.pending.filter(p => !p.accepted);
      cp.healthLimitSkipped = (cp.healthLimitSkipped || 0) + skipped.length;
      cp.pending = cp.pending.filter(p => p.accepted);
    }
    // Drain each paid page before requesting another; rejected candidates do
    // not consume the accepted-product allowance.
    if (cp.pending.length > 0) {
      const { product, powderOnly, retry, accepted, forceAnalysis, sellerOnly } = cp.pending[0];
      if (cp.accepted.includes(product.id) && !retry) cp.pending.shift();
      else {
        cp.calls++;
        const prepared = await prepareProductIntake(job, product, { ...io, collect, isCancelled: cancelled }, {
          healthProductPolicy: HEALTH_PRODUCT_POLICY, forceAnalysis, skipAnalysis: accepted, sellerOnly,
        });
        // Keep the candidate on cancellation. Recovery reuses journal receipts.
        if (await cancelled()) return save('cancelled');
        cp.failures.push(...prepared.errors);
        const decision = healthProductDecision(prepared.analysis, powderOnly);
        if (accepted) {
          await io.upsertProduct(prepared.product);
        } else if (decision.status === 'accepted') {
          const evidence = newProductEvidence(prepared.product, plan, cp.asOf);
          if (evidence) {
            await io.upsertProduct({ ...prepared.product,
              newProductClassifications: [{ ...evidence, healthProduct: decision }],
            });
            cp.accepted.push(product.id);
            cp.products++;
            await resolveReview(prepared.product, decision);
          } else {
            await review(prepared.product, { status: 'pending', reason: 'listing_or_sales_evidence_changed' }, powderOnly);
          }
        } else if (decision.status === 'pending') await review(prepared.product, decision, powderOnly);
        else {
          cp.healthExcluded = (cp.healthExcluded || 0) + 1;
          await resolveReview(prepared.product, decision);
        }
        cp.pending.shift();
      }
      return save('running');
    }
    // Always attempt every category's first page, even after the pool limit.
    // Additional pages stop at the limit and are explicitly marked incomplete.
    while (cp.work.length > 0 && cp.products >= plan.maxProducts && cp.work[0].page > 1) {
      const skipped = cp.work.shift();
      cp.healthCoverage[healthCategoryKey(skipped)].truncated = 'product_limit';
    }
    if (cp.work.length === 0) {
      const incomplete = cp.failures.length > 0 || cp.healthReviewCount || cp.healthLimitSkipped ||
        Object.values(cp.healthCoverage).some(c => c.firstPage !== 'done' || c.error || c.truncated);
      cp.finishedAt = new Date(io.now()).toISOString();
      return save(incomplete ? 'partial' : 'completed');
    }
    const work = cp.work[0];
    const category = cp.healthCoverage[healthCategoryKey(work)];
    cp.calls++;
    try {
      const result = await collect(job, healthSourceStep(cp, work), {
        ...plan, ...work, sources: ['discovery_sorftime'], sorftimeRequestLimit: 1,
        social: false, now: cp.asOf,
      });
      if (await cancelled()) return save('cancelled');
      cp.sourceRows = (cp.sourceRows || 0) + (result.sourceRows || 0);
      cp.filterStats ||= {};
      for (const [reason, count] of Object.entries(result.filterStats || {}))
        cp.filterStats[reason] = (cp.filterStats[reason] || 0) + count;
      if (!Array.isArray(result.products)) throw new Error('来源未返回可识别的商品列表');
      if (result.sourceRows > 0 && result.products.length === 0)
        throw new Error('来源返回资料但没有可识别商品，未记为零新品');
      category.pages++;
      delete category.error;
      delete category.failedWork;
      if (work.page === 1) category.firstPage = 'done';
      category.rows = (category.rows || 0) + (result.sourceRows || 0);
      for (const product of result.products) {
        if (!newProductEvidence(product, plan, cp.asOf)) {
          cp.healthEvidenceSkipped = (cp.healthEvidenceSkipped || 0) + 1;
          continue;
        }
        // Conditional entries cannot suppress a later unrestricted match.
        const key = `${product.id}:${work.powderOnly ? 'powder' : 'health'}`;
        if (cp.seen.includes(key) || cp.accepted.includes(product.id)) continue;
        cp.seen.push(key);
        if (cp.products >= plan.maxProducts) {
          cp.healthLimitSkipped = (cp.healthLimitSkipped || 0) + 1;
          continue;
        }
        cp.pending.push({ product, powderOnly: work.powderOnly });
      }
      cp.pageFingerprints ||= {};
      const fingerprints = cp.pageFingerprints[healthCategoryKey(work)] ||= [];
      const repeated = result.pageFingerprint && fingerprints.includes(result.pageFingerprint);
      if (result.pageFingerprint) fingerprints.push(result.pageFingerprint);
      if (result.hasMore) {
        if (repeated) category.truncated = 'repeated_page';
        else if (work.page >= plan.maxPages) category.truncated = 'page_limit';
        else cp.work.push({ ...work, page: work.page + 1 });
      } else category.complete = true;
      cp.logs.push(`${work.channel} · ${work.categoryName} · 第${work.page}页：来源${result.sourceRows || 0}条`);
    } catch (error) {
      category.error = String(error.message).slice(0, 500);
      category.failedWork = work;
      if (work.page === 1) category.firstPage = 'failed';
      cp.failures.push(`${work.channel} · ${work.categoryName}: ${category.error}`);
    }
    cp.work.shift();
    return save('running');
  } catch (error) {
    // Persist the unprocessed work; do not turn an unknown request into success.
    cp.failures.push(String(error.message).slice(0, 600));
    return save('partial');
  }
}
