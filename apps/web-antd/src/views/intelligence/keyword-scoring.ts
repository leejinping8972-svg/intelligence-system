import type { Keyword, Market } from './data';
import type { SemrushExtraMetrics } from '../../../../../server/semrush-keyword-trends.mjs';

import { semrushTrendSummary } from '../../../../../server/semrush-keyword-trends.mjs';
import {
  assessSupplementRelevance,
  hasOralProductContext,
  normalizeKeywordText,
} from './keyword-relevance';

export type KeywordGrade = 'A' | 'B' | 'C' | 'D';
export interface KeywordMetrics extends SemrushExtraMetrics {
  market: Market;
  source: string;
  collectedAt: string;
  monthlySearchVolume?: number;
  difficulty?: number;
  top3Share?: number;
  cpc?: number;
  advertisingCompetition?: number;
  intent?: string;
  database?: string;
  report?: string;
}
export interface KeywordAssessment {
  version: string;
  assessedAt: string;
  grade: KeywordGrade | null;
  status: 'pending' | 'provisional' | 'rated';
  score: null | number;
  coverage: number;
  tags: string[];
  recommendation: string;
  decision?: {
    action: 'research' | 'observe' | 'collect' | 'exclude' | 'defer';
    label: string;
    reason: string;
  };
  checks?: Array<{
    key: string;
    label: string;
    status:
      | 'available'
      | 'missing'
      | 'stale'
      | 'unavailable'
      | 'failed'
      | 'pending'
      | 'mismatch';
    source?: string;
    collectedAt?: string;
    message: string;
  }>;
  dimensions: Array<{
    key: string;
    label: string;
    weight: number;
    coveredWeight: number;
    score: null | number;
    evidence: string;
  }>;
}
export const KEYWORD_MODEL_VERSION = 'product-research-v4-evidence';
export const KEYWORD_MODEL_WEIGHTS = [
  { key: 'relevance', label: '成分与研究主题', weight: 30 },
  { key: 'demand', label: '搜索需求规模', weight: 25 },
  { key: 'trend', label: '需求趋势', weight: 25 },
  { key: 'product', label: '口服商品文本线索', weight: 15 },
  { key: 'competition', label: 'SEO切入难度', weight: 5 },
];
const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
const ageDays = (date?: string) =>
  (Date.now() - Date.parse(date || '')) / 86_400_000;
const fresh = (date: string | undefined, days: number) =>
  ageDays(date) >= -1 && ageDays(date) <= days;

function productEvidence(keyword: Keyword) {
  const text = (value: string) =>
    normalizeKeywordText(value)
      .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return (keyword.productKeywordEvidence || []).filter((item) => {
    let validUrl = false;
    try {
      validUrl = ['http:', 'https:'].includes(new URL(item.url).protocol);
    } catch {
      /* invalid source */
    }
    return (
      item.basis === 'product_text_candidate' &&
      (keyword.productIds || []).includes(item.productId) &&
      Boolean(item.sourceId?.trim() && item.fingerprint?.trim()) &&
      validUrl &&
      fresh(item.collectedAt, 180) &&
      Boolean(text(keyword.term)) &&
      ` ${text(item.quote)} `.includes(` ${text(keyword.term)} `) &&
      hasOralProductContext(`${item.productTitle || ''} ${item.quote}`)
    );
  });
}

function missingCollectionStatus(
  status?: string,
): 'failed' | 'pending' | 'unavailable' | 'missing' {
  if (status === 'failed') return 'failed';
  if (['pending', 'queued', 'running', 'collecting'].includes(status || ''))
    return 'pending';
  if (
    [
      'empty',
      'unavailable',
      'collected',
      'partial',
      'completed',
      'unsupported',
      'invalid',
    ].includes(status || '')
  )
    return 'unavailable';
  return 'missing';
}
export function gradeForScore(score: number): KeywordGrade {
  if (score >= 80) return 'A';
  if (score >= 65) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}
