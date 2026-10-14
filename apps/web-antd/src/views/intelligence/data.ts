import { computed, reactive, watch } from 'vue';

export type Market = 'MX' | 'US' | 'VN';
export type MarketFilter = 'ALL' | Market;
export const markets = [
  {
    code: 'US' as Market,
    name: '美国',
    english: 'United States',
    currency: 'USD',
    language: 'en-US',
    color: '#198771',
  },
  {
    code: 'MX' as Market,
    name: '墨西哥',
    english: 'Mexico',
    currency: 'MXN',
    language: 'es-MX',
    color: '#dc9c43',
  },
  {
    code: 'VN' as Market,
    name: '越南',
    english: 'Vietnam',
    currency: 'VND',
    language: 'vi-VN',
    color: '#647cc4',
  },
];
export const marketOptions = [
  { label: '全部市场', value: 'ALL' },
  ...markets.map((m) => ({ label: `${m.name} · ${m.code}`, value: m.code })),
];
export const categories = [
  '肠道与益生菌',
  '女性健康',
  '功能性营养',
  '体重管理',
];
export interface Keyword {
  id: string;
  term: string;
  market: Market;
  category: string;
  source: string;
  growth: null | number;
  series: number[];
  favorite: boolean;
  productIds: string[];
  siteIds: string[];
  updatedAt?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface IngredientInsight {
  name: string;
  amount: string;
  role: string;
  evidence: string;
}
export interface Product {
  id: string;
  title: string;
  brand: string;
  market: Market;
  category: string;
  form: string;
  size: string;
  price: number;
  currency: string;
  ingredient: string;
  dose: string;
  claim: string;
  benefits: string[];
  benefitEvidence: string;
  ingredientInsights: IngredientInsight[];
  siteId: string;
  color: string;
  imageUrl?: string;
  collectionFields?: string[];
  reviewed: boolean;
  favorite: boolean;
  firstSeenAt?: string;
  publishedAt?: string;
  evidenceUrl?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface Site {
  id: string;
  brand: string;
  domain: string;
  market: Market;
  platform: string;
  type: string;
  keyword: string;
  category: string;
  mainProducts: string[];
  ownershipBackground: string;
  ownershipOperations: string;
  ownershipEvidence: string;
  ownershipSource: string;
  collectorMode?: 'automatic' | 'manual' | 'restricted';
  lastCollectedAt?: string;
  evidenceUrl?: string;
  confidence?: number;
  signals?: string[];
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface Ad {
  id: string;
  brand: string;
  market: Market;
  platform: string;
  headline: string;
  copy: string;
  format: string;
  productId: string;
  status: string;
  color: string;
  firstSeenAt?: string;
  evidenceUrl?: string;
  dataNature?: 'collected' | 'demo' | 'imported';
}
export interface Review {
  id: string;
  productId: string;
  field: 'dose' | 'ingredient';
  current: string;
  proposed: string;
  quote: string;
  status: 'approved' | 'pending' | 'rejected';
  reason: string;
}
export interface Task {
  id: string;
  title: string;
  market: Market;
  status: 'cancelled' | 'completed' | 'partial' | 'queued';
  created: string;
  steps: string[];
}
export interface Monitor {
  id: string;
  productId: string;
  frequency: string;
  enabled: boolean;
}
export interface ImportBatch {
  id: string;
  name: string;
  count: number;
  skipped: number;
  errors: number;
  at: string;
  markets: Market[];
}
export interface AuditEvent {
  id: string;
  title: string;
  detail: string;
  at: string;
  market: MarketFilter;
}
export interface BrandingSettings {
  appName: string;
  workspaceName: string;
  businessName: string;
  environmentLabel: string;
  logo: string;
}
export const defaultBranding: BrandingSettings = {
  appName: '知衡情报',
  workspaceName: '知衡工作区',
  businessName: '大健康跨境市场情报',
  environmentLabel: '前台演示',
  logo: '/hci-logo.svg',
};
export interface DemoState {
  version: number;
  market: MarketFilter;
  keywords: Keyword[];
  products: Product[];
  sites: Site[];
  ads: Ad[];
  reviews: Review[];
  tasks: Task[];
  monitors: Monitor[];
  imports: ImportBatch[];
  audit: AuditEvent[];
  savedOpportunities: string[];
  branding: BrandingSettings;
  settings: {
    taskBudget: number;
    monthlyBudget: number;
    trendLimit: number;
    productsPerSite: number;
    serpSearchCost: number;
    trendsTaskCost: number;
    trendsKeywordsPerTask: number;
    storeLeadsMarketCost: number;
    costBufferRate: number;
    researchApiUrl: string;
    researchAccessKey: string;
    researchMaxSites: number;
  };
}
const seedTerms = [
  ['probiotic for women', '益生菌', '女性健康', 42],
  ['gut health supplement', '肠道', '肠道与益生菌', 28],
  ['magnesium glycinate', '镁', '功能性营养', 35],
  ['inositol supplement', '肌醇', '女性健康', 51],
  ['fiber supplement', '纤维', '体重管理', 18],
  ['collagen peptides', '胶原', '功能性营养', -8],
];
const localized = {
  US: seedTerms.map((t) => String(t[0])),
  MX: [
    'probióticos para mujer',
    'salud intestinal',
    'glicinato de magnesio',
    'suplemento de inositol',
    'suplemento de fibra',
    'péptidos de colágeno',
  ],
  VN: [
    'men vi sinh cho nữ',
    'sức khỏe đường ruột',
    'magie glycinate',
    'bổ sung inositol',
    'chất xơ hòa tan',
    'collagen peptide',
  ],
};

function at<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new Error(`演示数据索引越界：${index}`);
  return value;
}

function initial(): DemoState {
  const sites: Site[] = markets.flatMap((m, i) => [
    {
      id: `s${i * 2 + 1}`,
      brand: at(['Natura Lab', 'Vida Clara', 'An Nhiên'], i),
      domain: at(
        ['natura-lab.example', 'vidaclara.example', 'annhien.example'],
        i,
      ),
      market: m.code,
      platform: 'Shopify',
      type: '品牌直营',
      keyword: at(localized[m.code], 0),
      category: '肠道与女性健康',
      mainProducts: ['女性益生菌', '膳食纤维'],
      ownershipBackground: '独立品牌（官网自述）',
      ownershipOperations: '创始团队运营',
      ownershipEvidence: '官网 About 页面披露品牌与团队，未披露母公司信息。',
      ownershipSource: '官网 About / 品牌故事页',
      collectorMode: 'manual',
      lastCollectedAt: '2026-10-13',
    },
    {
      id: `s${i * 2 + 2}`,
      brand: at(['Daily Form', 'Raíz Vital', 'Lành Studio'], i),
      domain: at(
        ['daily-form.example', 'raizvital.example', 'lanh-studio.example'],
        i,
      ),
      market: m.code,
      platform: 'WooCommerce',
      type: '品牌直营',
      keyword: at(localized[m.code], 2),
      category: '功能性营养',
      mainProducts: ['甘氨酸镁', '日常矿物质配方'],
      ownershipBackground: '集团品牌（官网自述）',
      ownershipOperations: '营养健康团队运营',
      ownershipEvidence: '官网页脚与隐私政策展示集团运营主体；当前为演示摘录。',
      ownershipSource: '官网页脚 / Privacy Policy',
      collectorMode: 'manual',
      lastCollectedAt: '2026-10-12',
    },
  ]);
  const products: Product[] = markets.flatMap((m, i) => [
    {
      id: `p${i * 3 + 1}`,
      title: at(
        ['Women’s Daily Probiotic', 'Probióticos Mujer', 'Men vi sinh nữ'],
        i,
      ),
      brand: at(sites, i * 2).brand,
      market: m.code,
      category: '女性健康',
      form: '胶囊',
      size: '30粒 / 30份',
      price: at([32, 549, 385_000], i),
      currency: m.currency,
      ingredient: 'Lactobacillus acidophilus',
      dose: '10 billion CFU / 份',
      claim: '支持日常肠道健康',
      benefits: ['肠道健康', '女性日常养护'],
      benefitEvidence: '官网商品页标题与卖点区提及 daily gut health support。',
      ingredientInsights: [
        {
          name: 'Lactobacillus acidophilus',
          amount: '10 billion CFU / 份',
          role: '益生菌菌株；用于配方归类，功效仍需核验',
          evidence: 'Supplement Facts / 商品页成分区',
        },
      ],
      siteId: at(sites, i * 2).id,
      color: 'sage',
      reviewed: i === 0,
      favorite: i === 0,
      firstSeenAt: `2026-10-${String(12 - i).padStart(2, '0')}`,
      publishedAt: i === 0 ? '2026-10-10' : undefined,
      evidenceUrl: `https://${at(sites, i * 2).domain}/products/daily-probiotic`,
      dataNature: 'demo',
    },
    {
      id: `p${i * 3 + 2}`,
      title: at(['Magnesium Complex', 'Magnesio Esencial', 'Magie Balance'], i),
      brand: at(sites, i * 2 + 1).brand,
      market: m.code,
      category: '功能性营养',
      form: '胶囊',
      size: '60粒 / 30份',
      price: at([26, 429, 295_000], i),
      currency: m.currency,
      ingredient: 'Magnesium glycinate',
      dose: '200 mg / 份',
      claim: '支持放松与日常营养补充',
      benefits: ['放松支持', '矿物质补充'],
      benefitEvidence: '官网商品描述提及 relaxation 与 daily mineral support。',
      ingredientInsights: [
        {
          name: 'Magnesium glycinate',
          amount: '200 mg / 份',
          role: '镁来源；剂量按每份记录',
          evidence: 'Supplement Facts / 商品页配方区',
        },
      ],
      siteId: at(sites, i * 2 + 1).id,
      color: 'lavender',
      reviewed: false,
      favorite: false,
      firstSeenAt: `2026-10-${String(9 - i).padStart(2, '0')}`,
      evidenceUrl: `https://${at(sites, i * 2 + 1).domain}/products/magnesium`,
      dataNature: 'demo',
    },
    {
      id: `p${i * 3 + 3}`,
      title: at(['Daily Fiber Blend', 'Fibra Prebiótica', 'Chất Xơ Daily'], i),
      brand: at(sites, i * 2).brand,
      market: m.code,
      category: '肠道与益生菌',
      form: '粉剂',
      size: '180g / 30份',
      price: at([29, 479, 325_000], i),
      currency: m.currency,
      ingredient: 'Inulin · Psyllium husk',
      dose: '6 g / 份',
      claim: '补充膳食纤维',
      benefits: ['膳食纤维补充', '肠道规律支持'],
      benefitEvidence:
        '官网商品页卖点区提及 fiber intake 与 regularity support。',
      ingredientInsights: [
        {
          name: 'Inulin',
          amount: '配方组成，单项剂量未披露',
          role: '可溶性膳食纤维 / 益生元来源',
          evidence: '商品页成分表',
        },
        {
          name: 'Psyllium husk',
          amount: '合计 6 g / 份',
          role: '膳食纤维来源',
          evidence: 'Supplement Facts',
        },
      ],
      siteId: at(sites, i * 2).id,
      color: 'sand',
      reviewed: true,
      favorite: false,
      firstSeenAt: `2026-10-${String(6 - i).padStart(2, '0')}`,
      evidenceUrl: `https://${at(sites, i * 2).domain}/products/daily-fiber`,
      dataNature: 'demo',
    },
  ]);
  return {
    version: 1,
    market: 'ALL',
    sites,
    products,
    keywords: markets.flatMap((m, mi) =>
      seedTerms.map((t, i) => {
        const relatedProducts = products.filter(
          (product) =>
            product.market === m.code && product.category === String(t[2]),
        );
        return {
          id: `k${mi * 6 + i + 1}`,
          term: at(localized[m.code], i),
          market: m.code,
          category: String(t[2]),
          source: mi === 2 ? 'Google 联想词 · 演示' : 'Google / Amazon · 演示',
          growth: mi === 2 && i === 5 ? null : Number(t[3]) - mi * 5,
          series: Array.from({ length: 90 }, (_, j) =>
            Math.max(
              2,
              Math.min(
                100,
                Math.round(
                  22 +
                    i * 4 +
                    (j * (Number(t[3]) - mi * 5)) / 100 +
                    Math.sin(j / 6 + i) * 6,
                ),
              ),
            ),
          ),
          favorite: i === 0,
          productIds: relatedProducts.map((product) => product.id),
          siteIds: [
            ...new Set(relatedProducts.map((product) => product.siteId)),
          ],
          updatedAt: `2026-10-${String(13 - (i % 4)).padStart(2, '0')}`,
          dataNature: 'demo' as const,
        };
      }),
    ),
    ads: products
      .filter((_, i) => i % 3 !== 2)
      .map((p, i) => ({
        id: `ad${i + 1}`,
        brand: p.brand,
        market: p.market,
        platform: i % 2 ? 'TikTok' : 'Meta',
        headline:
          i % 2
            ? 'Make room for your daily ritual.'
            : 'A little care. Every day.',
        copy:
          i % 2
            ? '日常营养补充，围绕生活方式展开沟通。'
            : '女性日常肠道支持，强调简单、持续的习惯。',
        format: i % 2 ? '短视频' : '图片',
        productId: p.id,
        status: '观察到活跃',
        color: p.color,
        firstSeenAt: `2026-10-${String(13 - (i % 5)).padStart(2, '0')}`,
        evidenceUrl: `https://ads.example/${i + 1}`,
        dataNature: 'demo' as const,
      })),
    reviews: products
      .filter((p) => !p.reviewed)
      .map((p, i) => ({
        id: `r${i + 1}`,
        productId: p.id,
        field: 'dose',
        current: p.dose,
        proposed: i % 2 ? '10 billion CFU / 份' : '100 mg / 份',
        quote:
          i % 2
            ? 'Serving size: 1 capsule. Probiotic blend: 10 billion CFU.'
            : 'Serving size: 2 capsules. Magnesium: 100 mg per serving.',
        status: 'pending',
        reason: '',
      })),
    tasks: [
      {
        id: 'task-demo-1',
        title: '女性益生菌 · 首轮研究',
        market: 'US',
        status: 'partial',
        created: '2026-10-13 09:30',
        steps: [
          '关键词整理',
          '90天趋势',
          '独立站发现',
          '商品提取',
          '广告未授权',
        ],
      },
    ],
    monitors: [
      { id: 'm1', productId: 'p1', frequency: '每天', enabled: true },
      { id: 'm2', productId: 'p5', frequency: '每周', enabled: true },
    ],
    imports: [],
    audit: [],
    savedOpportunities: [],
    branding: { ...defaultBranding },
    settings: {
      taskBudget: 0,
      monthlyBudget: 0,
      trendLimit: 100,
      productsPerSite: 20,
      serpSearchCost: 0.015,
      trendsTaskCost: 0.0012,
      trendsKeywordsPerTask: 5,
      storeLeadsMarketCost: 0,
      costBufferRate: 20,
      researchApiUrl:
        'https://zhiheng-site-discovery.leejinping8972.workers.dev',
      researchAccessKey: '',
      researchMaxSites: 6,
    },
  };
}
// Keep table changes consistent with the 90-day chart displayed in the detail view.
function normalizeGrowth(data: DemoState) {
  for (const k of data.keywords) {
    if (k.growth === null || k.series.length < 56) continue;
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const previous = sum(k.series.slice(-56, -28));
    k.growth = previous
      ? Math.round(((sum(k.series.slice(-28)) - previous) / previous) * 1000) /
        10
      : null;
  }
  return data;
}
const storageKey = 'hci-demo-state-v1';
function restore(): DemoState {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (
      saved?.version === 1 &&
      Array.isArray(saved.products) &&
      Array.isArray(saved.audit)
    ) {
      const defaults = initial();
      const products: Product[] = saved.products.map((product: Product) => {
        const fallback = defaults.products.find(
          (item) => item.id === product.id,
        );
        return {
          ...fallback,
          ...product,
          benefits:
            product.benefits ||
            fallback?.benefits ||
            [product.claim].filter(Boolean),
          benefitEvidence:
            product.benefitEvidence ||
            fallback?.benefitEvidence ||
            '人工导入，待补充官网商品页卖点依据。',
          ingredientInsights: product.ingredientInsights ||
            fallback?.ingredientInsights || [
              {
                name: product.ingredient || '未知成分',
                amount: product.dose || '剂量未知',
                role: '待分析',
                evidence: '人工导入，待补充标签或官网依据',
              },
            ],
        } as Product;
      });
      const sites: Site[] = (saved.sites || defaults.sites).map(
        (site: Site) => {
          const fallback = defaults.sites.find((item) => item.id === site.id);
          return {
            ...fallback,
            ...site,
            category: site.category || fallback?.category || '待分类',
            mainProducts: site.mainProducts || fallback?.mainProducts || [],
            ownershipBackground:
              site.ownershipBackground ||
              fallback?.ownershipBackground ||
              '待核验',
            ownershipOperations:
              site.ownershipOperations ||
              fallback?.ownershipOperations ||
              '待核验',
            ownershipEvidence:
              site.ownershipEvidence ||
              fallback?.ownershipEvidence ||
              '尚未从官网获取股权或运营主体信息。',
            ownershipSource:
              site.ownershipSource || fallback?.ownershipSource || '官网待采集',
          } as Site;
        },
      );
      const keywords: Keyword[] = (saved.keywords || defaults.keywords).map(
        (keyword: Keyword) => {
          const fallback = defaults.keywords.find(
            (item) => item.id === keyword.id,
          );
          const relatedProducts = products.filter(
            (product) =>
              product.market === keyword.market &&
              product.category === keyword.category,
          );
          return {
            ...fallback,
            ...keyword,
            productIds:
              keyword.productIds ||
              fallback?.productIds ||
              relatedProducts.map((product) => product.id),
            siteIds: keyword.siteIds ||
              fallback?.siteIds || [
                ...new Set(relatedProducts.map((product) => product.siteId)),
              ],
          } as Keyword;
        },
      );
      const ads: Ad[] = (saved.ads || defaults.ads).map((ad: Ad) => {
        const fallback = defaults.ads.find((item) => item.id === ad.id);
        return {
          ...fallback,
          ...ad,
          firstSeenAt: ad.firstSeenAt || fallback?.firstSeenAt,
          evidenceUrl: ad.evidenceUrl || fallback?.evidenceUrl,
          dataNature: ad.dataNature || fallback?.dataNature || 'imported',
        } as Ad;
      });
      return {
        ...defaults,
        ...saved,
        products,
        sites,
        keywords,
        ads,
        branding: { ...defaults.branding, ...saved.branding },
        settings: {
          ...defaults.settings,
          ...saved.settings,
          productsPerSite: Math.min(
            20,
            Number(saved.settings?.productsPerSite) ||
              defaults.settings.productsPerSite,
          ),
          researchMaxSites: Math.min(
            10,
            Number(saved.settings?.researchMaxSites) ||
              defaults.settings.researchMaxSites,
          ),
          researchApiUrl:
            saved.settings?.researchApiUrl || defaults.settings.researchApiUrl,
        },
      };
    }
  } catch {
    /* Start fresh when storage is unavailable. */
  }
  return initial();
}
export const state = reactive<DemoState>(normalizeGrowth(restore()));
export const storageError = reactive({ value: '' });
watch(
  state,
  () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      storageError.value = '';
    } catch {
      storageError.value = '浏览器存储不可用，本次操作仅在当前页面会话保留。';
    }
  },
  { deep: true },
);
export const inMarket = (market: Market) =>
  state.market === 'ALL' || state.market === market;
