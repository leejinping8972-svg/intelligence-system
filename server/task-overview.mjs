import { createHash } from 'node:crypto';
const resourceKey = (w) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        w.routeId,
        w.provider,
        w.op,
        w.term,
        w.category?.id,
        w.url,
        w.domain,
        w.page,
        w.cursor,
        w.productId,
      ]),
    )
    .digest('hex');
const count = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const terminal = (status) =>
  ['awaiting_review', 'cancelled', 'completed', 'failed', 'partial'].includes(
    status,
  );
export function taskOverview(job, task) {
  const cp = job.checkpoint || {};
  const input = job.input || {};
  const c = task.researchProgress || task.collectionProgress;
  const p = task.progress;
  const state = job.cancelled ? 'cancelled' : job.status;
  let failed = count(cp.failures);
  let processed = count(c?.done);
  let succeeded = null;
  let total = count(c?.total);
  let waiting = count(c?.waiting);
  if (cp.personaProgress) {
    ({ total, processed, succeeded, failed } = cp.personaProgress);
  } else if (p) {
    total = count(p.total || input.limit);
    processed = count(p.processed);
    succeeded = count(
      p.succeeded ??
        p.rows?.filter((row) => ['collected', 'no_signal'].includes(row.status))
          .length ??
        Math.max(0, processed - p.failed),
    );
    failed = count(p.failed);
    waiting = count(p.retryPending);
  } else if (input.kind === 'products' && cp.siteWork) {
    total = input.records?.length || 0;
    succeeded = cp.siteWork.filter((w) =>
      ['completed', 'empty'].includes(w.status),
    ).length;
    failed = cp.siteWork.filter((w) =>
      ['blocked', 'failed', 'partial'].includes(w.status),
    ).length;
    processed = succeeded + failed;
    waiting = cp.siteWork.filter((w) => w.status === 'retry_wait').length;
  } else if (['evidence_analysis', 'market_analysis'].includes(input.kind)) {
    total = 1;
    processed = terminal(state) ? 1 : 0;
    succeeded = ['awaiting_review', 'completed'].includes(state) ? 1 : 0;
  } else {
    total ||=
      cp.work?.length ||
      input.records?.length ||
      (Array.isArray(input.urls) ? input.urls.length : 0) ||
      input.seeds?.length ||
      1;
    processed = Math.min(total, count(cp.index));
    if (['awaiting_review', 'completed'].includes(state)) processed = total;
    if (['awaiting_review', 'completed'].includes(state) && !failed)
      succeeded = total;
  }
  if (input.resourceDiscovery)
    failed = new Set(
      (cp.stopReasons || [])
        .filter((r) => r.status !== 'quantity_reached')
        .map((r) => r.key),
    ).size;
  const unknown = count(
    cp.personaProgress?.unknownCharges ??
      c?.unknownCharges ??
      cp.unknownCharges,
  );
  let reason =
    cp.personaProgress?.reason ||
    c?.stopReason ||
    cp.stopReason ||
    cp.error ||
    '';
  if (unknown)
    reason = '来源扣费或请求结果未确认，停止后续收费调用；已有结果保留';
  else if (state === 'cancelled')
    reason = '用户取消，当前请求结束后停止；已有结果保留';
  else if (['failed', 'partial'].includes(state) && !reason)
    reason =
      (cp.logs || []).findLast((l) =>
        /失败|异常|限流|上限|未完成|停止|未知|不足|未返回/.test(l),
      ) || '本轮已停止，部分采集未完成；历史记录未提供更具体原因';
  const reasons = {
    request_limit: '达到本次请求上限，剩余步骤未采集',
    rate_limit: '来源限流，等待冷却',
    paid_budget: '达到托管请求上限',
    browser_budget: '达到浏览器页数上限',
  };
  reason = reasons[reason] || reason;
  if (input.kind === 'persona_research' && state === 'completed') reason = '';
  const percent = total
    ? Math.min(100, Math.round((processed / total) * 100))
    : null;
  const elapsedStart = Date.parse(cp.startedAt || p?.startedAt || '');
  const elapsedEnd = Date.parse(cp.finishedAt || p?.finishedAt || '');
  return {
    status: state,
    total,
    processed: Math.min(total, processed),
    succeeded,
    failed,
    waiting,
    remaining: Math.max(0, total - processed),
    percent,
    outcome: ['failed', 'partial'].includes(state)
      ? '已停止 · 采集未完成'
      : state === 'cancelled'
        ? '已取消 · 结果保留'
        : state === 'queued'
          ? '已排队'
          : state === 'running'
            ? waiting
              ? '执行中 · 部分等待'
              : '正在执行'
            : ['awaiting_review', 'completed'].includes(state)
              ? '本次采集目标完成'
              : '状态待核对',
    reason,
    startedAt: cp.startedAt || p?.startedAt || '',
    finishedAt: cp.finishedAt || p?.finishedAt || '',
    elapsedSeconds:
      Number.isFinite(elapsedStart) && Number.isFinite(elapsedEnd)
        ? Math.max(0, Math.round((elapsedEnd - elapsedStart) / 1000))
        : null,
  };
}
const title = (w) =>
  w.domain || w.term || w.title || w.brand || w.productId || w.url || w.id;
