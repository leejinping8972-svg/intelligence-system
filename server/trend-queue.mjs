import { trendSeriesMessage } from './collector.js';
import { putDocument } from './database.mjs';
import { trendComparisons } from './model.js';
import { collect, pool, saveCheckpoint, saveKeyword } from './store.mjs';

export const RETRY_LIMIT = 5;
export const TREND_WINDOW = 24 * 60 * 60 * 1000;
export const finishedPart = (part) =>
  ['done', 'empty', 'failed'].includes(part.status);
export function retryDelay(
  attempt,
  retryAfterSeconds = 0,
  random = Math.random,
  limited = true,
) {
  const schedule = limited
    ? [120, 300, 900, 1800, 3600]
    : [30, 120, 300, 600, 1200];
  const header = Number(retryAfterSeconds);
  const base = Math.max(
    schedule[Math.min(Math.max(0, attempt - 1), 4)] * 1000,
    Number.isFinite(header) ? Math.max(0, header) * 1000 : 0,
  );
  return base + Math.floor(base * 0.1 * random());
}
export function errorPolicy(error) {
  const message = String(error?.message || '趋势采集失败');
  const status =
    Number(error?.httpStatus || error?.status) ||
    Number(message.match(/HTTP\s*(\d{3})/)?.[1]) ||
    0;
  const limited = status === 429 || /\b429\b|Too Many Requests/i.test(message);
  const transient =
    limited ||
    status >= 500 ||
    (!status &&
      /timeout|timed out|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|网络|超时|结果未知|请求未完成/i.test(
        message,
      ));
  return {
    message,
    status,
    limited,
    retry: transient,
    retryAfterSeconds: Number(error?.retryAfterSeconds) || 0,
  };
}
export function initializeTrendQueue(
  checkpoint,
  now = Date.now(),
  comparisonVersion = 0,
) {
  const cp = structuredClone(checkpoint);
  if (cp.trendQueueVersion === 1) return cp;
  const legacyIndex = cp.trendIndex || 0;
    const legacyRetries = cp.rateLimitRetries || 0;
  cp.trendQueueVersion = 1;
  cp.trendStartedAt = now;
  cp.trendDeadlineAt = now + TREND_WINDOW;
  cp.trendWork = (cp.keywords || []).map((r, i) => {
    const annual =
        comparisonVersion === 2
          ? r.trendHistoryPoints?.length > 0
          : r.series?.length > 0;
      const daily = r.trendDailyPoints?.length > 0;
    const prior = r.trendParts;
    const part = (has) => ({
      status: has ? 'done' : 'pending',
      attempts: 0,
      nextRunAt: 0,
      message: '',
    });
    const work = { annual: part(annual), daily: part(daily) };
    // Genuine empty responses are terminal data outcomes, including on later supplementation.
    for (const phase of ['annual', 'daily'])
      if (
        prior?.[phase]?.status === 'empty' &&
        (phase !== 'annual' ||
          comparisonVersion !== 2 ||
          prior[phase].comparisonVersion === 2)
      )
        work[phase].status = 'empty';
    if (
      i === legacyIndex &&
      legacyRetries &&
      /429/.test(`${r.trendMessage || ''} ${r.trendDailyMessage || ''}`)
    ) {
      const p = work[annual ? 'daily' : 'annual'];
      p.status = 'retry_wait';
      p.attempts = Math.min(legacyRetries, RETRY_LIMIT);
      p.nextRunAt = Math.max(now, Number(cp.nextRunAt) || 0);
      p.message = annual ? r.trendDailyMessage : r.trendMessage;
    }
    return work;
  });
  cp.trendBaseFailures =
    cp.upstreamFailures ??
    (cp.discoveryFailures || 0) + (cp.metricFailures || 0);
  if (!cp.trendBaseFailures)
    cp.trendBaseFailures =
      Number(Boolean(cp.semBlocked)) +
      (cp.keywords || []).filter((r) =>
        ['empty', 'failed', 'partial'].includes(r.semrushCollection?.status),
      ).length;
  cp.legacyTrendIndex = legacyIndex;
  cp.nextRunAt = 0;
  cp.waitReason = '';
  cp.rateLimitRetries = 0;
  delete cp.finishedAt;
  return cp;
}
export function nextTrendPart(cp, now = Date.now()) {
  const pending = [];
    const retries = [];
    const recover = [];
  for (const [index, work] of cp.trendWork.entries())
    for (const phase of ['annual', 'daily']) {
      const p = work[phase];
        const v = { index, phase, part: p };
      if (p.status === 'running') recover.push(v);
      else if (p.status === 'pending') pending.push(v);
      else if (p.status === 'retry_wait' && p.nextRunAt <= now) retries.push(v);
    }
  // New work advances; a due retry gets a fair slot at least every fourth dispatch.
  return (
    recover[0] ||
    ((cp.trendDispatches || 0) % 4 === 3
      ? retries[0] || pending[0]
      : pending[0] || retries[0])
  );
}
export function refreshTrendCheckpoint(cp, gate = {}, now = Date.now()) {
  const all = cp.trendWork.flatMap((w) => [w.annual, w.daily]);
  cp.trendIndex = cp.trendWork.filter(
    (w) => finishedPart(w.annual) && finishedPart(w.daily),
  ).length;
  cp.trendRetryPending = cp.trendWork.filter((w) =>
    [w.annual, w.daily].some((p) => p.status === 'retry_wait'),
  ).length;
  cp.trendAttention = cp.trendWork.filter((w) =>
    [w.annual, w.daily].some((p) => p.status === 'failed'),
  ).length;
  const active = all.filter((p) => !finishedPart(p));
  cp.failures = cp.trendBaseFailures + cp.trendAttention;
  if (active.length === 0) {
    cp.nextRunAt = 0;
    cp.waitReason = '';
    cp.currentTerm = '';
    cp.finishedAt = new Date(now).toISOString();
    return cp.failures ? 'partial' : 'awaiting_review';
  }
  const due = active.some((p) => ['pending', 'running'].includes(p.status))
    ? now
    : Math.min(...active.map((p) => p.nextRunAt));
  cp.nextRunAt = Math.min(
    cp.trendDeadlineAt,
    Math.max(due, Number(gate.until) || 0),
  );
  cp.waitReason =
    Number(gate.until) > now
      ? gate.reason || 'pacing'
      : due > now
        ? 'retry_queue'
        : '';
  return 'running';
}
export async function runTrendJob(job, overrides = {}) {
  const io = {
    collect,
    saveCheckpoint,
    saveKeyword,
    now: () => Date.now(),
    random: Math.random,
    getGate: async () =>
      (
        await pool.query(
          "SELECT value FROM provider_configs WHERE name='google-trends:gate'",
        )
      ).rows[0]?.value || {},
    setGate: (value) =>
      putDocument('provider_configs', 'google-trends:gate', value),
    checkCancelled: async () => {
      const r = (
        await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
          job.id,
        ])
      ).rows[0];
      if (!r || r.cancelled) throw new Error('任务已取消');
    },
    ...overrides,
  };
  const cp = initializeTrendQueue(
    job.checkpoint,
    io.now(),
    job.input.trendComparisonVersion,
  );
  cp.logs ||= [];
  try {
    await io.checkCancelled(job.id);
    if (io.now() >= cp.trendDeadlineAt) {
      for (const [i, w] of cp.trendWork.entries()) {
        for (const phase of ['annual', 'daily'])
          if (!finishedPart(w[phase]))
            Object.assign(w[phase], {
              status: 'failed',
              nextRunAt: 0,
              message: '超过24小时自动补齐期限，需人工重试；已有结果保留',
            });
        cp.keywords[i].trendParts = structuredClone(w);
        await io.saveKeyword(cp.keywords[i]);
      }
      cp.logs.push('自动补齐已达到24小时时限，剩余步骤转为需人工处理');
      return io.saveCheckpoint(
        job,
        cp,
        refreshTrendCheckpoint(cp, {}, io.now()),
      );
    }
    let gate = await io.getGate();
    if (Number(gate.until) > io.now())
      return io.saveCheckpoint(
        job,
        cp,
        refreshTrendCheckpoint(cp, gate, io.now()),
      );
    const item = nextTrendPart(cp, io.now());
    if (!item)
      return io.saveCheckpoint(
        job,
        cp,
        refreshTrendCheckpoint(cp, gate, io.now()),
      );
    const { index, phase, part } = item;
      const record = cp.keywords[index];
    if (part.status !== 'running') {
      part.attempts++;
      part.status = 'running';
    }
    cp.currentTerm = record.term;
    cp.trendCurrentPhase = phase;
    cp.nextRunAt = 0;
    cp.waitReason = '';
    // Persist attempt before dispatch. A restart reuses its journal key and cached response.
    await io.saveCheckpoint(job, cp);
    let updateGate = false;
    try {
      const data = await io.collect(
        job,
        `trend-v2:${index}:${phase}:${part.attempts}`,
        {
          sources: ['google_trends_part'],
          keywords: [record.term],
          markets: [record.market],
          trendPhase: phase,
          trendComparisonVersion: job.input.trendComparisonVersion,
        },
      );
      if (data.status === 'error')
        throw Object.assign(new Error(data.message), {
          httpStatus: data.httpStatus,
          retryAfterSeconds: data.retryAfterSeconds,
        });
      if (
        !['empty', 'success'].includes(data.status) ||
        !Array.isArray(data.points) ||
        data.phase !== phase ||
        data.market !== record.market ||
        String(data.keyword).toLowerCase() !== record.term.toLowerCase()
      )
        throw new Error('趋势接口返回内容不匹配，需人工核对');
      Object.assign(part, {
        status: data.points.length > 0 ? 'done' : 'empty',
        httpStatus: 0,
        nextRunAt: 0,
        message: data.message || '',
        collectedAt: data.collectedAt,
        comparisonVersion: job.input.trendComparisonVersion,
      });
      if (phase === 'annual')
        Object.assign(record, {
          series: data.points.map((p) => p.value),
          trendPoints: data.points,
          trendPeriod: data.period || 'today 12-m',
          trendResolution: data.resolution,
          trendSourceUrl: data.sourceUrl,
          trendCollectedAt: data.collectedAt,
          trendStatus: data.points.length > 0 ? 'collected' : 'empty',
          trendMessage: data.message || '已采集一年趋势',
          trendRegions: data.regions || [],
          trendRelatedTop: data.relatedTop || [],
          trendRelatedRising: data.relatedRising || [],
          trendInsightsStatus: data.insightsStatus || 'empty',
          trendInsightsMessage: data.insightsMessage || '',
          trendInsightsPeriod: data.insightsPeriod || data.period || '',
          ...(Array.isArray(data.historyPoints)
            ? {
                trendHistoryPoints: data.historyPoints,
                trendHistoryResolution: data.resolution,
                trendHistoryCollectedAt: data.collectedAt,
                trendHistorySourceUrl: data.sourceUrl,
              }
            : {}),
        });
      else
        Object.assign(record, {
          trendDailyPoints: data.points,
          trendDailyCollectedAt: data.collectedAt,
          trendDailyMessage:
            data.message || trendSeriesMessage(data.points.map((p) => p.value)),
        });
      record.growth = trendComparisons(record)[0].change;
      gate = {
        until: io.now() + 15_000 + Math.floor(io.random() * 3000),
        reason: 'pacing',
        consecutive429: 0,
      };
      updateGate = true;
      cp.logs.push(
        `${record.term} · ${phase === 'annual' ? '一年趋势' : '日趋势'}：${data.points.length}个时点；${part.message || '已保存'}`,
      );
    } catch (error) {
      const policy = errorPolicy(error);
      if (phase === 'annual') {
        record.trendMessage = policy.message;
        if (!record.series?.length) record.trendStatus = 'failed';
      } else record.trendDailyMessage = policy.message;
      const delay = retryDelay(
          part.attempts,
          policy.retryAfterSeconds,
          io.random,
          policy.limited,
        );
        const next = io.now() + delay;
      const retry =
        policy.retry &&
        part.attempts <= RETRY_LIMIT &&
        next < cp.trendDeadlineAt;
      Object.assign(part, {
        status: retry ? 'retry_wait' : 'failed',
        nextRunAt: retry ? next : 0,
        message: policy.message,
        httpStatus: policy.status,
      });
      if (policy.limited) {
        const consecutive = (gate.consecutive429 || 0) + 1;
        gate = {
          until:
            io.now() +
            retryDelay(consecutive, policy.retryAfterSeconds, io.random, true),
          reason: 'rate_limit',
          consecutive429: consecutive,
        };
        updateGate = true;
      }
      cp.logs.push(
        `${record.term} · ${phase === 'annual' ? '一年趋势' : '日趋势'}：${retry ? `已移入延迟队列，自动重试 ${part.attempts}/${RETRY_LIMIT}，${new Date(next).toISOString()}后再试` : '需人工处理'}；${policy.message}`,
      );
    }
    if (updateGate) await io.setGate(gate);
    record.trendParts = structuredClone(cp.trendWork[index]);
    record.updatedAt = new Date(io.now()).toISOString();
    const stored = await io.saveKeyword(record);
    if (stored?.id) record.id = stored.id;
    cp.trendDispatches = (cp.trendDispatches || 0) + 1;
    await io.checkCancelled(job.id);
    await io.saveCheckpoint(
      job,
      cp,
      refreshTrendCheckpoint(cp, gate, io.now()),
    );
  } catch (error) {
    try {
      await io.checkCancelled(job.id);
    } catch {
      return io.saveCheckpoint(job, cp, 'cancelled');
    }
    // Storage/transport failures must release the worker without losing the persisted attempt.
    throw error;
  }
}
