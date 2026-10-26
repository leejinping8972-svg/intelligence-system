import { createHash } from 'node:crypto';

export const defaultDailyPlan = {
  enabled: false,
  time: '09:00',
  timezone: 'Asia/Shanghai',
  markets: ['US', 'MX', 'VN'],
  providers: ['sorftime', 'semrush'],
  maxPages: 1,
  maxAds: 20,
  perKeyword: 10,
  adRequestBudget: 100,
  productRequestBudget: 100,
  semrushUnitBudget: 0,
};
export function validateDailyPlan(input) {
  const plan = { ...defaultDailyPlan, ...input, timezone: 'Asia/Shanghai', semrushUnitBudget: 0 };
  if (
    typeof plan.enabled !== 'boolean' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(plan.time)
  )
    throw new Error('请选择启用状态和有效的每日执行时间');
  for (const [key, allowed] of [
    ['markets', ['US', 'MX', 'VN']],
    ['providers', ['sorftime', 'semrush']],
  ]) {
    if (
      !Array.isArray(plan[key]) ||
      plan[key].length === 0 ||
      plan[key].some((v) => !allowed.includes(v))
    )
      throw new Error('请至少选择一个支持的市场和商品来源');
    plan[key] = [...new Set(plan[key])];
  }
  for (const [key, min, max] of [
    ['maxPages', 1, 10],
    ['maxAds', 1, 100],
    ['perKeyword', 1, 100],
    ['adRequestBudget', 1, 1000],
    ['productRequestBudget', 1, 10_000],
  ])
    if (!Number.isInteger(plan[key]) || plan[key] < min || plan[key] > max)
      throw new Error(`每日预算或采集数量超出范围：${key}`);
  if (plan.enabled && input.budgetAcknowledged !== true)
    throw new Error('启用前请确认每日采集可能消耗已配置来源额度');
  return Object.fromEntries(
    Object.keys(defaultDailyPlan).map((key) => [key, plan[key]]),
  );
}
export function beijingTime(now) {
  const value = new Date(now + 8 * 3_600_000).toISOString();
  return { day: value.slice(0, 10), time: value.slice(11, 16) };
}
export function dailyRequestId(day, kind, keywordId) {
  const hash = createHash('sha256')
    .update(`daily-discovery-v1:${day}:${kind}:${keywordId}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export function buildDailyRun(plan, keywords, now) {
  const { day } = beijingTime(now);
  const selected = keywords.filter(
    (k) =>
      k.reviewStatus === 'selected' &&
      k.dataNature !== 'demo' &&
      plan.markets.includes(k.market),
  );
  // Stable daily rotation shares a limited budget across a changing set of selected words.
  selected.sort((a, b) =>
    dailyRequestId(day, 'order', a.id).localeCompare(
      dailyRequestId(day, 'order', b.id),
    ),
  );
  const reserved = { ads: 0, products: 0, semrush: 0 };
  const work = [];
  for (const keyword of selected) {
    for (const kind of ['ads', 'products']) {
      const providers = plan.providers.filter(
        (p) => keyword.market !== 'VN' || p !== 'sorftime',
      );
      const requests =
        kind === 'ads'
          ? plan.maxPages
          : providers.reduce((sum, p) => sum + (p === 'semrush' ? 2 : 1), 0);
      const units =
        kind === 'products' && providers.includes('semrush')
          ? 20 + 30 * plan.perKeyword
          : 0;
      let reason = '';
      if (kind === 'products' && providers.length === 0)
        reason = '当前市场没有所选商品来源（Sorftime不支持越南）';
      else if (
        reserved[kind] + requests >
          (kind === 'ads' ? plan.adRequestBudget : plan.productRequestBudget)
      )
        reason = '超出每日预留预算，本日未排队；请调整预算以覆盖全部入选词';
      const entry = {
        kind,
        keywordId: keyword.id,
        term: keyword.term,
        market: keyword.market,
        providers,
        requestId: dailyRequestId(day, kind, keyword.id),
        requests,
        units,
        status: reason ? 'skipped' : 'pending',
        reason,
      };
      if (!reason) {
        reserved[kind] += requests;
        reserved.semrush += units;
      }
      work.push(entry);
    }
  }
  return {
    day,
    createdAt: new Date(now).toISOString(),
    plan,
    selectedCount: selected.length,
    reserved,
    work,
  };
}
export function dailySubmission(run, entry) {
  const plan = run.plan;
  return entry.kind === 'ads'
    ? {
        requestId: entry.requestId,
        kind: 'ads',
        keywordIds: [entry.keywordId],
        maxPages: plan.maxPages,
        maxAds: plan.maxAds,
        maxSites: 1,
        maxRequests: entry.requests,
        adStatus: 'ALL',
      }
    : {
        requestId: entry.requestId,
        terms: entry.term,
        discoveryDay: run.day,
        market: entry.market,
        providers: entry.providers,
        completeAll: false,
        enrich: false,
        trend: false,
        maxDetailProducts: 0,
        maxDomains: 1,
        maxProducts: plan.perKeyword * entry.providers.length,
        perKeyword: plan.perKeyword,
        maxRequests: entry.requests,
        semrushUnitLimit: 0,
      };
}
export async function stopPendingDailyWork(run, io, reason) {
  for (const entry of run.work.filter((e) => e.status === 'pending')) {
    const recovered = await io.findRequest?.(entry.requestId);
    if (recovered) {
      entry.jobId = recovered.id;
      entry.status = 'queued';
    } else {
      entry.status = 'skipped';
      entry.reason = reason;
    }
  }
}
export async function advanceDailyRun(run, io, now) {
  const today = beijingTime(now).day;
  // At most one scheduled child is outstanding. A provider problem stops the channel before the next paid job.
  for (const entry of run.work.filter(
    (e) => e.jobId && ['queued', 'running'].includes(e.status),
  )) {
    const job = await io.job(entry.jobId);
    entry.status = job?.status || 'failed';
    if (job?.cancelled) entry.status = 'cancelled';
    entry.reason =
      job?.checkpoint?.logs?.slice(-1)[0] || (job ? '' : '任务已移除');
    if (
      job &&
      ((job.checkpoint?.unknownCharges || 0) > 0 ||
        /401|403|429|额度|余额|鉴权|结果未知/.test(
          (job.checkpoint?.logs || []).join(' '),
        ))
    ) {
      for (const remaining of run.work.filter(
        (e) => e.kind === entry.kind && e.status === 'pending',
      )) {
        remaining.status = 'skipped';
        remaining.reason =
          '该渠道出现鉴权、额度、限流或未知扣费问题，停止本日后续自动调用';
      }
    }
  }
  if (today !== run.day)
    await stopPendingDailyWork(
      run,
      io,
      '已过本日执行窗口，不自动补跑历史收费任务',
    );
  if (run.work.some((e) => ['queued', 'running'].includes(e.status)))
    return run;
  const entry = run.work.find(
    (e) => e.status === 'pending' && (!e.retryAt || e.retryAt <= now),
  );
  if (!entry) return run;
  const recovered = await io.findRequest?.(entry.requestId);
  if (recovered) {
    entry.jobId = recovered.id;
    entry.status = 'queued';
    entry.reason = '恢复已保存的任务，本次未重复提交';
    return run;
  }
  const keyword = await io.keyword(entry.keywordId);
  if (
    !keyword ||
    keyword.reviewStatus !== 'selected' ||
    keyword.market !== entry.market ||
    keyword.term !== entry.term
  ) {
    entry.status = 'skipped';
    entry.reason = '关键词已取消入选、移除或发生变更';
    return run;
  }
  try {
    // The stable request ID recovers a submission committed before a scheduler crash.
    const job = await io.submit(entry.kind, dailySubmission(run, entry));
    entry.jobId = job.id;
    entry.status = job.cancelled ? 'cancelled' : job.status;
    entry.reason = '已提交后台；首次/最近发现和决策标签随采集结果保存';
  } catch (error) {
    entry.reason = error.message;
    if (/已有|正在|稍后|等待/.test(error.message)) entry.retryAt = now + 60_000;
    else entry.status = 'failed';
  }
  return run;
}
