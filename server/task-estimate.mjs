const positive = (v, fallback = 1) =>
  Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback;
export function estimateTask(input = {}, history = [], active = []) {
  if (input.plan)
    input = {
      ...input,
      market: input.plan.market,
      title: input.plan.title,
      budget: input.plan.budget,
    };
  const kind = input.kind || 'keyword_research';
  const keywords = input.existingRecords?.length || positive(input.limit, 30);
  const objects =
    input.siteIds?.length ||
    input.keywordIds?.length ||
    input.records?.length ||
    (Array.isArray(input.urls)
      ? input.urls.length
      : typeof input.urls === 'string'
        ? input.urls.split(/\s+/).filter(Boolean).length
        : 0) ||
    1;
  let calls = objects * positive(input.maxPages ?? input.maxPagesPerSite ?? input.budget?.maxPages);
  if (kind === 'market_collection')
    calls =
      (input.sources?.tiktokShop
        ? positive(input.budgets?.maxProducts) * 2
        : 0) +
      (input.sources?.metaActiveAds ? objects * positive(input.budgets?.adPages) : 0) +
      (input.sources?.independentSites
        ? positive(input.budgets?.siteProducts)
        : 0) +
      (input.sources?.tiktokContent
        ? positive(input.budgets?.maxContentQueries)
        : 0) +
      (input.sources?.tiktokComments
        ? positive(input.budgets?.commentVideos) *
          positive(input.budgets?.commentPages)
        : 0);
  let high = 15;
  let low = 2;
  if (kind === 'keyword_research') {
    calls = Math.max(
      1,
      keywords * 2 +
        (input.sources?.includes('semrush') ? keywords : 0) +
        (input.seeds?.length || 0) * (input.markets?.length || 1),
    );
    calls += input.socialTrends?.sources?.length
      ? (keywords *
            input.socialTrends.sources.length *
            positive(input.socialTrends.maxPages))
      : 0;
    low = 3;
    high = 12;
  } else if (kind === 'products') {
    low = 2;
    high = input.maxBrowserPages ? 30 : 20;
  } else if (
    [
      'ad_analysis',
      'evidence_analysis',
      'market_analysis',
      'persona_research',
    ].includes(kind)
  ) {
    calls = kind === 'persona_research' && input.plan?.acquire ? Math.max(1, (input.plan.groups?.length || 1) * 6 * (input.plan.sources?.length || 1)) : 1;
    low = 20;
    high = 120;
  }
  calls = Math.min(100000, Math.ceil(calls));
  const matches = history
    .filter((j) => (j.input?.kind || 'keyword_research') === kind)
    .flatMap((j) => {
      const cp = j.checkpoint || {};
      const seconds =
        (Date.parse(cp.finishedAt) - Date.parse(cp.startedAt)) / 1000;
      const requests = cp.requests || cp.keywords?.length * 2;
      return Number.isFinite(seconds) &&
        seconds > 0 &&
        requests > 0 &&
        seconds / requests < 600
        ? [seconds / requests]
        : [];
    })
    .sort((a, b) => a - b);
  if (matches.length >= 3) {
    const middle = matches[Math.floor(matches.length / 2)];
    low = middle * 0.6;
    high = middle * 1.8;
  }
  const queued = active.filter(
    (j) =>
      (j.input?.kind || 'keyword_research') === kind &&
      ['queued', 'running'].includes(j.status),
  ).length;
  return {
    minSeconds: Math.max(5, Math.ceil(calls * low)),
    maxSeconds: Math.max(15, Math.ceil(calls * high)),
    estimatedCalls: calls,
    ahead: queued,
    basis:
      matches.length >= 3
        ? '参考同类历史任务'
        : '按当前数量、页数和来源响应区间估算',
    samples: matches.length,
    note: '预计为开始执行后的耗时；排队等待另计。来源限流、登录验证、重试及新增分页会延长时间，达到上限也不保证数据完整。',
  };
}
