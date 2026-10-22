import { trendComparisons } from './trend-comparison';
import type { Ad, DemoState, Keyword, Market, Product } from './data';
import type { FreeSourceData, PublicSignal } from './public-sources';
import { discoveryDecision } from './discovery';
import { validDiscoveryDate } from '../../../../../server/discovery-newness.mjs';

export type RadarFindingType = 'ad' | 'concept' | 'ingredient' | 'product';
export type RadarFindingStatus =
  | 'confirmed'
  | 'demo'
  | 'newly-discovered'
  | 'pending';

export interface RadarEvidence {
  detail: string;
  id: string;
  kind:
    | 'ad'
    | 'content'
    | 'keyword'
    | 'product'
    | 'regulatory'
    | 'research'
    | 'site'
    | 'trend';
  observedAt: string;
  source: string;
  url?: string;
}

export interface RadarFinding {
  adoptionCount: number;
  businessScore: null | number;
  category: string;
  confidenceScore: number;
  evidence: RadarEvidence[];
  firstSeenAt: string;
  gaps: string[];
  id: string;
  market: Market;
  rationale: string[];
  status: RadarFindingStatus;
  subtitle: string;
  title: string;
  trendGrowth: null | number;
  type: RadarFindingType;
}

export interface RadarSourceCoverage {
  automated: boolean;
  count: number;
  key: string;
  label: string;
  lastUpdated: string;
  note: string;
  status: 'available' | 'missing' | 'partial';
}

export interface PublicCollectorData {
  configuredSites: number;
  events: Array<{
    id: string;
    observedAt: string;
    observationId: string;
    siteId: string;
    title: string;
    type: 'changed' | 'newly-discovered';
    url: string;
  }>;
  generatedAt: null | string;
  observations: Array<{
    brand: string;
    capturedAt: string;
    changeType: 'changed' | 'newly-discovered' | 'unchanged';
    currency: null | string;
    description: string;
    firstSeenAt: string;
    id: string;
    market: Market;
    price: null | number | string;
    publishedAt: null | string;
    siteId: string;
    title: string;
    url: string;
  }>;
  sourceRuns: Array<{
    note: string;
    siteId: string;
    status: string;
  }>;
}

const today = () => new Date().toISOString().slice(0, 10);

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function daysSince(value?: string) {
  const time = validDiscoveryDate(value);
  return time === undefined || Date.parse(value || '') > Date.now() ? Infinity : Math.floor((Date.now() - time) / 86_400_000);
}

function withinWindow(value: string | undefined, windowDays: number) {
  return daysSince(value) <= windowDays;
}

