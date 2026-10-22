import { discoveryDecision } from './discovery';

export type ProductMetricKind =
  | 'sales_volume'
  | 'review_count'
  | 'sales_rank'
  | 'shopping_rank'
  | 'keywords_count';
export interface ProductMetricSeries {
  basis?: string;
  provider: string;
  platform: string;
  market: string;
  productId: string;
  metric: ProductMetricKind;
  period: 'day' | 'week' | 'month';
  collectedAt: string;
  evidenceUrl?: string;
  points: Array<{
    start: string;
    end: string;
    value: number;
    partial?: boolean;
  }>;
}
export interface ProductCompletionState {
  status: string;
  message: string;
  jobId?: string;
  at?: string;
  points?: number;
}
export type ProductCompletion = Record<string, ProductCompletionState>;
export interface ProductDecisionData {
  listing?: {
    date: string;
    provider: string;
    platform: string;
    market: string;
    collectedAt: string;
    evidenceUrl?: string;
  };
  series?: ProductMetricSeries[];
}
export interface ProductDecision {
  key: string;
  label: string;
  color: string;
  reason: string;
  source: string;
  date: string;
  evidenceUrl?: string;
  change?: number;
}
export const productDecisionFilters = [
  { value: 'ALL', label: '全部决策标签' },
  { value: 'new_product', label: '新品（90天内）' },
  { value: 'growing', label: '近期增长' },
  { value: 'sustained', label: '持续增长' },
  { value: 'declining', label: '近期回落' },
  { value: 'emerging', label: '新出现信号' },
  { value: 'spike', label: '偶发尖峰' },
  { value: 'low_base', label: '低基数' },
  { value: 'rank_improving', label: '排名改善' },
  { value: 'coverage_growing', label: '搜索覆盖扩大' },
  { value: 'review_activity', label: '评论数变化' },
  { value: 'first_seen', label: '首次发现' },
  { value: 'insufficient', label: '趋势待补充' },
  { value: 'stale', label: '趋势数据过旧' },
];
export const PRODUCT_DECISION_VERSION = 'product-decisions-v3';
export function productDataSource(product: {
  sourceProvider?: string;
  sourcePlatform?: string;
  dataNature?: string;
  siteId?: string;
}) {
  if (product.sourceProvider)
    return `${product.sourceProvider} · ${product.sourcePlatform || '平台商品'}`;
  if (product.dataNature === 'demo') return '演示样本';
  return product.siteId ? '官网实采' : '人工导入 / 来源待确认';
}
export const PRODUCT_DECISION_RULES =
  '新品：有来源的上架日期在90天内。近期增长/回落：相邻完整周期销量变化≥20%/≤-20%；连续三个周期增长需四个观测值。零基数不计算百分比；销量基数不足20时标记低基数，不升级为持续增长。排名、评论数和关键词覆盖变化分别标记，不等同于销量。首次发现仅指系统首次观察。';