export function taskCollections(job, task, requests = []) {
  const cp = job.checkpoint || {};
  const input = job.input || {};
  const p = task.progress;
  const status = job.cancelled ? 'cancelled' : job.status;
  let rows;
  if (cp.personaProgress?.rows) return cp.personaProgress.rows;
  if (p?.rows?.length)
    rows = p.rows.map((r, i) => ({
      id: r.id,
      title: r.term,
      market: r.market,
      index: i,
      status: r.status,
      done: ['collected', 'no_signal'].includes(r.status) ? 1 : 0,
      total: 1,
      message: r.message,
    }));
  else if (task.researchProgress?.rows?.length)
    rows = task.researchProgress.rows.map((r, i) => ({
      ...r,
      index: i,
      title: r.domain || r.brand,
      done: ['completed', 'empty'].includes(r.status) ? 1 : 0,
      total: 1,
    }));
  else {
    const candidates =
      cp.work ||
      input.initialWork ||
      input.records ||
      input.urls ||
      input.seeds;
    const works = Array.isArray(candidates)
      ? candidates
      : [input.title || '采集与分析'];
    rows = works.slice(0, 1000).map((w, i) => {
      const resourceId = input.resourceDiscovery ? resourceKey(w) : undefined;
      const stoppedAt =
        resourceId &&
        cp.stopReasons?.findLast((reason) => reason.key === resourceId);
      const current = i === (cp.index || 0);
      const done =
        i < (cp.index || 0) ||
        ['awaiting_review', 'completed'].includes(status);
      const stopped = terminal(status) && !done;
      return {
        id: resourceId || String(i),
        index: i,
        title: typeof w === 'string' ? w : title(w) || '采集步骤 ' + (i + 1),
        market: w.market,
        status:
          stoppedAt?.status ||
          (done
            ? 'processed'
            : stopped
              ? 'not_started'
              : current && status === 'running'
                ? 'running'
                : 'pending'),
        done: done ? 1 : 0,
        total: 1,
        message:
          stoppedAt?.message ||
          (typeof w === 'object'
            ? [w.provider, w.op, w.message].filter(Boolean).join(' · ')
            : ''),
      };
    });
  }
  const requestLog = cp.requestLog || task.researchProgress?.requestLog || [];
  const pending = [];
  const event = (r) => ({
    at: r.timing?.startedAt || r.created_at || '',
    step: r.step,
    status: r.status,
    message:
      r.status === 'failed'
        ? /429|Too Many Requests/i.test(r.error || '')
          ? '来源限流，未采集完成'
          : /401|403|登录|权限/.test(r.error || '')
            ? '来源登录或权限受限'
            : /未知|未确认|扣费/.test(r.error || '')
              ? '请求结果或扣费未确认，未重放'
              : '请求失败，已有结果保留'
        : '',
  });
  for (const request of requests) {
    const step = String(request.step);
    const prefix = step.split(':')[0];
    // Discovery indices refer to seed/market combinations, not result keywords.
    const supported = p
      ? ['trend-v2', 'trend', 'sem-metric']
      : input.resourceDiscovery
        ? []
        : [
            'platform',
            'ads',
            'domain',
            'sites',
            'metrics',
            'social',
            'transcript',
            'sem-sites',
          ];
    const match =
      supported.includes(prefix) && step.match(/^[^:]+:(\d+)(?::|$)/);
    const row =
      input.resourceDiscovery && prefix === 'resource'
        ? rows.find(
            (candidate) => candidate.id === step.slice('resource:'.length),
          )
        : match && rows[Number(match[1])];
    if (row) (row.executions ||= []).push(event(request));
    else pending.push(event(request));
  }
  for (const row of rows) {
    row.executions ||= [];
    for (const r of requestLog) {
      let host = '';
      try {
        host = new URL(r.url).hostname.replace(/^www\./, '');
      } catch {}
      if (row.domain === host || rows.length === 1)
        row.executions.push({
          at: r.at,
          status: r.status,
          httpStatus: r.httpStatus,
          message: r.message,
          step: r.url,
        });
    }
  }
  if (pending.length)
    rows.unshift({
      id: 'shared-execution',
      title: '前置发现与共用采集步骤',
      status: 'processed',
      done: pending.filter((r) => r.status !== 'started').length,
      total: pending.length,
      message: '这些记录不属于单个结果对象，按原步骤单独展示',
      executions: pending,
    });
  return rows;
}
