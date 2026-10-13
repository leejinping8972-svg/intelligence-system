import type { Ad, DemoState, Keyword, Market, Product } from './data';

export type RadarFindingType = 'concept' | 'ingredient' | 'product';
export type RadarFindingStatus =
  | 'confirmed'
  | 'demo'
  | 'newly-discovered'
  | 'pending';

export interface RadarEvidence {
  detail: string;
  id: string;
  kind: 'ad' | 'keyword' | 'product' | 'site' | 'trend';
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

function safeDate(value?: string) {
  const date = value ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function daysSince(value?: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - safeDate(value).getTime()) / 86_400_000),
  );
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
        product.dataNature === 'imported' ? '人工导入商品资料' : '官网商品页',
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
          : `${keyword.term}：28天变化 ${keyword.growth > 0 ? '+' : ''}${keyword.growth}%`,
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
    .map<RadarFinding>((product) => {
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
        product.publishedAt ? '' : '缺少官方发布时间，只能认定为近期新发现',
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
        firstSeenAt: product.firstSeenAt || today(),
        status:
          product.dataNature === 'demo'
            ? 'demo'
            : product.publishedAt
              ? 'confirmed'
              : 'newly-discovered',
        confidenceScore: confidence,
        businessScore,
        trendGrowth: growth,
        adoptionCount: 1,
        evidence,
        rationale: [
          product.publishedAt
            ? `官网发布时间为 ${product.publishedAt}`
            : `最近 ${daysSince(product.firstSeenAt)} 天首次进入系统`,
          relatedAds
            ? `关联 ${relatedAds} 条近期广告信号`
            : '暂未发现关联广告信号',
          growth === null
            ? '缺少同品类可比较趋势'
            : `同品类关键词28天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
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
        detail: `${keyword.term} · 28天变化 ${keyword.growth ?? '数据不足'}${keyword.growth === null ? '' : '%'}`,
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
          : `同品类关键词28天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
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
          : `关联品类关键词28天平均变化 ${growth > 0 ? '+' : ''}${growth}%`,
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
  return [
    ...productFindings(state, windowDays, includeDemo),
    ...conceptFindings(state, windowDays, includeDemo),
    ...ingredientFindings(state, windowDays, includeDemo),
  ].sort(
    (a, b) =>
      (b.businessScore ?? -1) - (a.businessScore ?? -1) ||
      b.confidenceScore - a.confidenceScore,
  );
}

export function buildCollectedRadarFindings(
  collector: null | PublicCollectorData,
  windowDays: number,
): RadarFinding[] {
  if (!collector) return [];
  return collector.observations
    .filter((item) => withinWindow(item.firstSeenAt, windowDays))
    .map((item) => {
      const published = item.publishedAt?.slice(0, 10);
      const observed = item.firstSeenAt.slice(0, 10);
      const confidence = clamp(
        35 + 25 + Math.max(5, 20 - daysSince(observed)) + (published ? 20 : 8),
      );
      return {
        id: `collector-${item.id}`,
        type: 'product' as const,
        title: item.title,
        subtitle: `${item.brand} · 公开官网自动采集`,
        category: '待分类',
        market: item.market,
        firstSeenAt: observed,
        status: published
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
          published
            ? `官网页面提供发布时间 ${published}`
            : `系统于 ${observed} 首次发现该商品`,
          item.changeType === 'changed'
            ? '本次采集检测到页面内容变化'
            : '过去180天采集基线中没有相同商品指纹',
        ],
        gaps: [
          published ? '' : '缺少官网确认发布时间，暂按近期新发现处理',
          '尚未关联广告、关键词、趋势和供应链数据，因此不计算商业机会分',
        ].filter(Boolean),
      };
    });
}

export function buildSourceCoverage(
  state: DemoState,
  collector: null | PublicCollectorData = null,
): RadarSourceCoverage[] {
  const latest = (values: (string | undefined)[]) =>
    values.filter(Boolean).sort().reverse()[0] || '尚无数据';
  const collectedProducts = collector?.observations || [];
  const realProducts = state.products.filter(
    (item) => item.dataNature !== 'demo',
  );
  const realAds = state.ads.filter((item) => item.dataNature !== 'demo');
  const realKeywords = state.keywords.filter(
    (item) => item.dataNature !== 'demo',
  );
  const trendKeywords = realKeywords.filter((item) => item.series.length >= 2);
  return [
    {
      key: 'products',
      label: '官网商品与标签',
      count: realProducts.length + collectedProducts.length,
      lastUpdated:
        (collectedProducts.length && collector?.generatedAt?.slice(0, 10)) ||
        latest(realProducts.map((item) => item.firstSeenAt)),
      status:
        realProducts.length + collectedProducts.length ? 'partial' : 'missing',
      automated:
        !!collector?.configuredSites ||
        state.sites.some((site) => site.collectorMode === 'automatic'),
      note: '商品事实、新成分和卖点的主要证据',
    },
    {
      key: 'ads',
      label: '广告与落地页',
      count: realAds.length,
      lastUpdated: latest(realAds.map((item) => item.firstSeenAt)),
      status: realAds.length > 0 ? 'partial' : 'missing',
      automated: false,
      note: '传播动量信号；不单独证明新品',
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
) {
  const products = findings.filter((item) => item.type === 'product');
  const concepts = findings.filter((item) => item.type === 'concept');
  const ingredients = findings.filter((item) => item.type === 'ingredient');
  const strongest = [...findings]
    .filter((item) => item.businessScore !== null)
    .sort((a, b) => (b.businessScore || 0) - (a.businessScore || 0))[0];
  return [
    `知衡情报 · 新品雷达${windowDays}天分析报告`,
    `市场：${marketLabel}`,
    `生成时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    `发现概况：${products.length}个新品/新发现商品候选，${concepts.length}个概念候选，${ingredients.length}个成分候选。`,
    strongest
      ? `当前综合优先项：${strongest.title}（新鲜度可信度${strongest.confidenceScore}，商业机会分${strongest.businessScore}）。`
      : '当前没有达到观察窗口和市场条件的候选。',
    '',
    '判断口径：商品事实、广告传播、关键词与趋势分别记录；广告不单独证明新品；缺失数据标为不足，不按零分处理。',
    '',
    ...findings
      .slice(0, 10)
      .flatMap((item, index) => [
        `${index + 1}. [${item.type === 'product' ? '商品' : item.type === 'concept' ? '概念' : '成分'}] ${item.title}`,
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
