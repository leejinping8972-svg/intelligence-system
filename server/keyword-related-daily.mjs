import { dailyRequestId } from './daily-discovery-domain.mjs';
import {
  currentTrendPlan,
  trendDay,
  trendDigest,
} from './keyword-trends-domain.mjs';

export const RELATED_RUN = 'keyword-trends:related-run:';
const active = (entry) => ['queued', 'running'].includes(entry.status);
export function buildRelatedRun(plan, keywords, now) {
  const day = trendDay(now);
  const selected = keywords.filter(
    (k) =>
      k.reviewStatus === 'selected' &&
      k.dataNature !== 'demo' &&
      plan.markets.includes(k.market),
  );
  selected.sort((a, b) =>
    trendDigest(`${day}:${a.id}`).localeCompare(trendDigest(`${day}:${b.id}`)),
  );
  return {
    day,
    createdAt: new Date(now).toISOString(),
    plan,
    selectedCount: selected.length,
    work: selected.flatMap((keyword) =>
      plan.relatedSources.map((kind) => {
        const providers = plan.productProviders.filter(
          (p) => p !== 'sorftime' || keyword.market !== 'VN',
        );
        const reason =
          kind === 'products' && !providers.length
            ? '所选商品来源不支持该市场，未跨国替代'
            : '';
        return {
          key: `${keyword.id}:${kind}`,
          kind,
          keywordId: keyword.id,
          term: keyword.term,
          market: keyword.market,
          providers,
          status: reason ? 'skipped' : 'pending',
          reason,
          requestId: dailyRequestId(
            day,
            `selected-related-v1:${kind}`,
            keyword.id,
          ),
        };
      }),
    ),
  };
}
export function relatedSubmission(run, entry) {
  const p = run.plan;
  const common = { requestId: entry.requestId, keywordIds: [entry.keywordId] };
  if (entry.kind === 'sites')
    return { ...common, kind: 'sites', maxSites: p.relatedSites };
  if (entry.kind === 'ads')
    return {
      ...common,
      kind: 'ads',
      maxPages: p.relatedAdPages,
      maxAds: p.relatedAds,
      maxSites: p.relatedSites,
      includeSearchSites: false,
      adStatus: 'ACTIVE',
    };
  return {
    requestId: entry.requestId,
    terms: entry.term,
    market: entry.market,
    discoveryDay: run.day,
    providers: entry.providers,
    maxProducts: p.relatedProducts * entry.providers.length,
    perKeyword: p.relatedProducts,
    maxDomains: 1,
    maxDetailProducts: 0,
    completeAll: false,
    enrich: false,
    trend: false,
  };
}
function attachJob(entry, job) {
  entry.jobId = job.id;
  entry.status = job.cancelled ? 'cancelled' : job.status;
  entry.reason = job.checkpoint?.logs?.at(-1) || '已提交后台采集';
}
// Runs under the existing keyword-trends-runner guard. Only submits local jobs;
// provider execution and unknown-charge recovery remain in their original queues.
export async function advanceRelatedDaily(io) {
  const { db, now = Date.now() } = io;
  const day = trendDay(now);
  const plan = currentTrendPlan(await db.read('keyword-trends:plan'));
  let run = await io.latestRelatedRun();
  if (run) {
    const before = JSON.stringify(run);
    for (const entry of run.work.filter(active)) {
      const job = await io.relatedJob(entry.jobId);
      if (job) attachJob(entry, job);
      else
        Object.assign(entry, {
          status: 'failed',
          reason: '后台任务已移除，未重新提交',
        });
      if (
        job &&
        ((job.checkpoint?.unknownCharges || 0) > 0 ||
          /401|403|429|额度|余额|鉴权|结果未知/.test(
            (job.checkpoint?.logs || []).join(' '),
          ))
      ) {
        for (const other of run.work.filter(
          (e) => e.kind === entry.kind && e.status === 'pending',
        ))
          Object.assign(other, {
            status: 'skipped',
            reason: '该渠道出现额度、限流或未知结果问题，停止本日后续自动采集',
          });
      }
    }
    for (const entry of run.work.filter((e) => e.status === 'pending')) {
      const reason =
        run.day !== day
          ? '已跨日，不自动补跑历史采集'
          : !plan.enabled
            ? '每日计划已暂停'
            : !plan.relatedSources.includes(entry.kind)
              ? '该关联采集类型已关闭'
              : '';
      if (!reason) continue;
      const existing = await io.findRelatedRequest(entry.requestId);
      if (existing) attachJob(entry, existing);
      else Object.assign(entry, { status: 'skipped', reason });
    }
    if (JSON.stringify(run) !== before)
      await db.write(RELATED_RUN + run.day, run);
    if (run.work.some(active)) return;
  }
  const time = new Date(now + 8 * 3_600_000).toISOString().slice(11, 16);
  if (!run || run.day !== day) {
    if (!plan.enabled || !plan.relatedSources.length || time < plan.time)
      return;
    run = buildRelatedRun(plan, await io.keywords(), now);
    await db.write(RELATED_RUN + day, run);
  }
  if (!plan.enabled || run.day !== day) return;
  const entry = run.work.find(
    (e) => e.status === 'pending' && (!e.retryAt || e.retryAt <= now),
  );
  if (!entry) return;
  const existing = await io.findRelatedRequest(entry.requestId);
  if (existing) attachJob(entry, existing);
  else {
    const keyword = await io.relatedKeyword(entry.keywordId);
    if (
      !keyword ||
      keyword.reviewStatus !== 'selected' ||
      keyword.dataNature === 'demo' ||
      keyword.market !== entry.market ||
      keyword.term !== entry.term ||
      !plan.markets.includes(keyword.market)
    )
      Object.assign(entry, {
        status: 'skipped',
        reason: '关键词已取消入选、移除、变更或不在监测市场',
      });
    else
      try {
        attachJob(
          entry,
          await io.submitRelated(entry.kind, relatedSubmission(run, entry)),
        );
      } catch (error) {
        // The submit may have committed before its response was lost. The same
        // request ID is always recovered before any subsequent submission.
        entry.reason = error.message;
        const recovered = await io.findRelatedRequest(entry.requestId);
        if (recovered) attachJob(entry, recovered);
        else if (
          /已有|正在|稍后|等待|ECONN|connection|timeout|deadlock|数据库|网络/i.test(
            error.message,
          )
        )
          entry.retryAt = now + 60_000;
        else entry.status = 'failed';
      }
  }
  await db.write(RELATED_RUN + day, run);
}
