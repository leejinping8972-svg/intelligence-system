const routes = {
  products: '/sites',
  platform_products: '/products',
  ads: '/ads',
  ad_analysis: '/ads',
  consumer_research: '/consumer-insights',
  evidence_analysis: '/consumer-insights',
  market_analysis: '/consumer-insights',
  persona_research: '/consumer-insights',
  semrush_sites: '/sites',
  sites: '/selected-keywords',
  metrics: '/research',
  site_metrics: '/sites',
};
const actions = {
  keyword_research: 'server_submit',
  products: 'server_submit_products',
  platform_products: 'server_submit_platform_products',
  ads: 'server_submit_market',
  site_metrics: 'server_submit_market',
  semrush_sites: 'server_submit_semrush_sites',
  consumer_research: 'server_submit_insight',
  ad_analysis: 'server_submit_insight',
  evidence_analysis: 'server_submit_insight',
  market_analysis: 'server_submit_market_report',
  persona_research: 'server_persona_submit',
  sites: 'server_submit_enrichment',
  metrics: 'server_submit_enrichment',
};
const fields = [
  'kind',
  'market',
  'markets',
  'title',
  'seeds',
  'sources',
  'depth',
  'limit',
  'sorftimeRequestLimit',
  'socialTrends',
  'siteIds',
  'keywordIds',
  'productIds',
  'adIds',
  'urls',
  'query',
  'sourceKind',
  'analyze',
  'researchFocus',
  'maxRequests',
  'maxPages',
  'maxProducts',
  'maxDetailProducts',
  'maxRequestsPerSite',
  'maxBrowserPages',
  'maxPaidRequests',
  'profile',
  'perKeyword',
  'providers',
  'maxDomains',
  'enrich',
  'trend',
  'completeAll',
  'mode',
  'period',
  'endDate',
  'fetchTranscript',
  'maxAds',
  'maxSites',
  'siteSearchPages',
  'adStatus',
  'includeSearchSites',
  'autoComments',
  'maxDiscussionPosts',
  'reportId',
  'perPage',
  'discoveryOnly',
  'urlsPerKeyword',
  'maxComments',
  'refresh',
];
export function researchDraft(job) {
  const value = job.input || {};
  const kind = value.kind || 'keyword_research';
  const input = Object.fromEntries(
    fields.filter((k) => value[k] !== undefined).map((k) => [k, value[k]]),
  );
  if (Array.isArray(input.urls)) input.urls = input.urls.join('\n');
  if (kind === 'platform_products' || kind === 'semrush_sites')
    input.terms = (
      value.terms ||
      value.seeds ||
      value.records?.map((r) => r.term) ||
      []
    ).join('\n');
  if (kind === 'platform_products' && value.mode === 'enrich')
    input.refresh = true;
  if (value.resourceDiscovery) {
    const planFields = [
      'routeId',
      'market',
      'mode',
      'terms',
      'urls',
      'category',
      'websiteDomain',
      'researchCategory',
      'salesWindowDays',
      'ranking',
      'maxProducts',
      'includeDetails',
      'includeHistory',
      'budget',
    ];
    Object.assign(
      input,
      Object.fromEntries(
        planFields
          .filter((k) => value.resourcePlan?.[k] !== undefined)
          .map((k) => [k, value.resourcePlan[k]]),
      ),
      { resourceDiscovery: true },
    );
    input.terms = (input.terms || []).join('\n');
    input.urls = (input.urls || []).join('\n');
  }
  if (['ads', 'metrics', 'sites'].includes(kind))
    input.keywordIds ||= value.records?.map((r) => r.id);
  if (kind === 'products' || kind === 'site_metrics')
    input.siteIds ||= value.records?.map((r) => r.id);
  if (!value.kind && value.existingRecords)
    input.existingRecords = value.existingRecords;
  if (input.socialTrends)
    input.socialTrends = { ...input.socialTrends, budgetAcknowledged: false };
  if (value.resourceCategories) {
    for (const key of [
      'routeId',
      'provider',
      'platform',
      'query',
      'parentId',
      'parentReceiptId',
    ])
      if (value[key] !== undefined) input[key] = value[key];
    input.resourceCategories = true;
    input.market = value.market;
    input.budget = { requests: 5, sorftimeCalls: 1 };
  }
  const action = value.resourceCategories
    ? 'server_product_resource_categories'
    : kind === 'platform_products' && value.mode === 'enrich'
      ? 'server_complete_platform_products'
      : actions[kind];
  if (!action)
    throw new Error('此历史任务暂不支持重新研究，请从对应业务页面新建任务');
  return {
    kind,
    path: routes[kind] || '/research',
    action,
    input,
    previous: {
      title: value.title || '',
      keywords: (job.checkpoint?.keywords || []).map((r) => ({
        id: r.id,
        term: r.term,
        market: r.market,
      })),
      products: job.checkpoint?.products || 0,
      evidence: job.checkpoint?.evidenceIds?.length || 0,
      status: job.status,
    },
  };
}
