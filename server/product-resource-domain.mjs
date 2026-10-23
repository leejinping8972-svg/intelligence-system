import { createHash } from 'node:crypto';

const markets = ['US', 'MX', 'VN'];
const clean = (v, max = 200) => typeof v === 'string' ? v.normalize('NFKC').trim().slice(0, max) : '';
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const lines = (value) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/\r?\n/)).map((v) => clean(v, 1000)).filter(Boolean))];
const verification = { status: 'documented_schema_guarded', reason: '公开文档已核实；账户权限、实际覆盖与扣费未通过真实调用验证，运行时校验工具及参数。' };
const sample = '仅在本任务实际保存且口径可比的样本内排序；数量是目标上限，不保证全平台或全类目覆盖。';
const noWindow = '当前来源未提供可直接选择的滚动30/90/180天销量榜；累计已售、BSR、自然月和展示增量分别保留。';
function route(id, label, platform, provider, supportedMarkets, modes, extra = {}) {
  return {
    id, label, platform, provider, markets: supportedMarkets, modes,
    rankings: ['sample'], operations: ['search'], salesFields: [],
    history: { supported: false, reason: '无可靠历史销量接口；今天的采集不能补造过去180天。' },
    verification, cost: { unit: 'request', reason: '按本次手动设置的请求上限执行；实际扣费以提供方回执为准。' },
    limits: { maxProducts: 100, maxPages: 5 }, reason: noWindow,
    alternatives: ['保留关键词样本', '补齐可核验详情并持续积累观察'],
    ...extra,
  };
}
const sorftime = (id, name, platform, countries, search = true) => route(
  id, name, platform, 'sorftime', countries, [...(search ? ['keyword'] : []), 'category', 'urls'],
  {
    operations: [...(search ? ['search'] : []), 'category', 'bestsellers', 'detail', 'history'],
    rankings: ['sample', 'platform_bestsellers'],
    salesFields: [{ field: 'sourceMetrics.monthlySales', label: '来源月销量或累计已售', window: 'source_reported', nature: 'provider_estimate_or_display', unit: 'units', coverage: 'source_list' }],
    history: { supported: true, reason: '仅返回提供方已收录历史，原始分辨率按来源保存。Amazon通常为自然月，不能折算成滚动天数。' },
    cost: { unit: 'sorftime_call', reason: '每步最多一个数据工具调用；工具发现另有最多4个MCP控制请求。工具费用依账户，调用上限不是金额承诺。' },
  },
);

