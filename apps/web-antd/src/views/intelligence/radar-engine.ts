import type { Ad, DemoState, Keyword, Market, Product } from './data';
import type { FreeSourceData, PublicSignal } from './public-sources';

import { validDiscoveryDate } from '../../../../../server/discovery-newness.mjs';
import { benefitSignal, ingredientSignal, signalKey } from '../../../../../workers/site-discovery/src/product-signal-rules.js';
import { discoveryDecision } from './discovery';
import { trendComparisons } from './trend-comparison';

export const RADAR_RULES_VERSION = 2;

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
  return daysSince(value) < windowDays;
}

function keywordGrowth(keywords: Keyword[]) {
  const values = keywords
    .filter((item) => item.growth !== null && Number.isFinite(item.growth))
    .map((item) => item.growth as number);
  if (values.length === 0) return null;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 10,
    ) / 10
  );
}

function linkedKeywords(state: DemoState, products: Product[]) {
  const ids = new Set(products.map((product) => product.id));
  return state.keywords.filter((keyword) => keyword.market === products[0]?.market && keyword.productIds?.some((id) => ids.has(id)));
}

function linkedAds(state: DemoState, products: Product[], windowDays: number, includeDemo: boolean) {
  const ids = new Set(products.map((product) => product.id));
  return state.ads.filter((ad) => ad.market === products[0]?.market && ids.has(ad.productId) && (includeDemo || ad.dataNature !== 'demo') && withinWindow(ad.firstSeenAt, windowDays) && discoveryDecision(ad, 'ad').isNew !== false);
}

function opportunityScore(growth: null | number, ads: number, brands: number, reviewed: boolean) {
  if (growth === null && ads === 0) return null;
  return clamp(20 + Math.max(-20, Math.min(30, (growth ?? 0) / 2)) + Math.min(20, ads * 8) + Math.min(10, Math.max(0, brands - 1) * 2) + (reviewed ? 10 : 0));
}

function brandCount(products: Product[]) {
  return new Set(products.map((product) => signalKey(product.brand)).filter((brand) => brand && !/^(?:unknown|n a|品牌待核|品牌待确认|待确认|未知)$/.test(brand))).size;
}

