export const RELATED_SOURCES = ['products', 'ads', 'sites'];
export const defaultRelatedPlan = {
  relatedSources: [],
  productProviders: ['sorftime', 'semrush'],
  relatedProducts: 10,
  relatedAdPages: 1,
  relatedAds: 20,
  relatedSites: 5,
};
export function validateRelatedPlan(plan) {
  for (const [field, allowed] of [
    ['relatedSources', RELATED_SOURCES],
    ['productProviders', ['sorftime', 'semrush', 'tiktok_shop']],
  ]) {
    if (
      !Array.isArray(plan[field]) ||
      plan[field].some((v) => !allowed.includes(v))
    )
      throw new Error('请选择有效的每日关联采集类型和商品来源');
    plan[field] = [...new Set(plan[field])];
  }
  if (plan.relatedSources.includes('products') && !plan.productProviders.length)
    throw new Error('每日关联商品采集至少选择一个商品来源');
  for (const [field, max] of [
    ['relatedProducts', 100],
    ['relatedAdPages', 10],
    ['relatedAds', 100],
    ['relatedSites', 10],
  ]) {
    if (!Number.isInteger(plan[field]) || plan[field] < 1 || plan[field] > max)
      throw new Error('每日关联采集数量或页数超出范围');
  }
}
