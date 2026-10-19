import { adminRequest, serverMode } from './session';

export type ContentCategory = 'academic' | 'health' | 'social';
export const contentCategories = {
  social: '社媒内容',
  health: '权威健康资讯',
  academic: '学术证据',
};
export const contentTypes: Record<string, string> = {
  video: '视频',
  article: '文章',
  post: '帖子',
  paper: '论文',
};
export const contentStates: Record<string, string> = {
  queued: '等待执行',
  running: '执行中',
  completed: '已完成',
  partial: '部分完成',
  failed: '未完成',
  cancelled: '已取消',
  success: '已返回',
  pending: '尚未开始',
  skipped: '已跳过',
  unknown: '结果未确认',
  unconfigured: '未配置',
  unsupported: '当前语言不支持',
  rate_limited: '来源限流',
  blocked: '权限或配额受限',
};
export interface ContentItem {
  id: string;
  source: string;
  sourceLabel: string;
  sourceId: string;
  category: ContentCategory;
  type: string;
  title: string;
  summary: string;
  author: string;
  authorCountry: string;
  language: string;
  url: string;
  thumbnail?: string;
  videoId?: string;
  publishedAt: null | string;
  collectedAt: string;
  searchMarket: string;
  searchLanguage: string;
  matchedQueries: string[];
  matchReason: string;
  keywordIds: string[];
  productIds: string[];
  favorite: boolean;
  textAvailability: string;
  doi?: string;
  fullTextUrl?: string;
  publicationType?: string[];
  interactions?: Record<string, null | number>;
  ai?: {
    titleZh: string;
    summaryZh: string;
    reason: string;
    quote: string;
    duplicateOf: string;
  };
  transcript?: {
    text: string;
    language: string;
    segments: { text: string; startMs: number }[];
  };
}
export interface ContentJob {
  id: string;
  mode: string;
  status: string;
  submittedAt: string;
  updatedAt?: string;
  input: {
    query: string;
    market: string;
    language: string;
    limit?: number;
    queries?: string[];
  };
  steps: {
    source: string;
    query: string;
    status: string;
    count: number;
    cached?: boolean;
    message?: string;
  }[];
  itemIds: string[];
  requests: number;
  creditsCharged: number;
  unknownChargeRequests: number;
  aiStatus: string;
  aiMessage?: string;
  aiCount?: number;
  aiModel?: string;
  aiUsage?: { total_tokens?: number };
}
export interface ContentSnapshot {
  jobs: ContentJob[];
  job: ContentJob | null;
  items: ContentItem[];
}
export interface ContentStatus {
  sources: {
    id: string;
    label: string;
    category: ContentCategory;
    configured: boolean;
  }[];
  modelConfigured: boolean;
}
export async function contentRequest<T>(
  action: string,
  input: Record<string, unknown> = {},
) {
  if (!serverMode)
    throw new Error(
      '公共内容搜索需在隔离测试服务或服务器版使用；演示版不会连接正式接口',
    );
  return adminRequest<T>(action, input);
}
export function contentDate(value?: null | string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '来源未提供';
  return new Date(value).toLocaleDateString('zh-CN');
}
export function filterContent(
  items: ContentItem[],
  filter: {
    category: string;
    type: string;
    source: string;
    language: string;
    since: string;
    search: string;
    favorites: boolean;
  },
) {
  const needle = filter.search.trim().toLocaleLowerCase();
  return items.filter(
    (item) =>
      (filter.category === 'ALL' || item.category === filter.category) &&
      (filter.type === 'ALL' || item.type === filter.type) &&
      (filter.source === 'ALL' || item.source === filter.source) &&
      (filter.language === 'ALL' || item.language === filter.language) &&
      (!filter.favorites || item.favorite) &&
      (filter.since === 'ALL' ||
        Boolean(
          item.publishedAt &&
          Date.parse(item.publishedAt) <= Date.now() &&
          Date.now() - Date.parse(item.publishedAt) <=
            Number(filter.since) * 86_400_000,
        )) &&
      (!needle ||
        [
          item.title,
          item.summary,
          item.ai?.titleZh,
          item.ai?.summaryZh,
          item.author,
          ...item.matchedQueries,
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle)),
  );
}
export function contentCsv(items: ContentItem[]) {
  const cell = (value: unknown) =>
    `"${String(value ?? '')
      .replace(/^([=+@\-\t\r])/, "'$1")
      .replaceAll('"', '""')}"`;
  return `\uFEFF${[
    [
      '分类',
      '类型',
      '标题',
      '中文标题',
      '摘要',
      '中文摘要',
      '来源',
      '作者/机构',
      '来源语言',
      '发布时间',
      '检索市场',
      '命中词',
      '原文链接',
      '关联关键词ID',
      '关联产品ID',
    ],
    ...items.map((i) => [
      contentCategories[i.category],
      contentTypes[i.type],
      i.title,
      i.ai?.titleZh,
      i.summary,
      i.ai?.summaryZh,
      i.sourceLabel,
      i.author,
      i.language,
      i.publishedAt,
      i.searchMarket,
      i.matchedQueries.join(' / '),
      i.url,
      i.keywordIds.join(' / '),
      i.productIds.join(' / '),
    ]),
  ]
    .map((row) => row.map((value) => cell(value)).join(','))
    .join('\r\n')}`;
}
