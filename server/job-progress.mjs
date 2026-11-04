import { trendComparisons } from './model.js';
import { naturalKey } from './domain.mjs';

const terminalStates = new Set([
  'awaiting_review',
  'completed',
  'partial',
  'cancelled',
]);
export const isRateLimited = (message) =>
  /\b429\b|Too Many Requests/i.test(String(message || ''));
export function trendNeedsRetry(record) {
  if (record.trendParts)
    return ['annual', 'daily'].some(
      (phase) => !['done', 'empty'].includes(record.trendParts[phase]?.status),
    );
  return (
    !record.series?.length ||
    /失败|HTTP\s*[45]\d\d|未完成/.test(record.trendDailyMessage || '')
  );
}
export function retryRecords(previousRecords, currentRecords) {
  const keys = new Set(previousRecords.map(naturalKey));
  return currentRecords.filter(
    (record) => keys.has(naturalKey(record)) && trendNeedsRetry(record),
  );
}
export function jobProgress(
  job,
  assess = () => ({ status: 'pending' }),
  now = Date.now(),
) {
  const cp = job.checkpoint || {};
  if (cp.trendQueueVersion === 1) return asyncTrendProgress(job, assess, now);
  const records = cp.keywords || job.input.existingRecords || [];
  const terminal = terminalStates.has(job.cancelled ? 'cancelled' : job.status);
  const discoveryTotal = job.input.existingRecords
    ? 0
    : job.input.seeds.length * job.input.markets.length;
  const discoveryDone =
    cp.discoveryComplete || (terminal && !job.cancelled)
      ? discoveryTotal
      : Math.min(cp.discoveryIndex || 0, discoveryTotal);
  const processed = Math.min(cp.trendIndex || 0, records.length);
  const waiting = !terminal && Number(cp.nextRunAt) > now;
  const phase = terminal
    ? 'finished'
    : job.status === 'queued'
      ? 'queued'
      : waiting
        ? 'waiting'
        : discoveryDone < discoveryTotal
          ? 'discovery'
          : job.input.sources.includes('semrush') &&
              (cp.metricIndex || 0) < records.length
            ? 'metrics'
            : 'trends';
  const rows = records.map((record, index) => {
    const annual = Boolean(record.series?.length);
    const daily = Boolean(record.trendDailyPoints?.length);
    const reason = [
      ...new Set(
        [record.trendMessage, record.trendDailyMessage].filter(Boolean),
      ),
    ].join('；');
    const attempted = index < processed;
    const limited =
      (attempted || terminal || index === processed) && isRateLimited(reason);
    const retrying =
      !terminal && index === processed && cp.waitReason === 'rate_limit';
    const failed =
      (attempted || terminal) && (!annual || trendNeedsRetry(record));
    const notStarted =
      terminal && !attempted && !annual && record.trendStatus === 'pending';
    const noSignal = annual && !record.series.some((value) => value > 0);
    return {
      id: record.id,
      term: record.term,
      market: record.market,
      annualPoints: record.series?.length || 0,
      dailyPoints: record.trendDailyPoints?.length || 0,
      growth: trendComparisons(record)[0].change,
      assessment: assess(record).status,
      status: notStarted
        ? 'not_started'
        : retrying
          ? 'retrying'
          : failed
            ? limited
              ? 'limited'
              : 'failed'
            : attempted || terminal
              ? noSignal
                ? 'no_signal'
                : 'collected'
              : index === processed && phase === 'trends'
                ? 'running'
                : 'pending',
      message: notStarted
        ? '任务提前停止，本词尚未执行，可重试未完成趋势'
        : reason,
      annual,
      daily,
      limited,
      failed,
    };
  });
  const expansionOnly = Boolean(job.input.expansionOnly);
  const expansionFinished =
    expansionOnly && terminal && !job.cancelled;
  const semrushEnabled = job.input.sources.includes('semrush');
  const metricProcessed = Math.min(cp.metricIndex || 0, records.length);
  const expansionMetricsDone =
    !semrushEnabled ||
    Boolean(cp.semBlocked) ||
    metricProcessed >= records.length;
  const expansionPhase =
    expansionOnly && !terminal
      ? waiting
        ? 'waiting'
        : discoveryDone < discoveryTotal
          ? 'discovery'
          : semrushEnabled && !expansionMetricsDone
            ? 'metrics'
            : 'discovery'
      : phase;
  const expansionRows = expansionOnly
    ? records.map((record, index) => {
        const metric = record.semrushCollection;
        const metricFailed = metric?.status === 'failed';
        const metricDone = ['completed', 'partial', 'empty'].includes(
          metric?.status,
        );
        const skipped =
          Boolean(cp.semBlocked) &&
          index >= metricProcessed &&
          !metricFailed &&
          !metricDone;
        const running =
          !terminal &&
          expansionPhase === 'metrics' &&
          index === metricProcessed &&
          !cp.semBlocked;
        let status = 'pending';
        if (metricFailed) status = 'failed';
        else if (skipped) status = 'not_started';
        else if (running) status = 'running';
        else if (semrushEnabled && discoveryDone >= discoveryTotal) {
          if (metricDone) status = 'collected';
          else if (expansionFinished || Boolean(cp.semBlocked))
            status = 'not_started';
          else status = 'pending';
        } else if (discoveryDone >= discoveryTotal || terminal)
          status = 'collected';
        return {
          id: record.id,
          term: record.term,
          market: record.market,
          annualPoints: record.series?.length || 0,
          dailyPoints: record.trendDailyPoints?.length || 0,
          growth: trendComparisons(record)[0].change,
          assessment: assess(record).status,
          status,
          message:
            metric?.message ||
            (skipped
              ? 'Semrush 已阻断，本词指标未查询'
              : record.trendMessage || ''),
          annual: Boolean(record.series?.length),
          daily: Boolean(record.trendDailyPoints?.length),
          limited: false,
          failed: metricFailed,
        };
      })
    : rows;
  const expansionSucceeded = expansionRows.filter((row) =>
    ['collected', 'no_signal'].includes(row.status),
  ).length;
  const expansionFailed = expansionRows.filter((row) => row.failed).length;
  const expansionProcessed = expansionFinished
    ? records.length
    : discoveryDone < discoveryTotal
      ? records.length
      : semrushEnabled
        ? Boolean(cp.semBlocked)
          ? records.length
          : metricProcessed
        : records.length;
  const percent =
    (expansionFinished ||
      (terminal && !job.cancelled && processed === records.length))
      ? 100
      : phase === 'queued'
        ? 0
        : discoveryDone < discoveryTotal
          ? Math.floor((20 * discoveryDone) / discoveryTotal)
          : expansionOnly
            ? 20 +
              (semrushEnabled
                ? Math.floor(
                    (80 *
                      (Boolean(cp.semBlocked)
                        ? records.length
                        : metricProcessed)) /
                      Math.max(1, records.length),
                  )
                : 80)
            : 20 +
              (semrushEnabled
                ? Math.floor(
                    (20 * metricProcessed) / Math.max(1, records.length),
                  ) + Math.floor((60 * processed) / Math.max(1, records.length))
                : Math.floor((80 * processed) / Math.max(1, records.length)));
  const target =
    Number.isInteger(job.input.limit) && job.input.limit > 0
      ? job.input.limit
      : Math.max(records.length, discoveryTotal);
  return {
    phase: expansionOnly ? expansionPhase : phase,
    semrushUnits: cp.semUnits || 0,
    metricProcessed,
    semrushEnabled,
    percent,
    terminal,
    target,
    discovered: records.length,
    discoveryDone,
    discoveryTotal,
    processed: expansionOnly ? expansionProcessed : processed,
    total: records.length,
    succeeded: expansionOnly ? expansionSucceeded : undefined,
    annualAvailable: expansionRows.filter((row) => row.annual).length,
    dailyAvailable: expansionRows.filter((row) => row.daily).length,
    failed: expansionOnly
      ? expansionFailed
      : rows.filter((row) => row.failed).length,
    limited: expansionRows.filter((row) => row.limited).length,
    noSignal: expansionRows.filter((row) => row.status === 'no_signal').length,
    rated: expansionRows.filter((row) => row.assessment !== 'pending').length,
    shortfall:
      Number.isInteger(job.input.limit) && job.input.limit > 0
        ? Math.max(0, job.input.limit - records.length)
        : 0,
    nextRunAt: waiting ? new Date(cp.nextRunAt).toISOString() : '',
    waitReason: waiting ? cp.waitReason : '',
    retryAttempt: cp.rateLimitRetries || 0,
    currentTerm: terminal ? '' : cp.currentTerm || '',
    startedAt: cp.startedAt || '',
    // Older jobs did not record an explicit UTC lifecycle time. Do not invent it
    // from a database DATETIME whose session timezone may differ after migration.
    finishedAt: cp.finishedAt || '',
    updatedAt: cp.updatedAt || '',
    rows: expansionOnly ? expansionRows : rows,
  };
}

