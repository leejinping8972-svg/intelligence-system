export interface SourceQuota {
  remaining: null | number;
  total: null | number;
  expiresAt?: null | string;
  updatedAt: string;
  origin: 'automatic' | 'manual';
}
export interface UsageSource {
  id: string;
  name: string;
  mark: string;
  description: string;
  unit: string;
  configured: boolean;
  free?: boolean;
  inactive?: boolean;
  automatic?: boolean;
  records: number;
  today: number;
  cumulative: number;
  unknown: number;
  todayUnknown: number;
  cached: number;
  undated: number;
  quota: null | SourceQuota;
  manualQuota: null | SourceQuota;
  preferManual: boolean;
  quotaMessage: string;
}
export interface UsageEntry {
  id: string;
  sourceId: string;
  at: null | string;
  jobId: string;
  task: string;
  step: string;
  operation?: null | string;
  market: string;
  amount: null | number;
  status: string;
  billing: 'cached' | 'confirmed' | 'partial' | 'unknown';
}
export interface SourceUsageSnapshot {
  sources: UsageSource[];
  entries: UsageEntry[];
  daily: Array<{
    day: string;
    sources: Array<{ sourceId: string; amount: number; unknown: number }>;
  }>;
  total: number;
  page: number;
  pageSize: number;
  start: string;
  end: string;
  today: string;
  checkedAt: string;
  undated: number;
  unattributed: number;
  coverage: string;
}
export interface SourceUsagePending {
  loading: true;
  retryAfterMs: number;
}
export const billingLabels = {
  cached: '缓存复用',
  confirmed: '已确认',
  partial: '部分确认',
  unknown: '待确认',
};
export function usageNumber(value: null | number | undefined) {
  return typeof value === 'number'
    ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 })
    : '未获取';
}
export function usageTime(value: null | string | undefined) {
  return value
    ? new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '历史时间未记录';
}
export function usageStep(entry: UsageEntry) {
  const operations: Record<string, string> = { search: '平台商品搜索', detail: '商品详情', trend: '商品销量趋势', content: '商品图文内容', shopping: '购物商品发现', domains: '独立站发现', public_detail: '官网信息补齐', categories: '平台类目查询' };
  const operation = operations[entry.operation || ''];
  if (operation) return operation;
  const stages: Record<string, string> = { 'sem-metric': 'Semrush 关键词指标', metrics: '关键词指标补齐', 'sem-discover': 'Semrush 关键词扩展', 'sem-sites': 'Semrush 独立站发现', 'site-score': '独立站指标评估', domain: '站点流量指标', semrush: 'Semrush 定时监控', ads: '广告资料采集', social: '社交内容搜索', transcript: '字幕采集', 'model-report': 'AI 报告生成', model: 'AI 内容分析', search: '公共内容搜索', detail_metadata: '公共内容详情补齐', detail_transcript: '公共内容字幕补齐' };
  return stages[entry.step.split(':')[0] || ''] || entry.operation || entry.step;
}
