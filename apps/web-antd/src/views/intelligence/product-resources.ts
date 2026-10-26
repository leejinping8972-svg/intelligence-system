export type ResourceMode = 'category' | 'keyword' | 'urls';
export type ResourceRanking =
  | 'period_sales'
  | 'platform_bestsellers'
  | 'sample';
export type ResourceWindowDays = 30 | 90 | 180;

export interface ResourceCategory {
  id: string;
  path: string[];
  market: string;
  receiptId: string;
  name?: string;
  provider?: string;
  platform?: string;
  verification?: string | { status: string; reason?: string };
  mapping?: string;
}

export interface ResourceRoute {
  id: string;
  label: string;
  platform: string;
  provider: string;
  markets: string[];
  modes: ResourceMode[];
  rankings: ResourceRanking[];
  operations: string[];
  salesFields: Array<{
    field: string;
    label: string;
    window?: string;
    nature?: string;
    unit?: string;
    coverage?: string;
  }>;
  history: { supported: boolean; maxDays?: number; reason?: string };
  verification: { status: string; reason?: string };
  cost: { unit: string; reason?: string };
  limits: { maxProducts?: number; maxPages?: number };
  configured?: boolean;
  unavailableReason?: string;
  reason?: string;
  alternatives?: string[];
}

export interface ResourceCapabilities {
  routes: ResourceRoute[];
  platforms: Array<{
    id: string;
    label: string;
    reason?: string;
    alternatives?: string[];
  }>;
  configured: Record<string, boolean>;
}

export interface ResourceBudget {
  requests: number;
  providerCalls: number;
  sorftimeCalls: number;
  scrapeCredits: number;
  semrushUnits: number;
  braveRequests: number;
  browserPages: number;
  modelTokens: number;
  maxPages: number;
  maxDetailProducts: number;
}

export interface ResourceDiscoveryInput {
  resourceDiscovery: true;
  routeId: string;
  market: string;
  mode: ResourceMode;
  terms: string;
  category?: ResourceCategory;
  urls: string;
  salesWindowDays: ResourceWindowDays;
  ranking: ResourceRanking;
  maxProducts: number;
  includeDetails: boolean;
  includeHistory: boolean;
  researchCategory: string;
  websiteDomain?: string;
  budget: ResourceBudget;
}

export interface ResourceProductEvidence {
  version: 1;
  jobId: string;
  routeId: string;
  platform: string;
  provider: string;
  market: string;
  mode: ResourceMode;
  category?: ResourceCategory;
  researchCategory?: string;
  queryTerms?: string[];
  requestedWindow: {
    days: ResourceWindowDays;
    start?: string;
    end?: string;
    kind: 'rolling_days';
    purpose: 'sales_statistics';
  };
  metric: {
    status: string;
    kind: string;
    value?: number;
    raw?: string;
    unit?: string;
    precision?: string;
    originalWindow?: {
      kind: string;
      start?: string;
      end?: string;
      days?: number;
    };
    message?: string;
  };
  ranking: {
    kind: ResourceRanking;
    rank?: number;
    sourceRank?: number;
    population: 'collected_sample' | 'source_list';
    eligible?: number;
    total?: number;
    complete: boolean;
    message?: string;
  };
  coverage: {
    scope: string;
    complete: boolean;
    reason: string;
    [key: string]: unknown;
  };
  collectedAt: string;
  evidenceUrl?: string;
  price?: {
    raw?: string;
    amount?: number;
    currency?: string;
    precision?: string;
  };
  identity?: {
    sourceProductId: string;
    shopId?: string;
    shopName?: string;
    variantId?: string;
    variants?: Array<Record<string, unknown>>;
    specification?: string;
    formula?: string;
  };
  states?: {
    detail?: string | { status?: string; message?: string };
    history?: string | { status?: string; message?: string };
  };
}

export interface ResourceTaskProgress {
  routeId?: string;
  platform?: string;
  mode?: ResourceMode;
  requestedWindowDays?: ResourceWindowDays;
  requestedQuantity?: number;
  ranking?: ResourceRanking;
  coverage?: string;
  completeMarketCoverage?: boolean;
  completedSteps?: number;
  plannedSteps?: number;
  discoveryPages?: number;
  publicPages?: number;
  contents?: number;
  budget?: Partial<ResourceBudget>;
  usage?: Partial<ResourceBudget>;
  reserved?: Partial<ResourceBudget>;
  resumable?: boolean;
  stopReasons?: Array<{
    key?: string;
    provider?: string;
    op?: string;
    reason: string;
    status: string;
    message: string;
  }>;
  sourceStates?: Record<
    string,
    { blocked?: boolean; reason?: string; nextAllowedAt?: number }
  >;
  rankingSummary?: {
    requested?: number;
    saved?: number;
    comparableGroups?: number;
    population?: string;
    complete?: boolean;
    message?: string;
  };
}

