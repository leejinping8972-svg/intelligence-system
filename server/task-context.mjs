// Read-only, bounded task descriptions. Never replay requests to obtain context.
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const collections = new Set(['ads', 'products', 'sites']);
const destinations = {
  products: { path: '/products', label: '打开商品库' },
  sites: { path: '/sites', label: '打开独立站库' },
  ads: { path: '/ads', label: '打开广告库' },
  keywords: { path: '/research', label: '打开关键词研究' },
};

function description(input) {
  if (input.manualSalesVerification) return ['商品销量核对', '重新读取目标商品的来源详情，核对预估月销量。', 'products'];
  switch (input.kind) {
    case 'platform_products':
      return input.resourceCategories
        ? ['平台类目查询', '读取所选平台的类目，确认后续采集范围。', 'products']
        : input.mode === 'enrich'
          ? ['商品资料补全', '为所选商品补充来源详情与已配置的趋势资料。', 'products']
          : ['商品发现与趋势补全', '按指定关键词或资源路径发现商品，并采集已配置的详情与趋势。', 'products'];
    case 'source_fields': return ['来源字段 AI 分析', '整理目标对象已保存的原文资料，提取字段并保留来源引用。', input.targetKind];
    case 'product_watch': return ['商品持续监控', '更新本市场符合监控规则的商品，保留销售与价格观察记录。', 'products'];
    case 'discovery_monitor': return [({ fbm_new: 'FBM 新品发现', regular_new: '常规新品发现', ingredients: '成分风向' })[input.plan?.kind] || '新品发现', input.plan?.sourceMode === 'ingredient_trends' ? (input.trendOperation === 'analyze' ? '分析已积累的近期成分讨论，保留原文证据与覆盖范围。' : '每日补充社区帖子与重点评论，按ID去重保留历史。') : '按监控规则与指定来源收集新品或成分线索。', 'products'];
    case 'products': return ['站点商品采集', '从指定独立站采集商品资料。', 'sites'];
    case 'ads': return ['广告与关联站点采集', '按指定关键词查找广告及其关联独立站。', 'keywords'];
    case 'ad_analysis': return ['广告拆解与分析', '分析所选广告的内容、卖点和来源证据。', 'ads'];
    case 'site_metrics': return ['独立站指标补全', '补充指定独立站的流量与来源指标。', 'sites'];
    case 'semrush_sites': return ['独立站发现', '按指定关键词发现相关独立站。', 'keywords'];
    case 'sites': return ['关键词关联站点发现', '查找所选关键词对应的独立站。', 'keywords'];
    case 'metrics': return ['关键词指标补全', '补充所选关键词的搜索量与相关指标。', 'keywords'];
    case 'consumer_research': return ['消费者需求采集', '围绕指定主题收集消费者讨论与需求证据。', 'keywords'];
    case 'evidence_analysis': return ['需求语义分析', '分析已保存的需求证据，归纳主题和洞察。', 'keywords'];
    case 'market_analysis': return ['市场研究报告', '汇总指定市场与研究周期的商品和消费者资料。', 'keywords'];
    case 'persona_research': return ['人群画像研究', '按研究计划收集证据，整理目标人群与需求。', 'keywords'];
    case 'bulk_semrush_enrichment': return ['Semrush 批量数据补全', '按已保存的批次范围补充数据，具体执行情况见检查点。', 'keywords'];
    default: return !input.kind || input.kind === 'keyword_research'
      ? [input.expansionOnly ? '关键词发现' : '关键词与趋势研究', input.expansionOnly ? '从种子词发现相关关键词，并补充已选择的搜索量指标。' : '从种子词发现关键词，并采集已选择的趋势与指标。', 'keywords']
      : ['任务资料待检查', '此历史任务的类型暂时无法完整展示，原任务与已保存结果保留。', ''];
  }
}