function keywordGrowth(keywords: Keyword[], category: string, market: Market) {
  const values = keywords
    .filter(
      (item) =>
        item.market === market &&
        item.category === category &&
        item.growth !== null,
    )
    .map((item) => item.growth as number);
  if (values.length === 0) return null;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function productEvidence(product: Product, ads: Ad[], keywords: Keyword[]) {
  const relatedAds = ads.filter((ad) => ad.productId === product.id);
  const relatedKeywords = keywords.filter((keyword) =>
    keyword.productIds.includes(product.id),
  );
  const observedAt = product.firstSeenAt || today();
  const evidence: RadarEvidence[] = [
    {
      id: `product-${product.id}`,
      kind: 'product',
      source:
        product.sourceProvider ? `${product.sourceProvider} · ${product.sourcePlatform || '平台商品'}` : product.dataNature === 'imported' ? '人工导入商品资料' : '官网商品页',
      detail: `${product.title} · ${product.ingredient} · ${product.dose}`,
      observedAt,
      url: product.evidenceUrl,
    },
  ];
  for (const ad of relatedAds) {
    evidence.push({
      id: `ad-${ad.id}`,
      kind: 'ad',
      source: ad.platform,
      detail: `${ad.headline}；${ad.copy}`,
      observedAt: ad.firstSeenAt || observedAt,
      url: ad.evidenceUrl,
    });
  }
  for (const keyword of relatedKeywords.slice(0, 2)) {
    evidence.push({
      id: `keyword-${keyword.id}`,
      kind: keyword.series.length > 0 ? 'trend' : 'keyword',
      source: keyword.source,
      detail:
        keyword.growth === null
          ? `${keyword.term}：缺少可比较趋势`
          : `${keyword.term}：30天变化 ${keyword.growth > 0 ? '+' : ''}${keyword.growth}%`,
      observedAt: keyword.updatedAt || observedAt,
    });
  }
  return evidence;
}

function productFindings(
  state: DemoState,
  windowDays: number,
  includeDemo: boolean,
) {
  return state.products
    .filter((product) => includeDemo || product.dataNature !== 'demo')
    .filter((product) => withinWindow(product.firstSeenAt, windowDays))
    .filter((product) => discoveryDecision(product, 'product').isNew !== false)
    .map<RadarFinding>((product) => {
      const decision = discoveryDecision(product, 'product');
      const evidence = productEvidence(product, state.ads, state.keywords);
      const growth = keywordGrowth(
        state.keywords,
        product.category,
        product.market,
      );
      const relatedAds = state.ads.filter(
        (ad) => ad.productId === product.id,
      ).length;
      const factualEvidence = product.evidenceUrl ? 35 : 20;
      const confidence = clamp(
        factualEvidence +
          25 +
          Math.max(5, 20 - daysSince(product.firstSeenAt)) +
          Math.min(20, Math.max(0, evidence.length - 1) * 8),
      );
      const gaps = [
        decision.isNew === true ? '' : '缺少有来源的有效上架日期，只能认定为近期新发现',
        '尚未接入MOQ、成本、交期和目标市场合规结论',
      ].filter(Boolean);
      const businessScore = clamp(
        24 +
          Math.max(0, Math.min(25, (growth || 0) / 2)) +
          Math.min(20, relatedAds * 12) +
          (product.reviewed ? 14 : 7),
      );
      return {
        id: `radar-product-${product.id}`,
        type: 'product',
        title: product.title,
        subtitle: `${product.brand} · ${product.form} · ${product.ingredient}`,
        category: product.category,
        market: product.market,
        firstSeenAt: product.firstSeenAt!.slice(0, 10),
        status:
          product.dataNature === 'demo'
            ? 'demo'
            : decision.isNew === true
              ? 'confirmed'
              : 'newly-discovered',
        confidenceScore: confidence,
        businessScore,
        trendGrowth: growth,
        adoptionCount: 1,
        evidence,
        rationale: [
          decision.reason,
          `最近 ${daysSince(product.firstSeenAt)} 天首次进入系统；最近发现 ${product.discovery?.lastSeenAt?.slice(0, 10) || '未知'}`,
          relatedAds
            ? `关联 ${relatedAds} 条近期广告信号`
            : '暂未发现关联广告信号',
          growth === null
            ? '缺少同品类可比较趋势'
            : `同品类关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
        ],
        gaps,
      };
    });
}

function conceptFindings(
  state: DemoState,
  windowDays: number,
  includeDemo: boolean,
) {
  const groups = new Map<string, Product[]>();
  for (const product of state.products) {
    if (!includeDemo && product.dataNature === 'demo') continue;
    if (!withinWindow(product.firstSeenAt, windowDays)) continue;
    for (const benefit of product.benefits) {
      const key = `${product.market}:${benefit}`;
      groups.set(key, [...(groups.get(key) || []), product]);
    }
  }
  return [...groups.entries()].map<RadarFinding>(([key, products]) => {
    const concept = key.split(':').slice(1).join(':');
    const product = products[0]!;
    const brandCount = new Set(products.map((item) => item.brand)).size;
    const ads = state.ads.filter((ad) =>
      products.some((item) => item.id === ad.productId),
    );
    const keywords = state.keywords.filter(
      (keyword) =>
        keyword.market === product.market &&
        keyword.category === product.category,
    );
    const growth = keywordGrowth(
      state.keywords,
      product.category,
      product.market,
    );
    const evidence: RadarEvidence[] = [
      ...products.slice(0, 3).map((item) => ({
        id: `concept-product-${item.id}-${concept}`,
        kind: 'product' as const,
        source: '官网商品卖点',
        detail: `${item.brand} · ${item.title}：${item.benefitEvidence}`,
        observedAt: item.firstSeenAt || today(),
        url: item.evidenceUrl,
      })),
      ...ads.slice(0, 2).map((ad) => ({
        id: `concept-ad-${ad.id}-${concept}`,
        kind: 'ad' as const,
        source: ad.platform,
        detail: `${ad.headline}；${ad.copy}`,
        observedAt: ad.firstSeenAt || today(),
        url: ad.evidenceUrl,
      })),
      ...keywords.slice(0, 1).map((keyword) => ({
        id: `concept-keyword-${keyword.id}-${concept}`,
        kind: 'trend' as const,
        source: keyword.source,
        detail: `${keyword.term} · 30天变化 ${keyword.growth ?? '数据不足'}${keyword.growth === null ? '' : '%'}`,
        observedAt: keyword.updatedAt || today(),
      })),
    ];
    const sourceKinds = new Set(evidence.map((item) => item.kind)).size;
    const confidence = clamp(
      20 + brandCount * 12 + sourceKinds * 12 + Math.max(0, (growth || 0) / 4),
    );
    return {
      id: `radar-concept-${product.market}-${concept}`,
      type: 'concept',
      title: concept,
      subtitle: `${product.category} · ${brandCount} 个品牌采用`,
      category: product.category,
      market: product.market,
      firstSeenAt: products
        .map((item) => item.firstSeenAt || today())
        .sort()
        .reverse()[0]!,
      status: products.every((item) => item.dataNature === 'demo')
        ? 'demo'
        : 'pending',
      confidenceScore: confidence,
      businessScore: clamp(
        20 + brandCount * 12 + ads.length * 8 + Math.max(0, (growth || 0) / 2),
      ),
      trendGrowth: growth,
      adoptionCount: brandCount,
      evidence,
      rationale: [
        `${products.length} 个商品、${brandCount} 个品牌采用该表达`,
        `${ads.length} 条关联广告，${sourceKinds} 类独立证据`,
        growth === null
          ? '暂缺趋势验证'
          : `同品类关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
      ],
      gaps: [
        brandCount < 2 ? '尚未达到“至少2个品牌采用”的确认门槛' : '',
        sourceKinds < 2 ? '尚未达到两类独立来源交叉验证门槛' : '',
      ].filter(Boolean),
    };
  });
}

function ingredientFindings(
  state: DemoState,
  windowDays: number,
  includeDemo: boolean,
) {
  const groups = new Map<string, Product[]>();
  for (const product of state.products) {
    if (!includeDemo && product.dataNature === 'demo') continue;
    if (!withinWindow(product.firstSeenAt, windowDays)) continue;
    for (const insight of product.ingredientInsights) {
      const key = `${product.market}:${insight.name.toLowerCase()}`;
      groups.set(key, [...(groups.get(key) || []), product]);
    }
  }
  return [...groups.entries()].map<RadarFinding>(([key, products]) => {
    const ingredientKey = key.split(':').slice(1).join(':');
    const product = products[0]!;
    const insight = product.ingredientInsights.find(
      (item) => item.name.toLowerCase() === ingredientKey,
    )!;
    const brandCount = new Set(products.map((item) => item.brand)).size;
    const growth = keywordGrowth(
      state.keywords,
      product.category,
      product.market,
    );
    const evidence: RadarEvidence[] = products.slice(0, 3).map((item) => {
      const itemInsight = item.ingredientInsights.find(
        (entry) => entry.name.toLowerCase() === ingredientKey,
      )!;
      return {
        id: `ingredient-${item.id}-${ingredientKey}`,
        kind: 'product',
        source: '官网成分表 / 商品标签',
        detail: `${item.brand} · ${item.title}：${itemInsight.amount}；${itemInsight.evidence}`,
        observedAt: item.firstSeenAt || today(),
        url: item.evidenceUrl,
      };
    });
    const confidence = clamp(
      45 + Math.min(25, brandCount * 10) + (product.reviewed ? 20 : 5),
    );
    return {
      id: `radar-ingredient-${product.market}-${ingredientKey}`,
      type: 'ingredient',
      title: insight.name,
      subtitle: `${insight.amount} · ${product.form}`,
      category: product.category,
      market: product.market,
      firstSeenAt: products
        .map((item) => item.firstSeenAt || today())
        .sort()
        .reverse()[0]!,
      status: products.every((item) => item.dataNature === 'demo')
        ? 'demo'
        : 'pending',
      confidenceScore: confidence,
      businessScore: clamp(
        25 + brandCount * 12 + Math.max(0, (growth || 0) / 2),
      ),
      trendGrowth: growth,
      adoptionCount: brandCount,
      evidence,
      rationale: [
        `${products.length} 个商品标签出现，涉及 ${brandCount} 个品牌`,
        `记录剂量口径：${insight.amount}`,
        growth === null
          ? '暂缺相关需求趋势'
          : `关联品类关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
      ],
      gaps: [
        brandCount < 2 ? '目前只有单一品牌证据，仍属于成分候选' : '',
        '缺少供应商、MOQ、成本、交期及目标市场合规资料',
      ].filter(Boolean),
    };
  });
}

export function buildRadarFindings(
  state: DemoState,
  windowDays: number,
  includeDemo = true,
) {
  const compared = { ...state, keywords: state.keywords.map(k => ({...k, growth: trendComparisons(k)[0]!.change})) };
  return [
    ...adFindings(compared, windowDays, includeDemo),
    ...productFindings(compared, windowDays, includeDemo),
    ...conceptFindings(compared, windowDays, includeDemo),
    ...ingredientFindings(compared, windowDays, includeDemo),
  ].sort(
    (a, b) =>
      (b.businessScore ?? -1) - (a.businessScore ?? -1) ||
      b.confidenceScore - a.confidenceScore,
  );
}

function adFindings(state: DemoState, windowDays: number, includeDemo: boolean): RadarFinding[] {
  return state.ads.filter((ad) => (includeDemo || ad.dataNature !== 'demo') && withinWindow(ad.firstSeenAt, windowDays))
    .filter((ad) => discoveryDecision(ad, 'ad').isNew !== false)
    .map((ad) => {
      const decision = discoveryDecision(ad, 'ad');
      const keywords = state.keywords.filter((k) => ad.keywordIds?.includes(k.id));
      return {
        id: `radar-ad-${ad.id}`, type: 'ad', title: ad.headline || ad.brand,
        subtitle: `${ad.brand} · ${ad.platform} · ${decision.label}`, category: keywords[0]?.category || '待分类',
        market: ad.market, firstSeenAt: ad.firstSeenAt!.slice(0, 10),
        status: ad.dataNature === 'demo' ? 'demo' : decision.isNew === true ? 'confirmed' : 'newly-discovered',
        confidenceScore: decision.isNew === true ? 80 : 45, businessScore: null, trendGrowth: null,
        adoptionCount: keywords.length,
        evidence: [{ id: `ad-evidence-${ad.id}`, kind: 'ad', source: ad.source || ad.platform, detail: ad.copy || ad.headline,
          observedAt: ad.lastCollectedAt || ad.firstSeenAt!, url: ad.evidenceUrl }],
        rationale: [decision.reason, `入选关键词：${keywords.map((k) => k.term).join('、') || ad.query || '尚未关联'}`],
        gaps: [decision.isNew === null ? '缺少可核验的投放开始日期' : '', '广告传播不单独证明所售商品是新品'].filter(Boolean),
      };
    });
}

export function buildCollectedRadarFindings(
  collector: null | PublicCollectorData,
  windowDays: number,
): RadarFinding[] {
  if (!collector) return [];
  return collector.observations
    .filter((item) => withinWindow(item.firstSeenAt, windowDays))
    .map((item) => ({ item, decision: discoveryDecision({ market: item.market, firstSeenAt: item.firstSeenAt,
      decisionData: { listing: { date: item.publishedAt?.slice(0, 10), provider: '品牌官网', platform: '官网商品页', market: item.market,
        collectedAt: item.capturedAt, evidenceUrl: item.url } } }, 'product') }))
    .filter(({ decision }) => decision.isNew !== false)
    .map(({ item, decision }) => {
      const observed = item.firstSeenAt.slice(0, 10);
      const confidence = clamp(
        35 + 25 + Math.max(5, 20 - daysSince(observed)) + (decision.isNew === true ? 20 : 8),
      );
      return {
        id: `collector-${item.id}`,
        type: 'product' as const,
        title: item.title,
        subtitle: `${item.brand} · 公开官网自动采集`,
        category: '待分类',
        market: item.market,
        firstSeenAt: observed,
        status: decision.isNew === true
          ? ('confirmed' as const)
          : ('newly-discovered' as const),
        confidenceScore: confidence,
        businessScore: null,
        trendGrowth: null,
        adoptionCount: 1,
        evidence: [
          {
            id: `collector-evidence-${item.id}`,
            kind: 'product' as const,
            source: '品牌官网自动采集',
            detail: [
              item.description,
              item.price === null
                ? ''
                : `标价 ${item.price} ${item.currency || ''}`.trim(),
            ]
              .filter(Boolean)
              .join('；'),
            observedAt: item.capturedAt.slice(0, 10),
            url: item.url,
          },
        ],
        rationale: [
          decision.reason,
          item.changeType === 'changed'
            ? '本次采集检测到页面内容变化'
            : '过去180天采集基线中没有相同商品指纹',
        ],
        gaps: [
          decision.isNew === true ? '' : '缺少官网确认发布时间，暂按近期新发现处理',
          '尚未关联广告、关键词、趋势和供应链数据，因此不计算商业机会分',
        ].filter(Boolean),
      };
    });
}

function freeSignalEvidence(signal: PublicSignal): RadarEvidence {
  let kind: RadarEvidence['kind'] = 'research';
  if (signal.kind === 'product') kind = 'product';
  if (signal.kind === 'content' || signal.kind === 'news') kind = 'content';
  if (signal.kind === 'regulatory' || signal.kind === 'safety_aggregate')
    kind = 'regulatory';
  return {
    id: `public-${signal.id}`,
    kind,
    source: signal.source,
    detail: `${signal.title}；${signal.summary}`,
    observedAt: signal.observedAt,
    url: signal.url,
  };
}

export function buildFreeSourceRadarFindings(
  data: FreeSourceData | null,
  windowDays: number,
): RadarFinding[] {
  if (!data) return [];
  const findings: RadarFinding[] = [];
  const products = data.signals.filter(
    (signal) =>
      signal.kind === 'product' &&
      signal.market === 'US' &&
      withinWindow(signal.observedAt, windowDays),
  );
  for (const signal of products) {
    findings.push({
      id: `public-product-${signal.id}`,
      type: 'product',
      title: signal.title,
      subtitle: `${signal.brand || '品牌待核'} · NIH DSLD公开标签`,
      category: signal.category,
      market: 'US',
      firstSeenAt: signal.observedAt,
      status: 'pending',
      confidenceScore: clamp(
        62 + Math.max(0, 14 - daysSince(signal.observedAt)),
      ),
      businessScore: null,
      trendGrowth: null,
      adoptionCount: 1,
      evidence: [freeSignalEvidence(signal)],
      rationale: [
        `DSLD于 ${signal.observedAt} 收录该在售标签`,
        `公开标签包含 ${signal.ingredients?.length || 0} 个已提取成分名称`,
      ],
      gaps: [
        'DSLD收录日期不等于首次上市日期',
        '尚未关联官网首发、趋势、广告和供应链数据，因此不计算商业机会分',
      ],
    });
  }

  const contentGroups = new Map<string, PublicSignal[]>();
  for (const signal of data.signals) {
    if (signal.kind !== 'content' || signal.market === 'GLOBAL') continue;
    if (!withinWindow(signal.observedAt, windowDays)) continue;
    const key = `${signal.market}:${signal.query}`;
    contentGroups.set(key, [...(contentGroups.get(key) || []), signal]);
  }
  for (const [key, signals] of contentGroups) {
    const market = key.split(':')[0] as Market;
    const first = signals[0]!;
    findings.push({
      id: `public-content-${key}`,
      type: 'concept',
      title: first.query,
      subtitle: `${signals.length} 条近期公开视频内容`,
      category: first.category,
      market,
      firstSeenAt: signals
        .map((item) => item.observedAt)
        .toSorted()
        .at(-1)!,
      status: 'pending',
      confidenceScore: clamp(28 + Math.min(32, signals.length * 5)),
      businessScore: null,
      trendGrowth: null,
      adoptionCount: signals.length,
      evidence: signals.slice(0, 5).map(freeSignalEvidence),
      rationale: [
        `最近观察窗口内出现 ${signals.length} 条相关视频`,
        '内容数量用于判断传播活跃度，不代表搜索需求或销售增长',
      ],
      gaps: ['尚未与官网商品、关键词趋势和广告数据交叉验证'],
    });
  }

  const regulatoryGroups = new Map<string, PublicSignal[]>();
  for (const signal of data.signals) {
    if (signal.kind !== 'regulatory' || signal.market !== 'US') continue;
    if (!withinWindow(signal.observedAt, windowDays)) continue;
    regulatoryGroups.set(signal.query, [
      ...(regulatoryGroups.get(signal.query) || []),
      signal,
    ]);
  }
  for (const [query, signals] of regulatoryGroups) {
    const first = signals[0]!;
    findings.push({
      id: `public-regulatory-US-${query}`,
      type: 'ingredient',
      title: `${query} · 监管信号`,
      subtitle: `${signals.length} 条openFDA近期召回记录`,
      category: first.category,
      market: 'US',
      firstSeenAt: signals
        .map((item) => item.observedAt)
        .toSorted()
        .at(-1)!,
      status: 'pending',
      confidenceScore: 72,
      businessScore: null,
      trendGrowth: null,
      adoptionCount: signals.length,
      evidence: signals.slice(0, 5).map(freeSignalEvidence),
      rationale: [
        `观察窗口内匹配 ${signals.length} 条FDA召回记录`,
        '该信号用于风险复核，不用于判断市场机会大小',
      ],
      gaps: ['需要核对具体产品、批次、召回原因以及与拟开发配方的关联'],
    });
  }
  return findings;
}

export function buildSourceCoverage(
  state: DemoState,
  collector: null | PublicCollectorData = null,
  freeData: FreeSourceData | null = null,
): RadarSourceCoverage[] {
  const latest = (values: (string | undefined)[]) =>
    values.filter(Boolean).map((value) => value!.slice(0, 10)).sort().reverse()[0] || '尚无数据';
  const collectedProducts = collector?.observations || [];
  const realProducts = state.products.filter(
    (item) => item.dataNature !== 'demo',
  );
  const realAds = state.ads.filter((item) => item.dataNature !== 'demo');
  const realKeywords = state.keywords.filter(
    (item) => item.dataNature !== 'demo',
  );
  const trendKeywords = realKeywords.filter((item) => item.series.length >= 2);
  const publicProducts =
    freeData?.signals.filter((item) => item.kind === 'product').length || 0;
  const publicScience =
    freeData?.signals.filter((item) =>
      ['ingredient_profile', 'research', 'trial'].includes(item.kind),
    ).length || 0;
  const publicRegulatory =
    freeData?.signals.filter((item) =>
      ['regulatory', 'safety_aggregate'].includes(item.kind),
    ).length || 0;
  const publicContent =
    freeData?.signals.filter((item) => ['content', 'news'].includes(item.kind))
      .length || 0;
  return [
    {
      key: 'products',
      label: '商品与公开标签',
      count: realProducts.length + collectedProducts.length + publicProducts,
      lastUpdated:
        (collectedProducts.length && collector?.generatedAt?.slice(0, 10)) ||
        latest(realProducts.map((item) => item.firstSeenAt)),
      status:
        realProducts.length + collectedProducts.length + publicProducts
          ? 'partial'
          : 'missing',
      automated:
        realProducts.some((item) => Boolean(item.sourceProvider)) ||
        !!collector?.configuredSites ||
        state.sites.some((site) => site.collectorMode === 'automatic'),
      note: '平台商品、官网事实与NIH DSLD公开标签；支持每日入选词发现',
    },
    {
      key: 'ads',
      label: '广告与落地页',
      count: realAds.length,
      lastUpdated: latest(realAds.map((item) => item.firstSeenAt)),
      status: realAds.length > 0 ? 'partial' : 'missing',
      automated: realAds.some((item) => item.dataNature === 'collected'),
      note: '支持每日入选词发现；广告不单独证明新品',
    },
    {
      key: 'keywords',
      label: '关键词',
      count: realKeywords.length,
      lastUpdated: latest(realKeywords.map((item) => item.updatedAt)),
      status: realKeywords.length > 0 ? 'partial' : 'missing',
      automated: false,
      note: '用户表达、关联商品和站点覆盖',
    },
    {
      key: 'trends',
      label: '趋势时序',
      count: trendKeywords.length,
      lastUpdated: latest(trendKeywords.map((item) => item.updatedAt)),
      status: trendKeywords.length > 0 ? 'partial' : 'missing',
      automated: false,
      note: '需求变化验证；网页端数据按查询批次解释',
    },
    {
      key: 'science',
      label: '科研与成分档案',
      count: publicScience,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || '尚无数据',
      status: publicScience > 0 ? 'available' : 'missing',
      automated: true,
      note: 'PubMed、ClinicalTrials.gov与PubChem',
    },
    {
      key: 'regulatory',
      label: '监管与安全线索',
      count: publicRegulatory,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || '尚无数据',
      status: publicRegulatory > 0 ? 'available' : 'missing',
      automated: true,
      note: 'openFDA召回与CAERS汇总',
    },
    {
      key: 'content',
      label: '新闻与内容信号',
      count: publicContent,
      lastUpdated: freeData?.generatedAt?.slice(0, 10) || '尚无数据',
      status: publicContent > 0 ? 'partial' : 'missing',
      automated: true,
      note: 'GDELT与可选YouTube免费配额',
    },
    {
      key: 'supply',
      label: '供应链可行性',
      count: 0,
      lastUpdated: '尚未接入',
      status: 'missing',
      automated: false,
      note: 'MOQ、成本、交期、原料、认证和合规',
    },
  ];
}

export function buildRadarReport(
  findings: RadarFinding[],
  windowDays: number,
  marketLabel: string,
  appName = '情报工作区',
) {
  const products = findings.filter((item) => item.type === 'product');
  const concepts = findings.filter((item) => item.type === 'concept');
  const ingredients = findings.filter((item) => item.type === 'ingredient');
  const ads = findings.filter((item) => item.type === 'ad');
  const strongest = [...findings]
    .filter((item) => item.businessScore !== null)
    .sort((a, b) => (b.businessScore || 0) - (a.businessScore || 0))[0];
  return [
    `${appName} · 新品雷达${windowDays}天分析报告`,
    `市场：${marketLabel}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `发现概况：${products.length}个新品/新发现商品候选，${ads.length}条新广告线索，${concepts.length}个概念候选，${ingredients.length}个成分候选。`,
    strongest
      ? `当前综合优先项：${strongest.title}（新鲜度可信度${strongest.confidenceScore}，商业机会分${strongest.businessScore}）。`
      : '当前没有达到观察窗口和市场条件的候选。',
    '',
    '判断口径：商品事实、广告传播、关键词与趋势分别记录；广告不单独证明新品；缺失数据标为不足，不按零分处理。',
    '',
    ...findings
      .slice(0, 10)
      .flatMap((item, index) => [
        `${index + 1}. [${item.type === 'ad' ? '广告' : item.type === 'product' ? '商品' : item.type === 'concept' ? '概念' : '成分'}] ${item.title}`,
        `   ${item.subtitle}｜可信度 ${item.confidenceScore}｜机会分 ${item.businessScore ?? '数据不足'}`,
        `   依据：${item.rationale.join('；')}`,
        item.gaps.length > 0
          ? `   数据缺口：${item.gaps.join('；')}`
          : '   数据缺口：无关键缺口',
      ]),
    '',
    '说明：演示样本只用于验证交互和计算规则，不构成真实市场结论。正式报告应关闭“包含演示样本”。',
  ].join('\n');
}
