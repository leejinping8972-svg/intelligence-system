import type { Keyword, Market } from './data';

import { assessSupplementRelevance } from './keyword-relevance';

export type KeywordGrade = 'A' | 'B' | 'C' | 'D';
export interface KeywordMetrics {
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
  dimensions: Array<{
    key: string;
    label: string;
    weight: number;
    coveredWeight: number;
    score: null | number;
    evidence: string;
  }>;
}
export const KEYWORD_MODEL_VERSION = 'keyword-research-v3.1-30d';
export const KEYWORD_MODEL_WEIGHTS = [
  { key: 'relevance', label: '业务相关性', weight: 25 },
  { key: 'demand', label: '需求规模', weight: 20 },
  { key: 'trend', label: '趋势表现', weight: 20 },
  { key: 'product', label: '商品研究价值', weight: 20 },
  { key: 'competition', label: '竞争切入空间', weight: 15 },
];
const clamp = (value: number) => Math.round(Math.max(0, Math.min(100, value)));
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
  let product = business.product;
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
      ? (Date.parse(points.at(-1)!.date) - Date.parse(points[0]!.date)) /
        86_400_000
      : 0;
  const trendAge = keyword.trendCollectedAt
    ? (Date.now() - Date.parse(keyword.trendCollectedAt)) / 86_400_000
    : Number.NaN;
  const usableTrend =
    points.length >= 8 &&
    span >= 56 &&
    span <= 800 &&
    annualSeries.some((v) => v > 0) &&
    trendAge >= -1 &&
    trendAge <= 45;
  let trendScore: null | number = null;
  let trendEvidence = keyword.trendMessage || '尚无足够的有效趋势时序';
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
        ? (Date.parse(daily.at(-1)!.date) - Date.parse(daily[0]!.date)) /
          86_400_000
        : 0;
    const windowPoints = daily.length >= 60 && dailySpan >= 59 ? daily : points;
    const dailyUsed = windowPoints === daily;
    const step = dailyUsed
      ? 1
      : Math.min(31, Math.max(1, Math.round(span / (points.length - 1))));
    const end = Date.parse(windowPoints.at(-1)!.date) + step * 86_400_000;
    const avgWindow = (start: number, finish: number) => {
      let days = 0;
      let sum = 0;
      for (let i = 0; i < windowPoints.length; i++) {
        const p = windowPoints[i]!;
        const from = Date.parse(p.date);
        const to =
          i + 1 < windowPoints.length
            ? Math.min(
                Date.parse(windowPoints[i + 1]!.date),
                from + step * 86_400_000,
              )
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
    trendScore = clamp(
      (continuity * 65 + momentum * 0.35) * (spike ? 0.65 : 1),
    );
    if (spike) tags.add('偶发尖峰');
    else if (continuity >= 0.7) tags.add('需求持续');
    if (recent !== null && previous !== null) {
      if (recent > previous * 1.2 && recent > 0)
        tags.add(previous === 0 ? '新出现信号' : '近期增长');
      else if (previous > 0 && recent < previous * 0.8) tags.add('近期回落');
      else if (continuity >= 0.7) tags.add('走势平稳');
    }
    if (continuity < 0.2) tags.add('低样本信号');
    trendEvidence = `一年趋势持续性65% + 近30天相对此前30天动量35%；${dailyUsed ? '日数据' : '按原始时点覆盖天数加权'}，有效点${points.length}个，覆盖${Math.round(span)}天；尖峰降权，不代表搜索量`;
  } else tags.add(points.length > 0 ? '趋势样本不足或过期' : '待补趋势');
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
  const purchaseIntent =
    /(?:^|[,;\s])(2|3)(?:$|[,;\s])|commercial|transactional/i.test(intent);
  const navigationIntent = /^1$|^navigational$/i.test(intent.trim());
  const purchaseBonus = purchaseIntent && !offTopic && business.scoreCap > 49;
  if (purchaseBonus) product = clamp(product + 10);
  if (volume === 0) tags.add('平台搜索量为0');
  const dimensions: KeywordAssessment['dimensions'] = [
    {
      key: 'relevance',
      label: '业务相关性',
      weight: 25,
      coveredWeight: 25,
      score: relevance,
      evidence: business.evidence,
    },
    {
      key: 'demand',
      label: '需求规模',
      weight: 20,
      coveredWeight: demandScore === null ? 0 : 20,
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
      label: '趋势表现',
      weight: 20,
      coveredWeight: trendScore === null ? 0 : 20,
      score: trendScore,
      evidence: trendEvidence,
    },
    {
      key: 'product',
      label: '商品研究价值',
      weight: 20,
      coveredWeight: 20,
      score: product,
      evidence: `保健品成分、剂型、剂量、人群与商品表达的规则评分${purchaseBonus ? '；Semrush 商业或交易意图加10分（本维度封顶100）' : ''}；不代表销量或利润`,
    },
    {
      key: 'competition',
      label: '竞争切入空间',
      weight: 15,
      coveredWeight: kd === undefined ? 0 : 15,
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
  const canGrade =
    trendScore !== null && demandScore !== null && coverage >= 80;
  let score = canGrade
    ? clamp(
        dimensions.reduce(
          (sum, item) => sum + (item.score || 0) * item.coveredWeight,
          0,
        ) / coverage,
      )
    : null;
  if (score !== null) {
    score = Math.min(score, business.scoreCap);
    if (brand || navigationIntent) score = Math.min(score, 64);
    if (volume === 0) score = Math.min(score, 49);
  }
  const grade = score === null ? null : gradeForScore(score);
  let status: KeywordAssessment['status'] = 'pending';
  if (grade) status = coverage === 100 ? 'rated' : 'provisional';
  const recommendations = {
    A: '优先人工复核，可入选下一步独立站研究',
    B: '有研究价值，结合分项依据决定是否入选',
    C: '继续观察，优先补充缺失证据',
    D: '暂缓深入研究，检查相关性和需求信号',
  };
  let recommendation = grade
    ? recommendations[grade]
    : '先补齐有效趋势与关键指标，再进行评级';
  if (tags.has('泛词降权'))
    recommendation = '泛词优先细化成分、剂型、剂量或人群，再评估商品机会';
  if (tags.has('同名歧义待核验'))
    recommendation = '先核验是否指Omega-3保健品，明确成分后再研究';
  if (offTopic) recommendation = '不属于目标保健品商品需求，建议排除或人工核验';
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
    dimensions,
  };
}
