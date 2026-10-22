export interface TrendPoint {
  date: string;
  value: number;
  isPartial?: boolean;
}
interface TrendRecord {
  trendDailyPoints?: TrendPoint[];
  trendDailyCollectedAt?: string;
  trendPoints?: TrendPoint[];
  trendResolution?: string;
  trendCollectedAt?: string;
  trendHistoryPoints?: TrendPoint[];
  trendHistoryResolution?: string;
  trendHistoryCollectedAt?: string;
}
export interface TrendComparison {
  collectedAt?: string;
  key: string;
  label: string;
  heat: null | number;
  change: null | number;
  currentMean: null | number;
  previousMean: null | number;
  reason: string;
  start?: string;
  end?: string;
  previousStart?: string;
}
const DAY = 86_400_000;
const day = (value: number) => Math.floor(value / DAY) * DAY;
const date = (value: number) => new Date(value).toISOString().slice(0, 10);
const round = (value: number) => Math.round(value * 10) / 10;
function monthsBefore(end: number, months: number) {
  const original = new Date(end);
  const target = new Date(
    Date.UTC(original.getUTCFullYear(), original.getUTCMonth() - months, 1),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(original.getUTCDate(), lastDay));
  return target.getTime();
}
function intervals(
  points: TrendPoint[] = [],
  resolution = 'unknown',
  collectedAt?: string,
) {
  const valid = [
    ...new Map(
      points
        .filter(
          (p) =>
            !p.isPartial &&
            Number.isFinite(Date.parse(p.date)) &&
            Number.isFinite(p.value) &&
            p.value >= 0 &&
            p.value <= 100,
        )
        .map((p) => [day(Date.parse(p.date)), p.value]),
    ).entries(),
  ].toSorted((a, b) => a[0] - b[0]);
  let step = 0;
  if (resolution === 'day') step = 1;
  if (resolution === 'week') step = 7;
  if (!step || valid.length === 0) return [];
  const captured = Date.parse(collectedAt || '');
  const cutoff = Number.isFinite(captured) ? day(captured) : Infinity;
  return valid
    .map(([start, value], i) => ({
      start,
      end: Math.min(start + step * DAY, valid[i + 1]?.[0] ?? Infinity, cutoff),
      value,
    }))
    .filter((p) => p.end > p.start);
}
function compare(
  key: string,
  label: string,
  source: ReturnType<typeof intervals>,
  months = 0,
  bounds?: {
    start: number;
    end: number;
    previousStart: number;
    previousEnd: number;
  },
): TrendComparison {
  const result: TrendComparison = {
    key,
    label,
    heat: null,
    change: null,
    currentMean: null,
    previousMean: null,
    reason: '缺少完整趋势时序',
  };
  const lastPoint = source.at(-1);
  if (!lastPoint) return result;
  const end = bounds?.end ?? lastPoint.end;
  const start =
    bounds?.start ?? (months ? monthsBefore(end, months) : end - 30 * DAY);
  const previousStart =
    bounds?.previousStart ??
    (months ? monthsBefore(end, months * 2) : start - 30 * DAY);
  if (end <= start) {
    result.reason = '本周期尚无完整日数据';
    return result;
  }
  Object.assign(result, {
    start: date(start),
    end: date(end - DAY),
    previousStart: date(previousStart),
  });
  const average = (from: number, to: number) => {
    let coverage = 0;
    let total = 0;
    let first = Infinity;
    let last = -Infinity;
    const tolerance = source.some((p) => p.end - p.start > DAY) ? 7 * DAY : 0;

    for (const p of source) {
      const overlap = Math.max(
        0,
        Math.min(to, p.end) - Math.max(from, p.start),
      );
      if (!overlap) continue;
      coverage += overlap;
      total += p.value * overlap;
      first = Math.min(first, Math.max(from, p.start));
      last = Math.max(last, Math.min(to, p.end));
    }
    // A weekly query may start inside the first requested week. Allow only
    // that boundary truncation; an internal missing bucket remains unknown.
    return coverage > 0 &&
      coverage === last - first &&
      coverage >= to - from - tolerance
      ? { mean: total / coverage }
      : null;
  };
  const current = average(start, end);
  if (!current) return result;
  result.currentMean = current.mean;
  // Keep the original Google query scale. Never splice/re-normalize independently
  // fetched series; period changes must share the same scale within each pair.
  result.heat = Math.round(current.mean);
  const previous = average(previousStart, bounds?.previousEnd ?? start);
  if (!previous) {
    result.reason = '缺少此前等长周期，待补对比';
    return result;
  }
  result.previousMean = previous.mean;
  if (previous.mean === 0) {
    result.reason =
      current.mean > 0
        ? '此前基期为0，新出现信号，不能计算百分比'
        : '基期为0，搜索样本不足，不能计算百分比';
    return result;
  }
  result.change = round(((current.mean - previous.mean) / previous.mean) * 100);
  if (Object.is(result.change, -0)) result.change = 0;
  result.reason = '与此前等长周期平均热度比较';
  return result;
}
// Calendar week/month to the last complete UTC day; compare the matching
// elapsed part of the previous week/month. Legacy scoring keeps its 30d metric.
export function fourPeriodComparisons(record: TrendRecord): TrendComparison[] {
  const daily = intervals(
    record.trendDailyPoints,
    'day',
    record.trendDailyCollectedAt,
  );
  const history = intervals(
    record.trendHistoryPoints,
    record.trendHistoryResolution,
    record.trendHistoryCollectedAt,
  );
  const annual = intervals(
    record.trendPoints,
    record.trendResolution,
    record.trendCollectedAt,
  );
  const captured = Date.parse(record.trendDailyCollectedAt || '');
  const end = Number.isFinite(captured)
    ? day(captured)
    : (daily.at(-1)?.end ??
      day(Date.parse(record.trendCollectedAt || new Date().toISOString())));
  const d = new Date(end);
  const weekStart = end - ((d.getUTCDay() + 6) % 7) * DAY;
  const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const priorMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1);
  const long = history.length ? history : annual;
  return [
    compare('week', '本周', daily, 0, {
      start: weekStart,
      end,
      previousStart: weekStart - 7 * DAY,
      previousEnd: end - 7 * DAY,
    }),
    compare('month', '本月', daily, 0, {
      start: monthStart,
      end,
      previousStart: priorMonth,
      previousEnd: Math.min(monthStart, priorMonth + end - monthStart),
    }),
    compare('quarter', '近3个月', long, 3),
    compare('halfYear', '近6个月', long, 6),
  ];
}
export function trendComparisons(
  record: TrendRecord,
): [TrendComparison, TrendComparison, TrendComparison] {
  const daily = intervals(
    record.trendDailyPoints,
    'day',
    record.trendDailyCollectedAt,
  );
  const annual = intervals(
    record.trendPoints,
    record.trendResolution,
    record.trendCollectedAt,
  );
  const history = intervals(
    record.trendHistoryPoints,
    record.trendHistoryResolution,
    record.trendHistoryCollectedAt,
  );
  return [
    compare('month', '近30天', daily),
    compare('halfYear', '近半年', history.length > 0 ? history : annual, 6),
    compare('year', '近一年', history.length > 0 ? history : annual, 12),
  ];
}
export function formatTrendComparison(value: TrendComparison) {
  if (value.heat === null) return `${value.label}：—（待补数据）`;
  if (value.change === null)
    return `${value.label}：${value.heat}（${value.previousMean === 0 ? '基期为0' : '待补对比'}）`;
  return `${value.label}：${value.heat}(${value.change > 0 ? '+' : ''}${value.change}%)`;
}

export function rollingTrendComparison(record: TrendRecord, days: 30 | 90 | 365): TrendComparison {
  const daily = intervals(record.trendDailyPoints, 'day', record.trendDailyCollectedAt);
  const history = intervals(record.trendHistoryPoints, record.trendHistoryResolution, record.trendHistoryCollectedAt);
  const annual = intervals(record.trendPoints, record.trendResolution, record.trendCollectedAt);
  const series = days === 30 && daily.length ? daily : history.length ? history : annual;
  const captured = days === 30 && daily.length ? record.trendDailyCollectedAt : history.length ? record.trendHistoryCollectedAt : record.trendCollectedAt;
  const end = day(Date.parse(captured || ''));
  if (!Number.isFinite(end)) return compare('month', `近${days}天`, []);
  return { ...compare('month', `近${days}天`, series, 0, { start: end - days * DAY, end, previousStart: end - 2 * days * DAY, previousEnd: end - days * DAY }), collectedAt: captured };
}