const budgetLabels: Array<{ key: keyof ResourceBudget; label: string }> = [
  { key: 'requests', label: '物理HTTP请求（次）' },
  { key: 'providerCalls', label: '来源调用（次）' },
  { key: 'sorftimeCalls', label: 'Sorftime（调用）' },
  { key: 'scrapeCredits', label: 'ScrapeCreators（credits）' },
  { key: 'semrushUnits', label: 'Semrush（API units）' },
  { key: 'braveRequests', label: 'Brave（请求）' },
  { key: 'browserPages', label: '受控浏览器（页）' },
  { key: 'modelTokens', label: '模型（tokens）' },
];

export function resourceBudgetRows(progress: ResourceTaskProgress) {
  return budgetLabels.map(({ key, label }) => ({
    key,
    label,
    confirmed: progress.usage?.[key] ?? null,
    reserved: progress.reserved?.[key] ?? null,
    limit: key === 'semrushUnits' ? '不限积分' : progress.budget?.[key] ?? null,
  }));
}

export function resourceHasUnknownCharge(progress: ResourceTaskProgress) {
  return (
    !!progress.stopReasons?.some(
      (stop) => stop.reason === 'charge_unknown' || stop.status === 'unknown',
    ) ||
    Object.values(progress.sourceStates || {}).some(
      (source) => source.reason === 'charge_unknown',
    )
  );
}

export function resourceTaskCanResume(task: {
  status: string;
  researchProgress?: {
    unknownCharges?: number;
    resource?: ResourceTaskProgress;
  };
}) {
  const progress = task.researchProgress?.resource;
  return (
    task.status === 'cancelled' &&
    progress?.resumable === true &&
    !resourceHasUnknownCharge(progress) &&
    !(
      task.researchProgress?.unknownCharges &&
      task.researchProgress.unknownCharges > 0
    )
  );
}

export const resourceModeLabels: Record<ResourceMode, string> = {
  keyword: '关键词样本',
  category: '平台真实类目',
  urls: '公开页面',
};
export const resourceRankingLabels: Record<ResourceRanking, string> = {
  sample: '已采集样本排名',
  period_sales: '周期销量排名',
  platform_bestsellers: '平台热销榜',
};
export const resourceMetricLabels: Record<string, string> = {
  units: '售出件数',
  orders: '订单数',
  bsr: 'BSR排名',
  cumulative_units: '采集时点累计售出件数',
  display_delta: '展示销量增量',
  unknown: '指标口径未确认',
};
export const resourceStatusLabels: Record<string, string> = {
  observed: '已获取',
  available: '已获取',
  collected: '已获取',
  completed: '已完成',
  missing: '来源未返回',
  unsupported: '不支持',
  pending_history: '历史待积累',
  pending: '待积累',
  failed: '失败',
  not_indexed: '未收录',
  budget_limited: '预算截断',
  skipped: '未执行',
  unverified: '待验证',
};
export const resourceCostUnitLabels: Record<string, string> = {
  request: '物理HTTP请求',
  public_request: '公开HTTP请求',
  sorftime_call: 'Sorftime调用',
  scrape_credit: 'ScrapeCreators credits',
  semrush_units: 'Semrush API units',
  brave_request: 'Brave请求',
};

