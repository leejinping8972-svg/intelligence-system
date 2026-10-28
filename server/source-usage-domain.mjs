export const SOURCE_CATALOG = [
  {
    id: 'semrush',
    name: 'Semrush',
    mark: 'SE',
    unit: 'API units',
    config: 'provider:semrush:mcp:v1',
    description:
      '提供关键词搜索量、竞争难度和站点流量指标，用于关键词研究与独立站分析。',
    automatic: true,
  },
  {
    id: 'sorftime',
    name: 'Sorftime',
    mark: 'SF',
    unit: '调用',
    config: 'credentials',
    description:
      '提供 Amazon 关键词、商品详情和销量趋势，用于平台商品发现与数据补齐。',
  },
  {
    id: 'scrapecreators',
    name: 'ScrapeCreators',
    mark: 'SC',
    unit: 'credits',
    config: 'provider:scrapecreators:v1',
    description:
      '提供 Meta 广告、TikTok Shop 和社交内容数据，用于广告观察与消费者洞察。',
  },
  {
    id: 'firecrawl',
    name: 'Firecrawl',
    mark: 'FC',
    unit: 'credits',
    config: 'provider:site-fetch:v1',
    description:
      '为难以直连的商品页面提供托管采集，作为独立站商品抓取的付费备用。',
    automatic: true,
  },
  {
    id: 'youtube',
    name: 'YouTube Data API',
    mark: 'YT',
    unit: '配额单位',
    config: 'provider:youtube:v1',
    description: '获取视频搜索结果和公开互动数据，用于跟踪各市场的内容热度。',
  },
  {
    id: 'brave',
    name: 'Brave Search',
    mark: 'BS',
    unit: '请求',
    config: 'credentials',
    description: '从网页搜索结果发现品牌和独立站，并提供官网验证线索。',
  },
  {
    id: 'analysis',
    name: 'AI 模型服务',
    mark: 'AI',
    unit: 'tokens',
    config: 'provider:analysis:v1',
    description:
      '整理消费者内容、生成研究报告并辅助翻译，按模型实际返回的 token 用量统计。',
  },
  {
    id: 'google_trends',
    name: 'Google Trends',
    mark: 'GT',
    unit: '请求',
    free: true,
    description: '获取关键词的相对搜索趋势，用于判断热度变化和季节性。',
  },
  {
    id: 'google_suggest',
    name: 'Google 联想词',
    mark: 'GS',
    unit: '请求',
    free: true,
    description: '从搜索联想中发现延伸词，为关键词研究提供种子线索。',
  },
  {
    id: 'official_sites',
    name: '官网公开页面',
    mark: 'WEB',
    unit: '请求',
    free: true,
    description:
      '读取品牌官网商品页、公开目录及结构化数据，获取商品、价格与配方。',
  },
  {
    id: 'dsld',
    name: 'NIH DSLD',
    mark: 'DS',
    unit: '请求',
    free: true,
    description: '美国膳食补充剂标签库，提供商品、品牌、剂型与标签成分信息。',
  },
  {
    id: 'openfda',
    name: 'openFDA',
    mark: 'FD',
    unit: '请求',
    free: true,
    description: '提供美国召回和不良事件公开记录，用于产品风险线索核查。',
  },
  {
    id: 'pubmed',
    name: 'PubMed / ClinicalTrials',
    mark: 'PM',
    unit: '请求',
    free: true,
    description: '提供论文与临床研究登记，用于跟踪成分研究和科学证据。',
  },
  {
    id: 'pubchem',
    name: 'PubChem',
    mark: 'PC',
    unit: '请求',
    free: true,
    description: '提供可明确匹配的单一成分标识、分子式及基础化学档案。',
  },
  {
    id: 'gdelt',
    name: 'GDELT',
    mark: 'GD',
    unit: '请求',
    free: true,
    description: '提供全球新闻提及与事件线索，用于追踪行业和品牌动态。',
  },
  {
    id: 'medlineplus',
    name: 'MedlinePlus',
    mark: 'ML',
    unit: '请求',
    free: true,
    description: '提供英文与西班牙文健康主题内容，用于查找公共健康信息。',
  },
  {
    id: 'storeleads',
    name: 'Store Leads',
    mark: 'SL',
    unit: '额度',
    inactive: true,
    description: '提供电商独立站发现与背景数据，当前尚未接入自动接口。',
  },
  {
    id: 'seller',
    name: '卖家精灵',
    mark: 'SS',
    unit: '额度',
    inactive: true,
    description:
      '提供 Amazon 关键词与 ASIN 研究资料，当前以已有导出文件导入为主。',
  },
];
export const sourceById = (id) => SOURCE_CATALOG.find((s) => s.id === id);
const number = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const usageDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
export function usageDay(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return usageDateFormatter.format(new Date(value));
}
export function requestSources(step = '', record = {}, allowance = 0) {
  const sources = record.requestUsage?.sources || [];
  const provider = record.requestUsage?.provider || record.provider;
  if (
    provider === 'semrush' ||
    sources.some((s) =>
      ['semrush', 'semrush_sites', 'site_metrics'].includes(s),
    ) ||
    /^(sem-(discover|metric)|metrics|domain|site-score|sem-sites|semrush):/.test(
      step,
    )
  )
    return ['semrush'];
  if (
    provider === 'tiktok_shop' ||
    sources.some((s) =>
      ['ad_transcript', 'ads', 'social_research'].includes(s),
    ) ||
    /^(ads?|social|transcript):/.test(step)
  )
    return ['scrapecreators'];
  if (provider === 'sorftime' || allowance > 0) return ['sorftime'];
  if (provider === 'public_product') return ['official_sites'];
  if (/^(?:https?:\/\/|browser:https?:\/\/)/.test(step)) return ['official_sites'];
  if (sources.includes('semantic_analysis') || /^model/.test(step))
    return ['analysis'];
  if (sources.includes('google_trends_part') || /^trend/.test(step))
    return ['google_trends'];
  const ids = [];
  if (sources.includes('sorftime')) ids.push('sorftime');
  if (sources.includes('site_discovery')) ids.push('brave');
  if (sources.includes('google_suggest')) ids.push('google_suggest');
  return ids.length ? ids : ['unattributed'];
}
export function sourceCharge(id, record, status) {
  if (record.cached === true) return { amount: 0, billing: 'cached' };
  if (!['completed', 'done', 'success'].includes(status))
    return { amount: null, billing: 'unknown' };
  let amount = null;
  if (id === 'semrush') amount = Number.isSafeInteger(record.apiUnits) && record.apiUnits >= 0 ? record.apiUnits : null;
  else if (id === 'sorftime')
    amount = number(record.usage?.sorftimeCalls ?? record.providerCalls);
  else if (['firecrawl', 'scrapecreators'].includes(id))
    amount = number(record.creditsCharged);
  else if (id === 'analysis')
    amount = number(
      record.usage?.total_tokens ?? record.usage?.totalTokenCount,
    );
  else if (id === 'youtube') amount = number(record.quotaUnits);
  else if (sourceById(id)) amount = number(record.requests);
  const gap =
    Number(record.unknownCharges) > 0 ||
    (id === 'semrush' && record.legacyExpansionGap);
  return {
    amount,
    billing: amount === null ? 'unknown' : gap ? 'partial' : 'confirmed',
  };
}
export function usageEvent(row, sourceId) {
  const record = row.record || {};
  const at = record.requestUsage?.startedAt || row.at || null;
  return {
    id: `${row.id}:${sourceId}`,
    sourceId,
    at,
    day: usageDay(at),
    jobId: String(row.job_id || ''),
    task: (
      {
        keyword_research: '关键词研究',
        products: '独立站商品采集',
        platform_products: '平台商品发现',
        platform_product_enrichment: '商品数据补齐',
        enrichment: '关键词数据补齐',
        semrush_sites: 'Semrush 独立站发现',
        insight: '消费者需求洞察',
        market_report: '市场研究报告',
      }[row.task] || String(row.task || '历史任务')
    ).slice(0, 160),
    step: String(row.step || '未记录环节').slice(0, 160),
    operation: record.requestUsage?.operation || null,
    market: String(row.market || 'ALL'),
    status: row.status,
    dateBasis: at ? 'request' : 'undated',
    ...sourceCharge(sourceId, record, row.status),
  };
}
export function researchEvents(rows) {
  return rows.flatMap((row) =>
    requestSources(row.step, row.record, row.paid_allowance).map((id) =>
      usageEvent(
        {
          ...row,
          record: {
            ...row.record,
            legacyExpansionGap:
              row.step?.startsWith('sem-discover:') &&
              !Number.isSafeInteger(row.record?.unknownCharges),
          },
        },
        id,
      ),
    ),
  );
}
export function contentEvents(rows) {
  return rows.flatMap(({ name, value: job }) => {
    const events = (job.steps || []).flatMap((step, index) => {
      if (
        !step.accounted &&
        !step.cached &&
        !['running', 'unknown'].includes(step.status)
      )
        return [];
      const sourceId =
        step.paid || ['comments', 'transcript'].includes(job.mode)
          ? 'scrapecreators'
          : {
              youtube: 'youtube',
              article_fulltext: 'official_sites',
              europepmc: 'pubmed',
              medlineplus: 'medlineplus',
            }[step.source] || 'scrapecreators';
      return [
        usageEvent(
          {
            id: `${name}:${index}`,
            job_id: job.id,
            task: `公共内容 · ${job.input?.query || job.mode || '采集'}`,
            step: `${step.kind || job.mode || 'search'}:${step.source}:${index}`,
            status: step.status,
            at: step.usageAt,
            market: job.input?.market,
            record: {
              cached: step.cached,
              creditsCharged: step.creditsCharged,
              quotaUnits: step.quotaUnits,
              requests: step.actualRequests,
            },
          },
          sourceId,
        ),
      ];
    });
    if (job.aiUsage || ['failed', 'running', 'unknown'].includes(job.aiStatus))
      events.push(
        usageEvent(
          {
            id: `${name}:ai`,
            job_id: job.id,
            task: '公共内容整理',
            step: 'AI 内容整理',
            status: job.aiStatus === 'completed' ? 'done' : job.aiStatus,
            at: job.aiUsageAt,
            record: { usage: job.aiUsage },
          },
          'analysis',
        ),
      );
    return events;
  });
}
export function validateQuota(input) {
  if (!sourceById(input.sourceId)) throw new Error('数据源无效');
  for (const key of ['remaining', 'total'])
    if (
      input[key] !== null &&
      (number(input[key]) === null || input[key] > Number.MAX_SAFE_INTEGER)
    )
      throw new Error('额度必须是非负数字或留空');
  if (
    input.total !== null &&
    input.remaining !== null &&
    input.remaining > input.total
  )
    throw new Error('剩余额度不能超过总额度');
  if (
    input.expiresAt &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt) || !usageDay(input.expiresAt) || new Date(input.expiresAt).toISOString().slice(0, 10) !== input.expiresAt)
  )
    throw new Error('到期日期无效');
  return {
    remaining: input.remaining,
    total: input.total,
    expiresAt: input.expiresAt || null,
    updatedAt: new Date().toISOString(),
    origin: 'manual',
  };
}
export function summarizeUsage(
  events,
  configs,
  quotas,
  input = {},
  now = new Date(),
) {
  const today = usageDay(now.toISOString());
  const days = Number(input.days || 14);
  if (![7, 14, 30, 90].includes(days)) throw new Error('统计天数无效');
  const end = input.end || today;
  const start =
    input.start ||
    new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  if (
    ![start, end].every(
      (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)),
    ) ||
    start > end ||
    Date.parse(end) - Date.parse(start) > 366 * 86400000
  )
    throw new Error('请选择不超过一年的有效日期范围');
  const catalog = SOURCE_CATALOG.map((source) => {
    const records = events.filter((e) => e.sourceId === source.id);
    const known = records.filter(
      (e) => e.amount !== null && e.billing !== 'cached',
    );
    const quota = quotas[source.id] || {};
    const auto =
      quota.automatic?.remaining !== null &&
      quota.automatic?.remaining !== undefined
        ? quota.automatic
        : null;
    const chosen = quota.preferManual
      ? quota.manual
      : auto
        ? {
            ...auto,
            total: auto.total ?? quota.manual?.total ?? null,
            expiresAt: auto.expiresAt || quota.manual?.expiresAt || null,
          }
        : quota.manual;
    return {
      ...source,
      config: undefined,
      configured: source.free
        ? true
        : source.id === 'firecrawl'
          ? Boolean(configs[source.config]?.key)
          : source.id === 'sorftime'
            ? Boolean(
                configs['provider:sorftime:mcp:v1'] ||
                configs.credentialStatus?.sorftime,
              )
            : source.id === 'brave'
              ? Boolean(configs.credentialStatus?.brave)
              : Boolean(configs[source.config]),
      records: records.length,
      today: known
        .filter((e) => e.day === today)
        .reduce((sum, e) => sum + e.amount, 0),
      cumulative: known.reduce((sum, e) => sum + e.amount, 0),
      unknown: records.filter((e) => ['partial', 'unknown'].includes(e.billing))
        .length,
      todayUnknown: records.filter(
        (e) => e.day === today && ['partial', 'unknown'].includes(e.billing),
      ).length,
      cached: records.filter((e) => e.billing === 'cached').length,
      undated: records.filter((e) => !e.day).length,
      quota: chosen || null,
      manualQuota: quota.manual || null,
      preferManual: quota.preferManual === true,
      quotaMessage:
        quota.message ||
        (source.automatic
          ? '支持账户余额查询'
          : '未提供可用的免费余额接口，可手动登记'),
    };
  });
  let filtered = events.filter(
    (e) =>
      (!input.sourceId || e.sourceId === input.sourceId) &&
      (!input.billing || e.billing === input.billing) &&
      (!input.query ||
        `${e.task} ${e.jobId} ${e.step}`
          .toLowerCase()
          .includes(String(input.query).toLowerCase().slice(0, 160))) &&
      (input.undated === true
        ? !e.day
        : e.day && e.day >= start && e.day <= end),
  );
  filtered.sort(
    (a, b) =>
      (b.at || '').localeCompare(a.at || '') || a.id.localeCompare(b.id),
  );
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const daily = [];
  for (
    let day = Date.parse(`${start}T00:00:00Z`);
    day <= Date.parse(`${end}T00:00:00Z`);
    day += 86400000
  ) {
    const date = new Date(day).toISOString().slice(0, 10);
    const rows = events.filter((e) => e.day === date);
    daily.push({
      day: date,
      sources: SOURCE_CATALOG.map((s) => ({
        sourceId: s.id,
        amount: rows
          .filter((e) => e.sourceId === s.id && e.billing !== 'cached')
          .reduce((sum, e) => sum + (e.amount || 0), 0),
        unknown: rows.filter(
          (e) =>
            e.sourceId === s.id && ['partial', 'unknown'].includes(e.billing),
        ).length,
      })),
    });
  }
  const unattributed = events.filter(
    (e) => e.sourceId === 'unattributed',
  ).length;
  return {
    sources: catalog,
    daily,
    entries: filtered.slice((page - 1) * 25, page * 25),
    total: filtered.length,
    page,
    pageSize: 25,
    start,
    end,
    today,
    checkedAt: now.toISOString(),
    undated: events.filter((e) => !e.day).length,
    unattributed,
    coverage: `仅统计系统已记录请求；历史缺少时间的记录单列，未覆盖调用与未知扣费不按零处理。不同来源单位不合计，余额为最近一次账户快照。${unattributed ? `另有 ${unattributed} 条历史请求来源待核验。` : ''}`,
  };
}