export function taskContext(job, limit = 8) {
  const input = job.input || {};
  const [title, purpose, defaultKind] = description(input);
  const refs = [];
  const add = (kind, id, label = '', extra = {}) => {
    id = text(id);
    label = text(label);
    if (id || label) refs.push({ kind: collections.has(kind) ? kind : 'keywords', id, label: label || '', ...extra });
  };
  const targetKind = collections.has(input.targetKind) ? input.targetKind : defaultKind;
  if (input.targetId) add(targetKind, input.targetId, '', { sourceId: text(input.sourceProductId), market: text(input.market) });
  for (const id of list(input.productIds)) add('products', id);
  for (const id of list(input.siteIds)) add('sites', id);
  for (const id of list(input.adIds)) add('ads', id);
  for (const record of list(input.records)) add(defaultKind, record?.id, record?.domain || record?.title || record?.term, { market: text(record?.market) });
  if (!refs.length) {
    for (const item of [...list(input.seeds), ...list(input.terms), ...list(input.existingRecords)]) {
      add('keywords', typeof item === 'string' ? '' : item?.id, typeof item === 'string' ? item : item?.term, { market: text(item?.market) });
    }
    for (const url of [...list(input.urls), ...list(input.resourcePlan?.urls)]) add('sites', '', url);
    for (const term of list(input.resourcePlan?.terms)) add('keywords', '', term);
    for (const topic of list(input.plan?.topics)) add('keywords', '', topic);
    if (!refs.length && input.query) add(defaultKind, '', input.query);
  }
  const unique = [...new Map(refs.map(ref => [`${ref.kind}:${ref.id || `${ref.label}:${ref.market || ''}`}`, ref])).values()];
  const objectCount = unique.length || (input.kind === 'product_watch' ? number(job.checkpoint?.total) : null);
  const context = {
    kind: input.manualSalesVerification ? 'sales_verification' : input.kind || 'keyword_research',
    title, purpose,
    objectLabel: ({ products: '目标商品', sites: '目标独立站', ads: '目标广告', keywords: '研究范围' })[defaultKind] || '任务对象',
    objectCount,
    objects: unique.slice(0, limit),
    hasMore: unique.length > limit,
    scope: input.kind === 'product_watch' ? '本市场符合监控规则的商品' : input.kind === 'market_analysis' ? `${({ week: '周度', month: '月度', quarter: '季度' })[input.period] || '指定周期'}市场研究${input.endDate ? ` · 截至 ${text(input.endDate)}` : ''}` : input.kind === 'discovery_monitor' ? `${number(input.plan?.days) ?? '指定'}天观察范围` : '',
    verificationOnly: input.verifyOnly === true,
    destination: destinations[defaultKind],
  };
  if (context.verificationOnly) context.scope = '仅核对并保存记录，不更新商品库';
  return context;
}

function verificationResult(job) {
  const receipt = job.checkpoint?.receipt;
  if (!job.input?.manualSalesVerification || !receipt || receipt.jobId !== job.id || receipt.result !== 'success') return undefined;
  if (text(job.input.sourceProductId) && receipt.fresh?.asin !== job.input.sourceProductId) return undefined;
  if (job.input.market && receipt.fresh?.market !== job.input.market) return undefined;
  const fresh = number(receipt.fresh?.monthlySales);
  const previous = number(receipt.previous?.monthlySales);
  return {
    summary: fresh === null ? '核对请求已完成，来源未提供有效月销量' : '已取得本次预估月销量',
    metrics: [{ label: '预估月销量', value: fresh === null ? '未返回' : String(fresh), previous: previous === null ? '未记录' : String(previous) }],
    at: text(receipt.fresh?.collectedAt || receipt.finishedAt),
    provider: text(receipt.fresh?.salesEvidence?.provider || job.input.provider),
    notice: job.input.verifyOnly ? '本次结果已保存到核对记录，未覆盖商品库原值。' : '本次结果来自已保存的核对回执。',
    usage: [
      ['数据工具调用', number(receipt.providerCalls)],
      ['协议请求', number(receipt.usage?.requests)],
      ['模型调用', number(receipt.modelCalls)],
    ].filter(([, value]) => value !== null).map(([label, value]) => ({ label, value })),
  };
}

export async function decorateTaskContexts(tasks, jobs, connection, { detail = false } = {}) {
  const contexts = new Map(jobs.map(job => [job.id, taskContext(job, detail ? 100 : 8)]));
  const keys = [...new Set([...contexts.values()].flatMap(context => context.objects.filter(ref => ref.id && collections.has(ref.kind)).map(ref => `business:${ref.kind}:${ref.id}`)))];
  const documents = new Map();
  // Only this page's explicit target IDs; never load the complete product library.
  for (let offset = 0; offset < keys.length; offset += 200) {
    const chunk = keys.slice(offset, offset + 200);
    const result = await connection.query(`SELECT name,value FROM workspace_documents WHERE name IN (${chunk.map((_, i) => `$${i + 1}`).join(',')})`, chunk);
    for (const { name, value } of result.rows) documents.set(name, value);
  }
  for (const [id, context] of contexts) {
    context.objects = context.objects.map(ref => {
      const value = documents.get(`business:${ref.kind}:${ref.id}`);
      if (!value || (ref.market && value.market && ref.market !== value.market)) return { ...ref, label: ref.label || '名称未记录' };
      const sourceId = text(value.sourceProductId || ref.sourceId);
      const amazon = /amazon/i.test(text(value.sourcePlatform)) && /^[a-z0-9]{10}$/i.test(sourceId);
      return { ...ref, label: text(value.titleZh || value.title || value.brandZh || value.brand || value.domain) || ref.label || '名称未记录', original: value.titleZh && value.titleZh !== value.title ? text(value.title) : '', sourceId, identifierLabel: amazon ? 'ASIN' : '来源编号', platform: text(value.sourcePlatform), market: text(value.market || ref.market), imageUrl: /^https?:\/\//i.test(value.imageUrl || '') ? value.imageUrl : '' };
    });
    // An Amazon ASIN from the explicit verification input is usable even if the product was deleted.
    if (context.kind === 'sales_verification') for (const ref of context.objects) {
      if (/^[a-z0-9]{10}$/i.test(ref.sourceId || '')) ref.identifierLabel = 'ASIN';
    }
    if (detail) context.result = verificationResult(jobs.find(job => job.id === id));
  }
  return tasks.map(task => {
    const context = contexts.get(task.cloudJobId || task.id);
    return context ? { ...task, context } : task;
  });
}
