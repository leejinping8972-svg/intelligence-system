import catalogue from './health-category-catalogue.mjs';

export const HEALTH_COVERAGE_VERSION = catalogue.version;
export const HEALTH_PRODUCT_POLICY = 'oral-topical-nutrition-powder-v1';
export const healthCategories = catalogue.categories;

export function supportsHealthCoverage(plan) {
  return ['regular_new', 'fbm_new'].includes(plan.kind) &&
    plan.sourceMode !== 'official_new_releases' && plan.market === 'US' &&
    plan.channels?.length > 0 && plan.channels.every(c =>
      ['amazon', 'tiktok'].includes(c) &&
      (plan.sourceMarkets?.[c] || plan.market) === 'US');
}

// Only call for new submissions or future schedule plans, never frozen jobs.
export function futureHealthPlan(plan) {
  if (!supportsHealthCoverage(plan)) return plan;
  return {
    ...plan,
    healthCoverageVersion: HEALTH_COVERAGE_VERSION,
    healthProductPolicy: HEALTH_PRODUCT_POLICY,
    supplementOnly: true,
    categories: {},
  };
}

export function healthCategoryWork(plan) {
  if (plan.healthCoverageVersion !== HEALTH_COVERAGE_VERSION || !supportsHealthCoverage(plan))
    throw new Error('保健品类目版本或来源范围无效');
  return healthCategories.filter(c => plan.channels.includes(c.channel))
    .map(c => ({ channel: c.channel, sourceMarket: 'US', topic: 'Health products',
      nodeId: c.id, categoryName: c.name, powderOnly: c.powderOnly, page: 1 }));
}

export const healthCategoryKey = work => `${work.channel}:${work.nodeId}`;

export function healthCoverageSteps(cp) {
  if (!cp.healthCoverage) return [];
  const entries = Object.values(cp.healthCoverage);
  const lines = ['amazon', 'tiktok'].flatMap(channel => {
    const rows = entries.filter(c => c.channel === channel);
    if (rows.length === 0) return [];
    const base = rows.filter(c => !c.powderOnly);
    const extra = rows.filter(c => c.powderOnly);
    const ok = list => list.filter(c => c.firstPage === 'done').length;
    const extraLabel = extra.length > 0 ? `；代餐粉条件入口${ok(extra)}/${extra.length}` : '';
    return [`${channel === 'amazon' ? 'Amazon' : 'TikTok'}基础类目首屏成功${ok(base)}/${base.length}${extraLabel}；失败${rows.filter(c => c.error).length}；翻页未完整${rows.filter(c => c.truncated).length}`];
  });
  return [...lines, `已入池${cp.products || 0}件；待确认${cp.healthReviewCount || 0}件；排除${cp.healthExcluded || 0}件；上限跳过${cp.healthLimitSkipped || 0}条。首屏覆盖不代表全部分页采完。`];
}
