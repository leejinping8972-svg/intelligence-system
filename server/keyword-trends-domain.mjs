import { createHash } from 'node:crypto';

export const TREND_SOURCES = ['google', 'tiktok', 'instagram', 'facebook'];
export const defaultTrendPlan = {
  enabled: false,
  time: '09:00',
  sources: TREND_SOURCES,
  markets: ['US', 'MX', 'VN'],
  maxRequests: 100,
  maxPages: 1,
};
const DAY = 86_400_000;
export const trendDigest = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);
export const trendDay = (now) =>
  new Date(Number(now) + 8 * 3_600_000).toISOString().slice(0, 10);
export function validateTrendPlan(input) {
  const p = { ...defaultTrendPlan, ...input };
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
    ['maxPages', 5],
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
  return [
    { key: 'week', label: '本周', start: monday },
    { key: 'month', label: '本月', start: `${end.slice(0, 7)}-01` },
    { key: 'quarter', label: '近3个月', start: shiftMonths(end, 3) },
    { key: 'halfYear', label: '近6个月', start: shiftMonths(end, 6) },
  ].map((w) => ({
    ...w,
    end,
    startAt: Date.parse(`${w.start}T00:00:00+08:00`),
    endAt: Number(now),
  }));
}
export const searchWindows = {
  tiktok: ['this-week', 'this-month', 'last-3-months', 'last-6-months'],
  instagram: ['last-week', 'last-month', 'last-year'],
  facebook: ['public'],
  google: ['queue'],
};
export function buildTrendWork(keywords, plan) {
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
      })),
    ),
  );
}
export function summarizeSocial(snapshot, baselines = {}) {
  const items = snapshot.items || [];
  return {
    keywordId: snapshot.keywordId,
    term: snapshot.term,
    market: snapshot.market,
    source: snapshot.source,
    collectedAt: snapshot.at,
    coverage: snapshot.coverage,
    sampleCount: items.length,
    undatedCount: items.filter((i) => !i.publishedAt).length,
    periods: socialWindows(Date.parse(snapshot.at)).map((window) => {
      const matches = items.filter(
        (i) =>
          Number.isFinite(Date.parse(i.publishedAt)) &&
          Date.parse(i.publishedAt) >= window.startAt &&
          Date.parse(i.publishedAt) <= window.endAt,
      );
      const baseline = baselines[window.start];
      const old = new Map((baseline?.items || []).map((i) => [i.id, i]));
      // A change uses the SAME content IDs at two real observations. Never assign
      // today's cumulative counters to the publication date or manufacture history.
      const pairs = items.flatMap((i) => {
        const prior = old.get(i.id);
        return Number.isFinite(i.views) && Number.isFinite(prior?.views)
          ? [[prior.views, i.views]]
          : [];
      });
      const before = pairs.reduce((s, p) => s + p[0], 0),
        after = pairs.reduce((s, p) => s + p[1], 0);
      const usable =
        baseline &&
        baseline.at < snapshot.at &&
        trendDay(Date.parse(baseline.at)) !== trendDay(Date.parse(snapshot.at));
      const corrected = pairs.some(([a, b]) => b < a);
      const complete =
        snapshot.completedWindows?.includes('all') ||
        snapshot.completedWindows?.includes(window.key);
      let reason = '共同样本累计播放量相较起点快照增长；不是前期环比';
      if (before === 0) reason = '播放基期为0';
      if (pairs.length === 0) reason = '没有可比的播放量样本';
      if (!usable) reason = '待积累周期起点快照';
      if (corrected) reason = '平台播放计数回调，暂不计算涨幅';
      if (!complete) reason = '本周期尚未完成采集';
      return {
        key: window.key,
        label: window.label,
        start: window.start,
        end: window.end,
        collectedAt: snapshot.at,
        count: complete ? matches.length : null,
        change:
          complete && usable && pairs.length > 0 && before > 0 && !corrected
            ? Math.round(((after - before) / before) * 1000) / 10
            : null,
        matchedCount: usable ? pairs.length : 0,
        baselineAt: usable ? baseline.at : '',
        reason,
      };
    }),
  };
}
