import type { Ad, Keyword, Product, Site } from './data';
import { rollingTrendComparison } from './trend-comparison';

export type CoreKind = 'products' | 'sites' | 'ads' | 'keywords';
export type CorePeriod = 30 | 90 | 365;
export type MetricStatus =
  | 'available'
  | 'unsupported'
  | 'not_indexed'
  | 'accumulating'
  | 'failed'
  | 'budget_limited'
  | 'unverified';
export type MetricNature =
  | 'platform_display'
  | 'authorized'
  | 'third_party_estimate'
  | 'snapshot_delta'
  | 'system_observation'
  | 'brand_claim'
  | 'ai_summary'
  | 'unknown';
export interface EvidenceMetric {
  key: string;
  label: string;
  value: number | string | null;
  status: MetricStatus;
  reason: string;
  source: string;
  market: string;
  platform: string;
  unit: string;
  period: string;
  start?: string;
  end?: string;
  timezone: string;
  collectedAt: string;
  nature: MetricNature;
  evidenceUrl: string;
  precision?: string;
}
export interface CoreSnapshot {
  at: string;
  market: string;
  source: string;
  platform: string;
  scope: string;
  evidenceUrl: string;
  sold?: number;
  soldRaw?: string;
  soldPrecision?: string;
  organicTraffic?: number;
  paidTraffic?: number;
  price?: number;
  currency?: string;
  status?: string;
  creative?: string;
}
export interface FxRates {
  source: string;
  date: string;
  collectedAt: string;
  rates: Record<string, number>;
  evidenceUrl: string;
}
export interface CoreEvidence {
  version: 1;
  history?: CoreSnapshot[];
  historyCount?: number;
  historyTruncated?: boolean;
  fieldUpdatedAt?: Record<string, string>;
  metrics?: EvidenceMetric[];
  fx?: FxRates;
}
export interface CoreContext {
  complete?: boolean;
  products?: Product[];
  sites?: Site[];
  ads?: Ad[];
  keywords?: Keyword[];
  fx?: FxRates;
}
export interface CoreMetricSummary {
  periods?: Partial<Record<CorePeriod, EvidenceMetric[]>>;
  related?: {
    products?: number;
    ads?: number;
    hasIngredients?: boolean;
    hasPrices?: boolean;
    hasCreatives?: boolean;
    expansions?: Array<{ term: string; source: string }>;
  };
}
export const metricStatusLabels: Record<MetricStatus, string> = {
  available: '已获取',
  unsupported: '不支持',
  not_indexed: '未收录',
  accumulating: '待积累',
  failed: '失败',
  budget_limited: '预算截断',
  unverified: '待验证',
};
export const metricNatureLabels: Record<MetricNature, string> = {
  platform_display: '平台展示',
  authorized: '授权后台',
  third_party_estimate: '第三方估算',
  snapshot_delta: '快照增量',
  system_observation: '系统观察',
  brand_claim: '品牌宣称',
  ai_summary: 'AI归纳',
  unknown: '性质待核验',
};
const DAY = 86_400_000;
const validNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;
const zones: Record<string, string> = {
  VN: 'Asia/Ho_Chi_Minh',
  US: 'America/New_York',
  MX: 'America/Mexico_City',
};
const meaningful = (v?: string) =>
  !!v && !/^(平台未返回|未识别|待识别|待补充|未知|暂无|未采集|待核验)/.test(v);
const isoDay = (v: number) => new Date(v).toISOString().slice(0, 10);
export function marketDay(at: string, market: string) {
  if (!Number.isFinite(Date.parse(at))) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zones[market] || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}
