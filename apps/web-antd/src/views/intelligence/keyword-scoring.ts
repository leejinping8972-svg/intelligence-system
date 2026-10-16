import type { Keyword, Market } from './data';

export type KeywordGrade = 'A' | 'B' | 'C' | 'D';
export interface KeywordMetrics {
  market: Market;
  source: string;
  collectedAt: string;
  monthlySearchVolume?: number;
  difficulty?: number;
  top3Share?: number;
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
export const KEYWORD_MODEL_VERSION = 'keyword-research-v1.0';
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
  const text = keyword.term.toLocaleLowerCase();
  const tags = new Set<string>();
  const offTopic =
    /\b(hospital|clinic|doctor|jobs?|salary|magazine|badge reel|services?|partners|specialists?)\b|bệnh viện|tuyển dụng|招聘|医院/.test(
      text,
    );
  const ingredient =
    /magnesium|glycinate|collagen|creatine|probiotic|prebiotic|inositol|ashwagandha|berberine|melatonin|omega|vitamin|protein|electrolyte|inulin|psyllium|colágeno|probiótico|men vi sinh|chất xơ|胶原|益生菌/.test(
      text,
    );
  const form =
    /gumm|capsul|powder|softgel|tablet|liquid|cápsula|polvo|\bbột\b|viên|软糖|胶囊|粉剂/.test(
      text,
    );
  const commercial =
    /supplement|buy|price|shop|comprar|precio|suplemento|bổ sung|mua|giá|保健品|购买/.test(
      text,
    );
  const brand =
    /\b(amazon|walmart|iherb|now foods|nature made|garden of life|lemme|goli)\b/.test(
      text,
    );
  const classified = Boolean(
    keyword.category && !['待分类', '未分类'].includes(keyword.category),
  );
  if (ingredient) tags.add('成分词');
  if (form) tags.add('剂型词');
  if (commercial || ingredient || form) tags.add('商品需求词');
  if (/women|female|menopause|prenatal|phụ nữ|mujer|女性/.test(text))
    tags.add('人群词');
  if (brand) tags.add('品牌导航词');
  if (offTopic) tags.add('非商品需求');
  if (
    /how|what|benefits|side effects|cách|là gì|cómo|para qué|功效|副作用/.test(
      text,
    )
  )
    tags.add('内容研究词');

