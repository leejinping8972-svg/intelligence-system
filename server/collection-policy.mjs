export const COLLECTION_PROFILES = Object.freeze({
  explore: Object.freeze({
    label: '探索采集',
    maxProducts: 30,
    maxDetailProducts: 10,
    maxRequestsPerSite: 20,
    browserPagesPerSite: 1,
    maxSitesPerBatch: 20,
  }),
  deep: Object.freeze({
    label: '深度采集',
    maxProducts: 100,
    maxDetailProducts: 100,
    maxRequestsPerSite: 120,
    browserPagesPerSite: 3,
    maxSitesPerBatch: 16,
  }),
});

export function resolveCollectionPolicy(input, siteCount) {
  const profile = input.profile === 'deep' ? 'deep' : 'explore';
  const defaults = COLLECTION_PROFILES[profile];
  const maxProducts = Number(input.maxProducts ?? defaults.maxProducts);
  const maxDetailProducts = Number(
    input.maxDetailProducts ??
      Math.min(maxProducts, defaults.maxDetailProducts),
  );
  const maxRequestsPerSite = Number(
    input.maxRequestsPerSite ?? defaults.maxRequestsPerSite,
  );
  const maxRequests = Number(
    input.maxRequests ?? maxRequestsPerSite * siteCount,
  );
  const maxBrowserPages = Number(
    input.maxBrowserPages ??
      Math.min(50, defaults.browserPagesPerSite * siteCount),
  );
  return {
    profile,
    maxProducts,
    maxDetailProducts,
    maxRequests,
    maxRequestsPerSite,
    maxBrowserPages,
    recommendedSiteLimit: defaults.maxSitesPerBatch,
  };
}

export function collectionPolicyMessage(policy, siteCount) {
  const warnings = [];
  if (siteCount > policy.recommendedSiteLimit)
    warnings.push(
      `${policy.profile === 'deep' ? '深度' : '探索'}模式建议每批不超过${policy.recommendedSiteLimit}站；当前${siteCount}站会共享队列，请拆批以缩短等待时间`,
    );
  if (policy.maxRequests < policy.maxRequestsPerSite * siteCount)
    warnings.push('整批预算低于单站预算之和，后执行站点可能只得到部分结果');
  if (policy.maxRequestsPerSite < policy.maxDetailProducts + 1)
    warnings.push('单站预算不足以尝试全部详情目标，详情覆盖率可能无法达到100%');
  return warnings;
}