export const RESOURCE_ROUTES = [
  sorftime('amazon-sorftime', 'Amazon · Sorftime', 'amazon', ['US', 'MX']),
  sorftime('tiktok-sorftime', 'TikTok Shop 类目 · Sorftime', 'tiktok_shop', ['US', 'VN'], false),
  sorftime('shopee-sorftime', 'Shopee · Sorftime', 'shopee', ['VN']),
  sorftime('temu-sorftime', 'Temu · Sorftime', 'temu', ['US']),
  route('tiktok-scrapecreators', 'TikTok Shop 搜索 · ScrapeCreators', 'tiktok_shop', 'tiktok_shop', markets, ['keyword'], {
    operations: ['search'],
    salesFields: [{ field: 'sourceMetrics.soldCount', label: '展示累计已售', window: 'cumulative', nature: 'display_snapshot', unit: 'units', coverage: 'keyword_sample' }],
    cost: { unit: 'scrape_credit', reason: '文档每次请求1 credit；按实际credits_charged记账，缺回执保留预留、不自动重放。' },
    reason: `${noWindow} 非US搜索结果可能有限或不稳定；不跨国替代。`,
    alternatives: ['Sorftime真实类目', '公开商品链接'],
  }),
  route('tiktok-detail-scrapecreators', 'TikTok 商品链接 · ScrapeCreators', 'tiktok_shop', 'tiktok_shop', ['US'], ['urls'], { operations: ['detail'], cost: { unit: 'scrape_credit', reason: '每个商品链接1 credit；仅US有文档保证。' } }),
  route('tiktok-shop-scrapecreators', 'TikTok 店铺商品 · ScrapeCreators', 'tiktok_shop', 'tiktok_shop', markets, ['urls'], {
    operations: ['shop_products'], rankings: ['sample', 'platform_bestsellers'],
    cost: { unit: 'scrape_credit', reason: '每页1 credit，游标有界翻页。' },
    reason: 'top仅是店内热销排序，非全平台、全类目或指定天数销量榜；非US覆盖有限。',
  }),
  route('shopping-semrush', 'Google Shopping · Semrush', 'shopping', 'semrush', markets, ['keyword'], {
    operations: ['domains', 'shopping'], salesFields: [{ field: 'sourceMetrics.position', label: '购物广告位置/关键词搜索量', window: 'indexed_snapshot', nature: 'search_advertising', unit: 'position', coverage: 'indexed_merchants' }],
    cost: { unit: 'semrush_units', reason: '每步最多14次HTTP（连接、工具发现、schema与报告）；域名发现预留20 units/行，Shopping预留30 units/行，回执超预留立即停止。' },
    reason: '购物广告和站点商品发现，不是平台销量或交易订单来源。',
  }),
  ...[
    ['amazon', 'Amazon', ['US', 'MX']], ['tiktok_shop', 'TikTok Shop', markets],
    ['shopee', 'Shopee', ['VN']], ['mercadolibre', 'Mercado Libre', ['MX']],
    ['temu', 'Temu', ['US', 'MX']], ['website', '公开品牌/本土站', markets],
  ].flatMap(([platform, name, countries]) => [
    route(`${platform}-public`, `${name} · 公开链接`, platform, 'public_web', countries, ['urls'], { operations: ['public_page'], reason: '读取公开商品/类目页中的结构化商品和原始类目路径。登录、验证码、动态空页或无结构化商品时明确停止；不保证全目录。', verification: { status: 'synthetic_adapter_tested', reason: '适配器合成测试；真实网站可访问性和市场覆盖需运行环境核实。' }, cost: { unit: 'public_request', reason: '每次HTTP请求、重定向和下一页分别计入请求上限；不绕过访问限制。' } }),
    route(`${platform}-brave`, `${name} · Brave发现`, platform, 'brave', countries, ['keyword'], { operations: ['search', 'public_page'], reason: '关键词搜索只提供线索；仅后续公开页面可核验的商品入库。不是原生类目全量或销量榜。', cost: { unit: 'brave_request', reason: '每个搜索页1次Brave请求；每个落地页另外计入公开HTTP请求，不自动调用浏览器或模型。' } }),
  ]),
  route('instagram-scrapecreators', 'Instagram 内容与落地商品 · ScrapeCreators', 'instagram', 'scrapecreators', markets, ['keyword'], {
    operations: ['instagram_search', 'public_page'], cost: { unit: 'scrape_credit', reason: '每页Reels搜索1 credit；公开落地页另计请求。' },
    reason: 'Instagram用于品牌、内容和落地商品发现；内容地域是研究范围，不是已核验买家国家。没有交易销量、订单或平台热销榜。',
  }),
];