export const filteredProducts = computed(() =>
  state.products.filter((p) => inMarket(p.market)),
);
export const filteredKeywords = computed(() =>
  state.keywords.filter((p) => inMarket(p.market)),
);
export const filteredSites = computed(() =>
  state.sites.filter((p) => inMarket(p.market)),
);
export const pendingReviews = computed(() =>
  state.reviews.filter((review) => {
    if (review.status !== 'pending') return false;
    const product = state.products.find((item) => item.id === review.productId);
    return product ? inMarket(product.market) : false;
  }),
);
export function marketName(code: string) {
  return markets.find((m) => m.code === code)?.name ?? '全部市场';
}
export function money(value: number, currency: string) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'VND' ? 0 : 2,
  }).format(value);
}
export function stamp() {
  return new Date().toLocaleString('sv-SE');
}
export function audit(
  title: string,
  detail: string,
  market: MarketFilter = state.market,
) {
  state.audit.unshift({
    id: crypto.randomUUID(),
    title,
    detail,
    at: stamp(),
    market,
  });
}
export function toggleFavorite(product: Product) {
  product.favorite = !product.favorite;
  audit(
    product.favorite ? '收藏商品' : '取消收藏',
    product.title,
    product.market,
  );
}
export function monitorProduct(productId: string) {
  const found = state.monitors.find((m) => m.productId === productId);
  if (found) found.enabled = true;
  else
    state.monitors.push({
      id: crypto.randomUUID(),
      productId,
      frequency: '每周',
      enabled: true,
    });
  audit(
    '开启演示监控',
    state.products.find((p) => p.id === productId)?.title || productId,
    state.products.find((p) => p.id === productId)?.market || state.market,
  );
}
export function resetDemo() {
  const branding = { ...state.branding };
  Object.assign(state, normalizeGrowth(initial()), { branding });
}
export function download(
  name: string,
  content: string,
  type = 'text/plain;charset=utf-8',
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvValue(value: unknown) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(name: string, rows: Record<string, unknown>[]) {
  const [firstRow] = rows;
  if (!firstRow) return;
  const keys = Object.keys(firstRow);
  download(
    name,
    `\uFEFF${[
      keys.map((key) => csvValue(key)).join(','),
      ...rows.map((r) => keys.map((k) => csvValue(r[k])).join(',')),
    ].join('\r\n')}`,
    'text/csv;charset=utf-8',
  );
}