export function rollingWindow(at: string, market: string, days: CorePeriod) {
  const end = marketDay(at, market);
  const n = Date.parse(`${end}T00:00:00Z`);
  return {
    start: Number.isFinite(n) ? isoDay(n - days * DAY) : '',
    end,
    timezone: zones[market] || 'UTC',
  };
}
export function missingStatus(status?: string, message = ''): MetricStatus {
  const s = `${status || ''} ${message}`;
  if (/budget|limit|截断|预算|上限/i.test(s)) return 'budget_limited';
  if (/unsupported|不支持|未开放/i.test(s)) return 'unsupported';
  if (/failed|error|失败|错误/i.test(s)) return 'failed';
  if (/empty|not.indexed|未收录|无数据/i.test(s)) return 'not_indexed';
  if (/pending|queued|running|积累|等待/i.test(s)) return 'accumulating';
  return 'unverified';
}
function metric(
  record: { market: string },
  key: string,
  label: string,
  value: EvidenceMetric['value'],
  unit: string,
  meta: Partial<EvidenceMetric> = {},
): EvidenceMetric {
  const available = value !== null && value !== undefined && value !== '';
  return {
    key,
    label,
    value: available ? value : null,
    unit,
    market: record.market,
    source: '来源未记录',
    platform: '',
    period: '来源未提供统计周期',
    timezone: zones[record.market] || 'UTC',
    collectedAt: '',
    evidenceUrl: '',
    nature: 'unknown',
    status: available ? 'available' : 'unverified',
    reason: available ? '' : '来源未提供该字段',
    ...meta,
  };
}
function productMeta(p: Product): Partial<EvidenceMetric> {
  return {
    source: p.sourceProvider || (p.siteId ? '官网公开详情' : '来源未记录'),
    platform: p.sourcePlatform || '',
    collectedAt:
      p.sourceMetrics?.collectedAt ||
      p.sourceContent?.collectedAt ||
      p.lastCollectedAt ||
      '',
    evidenceUrl: p.evidenceUrl || p.sourceUrl || '',
    nature:
      p.sourceProvider === 'Sorftime'
        ? 'third_party_estimate'
        : 'platform_display',
  };
}
function productSales(p: Product, days: CorePeriod): EvidenceMetric[] {
  const meta = productMeta(p);
  const anchor = meta.collectedAt || '';
  const bounds = rollingWindow(anchor, p.market, days);
  let sales = metric(p, 'sales', `近${days}天售出件数`, null, '件', {
    ...meta,
    ...bounds,
    period: `${days}个完整市场日 [起,止)`,
    status: 'accumulating',
    reason: '没有覆盖完整窗口的同口径销量；历史需积累或来源提供',
  });
  // Only nonoverlapping, complete source intervals may be summed. Calendar
  // months and partial intervals must never be relabelled as rolling days.
  for (const s of p.decisionData?.series || []) {
    if (
      s.metric !== 'sales_volume' ||
      s.market !== p.market ||
      s.productId !== p.sourceProductId ||
      s.platform !== p.sourcePlatform
    )
      continue;
    const points = s.points
      .filter(
        (v) =>
          !v.partial &&
          validNumber(v.value) &&
          Number.isFinite(Date.parse(v.start)) &&
          Number.isFinite(Date.parse(v.end)) &&
          v.end >= v.start,
      )
      .toSorted((a, b) => a.start.localeCompare(b.start));
    let cursor = bounds.start,
      total = 0;
    for (const point of points) {
      const next = isoDay(Date.parse(`${point.end}T00:00:00Z`) + DAY);
      if (point.start !== cursor || next > bounds.end) continue;
      total += point.value;
      cursor = next;
    }
    if (cursor === bounds.end && bounds.start) {
      sales = {
        ...sales,
        value: total,
        status: 'available',
        reason: s.basis || '完整来源区间相加；不是订单数',
        source: s.provider,
        platform: s.platform,
        nature: 'third_party_estimate',
        collectedAt: s.collectedAt,
        evidenceUrl: s.evidenceUrl || '',
      };
      break;
    }
  }
  if (sales.value === null) {
    const history = p.coreEvidence?.history || [];
    const sameScope = history.filter(
      (s): s is CoreSnapshot & { sold: number } =>
        s.market === p.market &&
        s.scope === p.sourceProductId &&
        s.source === meta.source &&
        s.platform === meta.platform &&
        validNumber(s.sold) &&
        s.soldPrecision === 'exact',
    );
    const midnight = (at: string) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zones[p.market] || 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(at)) === '00:00:00';
    const first = sameScope.find(
      (s) => marketDay(s.at, p.market) === bounds.start && midnight(s.at),
    );
    const last = sameScope.findLast(
      (s) => marketDay(s.at, p.market) === bounds.end && midnight(s.at),
    );
    if (first && last) {
      const between = sameScope.filter(
        (s) => s.at >= first.at && s.at <= last.at,
      );
      const reset = between.some(
        (s, i) => s.sold < (between[i - 1]?.sold ?? s.sold),
      );
      const dates = { start: first.at, end: last.at, collectedAt: last.at };
      sales = reset
        ? { ...sales, reason: '累计计数发生回退或重置，不能计算销量' }
        : {
            ...sales,
            ...dates,
            label: `近${days}天展示已售增量`,
            value: last.sold - first.sold,
            status: 'available',
            nature: 'snapshot_delta',
            period: `${days}个完整市场日的午夜边界快照`,
            reason:
              '同商品同来源累计展示差值；未观察到回退，非净成交，无订单数据',
          };
    }
  }
  const completion = p.dataCompletion?.trend_AsinSalesVolume;
  if (sales.value === null && completion)
    sales = {
      ...sales,
      status: ['done', 'completed', 'collected'].includes(completion.status)
        ? 'accumulating'
        : missingStatus(completion.status, completion.message),
      reason: `${completion.message}；${sales.reason}`,
    };
  const daily = metric(
    p,
    'dailySales',
    `日均件数（${days}天）`,
    typeof sales.value === 'number'
      ? Math.round((sales.value / days) * 100) / 100
      : null,
    '件/天',
    {
      ...sales,
      key: 'dailySales',
      label: `日均件数（${days}天）`,
      unit: '件/天',
      value:
        typeof sales.value === 'number'
          ? Math.round((sales.value / days) * 100) / 100
          : null,
    },
  );
  return [sales, daily];
}
export function productMetrics(
  p: Product,
  days: CorePeriod,
  context: CoreContext = {},
): EvidenceMetric[] {
  const meta = productMeta(p),
    sm = p.sourceMetrics;
  const fieldTime = (key: string) =>
    p.coreEvidence?.fieldUpdatedAt?.[key] || meta.collectedAt;
  const fx = context.fx || p.coreEvidence?.fx;
  const price =
    p.price > 0 || p.collectionFields?.includes('price') ? p.price : null;
  const rate = p.currency === 'USD' ? 1 : fx?.rates[p.currency];
  const usd =
    price !== null && rate && rate > 0
      ? Math.round((price / rate) * 100) / 100
      : null;
  let usdReason = `原币保留；汇率日 ${fx?.date || 'USD同币种'}，非历史价格换算`;
  if (usd === null)
    usdReason = price === null ? '未获取原币价格' : '未获取有来源与日期的汇率';
  let sellingNature: MetricNature = p.benefitEvidence
    ? 'ai_summary'
    : 'unknown';
  if (p.sourceContent?.sellingPoints?.length) sellingNature = 'brand_claim';
  const sold = sm?.soldCount;
  const raw = sm?.soldRaw;
  const result = [
    ...productSales(p, days),
    metric(
      p,
      'cumulativeSold',
      '平台累计展示已售',
      raw || (validNumber(sold) ? sold : null),
      '件',
      {
        ...meta,
        collectedAt: sm?.soldCollectedAt || meta.collectedAt,
        period: '累计起算日未知；当前快照',
        precision: sm?.soldPrecision || '未知',
        reason:
          raw || validNumber(sold)
            ? '累计展示不等于周期销量或净成交'
            : '来源未返回明确的累计售出件数',
      },
    ),
    metric(
      p,
      'reportedOrders',
      '来源报告订单数',
      validNumber(sm?.orderCount) ? sm.orderCount : null,
      '订单',
      {
        ...meta,
        collectedAt: fieldTime('orderCount'),
        period: '来源未提供统计周期；不计算日均',
        reason: '仅明确的订单字段，不用售出件数替代',
      },
    ),
    metric(p, 'priceUsd', '美元对比价', usd, 'USD', {
      ...meta,
      collectedAt: fieldTime('price'),
      nature: p.currency === 'USD' ? meta.nature : 'third_party_estimate',
      period: '当前报价；未统一税费/运费及变体',
      source:
        p.currency === 'USD'
          ? meta.source
          : `${meta.source}；汇率 ${fx?.source || '未获取'}`,
      reason: usdReason,
      precision: fx ? `1 USD = ${rate} ${p.currency}` : undefined,
    }),
    metric(p, 'priceOriginal', '原币价格', price, p.currency, {
      ...meta,
      collectedAt: fieldTime('price'),
      period: '当前报价；税费/运费是否包含未知',
    }),
    metric(
      p,
      'spec',
      '规格 / 剂型',
      meaningful(p.size) ? `${p.size} / ${p.form}` : null,
      '原文',
      {
        ...meta,
        collectedAt: fieldTime('size'),
        nature: 'platform_display',
        period: '当前商品标签',
      },
    ),
    metric(
      p,
      'ingredients',
      '成分与每份剂量',
      meaningful(p.ingredient)
        ? `${p.ingredient}；${p.dose || '剂量未知'}`
        : null,
      '原文',
      {
        ...meta,
        collectedAt: fieldTime('ingredient'),
        reason: p.coreEvidence?.fieldUpdatedAt?.dose
          ? `剂量字段采集时间 ${p.coreEvidence.fieldUpdatedAt.dose}`
          : '剂量字段采集时间未单独记录',
        nature:
          p.collectionFields?.includes('ingredients') ||
          p.formula?.status === 'verified'
            ? 'platform_display'
            : 'unknown',
        period: '当前商品标签',
      },
    ),
    metric(p, 'claim', '品牌功效宣称', p.claim || null, '原文', {
      ...meta,
      collectedAt: fieldTime('claim'),
      nature: 'brand_claim',
      period: '当前品牌描述',
      reason: p.claim ? '品牌表述，不代表已验证疗效' : '未获取品牌宣称',
    }),
    metric(
      p,
      'sellingPoints',
      '卖点',
      p.sourceContent?.sellingPoints?.join('；') ||
        p.benefits?.join('；') ||
        null,
      '文本',
      {
        ...meta,
        collectedAt: fieldTime('benefits'),
        nature: sellingNature,
        period: '当前商品描述',
        reason: p.sourceContent?.sellingPoints?.length
          ? '来源明确返回的卖点原文，不代表疗效验证'
          : p.benefitEvidence || '未记录归纳依据',
      },
    ),
  ];
  for (const s of p.decisionData?.series || []) {
    if (s.metric !== 'sales_volume' || s.market !== p.market) continue;
    const v = s.points.findLast((v) => !v.partial);
    if (v)
      result.push(
        metric(p, 'sourceSales', '来源原始周期销量', v.value, '件', {
          ...meta,
          source: s.provider,
          nature: 'third_party_estimate',
          start: v.start,
          end: v.end,
          period: s.period,
          collectedAt: s.collectedAt,
          reason: s.basis || '保留原始窗口，不等同近30天',
        }),
      );
  }
  const snapshots = (p.coreEvidence?.history || []).filter(
    (s): s is CoreSnapshot & { sold: number } =>
      s.market === p.market &&
      s.scope === p.sourceProductId &&
      s.source === meta.source &&
      s.soldPrecision === 'exact' &&
      validNumber(s.sold),
  );
  const a = snapshots[0],
    b = snapshots.at(-1);
  if (a && b && a.at !== b.at) {
    const reset = snapshots.some(
      (s, i) => s.sold < (snapshots[i - 1]?.sold ?? s.sold),
    );
    const elapsed = (Date.parse(b.at) - Date.parse(a.at)) / DAY;
    result.push(
      metric(
        p,
        'observedDelta',
        '实际观察区间展示已售增量',
        reset ? null : b.sold - a.sold,
        '件',
        {
          ...meta,
          nature: 'snapshot_delta',
          start: a.at,
          end: b.at,
          period: `实际观察${Math.round(elapsed * 100) / 100}天`,
          status: reset ? 'unverified' : 'available',
          reason: reset
            ? '计数回退/重置，增量无效'
            : '首尾展示差值，非净成交，不外推为30/90/365天销量',
        },
      ),
    );
  }
  if (validNumber(sm?.monthlySales))
    result.push(
      metric(
        p,
        'reportedMonthlySales',
        '来源报告月销量',
        sm.monthlySales,
        '件',
        {
          ...meta,
          nature: 'third_party_estimate',
          period: '来源月度口径；起止日未提供',
          reason: '不能直接当作近30天销量',
        },
      ),
    );
  const unclassifiedSales =
    sm?.unclassifiedSales ||
    (p.sourcePlatform === 'TikTok Shop' &&
    validNumber(sm?.reportedSales) &&
    !validNumber(sm?.soldCount)
      ? String(sm.reportedSales)
      : '');
  if (unclassifiedSales)
    result.push(
      metric(
        p,
        'unclassifiedSales',
        '来源销售字段（口径未知）',
        unclassifiedSales,
        '未确认',
        {
          ...meta,
          nature: 'unknown',
          period: '统计窗口未知',
          reason:
            '上游sales或旧reportedSales未保留可核验的累计/周期/件数/订单口径，未参与计算',
        },
      ),
    );
  return result;
}
export function siteMetrics(
  s: Site,
  context: CoreContext = {},
): EvidenceMetric[] {
  const m = s.metrics?.market === s.market ? s.metrics : undefined;
  const meta: Partial<EvidenceMetric> = {
    source: m?.source || 'Semrush MCP',
    collectedAt: m?.collectedAt || '',
    evidenceUrl: s.evidenceUrl || `https://${s.domain}`,
    nature: 'third_party_estimate',
    platform: 'Google搜索',
    period: m?.period || '来源月度搜索估算；起止日未提供',
    status: missingStatus(s.metricsStatus, s.metricsMessage),
    reason: s.metricsMessage || '尚未获取该市场的来源指标',
  };
  const entries: Array<[string, string, number | undefined, string]> = [
    ['organicTraffic', '自然搜索流量估算', m?.organicTraffic, '次/月（估算）'],
    ['paidTraffic', '付费搜索流量估算', m?.paidTraffic, '次/月（估算）'],
    ['organicKeywords', '自然搜索关键词覆盖', m?.organicKeywords, '词'],
    ['paidKeywords', '付费搜索关键词覆盖', m?.paidKeywords, '词'],
  ];
  const result = entries.map(([key, label, v, unit]) =>
    metric(s, key, label, validNumber(v) ? v : null, unit, {
      ...meta,
      ...(validNumber(v)
        ? {
            status: 'available' as const,
            reason:
              key === 'paidTraffic'
                ? '付费搜索，不是FB/TK广告流量'
                : '目标市场搜索估算，不是全站访问量',
          }
        : {}),
    }),
  );
  const history = s.coreEvidence?.history || [];
  const comparable = history.filter(
    (h): h is CoreSnapshot & { organicTraffic: number } =>
      h.market === s.market &&
      h.source === m?.source &&
      validNumber(h.organicTraffic),
  );
  const a = comparable.at(-2),
    b = comparable.at(-1);
  result.push(
    metric(
      s,
      'trafficChange',
      '自然搜索流量快照变化',
      a && b ? b.organicTraffic - a.organicTraffic : null,
      '估算次数差',
      {
        ...meta,
        status: a && b ? 'available' : 'accumulating',
        nature: 'snapshot_delta',
        start: a?.at,
        end: b?.at,
        period: a && b ? '相邻来源快照，非固定周期增长率' : '待积累可比快照',
        reason:
          a && b
            ? '同来源同市场搜索估算变化，非实际访问量增长'
            : '缺少两个同市场同来源快照',
      },
    ),
  );
  const ads = (context.complete === false ? undefined : context.ads)?.filter(
    (a) => a.market === s.market && a.siteIds?.includes(s.id),
  );
  const products = (context.complete === false ? undefined : context.products)?.filter(
    (p) => p.market === s.market && p.siteId === s.id,
  );
  const observed = {
    ...meta,
    source: '系统关联记录',
    nature: 'system_observation' as const,
    period: '当前已保存记录',
    collectedAt: s.lastCollectedAt || m?.collectedAt || '',
  };
  const related = s.coreSummary?.related;
  const adCount = related?.ads ?? ads?.length;
  const productCount = related?.products ?? products?.length;
  result.push(
    metric(s, 'linkedAds', '关联广告', adCount ?? null, '条已保存', {
      ...observed,
      status: adCount !== undefined ? 'available' : 'unverified',
      reason: '观察数量不代表盈利或全量投放',
    }),
    metric(
      s,
      'linkedProducts',
      '商品覆盖',
      productCount ?? null,
      '件已保存',
      {
        ...observed,
        status: productCount !== undefined ? 'available' : 'unverified',
        reason: '已保存商品覆盖，不是全站商品总数',
      },
    ),
  );
  const uses = [];
  if (related?.hasIngredients ?? products?.some((p) => meaningful(p.ingredient)))
    uses.push('配方参考：有关联商品成分原文');
  if (related?.hasPrices ?? products?.some((p) => p.price > 0)) uses.push('价格参考：有公开商品报价');
  if (related?.hasCreatives ?? ads?.some((a) => a.imageUrls?.length || a.videoUrls?.length))
    uses.push('素材参考：有可回查关联广告');
  if (s.evidenceUrl || s.domain) uses.push('落地页参考：有公开站点链接');
  uses.push('销售参考待证实：无授权经营数据');
  result.push(
    metric(s, 'referenceUse', '参考用途及依据', uses.join('；'), '用途', {
      ...observed,
      status: 'available',
      reason: '用途不代表经营绩效或利润',
    }),
  );
  for (const [key, label, unit] of [
    ['visits', '全站访问量', '次'],
    ['revenue', '实际营收', '金额'],
    ['conversion', '实际转化率', '%'],
    ['roas', '实际ROAS', '倍'],
  ] as const)
    result.push(
      metric(s, key, label, null, unit, {
        ...meta,
        status: 'unsupported',
        reason: '当前来源未提供授权的全站分析或经营数据',
      }),
    );
  return result;
}
export function adMetrics(a: Ad, context: CoreContext = {}): EvidenceMetric[] {
  const meta: Partial<EvidenceMetric> = {
    source: a.source || '来源未记录',
    platform: a.platform,
    collectedAt: a.lastCollectedAt || '',
    evidenceUrl: a.evidenceUrl || '',
    nature: 'platform_display',
    period: '当前来源记录',
  };
  const result = [
    metric(
      a,
      'status',
      '广告状态',
      a.status === '未知' ? null : a.status,
      '状态',
      meta,
    ),
    metric(a, 'startDate', '平台开始日期', a.startDate || null, '日期', meta),
    metric(a, 'firstObserved', '系统首次观察', a.firstSeenAt || null, '时间', {
      ...meta,
      source: '系统采集日志',
      nature: 'system_observation',
    }),
    metric(
      a,
      'lastObserved',
      '系统最近观察',
      a.lastCollectedAt || null,
      '时间',
      {
        ...meta,
        source: '系统采集日志',
        nature: 'system_observation',
        reason: '首尾跨度不代表连续在投',
      },
    ),
    metric(
      a,
      'creative',
      '素材与形式',
      [a.format, ...(a.imageUrls || []), ...(a.videoUrls || [])]
        .filter(Boolean)
        .join('；') || null,
      '素材链接',
      meta,
    ),
    metric(
      a,
      'sellingPoints',
      '素材卖点原文',
      a.headline || a.copy || null,
      '原文',
      { ...meta, nature: 'brand_claim' },
    ),
    metric(
      a,
      'advertiser',
      '广告主',
      [a.brand, a.pageId].filter(Boolean).join(' / ') || null,
      '名称 / ID',
      meta,
    ),
    metric(
      a,
      'linkedProducts',
      '关联商品',
      a.productId
        ? context.products?.find((p) => p.id === a.productId)?.title ||
            a.productId
        : null,
      '商品',
      {
        ...meta,
        nature: 'system_observation',
        reason: a.productId
          ? '保存的商品关联；需回查落地证据'
          : '没有精确商品落地链接，不按同标题自动关联',
      },
    ),
    metric(
      a,
      'landingPages',
      '落地页',
      a.landingUrls?.join('；') || null,
      'URL',
      meta,
    ),
    metric(
      a,
      'linkedSites',
      '关联站点',
      a.siteIds
        ?.map((id) => context.sites?.find((s) => s.id === id)?.domain || id)
        .join('；') || null,
      '站点',
      { ...meta, nature: 'system_observation' },
    ),
  ];
  for (const [key, label, unit] of [
    ['spend', '广告花费', '原币'],
    ['impressions', '曝光', '次'],
    ['clicks', '点击', '次'],
    ['purchases', '购买', '订单'],
    ['roas', 'ROAS', '倍'],
  ] as const) {
    const supported = a.coreEvidence?.metrics?.find(
      (v) =>
        v.key === key &&
        v.market === a.market &&
        v.source &&
        v.nature !== 'unknown',
    );
    result.push(
      supported ||
        metric(a, key, label, null, unit, {
          ...meta,
          status: 'unsupported',
          reason: '当前公开来源未提供可核验经营指标',
        }),
    );
  }
  const history = a.coreEvidence?.history || [];
  result.push(
    metric(
      a,
      'observations',
      '有效观察次数',
      a.coreEvidence?.historyCount ??
        (history.length > 0 ? history.length : null),
      '次',
      {
        ...meta,
        source: '系统保存快照',
        nature: 'system_observation',
        period: '已采集时点；间隔内状态未知',
        reason: '多次观察不证明连续投放或盈利',
      },
    ),
  );
  return result;
}
function normalizedTerm(v: string) {
  return v.normalize('NFKC').trim().toLowerCase().replaceAll(/\s+/g, ' ');
}
const aiSource = /\bAI\b|OpenAI|模型|人工智能/i;
export function keywordMetrics(
  k: Keyword,
  days: CorePeriod,
  context: CoreContext = {},
): EvidenceMetric[] {
  const m = k.metrics?.market === k.market ? k.metrics : undefined;
  const trend = rollingTrendComparison(k, days);
  const meta: Partial<EvidenceMetric> = {
    source: 'Google Trends',
    platform: 'Google',
    collectedAt: trend.collectedAt || '',
    evidenceUrl: k.trendSourceUrl || '',
    period: `近${days}天；Google相对尺度`,
    nature: 'third_party_estimate',
    start: trend.start,
    end: trend.end,
    timezone: 'UTC',
    reason: trend.reason,
  };
  const result = [
    metric(
      k,
      'searchVolume',
      '目标市场月搜索量估算',
      validNumber(m?.monthlySearchVolume) ? m.monthlySearchVolume : null,
      '次/月（估算）',
      {
        source: m?.source || 'Semrush MCP',
        platform: 'Google搜索',
        collectedAt: m?.collectedAt || '',
        period: '来源月度估算；起止日未提供',
        nature: 'third_party_estimate',
        status: validNumber(m?.monthlySearchVolume)
          ? 'available'
          : missingStatus(
              k.semrushCollection?.status,
              k.semrushCollection?.message,
            ),
        reason: m
          ? '目标市场来源估算，不是实际搜索日志'
          : k.semrushCollection?.message || '未获取该市场搜索量，不使用US代替',
      },
    ),
    metric(k, 'relativeHeat', 'Google相对热度', trend.heat, '0-100', {
      ...meta,
      status:
        trend.heat === null
          ? missingStatus(k.trendStatus, k.trendMessage)
          : 'available',
    }),
    metric(k, 'trendChange', `近${days}天相对热度变化`, trend.change, '%', {
      ...meta,
      status: trend.change === null ? 'accumulating' : 'available',
    }),
  ];
  const top = k.trendRelatedTop,
    rising = k.trendRelatedRising;
  for (const [key, label, list] of [
    ['relatedTop', '热门相关查询', top],
    ['relatedRising', '上升相关查询', rising],
  ] as const)
    result.push(
      metric(
        k,
        key,
        label,
        list?.map((v) => `${v.query} (${v.formattedValue})`).join('；') || null,
        '查询词',
        {
          ...meta,
          collectedAt: k.trendCollectedAt || '',
          period: k.trendInsightsPeriod || '来源相关查询窗口',
          status: list?.length
            ? 'available'
            : missingStatus(k.trendInsightsStatus, k.trendInsightsMessage),
          reason: list?.length
            ? '来源相关查询，不是实际搜索次数'
            : k.trendInsightsMessage || '来源未提供相关查询',
        },
      ),
    );
  const expanded = k.coreSummary?.related?.expansions ?? (context.complete === false ? undefined : context.keywords)?.filter(
    (v) =>
      v.market === k.market &&
      normalizedTerm(v.seedTerm || '') === normalizedTerm(k.term) &&
      normalizedTerm(v.term) !== normalizedTerm(k.term),
  );
  const groups: Array<[string, string, string[] | undefined]> = [
    [
      'autocomplete',
      '搜索联想',
      expanded
        ?.filter((v) => /联想|autocomplete/i.test(v.source))
        .map((v) => v.term),
    ],
    [
      'aiSuggestions',
      'AI建议',
      expanded?.filter((v) => aiSource.test(v.source)).map((v) => v.term),
    ],
    [
      'otherExpansion',
      '其他来源扩词',
      expanded
        ?.filter(
          (v) =>
            !/联想|autocomplete/i.test(v.source) && !aiSource.test(v.source),
        )
        .map((v) => v.term),
    ],
  ];
  for (const [key, label, list] of groups)
    result.push(
      metric(
        k,
        key,
        label,
        list ? new Set(list.map((v) => normalizedTerm(v))).size : null,
        '个去重词',
        {
          source: '系统已保存扩词及来源标签',
          platform: '多来源',
          collectedAt: k.updatedAt || k.collectedAt || '',
          nature: key === 'aiSuggestions' ? 'ai_summary' : 'system_observation',
          period: '当前保存的同市场种子关系',
          reason: '扩词数量不是搜索次数；来源类型分别保留',
        },
      ),
    );
  const all = [
    ...(top || []).map((v) => v.query),
    ...(rising || []).map((v) => v.query),
    ...(expanded || []).map((v) => v.term),
  ];
  result.push(
    metric(
      k,
      'expansionCount',
      '去重扩词数量',
      expanded || top || rising
        ? new Set(
            all
              .map((v) => normalizedTerm(v))
              .filter((v) => v !== normalizedTerm(k.term)),
          ).size
        : null,
      '个去重词',
      {
        source: '系统保存的相关查询/联想/建议',
        collectedAt: k.updatedAt || k.collectedAt || '',
        nature: 'system_observation',
        period: '当前保存记录',
        reason: '跨类型去重计数，不是搜索次数或完整需求规模',
      },
    ),
  );
  for (const [key, label, ids] of [
    ['linkedProducts', '关联商品', k.productIds],
    ['linkedSites', '关联站点', k.siteIds],
  ] as const)
    result.push(
      metric(k, key, label, ids?.length ?? null, '条已保存', {
        source: '系统保存的关联',
        collectedAt: k.updatedAt || '',
        nature: 'system_observation',
        period: '当前关联记录',
      }),
    );
  return result;
}
export function coreMetrics(
  kind: CoreKind,
  record: Product | Site | Ad | Keyword,
  days: CorePeriod = 30,
  context: CoreContext = {},
) {
  let metrics: EvidenceMetric[];
  switch (kind) {
    case 'products': {
      metrics = productMetrics(record as Product, days, context);
      break;
    }
    case 'sites': {
      metrics = siteMetrics(record as Site, context);
      break;
    }
    case 'ads': {
      metrics = adMetrics(record as Ad, context);
      break;
    }
    default: {
      metrics = keywordMetrics(record as Keyword, days, context);
    }
  }
  for (const summary of record.coreSummary?.periods?.[days] || []) {
    const index = metrics.findIndex((item) => item.key === summary.key);
    if (index < 0) metrics.push(summary);
    else metrics[index] = summary;
  }
  const collectedAt =
    metrics
      .map((m) => m.collectedAt)
      .filter((v) => Number.isFinite(Date.parse(v)))
      .toSorted()
      .at(-1) || '';
  const sources = [
    ...new Set(
      metrics
        .filter((m) => m.value !== null && m.source !== '来源未记录')
        .map((m) => m.source),
    ),
  ].slice(0, 3);
  return [
    ...metrics,
    metric(
      record,
      'sourceContext',
      '来源 / 更新时间',
      `${sources.join('；') || '来源待核对'} · ${collectedAt || '时间未记录'}`,
      '来源 / 时间',
      {
        source: sources.join('；') || '来源未记录',
        collectedAt,
        period: '各指标保留独立采集时间；此处列最近时间',
        nature: 'system_observation',
        reason: '逐项口径及缺失原因见指标证据',
      },
    ),
  ];
}
export function metricText(m: EvidenceMetric) {
  if (m.value === null) return metricStatusLabels[m.status];
  return typeof m.value === 'number'
    ? m.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    : m.value;
}
export function coreExport(
  kind: CoreKind,
  record: Product | Site | Ad | Keyword,
  context: CoreContext = {},
) {
  const result: Record<string, number | string> = {
    记录ID: record.id,
    市场: record.market,
  };
  const periods: CorePeriod[] =
    kind === 'products' || kind === 'keywords' ? [30, 90, 365] : [30];
  const seen = new Set<string>();
  for (const days of periods)
    for (const m of coreMetrics(kind, record, days, context)) {
      const prefix = [
        'sales',
        'dailySales',
        'relativeHeat',
        'trendChange',
      ].includes(m.key)
        ? `${days}天_${m.key}`
        : m.key;
      if (seen.has(prefix)) continue;
      seen.add(prefix);
      result[`${prefix}_指标`] = m.label;
      result[`${prefix}_值`] = m.value ?? '';
      for (const [suffix, value] of Object.entries({
        单位: m.unit,
        来源: m.source,
        市场: m.market,
        平台: m.platform,
        统计周期: m.period,
        起始: m.start || '',
        截止: m.end || '',
        时区: m.timezone,
        采集时间: m.collectedAt,
        性质: metricNatureLabels[m.nature],
        状态: metricStatusLabels[m.status],
        缺失或口径说明: m.reason,
        精度: m.precision || '',
        证据: m.evidenceUrl,
      }))
        result[`${prefix}_${suffix}`] = value;
    }
  result.历史快照JSON = JSON.stringify(
    'coreEvidence' in record ? record.coreEvidence?.history || [] : [],
  );
  result.累计观察快照数 =
    record.coreEvidence?.historyCount ??
    record.coreEvidence?.history?.length ??
    '';
  result.快照保留范围 = record.coreEvidence?.historyTruncated
    ? '当前记录仅含最近600个以内且160KB以内快照；更早观察保存在服务端独立档案'
    : '当前记录包含已保存快照';
  if (kind === 'products')
    result.美元换算汇率JSON = JSON.stringify(
      context.fx || record.coreEvidence?.fx || null,
    );
  result.原始字段JSON = JSON.stringify(record);
  return result;
}