export function resourceRoute(id) {
  return RESOURCE_ROUTES.find((r) => r.id === id);
}
export function resourceResumeAllowed(job) {
  if (!job?.input?.resourceDiscovery || !(job.cancelled || job.status === 'cancelled')) return false;
  const cp = job.checkpoint || {};
  return !cp.inFlight && !cp.unknownCharges && (!cp.startedAt || Boolean(cp.finishedAt)) && (!cp.work || cp.index < cp.work.length);
}
export function resourceCapabilities(configured = {}) {
  return {
    version: 1, checkedAt: '2026-10-22', configured,
    routes: RESOURCE_ROUTES.map((r) => ({ ...r, configured: r.provider === 'public_web' || Boolean(configured[r.provider]), unavailableReason: r.provider === 'public_web' || configured[r.provider] ? '' : '请在现有数据源设置配置此来源；未执行连接或收费测试。' })),
    platforms: [
      { id: 'amazon', label: 'Amazon', reason: 'US/MX搜索、真实类目与来源榜单，按实际工具schema校验。', alternatives: ['公开商品链接'] },
      { id: 'tiktok_shop', label: 'TikTok Shop', reason: '搜索、类目、店铺与US详情；非US ScrapeCreators覆盖有限，无指定周期销量榜。', alternatives: ['Sorftime类目', '公开链接'] },
      { id: 'shopee', label: 'Shopee', reason: '仅VN市场开放此适配，类目与商品按账户MCP工具校验；无US/MX平台替代。', alternatives: ['VN公开链接'] },
      { id: 'mercadolibre', label: 'Mercado Libre', reason: '现有渠道未核实可用交易/历史API；MX公开页面和Brave只作商品样本发现。', alternatives: ['MX公开商品页'] },
      { id: 'temu', label: 'Temu', reason: 'Sorftime文档确认US；公开页面仅适配US/MX样本，不支持VN或原生类目全量。', alternatives: ['US/MX公开链接'] },
      { id: 'instagram', label: 'Instagram', reason: '品牌、内容和可验证落地商品；没有交易销量。', alternatives: ['已有关联公共内容研究', '品牌官网页'] },
      { id: 'shopping', label: 'Google Shopping', reason: '广告索引商品线索，非交易数据。', alternatives: ['商家公开商品页'] },
      { id: 'website', label: 'VN/US/MX本土站', reason: '公开结构化商品/类目页；用户选择研究市场不证明商品实际销售国。', alternatives: ['精确商品链接'] },
    ],
    windowReason: noWindow,
  };
}