function asyncTrendProgress(job, assess, now) {
  const cp = job.checkpoint,
    records = cp.keywords || [],
    work = cp.trendWork || [];
  const terminal = terminalStates.has(job.cancelled ? 'cancelled' : job.status);
  const finished = (p) => ['done', 'empty', 'failed'].includes(p?.status);
  const rows = records.map((record, index) => {
    const w = work[index] || {},
      parts = [w.annual, w.daily].filter(Boolean);
    const retry = parts.filter((p) => p.status === 'retry_wait'),
      running = parts.some((p) => p.status === 'running');
    const failed = parts.some((p) => p.status === 'failed'),
      done = parts.length === 2 && parts.every(finished);
    const noSignal =
      done &&
      !failed &&
      (!record.series?.length || !record.series.some((v) => v > 0));
    const untouched =
      parts.every((p) => p.status === 'pending') &&
      !record.series?.length &&
      !record.trendDailyPoints?.length;
    const nextRetryAt = retry.length
      ? new Date(
          Math.max(
            Math.min(...retry.map((p) => p.nextRunAt)),
            cp.waitReason === 'rate_limit' ? cp.nextRunAt : 0,
          ),
        ).toISOString()
      : '';
    const status = retry.length
      ? 'retrying'
      : running
        ? 'running'
        : failed
          ? 'failed'
          : done
            ? noSignal
              ? 'no_signal'
              : 'collected'
            : untouched
              ? 'pending'
              : 'in_progress';
    return {
      id: record.id,
      term: record.term,
      market: record.market,
      annualPoints: record.series?.length || 0,
      dailyPoints: record.trendDailyPoints?.length || 0,
      growth: trendComparisons(record)[0].change,
      assessment: assess(record).status,
      status,
      annual: Boolean(record.series?.length),
      daily: Boolean(record.trendDailyPoints?.length),
      failed,
      limited: parts.some((p) => p.httpStatus === 429),
      nextRetryAt,
      retryAttempts: Math.max(
        0,
        ...parts.map((p) => Math.max(0, (p.attempts || 0) - 1)),
      ),
      annualStatus: w.annual?.status || 'pending',
      dailyStatus: w.daily?.status || 'pending',
      message: [
        ['一年', w.annual],
        ['日趋势', w.daily],
      ]
        .map(
          ([label, p]) =>
            `${label}：${p?.message || { pending: '待执行', running: '采集中', done: '已保存', empty: '没有可用时点', failed: '需人工处理', retry_wait: '等待自动重试' }[p?.status] || '待执行'}`,
        )
        .join('；'),
    };
  });
  const processed = work.filter(
    (w) => finished(w.annual) && finished(w.daily),
  ).length;
  const completedParts = work
    .flatMap((w) => [w.annual, w.daily])
    .filter(finished).length;
  const waiting = !terminal && Number(cp.nextRunAt) > now;
  const discoveryTotal = job.input.existingRecords
    ? 0
    : (job.input.seeds?.length || 0) * (job.input.markets?.length || 0);
  return {
    asyncRetries: true,
    phase: terminal ? 'finished' : waiting ? 'waiting' : 'trends',
    terminal,
    percent: records.length
      ? Math.min(
          100,
          40 + Math.floor((60 * completedParts) / (records.length * 2)),
        )
      : 100,
    semrushUnits: cp.semUnits || 0,
    metricProcessed: Math.min(cp.metricIndex || 0, records.length),
    semrushEnabled: job.input.sources.includes('semrush'),
    target: job.input.limit,
    discovered: records.length,
    discoveryDone: discoveryTotal,
    discoveryTotal,
    processed,
    total: records.length,
    annualAvailable: rows.filter((r) => r.annual).length,
    dailyAvailable: rows.filter((r) => r.daily).length,
    failed: rows.filter((r) => r.failed).length,
    limited: rows.filter((r) => r.limited).length,
    noSignal: rows.filter((r) => r.status === 'no_signal').length,
    rated: rows.filter((r) => r.assessment !== 'pending').length,
    shortfall: Math.max(0, job.input.limit - records.length),
    succeeded: rows.filter((r) => ['collected', 'no_signal'].includes(r.status))
      .length,
    retryPending: rows.filter((r) => r.status === 'retrying').length,
    notStarted: rows.filter((r) => r.status === 'pending').length,
    needsAttention: rows.filter((r) => r.failed).length,
    nextRunAt: waiting ? new Date(cp.nextRunAt).toISOString() : '',
    waitReason: waiting ? cp.waitReason : '',
    retryLimit: 5,
    retryAttempt: Math.max(
      0,
      ...work
        .flatMap((w) => [w.annual, w.daily])
        .filter((p) => p.status === 'retry_wait')
        .map((p) => Math.max(0, p.attempts - 1)),
    ),
    currentTerm: terminal ? '' : cp.currentTerm || '',
    startedAt: cp.startedAt || '',
    finishedAt: cp.finishedAt || '',
    updatedAt: cp.updatedAt || '',
    rows,
  };
}

// A job stops issuing requests during a provider cooldown. Retry only free Trends calls.
export function rateLimitDelay(attempt, retryAfterSeconds = 0) {
  return Math.max(
    [60_000, 120_000, 300_000][Math.min(attempt - 1, 2)],
    Math.min(3_600_000, Math.max(0, retryAfterSeconds) * 1000),
  );
}
export function runnableJob(jobs, now = Date.now()) {
  return jobs.find(
    (job) => !job.cancelled && Number(job.checkpoint?.nextRunAt || 0) <= now,
  );
}