function sourceUrl(product: Product) {
  try { return ['http:', 'https:'].includes(new URL(product.evidenceUrl || '').protocol); }
  catch { return false; }
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
      kind: keyword.growth !== null ? 'trend' : 'keyword',
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
      const keywords = linkedKeywords(state, [product]);
      const ads = linkedAds(state, [product], windowDays, includeDemo);
      const evidence = productEvidence(product, ads, keywords);
      const growth = keywordGrowth(keywords);
      const relatedAds = ads.length;
      const confidence = Math.min(decision.isNew === true ? 95 : 69, clamp(
        (sourceUrl(product) ? 35 : 10) +
          (decision.isNew === true ? 25 : 0) +
          Math.max(0, 10 - daysSince(product.firstSeenAt)) +
          (relatedAds ? 10 : 0) + (growth !== null ? 10 : 0),
      ));
      const gaps = [
        decision.isNew === true ? '' : '缺少有来源的有效上架日期，只能认定为近期新发现',
        growth === null && !relatedAds ? '缺少直接关联的有效趋势或近期广告，不计算线索评分' : '',
        '尚未接入MOQ、成本、交期和目标市场合规结论',
      ].filter(Boolean);
      const businessScore = opportunityScore(growth, relatedAds, 1, product.reviewed);
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
            ? '缺少直接关联的可比较趋势'
            : `直接关联关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
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
    if (!sourceUrl(product)) continue;
    for (const benefit of product.benefits) {
      const text = benefitSignal(benefit);
      if (!text) continue;
      const key = `${product.market}:${signalKey(text)}`;
      const existing = groups.get(key) || [];
      if (!existing.some((item) => item.id === product.id)) groups.set(key, [...existing, product]);
    }
  }
  return [...groups.entries()].map<RadarFinding>(([key, products]) => {
    const conceptKey = key.split(':').slice(1).join(':');
    const product = products[0]!;
    const concept = product.benefits.find((value) => signalKey(value) === conceptKey)!;
    const brands = brandCount(products);
    const ads = linkedAds(state, products, windowDays, includeDemo);
    const keywords = linkedKeywords(state, products).filter((keyword) => keyword.growth !== null);
    const growth = keywordGrowth(keywords);
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
    const confidence = Math.min(brands >= 2 && sourceKinds >= 2 ? 85 : 69,
      clamp(20 + Math.min(20, brands * 4) + sourceKinds * 12));
    return {
      id: `radar-concept-${product.market}-${conceptKey}`,
      type: 'concept',
      title: concept,
      subtitle: `${product.category} · ${brands} 个品牌采用`,
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
      businessScore: opportunityScore(growth, ads.length, brands, products.some((item) => item.reviewed)),
      trendGrowth: growth,
      adoptionCount: brands,
      evidence,
      rationale: [
        `${products.length} 个商品、${brands} 个品牌采用该表达`,
        `${ads.length} 条近期关联广告，${sourceKinds} 类证据`,
        growth === null
          ? '暂缺趋势验证'
          : `直接关联关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
      ],
      gaps: [
        '仅为观察窗口内的卖点表达，未证明属于新概念',
        brands < 2 ? '尚未达到“至少2个品牌采用”的确认门槛' : '',
        sourceKinds < 2 ? '尚缺直接关联的近期广告或有效趋势证据' : '',
        growth === null && !ads.length ? '缺少直接关联的有效趋势或近期广告，不计算线索评分' : '',
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
    if (!sourceUrl(product)) continue;
    for (const insight of product.ingredientInsights) {
      const text = ingredientSignal(insight.name, product.ingredient);
      if (!text) continue;
      const key = `${product.market}:${signalKey(text)}`;
      const existing = groups.get(key) || [];
      if (!existing.some((item) => item.id === product.id)) groups.set(key, [...existing, product]);
    }
  }
  return [...groups.entries()].map<RadarFinding>(([key, products]) => {
    const ingredientKey = key.split(':').slice(1).join(':');
    const product = products[0]!;
    const insight = product.ingredientInsights.find(
      (item) => signalKey(item.name) === ingredientKey,
    )!;
    const brands = brandCount(products);
    const keywords = linkedKeywords(state, products);
    const growth = keywordGrowth(keywords);
    const ads = linkedAds(state, products, windowDays, includeDemo);
    const evidence: RadarEvidence[] = products.slice(0, 3).map((item) => {
      const itemInsight = item.ingredientInsights.find(
        (entry) => signalKey(entry.name) === ingredientKey,
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
    const confidence = Math.min(products.some((item) => item.reviewed) ? 85 : 69,
      clamp(40 + Math.min(15, brands * 3) + (product.reviewed ? 20 : 0)));
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
      businessScore: opportunityScore(growth, ads.length, brands, products.some((item) => item.reviewed)),
      trendGrowth: growth,
      adoptionCount: brands,
      evidence,
      rationale: [
        `${products.length} 个商品标签出现，涉及 ${brands} 个品牌`,
        `记录剂量口径：${insight.amount}`,
        growth === null
          ? '暂缺相关需求趋势'
          : `直接关联关键词30天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
      ],
      gaps: [
        '标签出现不证明原料首次上市或属于新成分',
        brands < 2 ? '目前只有单一品牌证据，仍属于成分候选' : '',
        growth === null && !ads.length ? '缺少直接关联的有效趋势或近期广告，不计算线索评分' : '',
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
      const confidence = Math.min(decision.isNew === true ? 95 : 69, clamp(
        35 + Math.max(0, 10 - daysSince(observed)) + (decision.isNew === true ? 25 : 0),
      ));
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
          '尚未关联有效趋势或近期广告，因此不计算线索评分',
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
      confidenceScore: Math.min(69, clamp(45 + Math.max(0, 10 - daysSince(signal.observedAt)))),
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
        '尚未关联有效趋势或近期广告，因此不计算线索评分',
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
    `发现概况：${products.length}个商品发现（${products.filter((item) => item.status === 'confirmed').length}个来源确认90天内上架），${ads.length}条新广告线索，${concepts.length}个卖点/话题线索，${ingredients.length}个成分线索。`,
    strongest
      ? `当前线索评分较高项：${strongest.title}（证据完整度${strongest.confidenceScore}，线索评分${strongest.businessScore}）。`
      : findings.length ? '当前候选缺少直接关联的有效趋势或近期广告，线索评分为数据不足。' : '当前没有达到观察窗口和市场条件的候选。',
    '',
    '判断口径：首次发现不等于首次上市；卖点和成分出现不证明新颖性；广告不单独证明新品。线索评分仅参考直接关联的趋势、近期广告与品牌采用，不包含成本、利润、供应链或合规结论。',
    '',
    ...findings
      .slice(0, 10)
      .flatMap((item, index) => [
        `${index + 1}. [${item.type === 'ad' ? '广告' : item.type === 'product' ? '商品' : item.type === 'concept' ? '概念' : '成分'}] ${item.title}`,
        `   ${item.subtitle}｜证据完整度 ${item.confidenceScore}｜线索评分 ${item.businessScore ?? '数据不足'}`,
        `   依据：${item.rationale.join('；')}`,
        item.gaps.length > 0
          ? `   数据缺口：${item.gaps.join('；')}`
          : '   数据缺口：无关键缺口',
      ]),
    '',
    '说明：演示样本只用于验证交互和计算规则，不构成真实市场结论。正式报告应关闭“包含演示样本”。',
  ].join('\n');
}