export function assessKeyword(keyword: Keyword): KeywordAssessment {
  if (keyword.listSummary && keyword.assessment) return keyword.assessment;
  const business = assessSupplementRelevance(keyword);
  const { relevance, offTopic, brand } = business;
  const tags = new Set<string>(business.tags);
  if (keyword.source.includes('Sorftime')) tags.add('Amazon站内来源');
  const normalized = new Map(
    (keyword.trendPoints || [])
      .filter(
        (p) =>
          !p.isPartial &&
          Number.isFinite(p.value) &&
          p.value >= 0 &&
          p.value <= 100 &&
          Number.isFinite(Date.parse(p.date)),
      )
      .map((p) => [p.date, p]),
  );
  const points = [...normalized.values()].toSorted(
    (a, b) => Date.parse(a.date) - Date.parse(b.date),
  );
  const annualSeries = points.map((p) => p.value);
  const span =
    points.length > 1
      ? (Date.parse(points.at(-1)?.date || '') -
          Date.parse(points[0]?.date || '')) /
        86_400_000
      : 0;
  const usableTrend =
    points.length >= 8 &&
    span >= 56 &&
    span <= 800 &&
    annualSeries.some((v) => v > 0) &&
    fresh(keyword.trendCollectedAt, 45) &&
    fresh(points.at(-1)?.date, 60);
  let trendScore: null | number = null;
  let trendEvidence = keyword.trendMessage || '尚无足够的有效趋势时序';
  let trendSource = '';
  let trendDate = keyword.trendCollectedAt;
  if (usableTrend) {
    const daily = (keyword.trendDailyPoints || [])
      .filter(
        (p) =>
          !p.isPartial &&
          Number.isFinite(p.value) &&
          p.value >= 0 &&
          p.value <= 100 &&
          Number.isFinite(Date.parse(p.date)),
      )
      .toSorted((a, b) => Date.parse(a.date) - Date.parse(b.date));
    const dailySpan =
      daily.length > 1
        ? (Date.parse(daily.at(-1)?.date || '') -
            Date.parse(daily[0]?.date || '')) /
          86_400_000
        : 0;
    const windowPoints =
      daily.length >= 60 &&
      dailySpan >= 59 &&
      fresh(keyword.trendDailyCollectedAt, 45) &&
      fresh(daily.at(-1)?.date, 45)
        ? daily
        : points;
    const dailyUsed = windowPoints === daily;
    const step = dailyUsed
      ? 1
      : Math.min(31, Math.max(1, Math.round(span / (points.length - 1))));
    const end = Date.parse(windowPoints.at(-1)?.date || '') + step * 86_400_000;
    const avgWindow = (start: number, finish: number) => {
      let days = 0;
      let sum = 0;
      for (const [i, p] of windowPoints.entries()) {
        const from = Date.parse(p.date);
        const next = windowPoints[i + 1];
        const to = next
          ? Math.min(Date.parse(next.date), from + step * 86_400_000)
          : from + step * 86_400_000;
        const overlap =
          Math.max(0, Math.min(to, finish) - Math.max(from, start)) /
          86_400_000;
        sum += p.value * overlap;
        days += overlap;
      }
      return days >= 30 ? sum / days : null;
    };
    const previous = avgWindow(end - 60 * 86_400_000, end - 30 * 86_400_000);
    const recent = avgWindow(end - 30 * 86_400_000, end);
    const continuity =
      annualSeries.filter((v) => v > 0).length / annualSeries.length;
    let momentum = 50;
    if (recent !== null && previous !== null) {
      if (previous > 0)
        momentum = clamp(50 + (50 * (recent - previous)) / previous);
      else momentum = recent > 0 ? 70 : 20;
    }
    const total = annualSeries.reduce((sum, v) => sum + v, 0);
    const spike = Math.max(...annualSeries) / total > 0.45;
    trendScore = clamp((continuity * 40 + momentum * 0.6) * (spike ? 0.65 : 1));
    if (spike) tags.add('偶发尖峰');
    else if (continuity >= 0.7) tags.add('需求持续');
    if (recent !== null && previous !== null) {
      if (recent > previous * 1.2 && recent > 0)
        tags.add(previous === 0 ? '新出现信号' : '近期增长');
      else if (previous > 0 && recent < previous * 0.8) tags.add('近期回落');
      else if (continuity >= 0.7) tags.add('走势平稳');
    }
    if (continuity < 0.2) tags.add('低样本信号');
    trendSource = 'Google Trends';
    trendEvidence = `Google趋势持续性40% + 近30天相对此前30天动量60%；${dailyUsed ? '日数据' : '按原始时点覆盖天数加权'}，有效点${points.length}个，覆盖${Math.round(span)}天；尖峰降权，不代表搜索量`;
  }
  const metrics = keyword.metrics;
  const metricDate = metrics ? Date.parse(metrics.collectedAt) : Number.NaN;
  const metricAge = (Date.now() - metricDate) / 86_400_000;
  const validMetrics = Boolean(
    metrics?.source.trim() &&
    metrics.market === keyword.market &&
    Number.isFinite(metricDate) &&
    metricAge >= -1 &&
    metricAge <= 90,
  );
  const monthly = semrushTrendSummary(metrics, keyword.market);
  if (
    trendScore === null &&
    validMetrics &&
    monthly.available &&
    fresh(monthly.collectedAt, 90) &&
    monthly.values.some((v) => v > 0)
  ) {
    const values = monthly.values;
    const mean = (items: number[]) =>
      items.reduce((sum, n) => sum + n, 0) / items.length;
    const previous = mean(values.slice(-6, -3));
    const recent = mean(values.slice(-3));
    const continuity = values.filter((v) => v > 0).length / values.length;
    let momentum = recent > 0 ? 70 : 20;
    if (previous > 0) momentum = clamp(50 + 50 * (recent / previous - 1));
    const spike =
      Math.max(...values) / values.reduce((sum, n) => sum + n, 0) > 0.45;
    trendScore = clamp((40 * continuity + 0.6 * momentum) * (spike ? 0.65 : 1));
    trendSource = 'Semrush月度相对趋势';
    trendDate = monthly.collectedAt;
    trendEvidence = `Semrush过去12个月相对热度，持续性40% + 最近3点相对此前3点动量60%；${monthly.quarterChange === null ? '此前窗口为0，变化率未知' : `相对变化${monthly.quarterChange}%`}；尖峰降权，来源未提供逐月日期，不换算搜索次数`;
    tags.add('Semrush趋势');
    if (spike) tags.add('偶发尖峰');
    else if (continuity >= 0.7) tags.add('需求持续');
    if (previous > 0 && recent < previous * 0.8) tags.add('近期回落');
    else if (recent > previous * 1.2 && recent > 0)
      tags.add(previous > 0 ? '近期增长' : '新出现信号');
    else if (continuity >= 0.7) tags.add('走势平稳');
  }
  if (trendScore === null) {
    tags.add('待补趋势');
    trendEvidence =
      '缺少新鲜、同市场且样本充分的Google趋势或Semrush月趋势；未收录、全0和采集失败均不推算增长';
  }
  const volume =
    validMetrics &&
    Number.isFinite(metrics?.monthlySearchVolume) &&
    (metrics?.monthlySearchVolume ?? -1) >= 0
      ? metrics?.monthlySearchVolume
      : undefined;
  // Fixed market reference anchors, not a ranking within the current result batch.
  const volumeCeiling = keyword.market === 'US' ? 100_000 : 50_000;
  const demandScore =
    volume === undefined
      ? null
      : clamp((Math.log10(1 + volume) / Math.log10(1 + volumeCeiling)) * 100);
  const kd =
    validMetrics &&
    typeof metrics?.difficulty === 'number' &&
    Number.isFinite(metrics.difficulty) &&
    metrics.difficulty >= 0 &&
    metrics.difficulty <= 100
      ? metrics.difficulty
      : undefined;
  const competitionScore = kd === undefined ? null : clamp(100 - kd);
  if (demandScore === null) tags.add('待补搜索量');
  if (kd === undefined) tags.add('待补KD');
  if (metrics && !validMetrics) tags.add('指标待核验或过期');
  if (metrics?.source.includes('Semrush')) {
    tags.add('Semrush指标');
    if (metrics.intent) tags.add(`搜索意图：${metrics.intent}`);
  }
  const intent = validMetrics ? metrics?.intent || '' : '';
  // Semrush: 0 commercial, 1 informational, 2 navigational, 3 transactional.
  const semrushIntent = /Semrush/i.test(metrics?.source || '');
  const purchaseIntent =
    /commercial|transactional/i.test(intent) ||
    (semrushIntent && /(?:^|[,;\s])[03](?:$|[,;\s])/.test(intent));
  const navigationIntent =
    /^navigational$/i.test(intent.trim()) ||
    (semrushIntent && /^2$/.test(intent.trim()));
  if (purchaseIntent) tags.add('商业意图线索');
  const products = productEvidence(keyword);
  const productScore =
    products.length > 0 &&
    !offTopic &&
    !business.seedMismatch &&
    business.ingredient
      ? 70
      : null;
  if (productScore === null) tags.add('待核验口服商品');
  if (volume === 0) tags.add('平台搜索量为0');
  const dimensions: KeywordAssessment['dimensions'] = [
    {
      key: 'relevance',
      label: '成分与研究主题',
      weight: 30,
      coveredWeight: 30,
      score: relevance,
      evidence: business.evidence,
    },
    {
      key: 'demand',
      label: '搜索需求规模',
      weight: 25,
      coveredWeight: demandScore === null ? 0 : 25,
      score: demandScore,
      evidence:
        volume === undefined
          ? '缺少有来源、日期和同市场的搜索量指标'
          : `月搜索量${volume}；${metrics?.source}；市场固定参考上沿${
              volumeCeiling
            }`,
    },
    {
      key: 'trend',
      label: '需求趋势',
      weight: 25,
      coveredWeight: trendScore === null ? 0 : 25,
      score: trendScore,
      evidence: trendEvidence,
    },
    {
      key: 'product',
      label: '口服商品文本线索',
      weight: 15,
      coveredWeight: productScore === null ? 0 : 15,
      score: productScore,
      evidence:
        productScore === null
          ? '未找到符合条件的已关联口服商品原文：需来源URL、引用、来源ID、指纹和180天内日期；剂型词、意图代码、关联数量均不算商品证据'
          : `有可追溯口服商品原文线索，固定70分；${products[0]?.url}；仅证明商品文本提及，不代表销量、人体功效、市场准入或利润`,
    },
    {
      key: 'competition',
      label: 'SEO切入难度',
      weight: 5,
      coveredWeight: kd === undefined ? 0 : 5,
      score: competitionScore,
      evidence:
        kd === undefined
          ? '缺少同市场自然搜索 KD；广告竞争度不是 KD'
          : `100 − KD(${kd})；${metrics?.source}；仅反映自然搜索排名难度，不等于商业竞争、盈利或前三站点流量份额`,
    },
  ];
  const coverage = dimensions.reduce(
    (sum, item) => sum + item.coveredWeight,
    0,
  );
  // A new concept must be actionable immediately.  Score from every available
  // dimension and normalize by covered weight; missing trend/volume/KD data
  // stays visible as an evidence gap instead of turning the whole score off.
  let score =
    coverage > 0
      ? clamp(
          dimensions.reduce(
            (sum, item) => sum + (item.score || 0) * item.coveredWeight,
            0,
          ) / coverage,
        )
      : 0;
  if (score !== null) {
    score = Math.min(score, business.scoreCap);
    if (brand || navigationIntent) score = Math.min(score, 64);
    if (volume === 0) score = Math.min(score, 49);
    if (demandScore === null && trendScore === null)
      score = Math.min(score, 49);
    else if (demandScore === null || trendScore === null)
      score = Math.min(score, 64);
    if (productScore === null) score = Math.min(score, 79);
  }
  const grade = gradeForScore(score);
  const status: KeywordAssessment['status'] =
    coverage === 100 ? 'rated' : 'provisional';
  let decision: NonNullable<KeywordAssessment['decision']> = {
    action: 'defer',
    label: '暂缓研究',
    reason: '现有信号较弱，暂不优先投入选品资源',
  };
  if (score >= 80) {
    decision = {
      action: 'research',
      label: '优先深入研究',
      reason:
        '需求、趋势与口服商品线索支持优先核验；继续核对实际销量、复购、毛利及目标市场准入',
    };
  } else if (score >= 65) {
    decision = {
      action: 'observe',
      label: '继续观察',
      reason: '有研究信号，补充口服商品与细分用途证据后再决定投入',
    };
  } else if (score >= 50) {
    decision = {
      action: 'observe',
      label: '低优先观察',
      reason: '当前信号一般，先验证细分需求与商品线索',
    };
  }
  if (demandScore === null || trendScore === null || !business.ingredient)
    decision = {
      action: 'collect',
      label: '先补证据',
      reason:
        '缺少成分核验、搜索量或有效趋势；当前低分不等于没有市场，不进入优先研究池',
    };
  if (offTopic || business.seedMismatch)
    decision = {
      action: 'exclude',
      label: '排除当前方向',
      reason: '非目标口服商品或偏离研究成分，建议排除；可另建适用方向研究',
    };
  const recommendation = `${decision.label}：${decision.reason}。分数用于研究排序，不代表备货建议。`;
  const metricStatus = (
    present: boolean,
  ): NonNullable<KeywordAssessment['checks']>[number]['status'] => {
    if (present) return 'available';
    if (metrics && metrics.market !== keyword.market) return 'mismatch';
    if (
      metrics &&
      Number.isFinite(metricDate) &&
      !fresh(metrics.collectedAt, 90)
    )
      return 'stale';
    return missingCollectionStatus(keyword.semrushCollection?.status);
  };
  type CheckStatus = NonNullable<KeywordAssessment['checks']>[number]['status'];
  let relevanceStatus: CheckStatus = 'missing';
  if (offTopic || business.seedMismatch) relevanceStatus = 'mismatch';
  else if (business.ingredient) relevanceStatus = 'available';
  const trendStatus = (): CheckStatus => {
    if (trendScore !== null) return 'available';
    if (metrics?.searchTrend && metrics.market !== keyword.market)
      return 'mismatch';
    if (
      (monthly.available && !fresh(monthly.collectedAt, 90)) ||
      (points.length > 0 && !fresh(keyword.trendCollectedAt, 45))
    )
      return 'stale';
    if (monthly.available || points.length > 0) return 'unavailable';
    return missingCollectionStatus(
      keyword.trendStatus || metrics?.searchTrend?.status,
    );
  };
  const checks: KeywordAssessment['checks'] = [
    {
      key: 'relevance',
      label: '成分与研究主题',
      status: relevanceStatus,
      source: '成分规则与任务主题核对',
      message: business.evidence,
    },
    {
      key: 'demand',
      label: '同市场月搜索量',
      status: metricStatus(demandScore !== null),
      source: metrics?.source,
      collectedAt: metrics?.collectedAt,
      message:
        volume === undefined
          ? keyword.semrushCollection?.message ||
            '未知，不按0处理；需同市场来源与90天内采集日期'
          : `来源估算${volume}/月${volume === 0 ? '，已明确返回0，区别于未收录' : '；不代表口服购买量'}`,
    },
    {
      key: 'trend',
      label: '有效需求趋势',
      status: trendStatus(),
      source: trendSource || 'Google Trends / Semrush',
      collectedAt:
        trendScore === null
          ? metrics?.searchTrend?.collectedAt || keyword.trendCollectedAt
          : trendDate,
      message: trendEvidence,
    },
    {
      key: 'product',
      label: '可追溯口服商品原文',
      status: productScore === null ? 'missing' : 'available',
      source: productScore === null ? undefined : products[0]?.url,
      collectedAt: productScore === null ? undefined : products[0]?.collectedAt,
      message:
        productScore === null
          ? '待补原文或核验关联、口服用途与日期；不以商品ID或搜索意图代替证据'
          : '关联口服商品的原文线索可追溯；仍需人工核验商品市场、标签与实际销售',
    },
    {
      key: 'competition',
      label: '同市场自然搜索KD',
      status: metricStatus(kd !== undefined),
      source: metrics?.source,
      collectedAt: metrics?.collectedAt,
      message:
        kd === undefined
          ? '缺少有效KD；广告竞争度不能代替'
          : `KD ${kd}；仅作SEO参考，不是商品竞争度`,
    },
  ];
  return {
    version: KEYWORD_MODEL_VERSION,
    assessedAt:
      metrics?.collectedAt ||
      keyword.trendCollectedAt ||
      keyword.collectedAt ||
      keyword.updatedAt ||
      '',
    grade,
    status,
    score,
    coverage,
    tags: [...tags],
    recommendation,
    decision,
    checks,
    dimensions,
  };
}
