export const POOL_TYPES = ['regular_new', 'fbm_new', 'new_listing'];
export function inNewProductPool(product) {
  return (product?.newProductClassifications || []).some((c) =>
    POOL_TYPES.includes(c.type),
  );
}
export function poolType(product) {
  return (product?.newProductClassifications || []).some(
    (c) => c.type === 'fbm_new' || c.fulfillment === 'FBM',
  )
    ? 'fbm_new'
    : 'regular_new';
}
export const NEW_PRODUCT_RULES =
  '每天北京时间00:00发起采集，筛选此前7个完整自然日上架、Sorftime报告销量大于0的商品。默认美国保健品，可选择来源真实类目；FBM仅指Amazon商家自配送。缺上架日期或销量证据不入池，TikTok曝光时间不代替上架时间。销量为来源报告或估算，不是已核实订单；覆盖受来源收录、类目、页数和采集上限影响。入池后保留历史，不因超过7天移除；历史宽窗口或官方榜单数据按原入池证据标注。';

// Apply only to future scheduled runs; never rewrite a frozen job/checkpoint.
export function dailyNewProductPlan(plan) {
  if (!['fbm_new', 'regular_new'].includes(plan.kind)) return plan;
  return {
    ...plan,
    ...(plan.market === 'US'
      ? {
          channels: plan.channels.filter((c) => c !== 'shopee'),
          sourceMarkets: Object.fromEntries(
            plan.channels.filter((c) => c !== 'shopee').map((c) => [c, 'US']),
          ),
          categories: Object.fromEntries(
            Object.entries(plan.categories || {}).map(([channel, rows]) => [
              channel,
              rows.filter((c) => c.market === 'US'),
            ]),
          ),
        }
      : {}),
    sourceMode: 'sorftime',
    requireSales: true,
    days: 7,
    completeDays: true,
    frequency: 'daily',
    time: '00:00',
  };
}

export function previousListingWindow(days, now = Date.now()) {
  const end = new Date(now + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(end) - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}
