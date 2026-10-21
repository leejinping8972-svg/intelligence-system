import type { ResearchReport } from './research-reports';

export interface ConsumerTopic {
  key: string;
  label: string;
  direction: string;
  suggestion: string;
  count: number;
  sampleSize: number;
  share: null | number;
  sourceCount: null | number;
  sources: string[];
  platforms: string[];
  engagement: null | number;
  evidenceIds: string[];
  method: string;
}
export function reportTopics(report: ResearchReport): ConsumerTopic[] {
  if (report.topicSummary) return report.topicSummary;
  return (report.statistics?.themes || []).map((t) => ({
    ...t,
    direction: '',
    sampleSize: report.statistics?.sampleSize || 0,
    share: report.statistics?.sampleSize
      ? Math.round((t.count / report.statistics.sampleSize) * 100)
      : null,
    sources: [],
    platforms: [],
    engagement: null,
    method: '规则统计 · 全部已采样文本',
  }));
}
export const reportStatus = (status: string) =>
  ({
    queued: '排队中',
    running: '生成中',
    completed: '已完成',
    partial: '部分完成',
    cancelled: '已取消',
  })[status] || status;
export function latestKeywordReports(reports: ResearchReport[]) {
  const map = new Map<string, ResearchReport>();
  for (const r of [...reports].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )) {
    if (r.kind === 'ad_analysis' || r.reportType === 'ad') continue;
    for (const id of r.keywordIds || []) if (!map.has(id)) map.set(id, r);
  }
  return map;
}
export function filterConsumerReports(
  reports: ResearchReport[],
  filters: {
    market: string;
    keyword: string;
    topic: string;
    search: string;
    review: string;
  },
) {
  return reports.filter(
    (r) =>
      r.kind !== 'ad_analysis' &&
      r.reportType !== 'ad' &&
      (filters.market === 'ALL' || r.market === filters.market) &&
      (!filters.keyword || r.keywordIds?.includes(filters.keyword)) &&
      (!filters.topic ||
        reportTopics(r).some((t) => t.label === filters.topic)) &&
      (filters.review === 'ALL' ||
        (r.reviewStatus || 'pending') === filters.review) &&
      `${r.title} ${reportTopics(r)
        .map((t) => t.label)
        .join(' ')}`
        .toLowerCase()
        .includes(filters.search.toLowerCase()),
  );
}
export function publicEvidenceUrl(value?: string) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password
      ? url.href
      : '';
  } catch {
    return '';
  }
}