  let relevance = 30;
  if (ingredient) relevance = 80;
  if (classified) relevance = 85;
  if (offTopic) relevance = 10;
  const product = offTopic
    ? 10
    : clamp(
        25 + (ingredient ? 30 : 0) + (form ? 25 : 0) + (commercial ? 20 : 0),
      );
  const points = (keyword.trendPoints || []).filter(
    (point) => !point.isPartial,
  );
  const series =
    points.length > 0 ? points.map((point) => point.value) : keyword.series;
  const span =
    points.length > 1
      ? (Date.parse(points.at(-1)?.date || '') -
          Date.parse(points[0]?.date || '')) /
        86_400_000
      : Math.max(0, series.length - 1);
  const usableTrend =
    series.length >= 8 && span >= 56 && series.some((value) => value > 0);
  let trendScore: null | number = null;
  let trendEvidence = keyword.trendMessage || '尚无足够的有效趋势时序';
  if (usableTrend) {
    const avg = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) /
      Math.max(1, values.length);
    const windowSize = Math.max(2, Math.floor(series.length / 4));
    const recent = avg(series.slice(-windowSize));
    const previous = avg(series.slice(-2 * windowSize, -windowSize));
    const continuity =
      series.filter((value) => value > 0).length / series.length;
    let momentum = 20;
    if (recent > 0) momentum = 70;
    if (previous > 0)
      momentum = clamp(50 + (50 * (recent - previous)) / previous);
    const total = series.reduce((sum, value) => sum + value, 0);
    const spike = Math.max(...series) / total > 0.45;
    trendScore = clamp(
      (continuity * 35 + momentum * 0.35 + recent * 0.3) * (spike ? 0.65 : 1),
    );
    if (spike) tags.add('偶发尖峰');
    else if (continuity >= 0.7) tags.add('需求持续');
    if (recent > previous * 1.2 && recent > 0) tags.add('近期增长');
    else if (previous > 0 && recent < previous * 0.8) tags.add('近期回落');
    else if (continuity >= 0.7) tags.add('走势平稳');
    if (continuity < 0.2) tags.add('低样本信号');
    trendEvidence = `一年序列按四分之一窗口观察持续性与变化；有效点${
      series.length
    }个，覆盖${Math.round(span)}天，非绝对搜索量`;
  } else tags.add(series.length > 0 ? '趋势样本不足' : '待补趋势');
  const metrics = keyword.metrics;
  const metricDate = metrics ? Date.parse(metrics.collectedAt) : Number.NaN;
  const metricAge = (Date.now() - metricDate) / 86_400_000;
  const validMetrics = Boolean(
    metrics?.source.trim() &&
    metrics.market === keyword.market &&
    Number.isFinite(metricDate) &&
    metricAge >= -1 &&
    metricAge <= 180,
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
  const competitionValues: number[] = [];
  if (
    validMetrics &&
    metrics?.difficulty !== undefined &&
    metrics.difficulty >= 0 &&
    metrics.difficulty <= 100
  )
    competitionValues.push(100 - metrics.difficulty);
  if (
    validMetrics &&
    metrics?.top3Share !== undefined &&
    metrics.top3Share >= 0 &&
    metrics.top3Share <= 100
  )
    competitionValues.push(100 - metrics.top3Share);
  const competitionScore =
    competitionValues.length > 0
      ? clamp(
          competitionValues.reduce((sum, value) => sum + value, 0) /
            competitionValues.length -
            (brand ? 10 : 0),
        )
      : null;
  if (demandScore === null) tags.add('待补搜索量');
  if (competitionValues.length < 2) tags.add('待补竞争指标');
  if (metrics && !validMetrics) tags.add('指标待核验');
  const dimensions: KeywordAssessment['dimensions'] = [
    {
      key: 'relevance',
      label: '业务相关性',
      weight: 25,
      coveredWeight: 25,
      score: relevance,
      evidence: offTopic
        ? '命中医院、服务、招聘或媒体等非商品表达规则'
        : '结合关键词、种子词上下文和研究品类的规则判断',
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
      evidence: '成分、剂型、人群及商品表达的规则评分，不代表销量或利润',
    },
    {
      key: 'competition',
      label: '竞争切入空间',
      weight: 15,
      coveredWeight: competitionValues.length * 7.5,
      score: competitionScore,
      evidence: `关键词难度与前三站点搜索份额各占本维度一半；${
        metrics?.source || '缺少指标来源'
      }`,
    },
  ];
  const coverage = dimensions.reduce(
    (sum, item) => sum + item.coveredWeight,
    0,
  );
  const canGrade = trendScore !== null && coverage >= 60;
  const score = canGrade
    ? clamp(
        dimensions.reduce(
          (sum, item) => sum + (item.score || 0) * item.coveredWeight,
          0,
        ) / coverage,
      )
    : null;
  const grade = score === null ? null : gradeForScore(score);
  let status: KeywordAssessment['status'] = 'pending';
  if (grade) status = coverage === 100 ? 'rated' : 'provisional';
  const recommendations = {
    A: '优先人工复核，可入选下一步独立站研究',
    B: '有研究价值，结合分项依据决定是否入选',
    C: '继续观察，优先补充缺失证据',
    D: '暂缓深入研究，检查相关性和需求信号',
  };
  return {
    version: KEYWORD_MODEL_VERSION,
    assessedAt:
      keyword.trendCollectedAt ||
      keyword.collectedAt ||
      keyword.updatedAt ||
      '',
    grade,
    status,
    score,
    coverage,
    tags: [...tags],
    recommendation: grade
      ? recommendations[grade]
      : '先补齐有效趋势与关键指标，再进行评级',
    dimensions,
  };
}