export function resourceSalesFieldDescription(
  field: ResourceRoute['salesFields'][number],
) {
  const labels: Record<string, string> = {
    units: '件数',
    orders: '订单',
    position: '来源位置',
    source_reported: '来源原始窗口',
    cumulative: '累计至采集时点',
    indexed_snapshot: '收录时点快照',
    provider_estimate_or_display: '来源估算或平台展示',
    display_snapshot: '平台展示快照',
    search_advertising: '搜索广告指标',
    source_list: '来源列表范围',
    keyword_sample: '关键词样本',
    indexed_merchants: '已收录商家范围',
  };
  return [field.label, field.unit, field.window, field.nature, field.coverage]
    .filter((value): value is string => !!value)
    .map((value) => labels[value] || value)
    .join(' · ');
}
export const resourceBudgetMaximums: ResourceBudget = {
  requests: 500,
  providerCalls: 200,
  sorftimeCalls: 100,
  scrapeCredits: 100,
  semrushUnits: 0,
  braveRequests: 50,
  browserPages: 0,
  modelTokens: 0,
  maxPages: 10,
  maxDetailProducts: 100,
};
const providerBudgetKeys: Record<string, keyof ResourceBudget | undefined> = {
  sorftime: 'sorftimeCalls',
  tiktok_shop: 'scrapeCredits',
  scrapecreators: 'scrapeCredits',
  semrush: 'semrushUnits',
  brave: 'braveRequests',
};

