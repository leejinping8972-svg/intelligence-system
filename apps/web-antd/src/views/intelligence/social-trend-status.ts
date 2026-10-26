import type { SocialSummary } from './keyword-social-trends';

export function socialTrendStatus(summary: SocialSummary | undefined, state: { loading: boolean; loaded: boolean; error: string }) {
  if (summary?.periods?.some((p) => p.count !== null)) {
    if (summary.attemptMessage || state.error) return '更新未完成，保留已采集值';
    return summary.comparisonVersion === 2 ? '内容样本 / 发布量环比' : '旧版已采集值，需回查';
  }
  if (state.error) return '读取失败，点击重试';
  if (state.loading && !state.loaded) return '正在读取已采集数据…';
  if (summary?.attemptMessage) return '采集未完成，查看原因';
  if (summary?.collectedAt) return '已采集，周期数据不足';
  return state.loaded ? '尚未采集此来源' : '等待读取已采集数据';
}
