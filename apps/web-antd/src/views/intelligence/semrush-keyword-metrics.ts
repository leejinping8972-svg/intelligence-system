import type { Keyword } from './data';

import { semrushTrendSummary } from '../../../../../server/semrush-keyword-trends.mjs';

const display = (value: number | undefined) =>
  value === undefined
    ? '未返回'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });

export function semrushMetricRows(keyword: Keyword) {
  const m =
    keyword.metrics?.market === keyword.market &&
    /Semrush/i.test(keyword.metrics.source || '')
      ? keyword.metrics
      : undefined;
  return [
    {
      label: '月搜索量估算',
      value: display(m?.monthlySearchVolume),
      note: '次/月；来源估算',
    },
    {
      label: '自然搜索难度 KD',
      value: display(m?.difficulty),
      note: '0–100；越高越难',
    },
    {
      label: '点击成本 CPC',
      value: m?.cpc === undefined ? '未返回' : `$${display(m.cpc)}`,
      note: 'USD；广告点击成本估算',
    },
    {
      label: '广告竞争度',
      value: display(m?.advertisingCompetition),
      note: '0–1；不是自然搜索难度',
    },
    {
      label: '搜索意图',
      value: m?.intent || '未返回',
      note: '保留来源标签或代码',
    },
    {
      label: '搜索结果数',
      value: display(m?.searchResultCount),
      note: '来源估算的结果数量',
    },
    {
      label: '种子词相关度',
      value: display(m?.relatedRelevance),
      note: `0–1；${m?.relatedTo ? `相对于 ${m.relatedTo}` : '仅相关词报告返回，种子词未记录'}`,
    },
    {
      label: '搜索结果特征',
      value: m?.serpFeatures
        ? m.serpFeatures.join('、') || '无特征（来源返回空列表）'
        : '未返回',
      note: '来源特征标签或代码；仅部分扩词报告返回',
    },
  ];
}

export function semrushKeywordExport(keyword: Keyword) {
  const m =
    keyword.metrics?.market === keyword.market &&
    /Semrush/i.test(keyword.metrics.source || '')
      ? keyword.metrics
      : undefined;
  const summary = semrushTrendSummary(m, keyword.market);
  return {
    Semrush_指标日期: m?.collectedAt || '',
    Semrush_报告: m?.report || '',
    Semrush_月度相对趋势: summary.values.join(','),
    Semrush_趋势日期: summary.collectedAt,
    Semrush_趋势报告: m?.searchTrend?.report || '',
    Semrush_趋势口径:
      '过去12个月由早到晚；0–100相对值；逐月日期未返回；非搜索次数',
    Semrush_最新月变化百分比: summary.monthChange ?? '',
    Semrush_近3月对前3月变化百分比: summary.quarterChange ?? '',
    Semrush_近6月对前6月变化百分比: summary.halfChange ?? '',
    Semrush_峰值月序号: summary.peakPositions.join(','),
    Semrush_搜索结果数: m?.searchResultCount ?? '',
    Semrush_相关度: m?.relatedRelevance ?? '',
    Semrush_相关度种子词: m?.relatedTo || '',
    Semrush_搜索结果特征: m?.serpFeatures?.join(',') || '',
    Semrush_开放字段: m?.semrushColumns?.join(',') || '',
    Semrush_趋势状态: summary.available ? '已获取' : summary.message,
  };
}