export function validateResourceInput(input) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId || '')) throw new Error('缺少有效提交编号');
  const r = resourceRoute(input.routeId);
  if (!r) throw new Error('所选资源路径不存在');
  if (!r.markets.includes(input.market)) throw new Error('该来源不支持所选国家；请使用能力表中的公开链接或其他来源');
  const mode = input.mode || 'keyword';
  if (!r.modes.includes(mode)) throw new Error('该来源不支持此获取方式；关键词样本不能冒充原生类目');
  const ranking = input.ranking || 'sample';
  if (!r.rankings.includes(ranking)) throw new Error(noWindow);
  if (ranking === 'platform_bestsellers' && mode !== 'category' && r.id !== 'tiktok-shop-scrapecreators') throw new Error('该热销排序仅适用于真实类目或店铺商品路径');
  const days = input.salesWindowDays ?? 30;
  if (![30, 90, 180].includes(days)) throw new Error('销量统计窗口仅支持近30/90/180天；不是上架时间');
  const terms = lines(input.terms);
  const urls = lines(input.urls);
  if (mode === 'keyword' && (!terms.length || terms.length > 20 || terms.some((t) => t.length > 200))) throw new Error('请输入1至20个关键词，每词不超过200字符');
  if (mode === 'urls' && (!urls.length || urls.length > 100 || urls.some((s) => !/^https:\/\/[^\s]+$/i.test(s)))) throw new Error('请输入1至100个公开HTTPS链接');
  let category;
  if (mode === 'category') {
    const c = input.category;
    if (!c || !clean(c.id) || !Array.isArray(c.path) || !c.path.length || c.path.length > 20 || c.path.some((p) => !clean(p)) || c.market !== input.market || !clean(c.receiptId)) throw new Error('请先查询并选择该国家提供方实际返回的类目，不接受手工拼造ID');
    category = { id: clean(c.id), path: c.path.map((s) => clean(s)), market: input.market, receiptId: clean(c.receiptId), provider: r.provider, platform: r.platform };
  }
  const maxProducts = input.maxProducts ?? 100;
  if (!Number.isInteger(maxProducts) || maxProducts < 1 || maxProducts > 100) throw new Error('本次商品目标须为1至100，不自动扫描全市场');
  const defaults = { requests: 30, providerCalls: 20, sorftimeCalls: r.provider === 'sorftime' ? 10 : 0, scrapeCredits: ['tiktok_shop', 'scrapecreators'].includes(r.provider) ? 10 : 0, semrushUnits: r.provider === 'semrush' ? 2000 : 0, braveRequests: r.provider === 'brave' ? 5 : 0, browserPages: 0, modelTokens: 0, maxPages: 5, maxDetailProducts: 10 };
  const maximums = { requests: 500, providerCalls: 200, sorftimeCalls: 100, scrapeCredits: 100, semrushUnits: 100_000, braveRequests: 50, browserPages: 0, modelTokens: 0, maxPages: 10, maxDetailProducts: 100 };
  const budget = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input.budget?.[key] ?? fallback;
    if (!Number.isInteger(value) || value < (['requests', 'maxPages'].includes(key) ? 1 : 0) || value > (key === 'maxPages' ? r.limits.maxPages : maximums[key])) throw new Error(`${key}预算超出范围；此路径不使用模型或浏览器`);
    budget[key] = value;
  }
  const required = { sorftime: 'sorftimeCalls', tiktok_shop: 'scrapeCredits', scrapecreators: 'scrapeCredits', semrush: 'semrushUnits', brave: 'braveRequests' }[r.provider];
  if (required && (!budget[required] || !budget.providerCalls)) throw new Error('所选来源预算为0，请设置有限来源额度或改用公开链接');
  if (input.includeHistory && !r.history.supported) throw new Error(r.history.reason);
  if (input.includeDetails && !r.operations.includes('detail')) throw new Error('此来源没有可用详情接口；可使用公开商品链接补全');
  const websiteDomain = clean(input.websiteDomain).toLowerCase();
  if (r.platform === 'website' && !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(websiteDomain)) throw new Error('请填写允许读取的品牌或本土站域名，例如 brand.com');
  const initialOperation = mode === 'urls' ? r.operations.includes('shop_products') ? 'shop_products' : r.provider === 'public_web' ? 'public_page' : 'detail' : r.operations[0];
  const plan = { routeId: r.id, platform: r.platform, provider: r.provider, market: input.market, mode, terms: mode === 'keyword' ? terms : [], urls: mode === 'urls' ? urls : [], category, websiteDomain, researchCategory: clean(input.researchCategory), salesWindowDays: days, ranking, maxProducts, includeDetails: Boolean(input.includeDetails), includeHistory: Boolean(input.includeHistory), budget, initialOperation, operations: r.operations, supportedOperations: r.operations, cost: { providerCalls: r.provider === 'public_web' ? 0 : 1, ...(required && required !== 'semrushUnits' ? { [required]: 1 } : {}) } };
  return { kind: 'platform_products', resourceDiscovery: true, resourcePlan: plan, market: input.market, markets: [input.market], providers: [r.provider], seeds: plan.terms.length ? plan.terms : [category?.id || urls[0]], maxProducts, perKeyword: maxProducts, maxRequests: budget.requests, maxDetailProducts: budget.maxDetailProducts, maxDomains: 3, semrushUnitLimit: budget.semrushUnits, completeAll: false, enrich: plan.includeDetails, trend: plan.includeHistory };
}