export function splitResourceLines(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export function resourceSupports(
  route: ResourceRoute | undefined,
  operation: 'detail' | 'history',
) {
  if (!route) return false;
  return operation === 'history'
    ? route.history.supported && route.operations.includes('history')
    : route.operations.some(
        (value) => value === 'detail' || value === 'details',
      );
}

export function resourceRouteAvailable(
  route: ResourceRoute,
  configured: Record<string, boolean>,
) {
  return route.configured !== false && configured[route.provider] !== false;
}

export function resourceRankingsForMode(
  route: ResourceRoute,
  mode: ResourceMode,
) {
  return route.rankings.filter(
    (ranking) =>
      ranking !== 'platform_bestsellers' ||
      mode === 'category' ||
      route.id === 'tiktok-shop-scrapecreators',
  );
}

export function validateResourceInput(
  input: ResourceDiscoveryInput,
  route: ResourceRoute | undefined,
) {
  if (!route || route.id !== input.routeId) return '请选择已加载的资源路径';
  if (!route.markets.includes(input.market)) return '该路径不支持所选国家';
  if (!route.modes.includes(input.mode)) return '该路径不支持所选采集方式';
  if (!resourceRankingsForMode(route, input.mode).includes(input.ranking))
    return '该获取方式不支持所选排名口径';
  if (![30, 90, 180].includes(input.salesWindowDays))
    return '请选择30、90或180天销量统计窗口';
  if (
    !Number.isInteger(input.maxProducts) ||
    input.maxProducts < 1 ||
    input.maxProducts > Math.min(100, route.limits.maxProducts || 100)
  )
    return '目标数量超出该路径上限（最多100件）';
  if (input.mode === 'keyword') {
    const count = splitResourceLines(input.terms).length;
    if (
      !count ||
      count > 20 ||
      splitResourceLines(input.terms).some((term) => term.length > 200)
    )
      return '请输入1至20个关键词，每词不超过200字符';
  }
  if (
    input.mode === 'category' &&
    (!input.category?.id ||
      !input.category.receiptId ||
      !input.category.path.length ||
      input.category.market !== input.market)
  )
    return '请查询并选择当前国家返回的真实平台类目';
  if (input.mode === 'urls') {
    const urls = splitResourceLines(input.urls);
    if (!urls.length || urls.length > 100)
      return '请输入1至100个公开页面网址，每行一个';
    if (
      urls.some((value) => {
        try {
          const url = new URL(value);
          return url.protocol !== 'https:' || !!url.username || !!url.password;
        } catch {
          return true;
        }
      })
    )
      return '请填写有效的公开HTTPS网址';
  }
  if (route.platform === 'website') {
    try {
      const domain = new URL(`https://${input.websiteDomain || ''}`);
      if (
        !domain.hostname.includes('.') ||
        domain.pathname !== '/' ||
        domain.username ||
        domain.password ||
        domain.port ||
        domain.search ||
        domain.hash
      )
        return '请填写目标公开站点域名，例如brand.com';
    } catch {
      return '请填写目标公开站点域名，例如brand.com';
    }
  }
  if (
    (Object.keys(resourceBudgetMaximums) as Array<keyof ResourceBudget>).some(
      (key) =>
        key !== 'semrushUnits' &&
        (!Number.isInteger(input.budget[key]) ||
          input.budget[key] < 0 ||
          input.budget[key] > resourceBudgetMaximums[key]),
    )
  )
    return '预算必须为有限非负整数';
  if (!input.budget.requests || !input.budget.maxPages)
    return '请求和翻页上限至少为1';
  if (route.limits.maxPages && input.budget.maxPages > route.limits.maxPages)
    return `此路径最多翻页${route.limits.maxPages}次`;
  const required = providerBudgetKeys[route.provider];
  if (
    required &&
    ((required !== 'semrushUnits' && !input.budget[required]) ||
      !input.budget.providerCalls)
  )
    return '所选来源额度为0，请设置有限额度或使用公开链接';
  if (
    input.includeDetails &&
    (!resourceSupports(route, 'detail') || !input.budget.maxDetailProducts)
  )
    return '当前路径详情不可用或详情预算为0';
  if (input.includeHistory && !resourceSupports(route, 'history'))
    return '该路径不提供历史，已有观察需继续积累';
  return '';
}

export function resourceOriginalWindow(evidence: ResourceProductEvidence) {
  const window = evidence.metric.originalWindow;
  if (!window) return '来源未提供统计区间';
  const label: Record<string, string> = {
    rolling_days: '滚动窗口',
    calendar_month: '自然月',
    calendar_months: '自然月',
    source_month_unspecified: '来源月销量（起止日未确认）',
    cumulative: '累计至采集时点',
    lifetime: '累计至采集时点',
    snapshot: '采集时点快照',
    unknown: '区间未确认',
  };
  return [
    label[window.kind] || window.kind,
    window.days ? `${window.days}天` : '',
    [window.start, window.end].filter(Boolean).join(' 至 '),
  ]
    .filter(Boolean)
    .join(' · ');
}

export function resourceMetricValue(evidence: ResourceProductEvidence) {
  if (!['observed', 'available'].includes(evidence.metric.status))
    return (
      resourceStatusLabels[evidence.metric.status] || evidence.metric.status
    );
  const value =
    evidence.metric.raw ||
    (Number.isFinite(evidence.metric.value)
      ? String(evidence.metric.value)
      : '来源未返回');
  return [value, evidence.metric.unit].filter(Boolean).join(' ');
}

export function resourceRankingSummary(evidence: ResourceProductEvidence) {
  const kind = resourceRankingLabels[evidence.ranking.kind] || '排名口径待核验';
  const rank = evidence.ranking.rank;
  return [
    kind,
    Number.isInteger(rank) && Number(rank) > 0 ? `第${rank}名` : '暂无可比名次',
    evidence.ranking.population === 'source_list'
      ? '来源榜单范围'
      : '已采集样本范围',
  ].join(' · ');
}

export function resourceExportRecord(product: {
  sourceProductId?: string;
  resourceEvidence?: ResourceProductEvidence;
  resourceHistory?: ResourceProductEvidence[];
}) {
  const evidence = product.resourceEvidence;
  return {
    来源商品ID:
      product.sourceProductId || evidence?.identity?.sourceProductId || '',
    平台类目ID: evidence?.category?.id || '',
    平台类目路径: evidence?.category?.path.join(' > ') || '',
    统一研究类目: evidence?.researchCategory || '',
    资源路径: evidence?.routeId || '',
    销量请求窗口天数: evidence?.requestedWindow.days ?? '',
    原始销量口径: evidence
      ? resourceMetricLabels[evidence.metric.kind] || evidence.metric.kind
      : '',
    原始销量值:
      evidence && ['observed', 'available'].includes(evidence.metric.status)
        ? evidence.metric.raw || (evidence.metric.value ?? '')
        : '',
    原始销量状态: evidence
      ? resourceStatusLabels[evidence.metric.status] || evidence.metric.status
      : '',
    原始统计区间: evidence ? resourceOriginalWindow(evidence) : '',
    排名口径: evidence ? resourceRankingSummary(evidence) : '',
    排名覆盖: evidence?.coverage.reason || '',
    原币标价原文: evidence?.price?.raw ?? '',
    原币价格精度: evidence?.price?.precision || '',
    店铺ID: evidence?.identity?.shopId || '',
    店铺名称: evidence?.identity?.shopName || '',
    变体ID: evidence?.identity?.variantId || '',
    变体证据: evidence?.identity?.variants
      ? JSON.stringify(evidence.identity.variants)
      : '',
    资源采集证据JSON: evidence ? JSON.stringify(evidence) : '',
    资源历史证据JSON: product.resourceHistory?.length
      ? JSON.stringify(product.resourceHistory)
      : '',
  };
}
