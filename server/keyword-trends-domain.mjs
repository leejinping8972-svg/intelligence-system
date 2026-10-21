import { createHash } from 'node:crypto';

export const TREND_SOURCES = ['google', 'tiktok', 'instagram', 'facebook'];
export const defaultTrendPlan = {
  comparisonVersion: 2,
  enabled: false,
  time: '09:00',
  sources: TREND_SOURCES,
  markets: ['US', 'MX', 'VN'],
  maxRequests: 100,
  maxPages: 11,
};
const DAY = 86_400_000;
export const trendDigest = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);
export const trendDay = (now) =>
  new Date(Number(now) + 8 * 3_600_000).toISOString().slice(0, 10);
export function validateTrendPlan(input) {
  const p = { ...defaultTrendPlan, ...input, comparisonVersion: 2 };
  if (
    typeof p.enabled !== 'boolean' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)
  )
    throw new Error('请选择有效的启用状态和北京时间');
  for (const [key, allowed] of [
    ['sources', TREND_SOURCES],
    ['markets', ['US', 'MX', 'VN']],
  ]) {
    if (
      !Array.isArray(p[key]) ||
      p[key].length === 0 ||
      p[key].some((v) => !allowed.includes(v))
    )
      throw new Error('请选择有效的趋势来源和市场');
    p[key] = [...new Set(p[key])];
  }
  for (const [key, max] of [
    ['maxRequests', 1000],
    ['maxPages', 100],
  ]) {
    if (!Number.isInteger(p[key]) || p[key] < 1 || p[key] > max)
      throw new Error('采集预算或分页上限无效');
  }
  if (p.enabled && input.budgetAcknowledged !== true)
    throw new Error('启用每日采集前请确认来源额度预算');
  return Object.fromEntries(
    Object.keys(defaultTrendPlan).map((key) => [key, p[key]]),
  );
}
function shiftMonths(date, count) {
  const d = new Date(`${date}T00:00:00Z`),
    day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - count);
  const last = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function socialWindows(now) {
  const end = trendDay(now),
    d = new Date(`${end}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY)
    .toISOString()
    .slice(0, 10);
  const month = `${end.slice(0, 7)}-01`;
  const previousMonth = shiftMonths(month, 1);
  const stamp = (date) => Date.parse(`${date}T00:00:00+08:00`);
  const format = (value) => trendDay(value);
  const endAt = stamp(end);
  const weekStart = stamp(monday);
  const monthStart = stamp(month);
  const priorMonthStart = stamp(previousMonth);
  return [
    {
      key: 'week',
      label: '本周',
      startAt: weekStart,
      previousStartAt: weekStart - 7 * DAY,
      previousEndAt: endAt - 7 * DAY,
    },
    {
      key: 'month',
      label: '本月',
      startAt: monthStart,
      previousStartAt: priorMonthStart,
      previousEndAt: Math.min(monthStart, priorMonthStart + endAt - monthStart),
    },
    {
      key: 'quarter',
      label: '近3个月',
      startAt: stamp(shiftMonths(end, 3)),
      previousStartAt: stamp(shiftMonths(end, 6)),
      previousEndAt: stamp(shiftMonths(end, 3)),
    },
    {
      key: 'halfYear',
      label: '近6个月',
      startAt: stamp(shiftMonths(end, 6)),
      previousStartAt: stamp(shiftMonths(end, 12)),
      previousEndAt: stamp(shiftMonths(end, 6)),
    },
  ].map((w) => ({
    ...w,
    endAt,
    start: format(w.startAt),
    end: format(endAt - DAY),
    previousStart: format(w.previousStartAt),
    previousEnd: format(w.previousEndAt - DAY),
  }));
}
export const searchWindows = {
  tiktok: ['history-v2'],
  instagram: ['history-v2'],
  facebook: ['history-v2'],
  google: ['queue-v2'],
};
export function buildTrendWork(keywords, plan, now = Date.now()) {
  const historyStart = socialWindows(now).at(-1).previousStart;
  return keywords.flatMap((k) =>
    plan.sources.flatMap((source) =>
      searchWindows[source].map((window) => ({
        key: `${trendDigest(`${k.id}:${source}`)}:${window}:1`,
        keywordId: k.id,
        term: k.term,
        market: k.market,
        source,
        window,
        page: 1,
        status: 'pending',
        comparisonVersion: 2,
        anchorAt: new Date(now).toISOString(),
        historyStart,
      })),
    ),
  );
}
export function summarizeSocial(snapshot) {
  const items = snapshot.items || [];
  const history = snapshot.history || {};
  const dated = items.filter((i) => Number.isFinite(Date.parse(i.publishedAt)));
  const classified = dated.length === items.length && !history.discarded;
  const covers = (start) =>
    snapshot.comparisonVersion === 2 &&
    classified &&
    (history.exhausted === true ||
      (history.chronological === true &&
        Number.isFinite(history.oldestAt) &&
        history.oldestAt <= start));
  const count = (start, end) =>
    dated.filter(
      (i) =>
        Date.parse(i.publishedAt) >= start && Date.parse(i.publishedAt) < end,
    ).length;
  return {
    comparisonVersion: 2,
    metric: 'publication_daily_rate',
    keywordId: snapshot.keywordId,
    term: snapshot.term,
    market: snapshot.market,
    source: snapshot.source,
    collectedAt: snapshot.at,
    coverage: snapshot.coverage,
    sampleCount: items.length,
    undatedCount: items.length - dated.length,
    history,
    periods: socialWindows(Date.parse(snapshot.anchorAt || snapshot.at)).map(
      (window) => {
        const currentCount = count(window.startAt, window.endAt);
        const previousCount = count(
          window.previousStartAt,
          window.previousEndAt,
        );
        const currentDays = (window.endAt - window.startAt) / DAY;
        const previousDays =
          (window.previousEndAt - window.previousStartAt) / DAY;
        const currentComplete = covers(window.startAt),
          previousComplete = covers(window.previousStartAt);
        const comparable =
          currentComplete &&
          previousComplete &&
          currentDays > 0 &&
          previousDays > 0;
        const currentMean = currentDays > 0 ? currentCount / currentDays : null;
        const previousMean =
          previousDays > 0 ? previousCount / previousDays : null;
        let state = 'ready';
        let reason =
          '按真实发布时间统计，比较前后期日均内容样本发布量；不是历史播放量或站内搜索量';
        if (previousCount === 0) {
          state = 'zero_base';
          reason = '此前周期样本发布量为0，不能计算百分比';
        }
        if (!comparable) {
          state = 'coverage_insufficient';
          reason = `历史覆盖不足：需回查至${window.previousStart}；${history.stopReason || '正在回查历史分页'}`;
        }
        if (!classified) {
          state = 'coverage_insufficient';
          reason =
            '存在发布时间缺失或未能归类的内容，无法确认两期覆盖；不能计算百分比';
        }
        if (currentDays <= 0 || previousDays <= 0) {
          state = 'empty_period';
          reason = '本周期尚无完整日数据';
        }
        return {
          key: window.key,
          label: window.label,
          start: window.start,
          end: window.end,
          previousStart: window.previousStart,
          previousEnd: window.previousEnd,
          collectedAt: snapshot.at,
          count: currentCount,
          previousCount,
          currentMean,
          previousMean,
          currentComplete,
          previousComplete,
          change:
            comparable && previousMean > 0
              ? Math.round((currentMean / previousMean - 1) * 1000) / 10
              : null,
          state,
          reason,
        };
      },
    ),
  };
}

export function updateHistory(snapshot, result, entry) {
  const old = snapshot.history || {
    chronological: entry.source === 'tiktok',
    oldestAt: null,
    lastOldestAt: null,
    discarded: false,
    exhausted: false,
  };
  const dates = result.items.map((i) => Date.parse(i.publishedAt));
  const valid = dates.filter((date) => Number.isFinite(date));
  const ordered =
    dates.length === valid.length &&
    dates.every((date, i) => i === 0 || date <= dates[i - 1]);
  const newest = valid.length > 0 ? Math.max(...valid) : null;
  const oldest = valid.length > 0 ? Math.min(...valid) : null;
  return {
    ...old,
    chronological:
      old.chronological &&
      ordered &&
      (old.lastOldestAt === null ||
        newest === null ||
        newest <= old.lastOldestAt),
    oldestAt:
      oldest === null
        ? old.oldestAt
        : Math.min(old.oldestAt ?? Infinity, oldest),
    lastOldestAt: oldest ?? old.lastOldestAt,
    discarded: old.discarded || result.discardedCount > 0,
    exhausted: old.exhausted || result.exhausted === true,
    pages: entry.page,
    stopReason: result.paginationIssue || '',
  };
}

export function presentSocialSummary(summary) {
  if (
    summary.comparisonVersion === 2 &&
    summary.metric === 'publication_daily_rate'
  )
    return summary;
  return {
    ...summary,
    comparisonVersion: 1,
    periods: (summary.periods || []).map((p) => ({
      ...p,
      change: null,
      state: 'legacy',
      reason: '旧版播放快照结果，需重新回查历史内容后计算环比',
    })),
  };
}

export function currentTrendPlan(saved) {
  if (!saved) return defaultTrendPlan;
  return saved.comparisonVersion === 2
    ? saved
    : { ...defaultTrendPlan, ...saved, enabled: false, comparisonVersion: 2 };
}
