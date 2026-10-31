export const COLLECTION_PROFILES = Object.freeze({
  explore: Object.freeze({
    label: '探索采集',
    maxProducts: 30,
    maxDetailProducts: 10,
    maxPagesPerSite: 20,
    browserPagesPerSite: 1,
    maxSitesPerBatch: 20,
  }),
  deep: Object.freeze({
    label: '深度采集',
    maxProducts: 100,
    maxDetailProducts: 100,
    maxPagesPerSite: 120,
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
  const maxPagesPerSite = Number(
    input.maxPagesPerSite ?? defaults.maxPagesPerSite,
  );
  const maxBrowserPages = Number(
    input.maxBrowserPages ??
      Math.min(50, defaults.browserPagesPerSite * siteCount),
  );
  return {
    profile,
    maxProducts,
    maxDetailProducts,
    maxPagesPerSite,
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
  return warnings;
}