const DAY = 86_400_000;
const day = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) &&
    new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : Number.NaN;
};
const sourceOf = (value: {
  provider: string;
  platform: string;
  market: string;
}) => `${value.provider} · ${value.platform} · ${value.market}`;
const periodName = { day: '日', week: '周', month: '月' };
function validPoint(
  point: ProductMetricSeries['points'][number],
  period: ProductMetricSeries['period'],
  now: number,
) {
  const start = day(point.start),
    end = day(point.end);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start > end ||
    end + DAY > now ||
    point.partial ||
    typeof point.value !== 'number' ||
    !Number.isFinite(point.value) ||
    point.value < 0
  )
    return false;
  if (period === 'day') return start === end;
  if (period === 'week') return end - start === 6 * DAY;
  const date = new Date(start);
  return (
    date.getUTCDate() === 1 &&
    end === Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  );
}
export function productDecisions(
  product: {
    listSummary?: boolean;
    decisionTags?: ProductDecision[];
    market: string;
    firstSeenAt?: string;
    decisionData?: ProductDecisionData;
    dataCompletion?: ProductCompletion;
  },
  now = Date.now(),
): ProductDecision[] {
  if (product.listSummary && product.decisionTags) return product.decisionTags;
  const result: ProductDecision[] = [];
  const data = product.decisionData;
  const listing = data?.listing;
  if (
    listing && discoveryDecision(product, 'product', now).isNew === true
  ) {
    result.push({
      key: 'new_product',
      label: '新品',
      color: 'purple',
      reason: `平台上架日期 ${listing.date}，距观察日不超过90天；不代表品牌首次推出。`,
      source: sourceOf(listing),
      date: listing.collectedAt,
      evidenceUrl: listing.evidenceUrl,
    });
  }
  let hasTrend = false,
    stale = false;
  const seen = new Set<string>();
  for (const series of [...(data?.series || [])].toSorted(
    (a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt),
  )) {
    if (
      !series.provider ||
      !series.platform ||
      !series.productId ||
      series.market !== product.market ||
      ![
        'sales_volume',
        'sales_rank',
        'shopping_rank',
        'keywords_count',
        'review_count',
      ].includes(series.metric) ||
      !['day', 'week', 'month'].includes(series.period) ||
      !Array.isArray(series.points) ||
      !Number.isFinite(Date.parse(series.collectedAt)) ||
      Date.parse(series.collectedAt) > now
    )
      continue;
    const identity = [
      series.provider,
      series.platform,
      series.market,
      series.productId,
      series.metric,
      series.period,
    ].join(':');
    if (seen.has(identity)) continue;
    seen.add(identity);
    const duplicates = new Map<string, number>();
    for (const point of series.points)
      duplicates.set(point.start, (duplicates.get(point.start) || 0) + 1);
    const points = series.points
      .filter(
        (p) =>
          duplicates.get(p.start) === 1 && validPoint(p, series.period, now),
      )
      .toSorted((a, b) => day(a.start) - day(b.start));
    const current = points.at(-1),
      previous = points.at(-2);
    if (!current || !previous || day(current.start) !== day(previous.end) + DAY)
      continue;
    if (
      now - day(current.end) >
      { day: 7, week: 21, month: 45 }[series.period] * DAY
    ) {
      stale = true;
      continue;
    }
    if (
      ['sales_rank', 'shopping_rank'].includes(series.metric) &&
      (!current.value || !previous.value)
    )
      continue;
    hasTrend = true;
    const suffix = `${series.platform}${periodName[series.period]}`;
    const detail = `${previous.start}～${previous.end}：${previous.value}；${current.start}～${current.end}：${current.value}。`;
    const add = (
      key: string,
      label: string,
      color: string,
      reason: string,
      change?: number,
    ) =>
      result.push({
        key,
        label,
        color,
        reason: `${detail}${reason}`,
        source: sourceOf(series),
        date: series.collectedAt,
        evidenceUrl: series.evidenceUrl,
        change,
      });
    const tail = [current];
    for (let i = points.length - 2; i >= 0 && tail.length < 12; i--) {
      const point = points[i];
      const firstPoint = tail[0];
      if (
        !point ||
        !firstPoint ||
        day(firstPoint.start) !== day(point.end) + DAY
      )
        break;
      tail.unshift(point);
    }
    if (
      series.metric === 'sales_volume' &&
      tail.length >= 4 &&
      tail.slice(0, -1).every((p) => p.value === 0) &&
      current.value > 0
    ) {
      add(
        'emerging',
        `${suffix}销量新出现信号`,
        'cyan',
        '此前至少三个完整周期销量指标为0，最近出现正值；不计算零基数增长率，也不据此认定新品。',
      );
      continue;
    }
    const growth =
      previous.value > 0
        ? ((current.value - previous.value) / previous.value) * 100
        : undefined;
    if (growth === undefined || !Number.isFinite(growth)) {
      add(
        'low_base',
        `${suffix}零基数`,
        'orange',
        '前期基数为0，不能计算百分比；当前数据不等同于连续增长。',
      );
      continue;
    }
    if (series.metric === 'sales_rank' || series.metric === 'shopping_rank') {
      if (growth <= -20)
        add(
          'rank_improving',
          `${suffix}${series.metric === 'shopping_rank' ? 'Shopping' : '销量'}排名改善`,
          'blue',
          '排名数字降低表示位置改善，不等于销量增长。',
          growth,
        );
      else if (growth >= 20)
        add(
          'rank_declining',
          `${suffix}排名回落`,
          'orange',
          '排名数字增加表示位置回落。',
          growth,
        );
      else
        add(
          'rank_stable',
          `${suffix}排名变化有限`,
          'default',
          '排名变化未达到20%的提示阈值。',
          growth,
        );
      continue;
    }
    if (series.metric === 'review_count') {
      add(
        'review_activity',
        `${suffix}评论数${growth > 0 ? '增加' : growth < 0 ? '减少' : '不变'}`,
        'blue',
        `评论数由${previous.value}变为${current.value}，变化${growth.toFixed(1)}%；评论指标不等于销量。`,
        growth,
      );
      continue;
    }
    if (series.metric === 'keywords_count') {
      if (growth >= 20)
        add(
          'coverage_growing',
          `${suffix}搜索覆盖扩大`,
          'blue',
          '商品覆盖关键词数增加，不等于销量或点击增长。',
          growth,
        );
      else if (growth <= -20)
        add(
          'coverage_declining',
          `${suffix}搜索覆盖缩小`,
          'orange',
          '商品覆盖关键词数减少。',
          growth,
        );
      else
        add(
          'coverage_stable',
          `${suffix}搜索覆盖变化有限`,
          'default',
          '覆盖变化未达到20%的提示阈值。',
          growth,
        );
      continue;
    }
    // Require a peak followed by two observations back near a positive baseline.
    const peakIndex = tail.length - 3;
    const baseline = tail.slice(0, peakIndex);
    const baselineValues = baseline
      .map((p) => p.value)
      .toSorted((a, b) => a - b);
    const median = baselineValues[Math.floor(baselineValues.length / 2)] || 0;
    const peak = tail[peakIndex];
    if (
      peak &&
      baseline.length >= 3 &&
      median >= 20 &&
      peak.value >= median * 3 &&
      tail.slice(peakIndex + 1).every((p) => p.value <= median * 1.5)
    ) {
      add(
        'spike',
        `${suffix}销量偶发尖峰`,
        'orange',
        `峰值周期 ${peak.start} 指标${peak.value}，至少是前期中位数${median}的3倍，后两个周期已回落至中位数1.5倍以内。`,
      );
      continue;
    }
    const sign = growth >= 0 ? '+' : '';
    if (growth >= 20 && previous.value < 20)
      add(
        'low_base',
        `${suffix}销量低基数增长`,
        'orange',
        `变化${sign}${growth.toFixed(1)}%，前期指标不足20，不标记持续增长。`,
        growth,
      );
    else if (growth >= 20) {
      add(
        'growing',
        `${suffix}销量近期增长`,
        'green',
        `变化${sign}${growth.toFixed(1)}%，达到20%的提示阈值。销量口径以平台为准。`,
        growth,
      );
      const last = tail.slice(-4);
      if (
        last.length === 4 &&
        (last[0]?.value ?? 0) >= 20 &&
        last
          .slice(1)
          .every((p, i) => last[i] !== undefined && p.value > last[i].value)
      )
        add(
          'sustained',
          `${suffix}销量持续增长`,
          'green',
          '最近四个完整观测值连续上升，形成三个连续增长周期。',
        );
    } else if (growth <= -20)
      add(
        'declining',
        `${suffix}销量近期回落`,
        'orange',
        `变化${growth.toFixed(1)}%，达到-20%的提示阈值。`,
        growth,
      );
    else
      add(
        'stable',
        `${suffix}销量变化有限`,
        'default',
        `变化${sign}${growth.toFixed(1)}%，未达到增长或回落阈值。`,
        growth,
      );
  }
  const first = Date.parse(product.firstSeenAt || '');
  if (Number.isFinite(first) && first <= now && now - first < 14 * DAY)
    result.push({
      key: 'first_seen',
      label: '首次发现',
      color: 'default',
      reason: '系统在最近14天首次采集到该商品，不表示商品刚上架。',
      source: '系统采集记录',
      date: new Date(first).toISOString(),
    });
  if (!hasTrend) {
    const steps = Object.entries(product.dataCompletion || {}).filter(([key]) =>
      key.startsWith('trend'),
    );
    const states = steps.map(([, value]) => value);
    let label = stale ? '趋势数据过旧' : '趋势未请求';
    let reason = stale
      ? '历史数据已超过时效窗口，暂不用于当前趋势判断。'
      : '该商品尚未完成历史请求；可在商品库点击补全商品数据。';
    if (states.some((s) => ['queued', 'running'].includes(s.status))) {
      label = '趋势补全中';
      reason = '已进入后台补全队列，关闭页面后继续执行。';
    } else if (
      states.some((s) => ['failed', 'unknown', 'cancelled'].includes(s.status))
    ) {
      label = '趋势采集未完成';
      reason = states
        .filter((s) => ['failed', 'unknown', 'cancelled'].includes(s.status))
        .map((s) => s.message)
        .join('；');
    } else if (
      states.length > 0 &&
      states.every((s) => s.status === 'unsupported')
    ) {
      label = '来源不提供历史';
      reason = states.map((s) => s.message).join('；');
    } else if (states.length > 0 && states.every((s) => s.status === 'empty')) {
      label = '平台暂无有效历史';
      reason = states.map((s) => s.message).join('；');
    } else if ((data?.series?.length || 0) > 0 && !stale) {
      label = '历史周期不足';
      reason =
        '已有历史，但缺少同商品、同市场、同指标的相邻完整周期；可在详情查看实际返回值。';
    }
    result.push({
      key: stale ? 'stale' : 'insufficient',
      label,
      color: 'default',
      reason,
      source: '系统规则',
      date: new Date(now).toISOString(),
    });
  }
  return result;
}