export function requestedSalesWindow(plan, at = new Date().toISOString()) {
  const end = new Date(at);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end.getTime() - plan.salesWindowDays * 86_400_000);
  return { days: plan.salesWindowDays, start: start.toISOString().slice(0, 10), end: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10), kind: 'rolling_days', purpose: 'sales_statistics', timezone: 'UTC' };
}
export function resourceSalesMetric(product, window) {
  const sm = product.sourceMetrics || {};
  // Only complete daily units for this exact source product can fill a rolling window.
  for (const series of product.decisionData?.series || []) {
    if (series.metric !== 'sales_volume' || series.period !== 'day' || series.market !== product.market || series.productId !== product.sourceProductId || series.provider !== product.sourceProvider || series.platform !== product.sourcePlatform || String(series.sourceVariantId || series.variantId || '') !== String(product.sourceVariantId || product.resourceRaw?.variantId || '')) continue;
    const points = series.points.filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.start) && Number.isFinite(Date.parse(p.start)) && new Date(p.start).toISOString().slice(0, 10) === p.start && p.start >= window.start && p.end <= window.end && p.start === p.end && !p.partial && finite(p.value));
    const unique = new Map(points.map((p) => [p.start, p.value]));
    if (unique.size !== window.days || points.some((p) => unique.get(p.start) !== p.value)) continue;
    return { status: 'observed', kind: 'units', value: [...unique.values()].reduce((a, b) => a + b, 0), unit: '件', precision: 'source_reported', originalWindow: { ...window }, message: '来源逐日销量覆盖请求窗口；仅可比较本次采集样本，不等于平台全量排名。' };
  }
  const original = product.resourceSourceMetric;
  if (original && finite(original.value) && original.window?.start === window.start && original.window?.end === window.end && original.window?.kind === 'rolling_days' && original.window.days === window.days && ['units', 'orders'].includes(original.kind)) return { status: 'observed', kind: original.kind, value: original.value, raw: original.raw, unit: original.kind === 'orders' ? '订单' : '件', precision: original.precision || 'source_reported', originalWindow: original.window, message: '原始来源明确覆盖请求统计窗口；覆盖范围仍为来源返回样本。' };
  if (sm.soldRaw || finite(sm.soldCount)) return { status: 'observed', kind: 'cumulative_units', ...(finite(sm.soldCount) ? { value: sm.soldCount } : {}), raw: sm.soldRaw, unit: '件', precision: sm.soldPrecision || 'unknown', originalWindow: { kind: 'cumulative' }, message: `来源为累计展示已售，不代表近${window.days}天销量；不是订单数。` };
  if (finite(sm.monthlySales)) return { status: 'observed', kind: 'units', value: sm.monthlySales, unit: '件', precision: 'provider_estimate', originalWindow: { kind: 'source_month_unspecified' }, message: '来源月销量未给出精确起止日，不能换算或冒充滚动统计窗口。' };
  if (finite(sm.salesRank)) return { status: 'observed', kind: 'bsr', value: sm.salesRank, unit: '排名', originalWindow: { kind: 'snapshot' }, message: '平台BSR不是销量、销售件数或订单。' };
  return { status: product.sourcePlatform === 'Instagram' ? 'unsupported' : 'pending_history', kind: 'unknown', originalWindow: { kind: 'unknown' }, message: '来源未返回可比较销量；历史不足保持待积累，不以0代替。' };
}
export function decorateResourceProduct(product, plan, context = {}) {
  const at = context.collectedAt || product.lastCollectedAt || product.sourceMetrics?.collectedAt || new Date().toISOString();
  const window = requestedSalesWindow(plan, at);
  const old = product.resourceEvidence;
  const metric = resourceSalesMetric(product, window);
  const raw = product.resourceRaw || {};
  const p = { ...product, ...(plan.researchCategory ? { category: plan.researchCategory } : {}) };
  p.resourceEvidence = {
    version: 1, jobId: context.jobId || old?.jobId || '', routeId: plan.routeId, platform: plan.platform, provider: plan.provider, market: plan.market, mode: plan.mode,
    ...(plan.category ? { category: plan.category } : raw.category ? { category: raw.category } : {}), researchCategory: plan.researchCategory, queryTerms: plan.terms || [],
    requestedWindow: window, metric,
    ranking: { kind: plan.ranking, population: plan.ranking === 'platform_bestsellers' ? 'source_list' : 'collected_sample', sourceRank: context.sourceRank || raw.sourceRank, complete: false, message: plan.ranking === 'platform_bestsellers' ? '保留来源榜单顺序；榜单统计口径按来源，未承诺指定天数销量或完整类目。' : sample },
    coverage: { scope: 'collected_sample', complete: false, reason: sample, ...context.coverage, marketVerification: raw.marketEvidence || (plan.platform === 'website' || plan.platform === 'instagram' ? 'research_scope_only' : 'source_market_parameter') },
    ...(context.discoveryOrigin ? { discoveryOrigin: context.discoveryOrigin } : {}),
    collectedAt: at, evidenceUrl: product.evidenceUrl || product.sourceUrl || '',
    price: { ...(product.collectionFields?.includes('price') && finite(product.price) ? { amount: product.price } : {}), currency: product.currency, raw: raw.priceRaw, precision: raw.pricePrecision || (raw.priceRaw ? 'source_decimal' : 'unknown') },
    identity: { sourceProductId: product.sourceProductId, shopId: raw.shopId, shopName: product.sourceMetrics?.shopName || raw.shopName, variantId: product.sourceVariantId || raw.variantId, variants: raw.variants, specification: /^(平台未返回|官网未公开|待识别)/.test(product.size || '') ? undefined : product.size, formula: /^(平台未返回|官网未公开|未知)/.test(product.ingredient || '') ? undefined : product.ingredient },
    states: { history: { status: metric.kind === 'units' && metric.originalWindow?.kind === 'rolling_days' ? 'observed' : plan.includeHistory ? 'pending_history' : 'unsupported', message: noWindow }, detail: { status: product.sourceContent ? 'observed' : 'missing' }, ...context.states },
  };
  return p;
}
export function rankResourceProducts(products, plan) {
  const group = (p) => {
    const m = p.resourceEvidence?.metric;
    if (!m || !finite(m.value) || !['exact', 'source_reported', 'provider_estimate'].includes(m.precision || '') || m.kind === 'unknown' || m.originalWindow?.kind === 'source_month_unspecified') return '';
    return JSON.stringify([m.kind, m.unit, m.originalWindow]);
  };
  const groups = new Map();
  for (const p of products) { const key = group(p); if (key) (groups.get(key) || groups.set(key, []).get(key)).push(p); }
  for (const list of groups.values()) list.sort((a, b) => (a.resourceEvidence.metric.kind === 'bsr' ? 1 : -1) * (a.resourceEvidence.metric.value - b.resourceEvidence.metric.value) || a.id.localeCompare(b.id));
  const ranked = products.map((p) => {
    const e = p.resourceEvidence;
    if (!e) return p;
    const comparable = groups.get(group(p));
    const ranking = { ...e.ranking, total: products.length, eligible: comparable?.length || 0, complete: false };
    if (plan.ranking === 'platform_bestsellers') { if (finite(e.ranking.sourceRank) && e.ranking.sourceRank > 0) ranking.rank = e.ranking.sourceRank; }
    else if (comparable) { ranking.rank = comparable.indexOf(p) + 1; ranking.message = `${sample} 本组${comparable.length}件，按${e.metric.kind}及原始窗口比较。`; }
    else ranking.message = '缺少口径可比的精确数值，保留来源顺序但不编造销量名次。';
    return { ...p, resourceEvidence: { ...e, ranking } };
  });
  return { products: ranked, summary: { requested: plan.maxProducts, saved: products.length, comparableGroups: groups.size, population: 'collected_sample', complete: false, message: sample } };
}
export function mergeResourceHistory(old, patch) {
  const values = [...(old?.resourceHistory || []), old?.resourceEvidence, ...(patch.resourceHistory || []), patch.resourceEvidence].filter(Boolean);
  return [...new Map(values.map((v) => [JSON.stringify(v), v])).values()].slice(-200);
}
export async function archiveResourceEvidence(value, old, write) {
  const previous = new Set((old?.resourceHistory || []).map((s) => JSON.stringify(s)));
  for (const snapshot of [...(value.resourceHistory || []), value.resourceEvidence].filter(Boolean)) {
    const key = JSON.stringify(snapshot);
    if (previous.has(key)) continue;
    const hash = createHash('sha256').update(key).digest('hex').slice(0, 32);
    await write(`resource:observation:products:${value.id}:${hash}`, snapshot, true);
  }
}
