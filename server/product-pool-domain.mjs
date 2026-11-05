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
  '按各监控保存的周期和北京时间发起采集，筛选执行日前所选数量的完整自然日内上架、Sorftime报告销量大于0的商品。默认近7天、每天00:00，可在编辑监控中修改；具体条件见商品入池证据。默认美国保健品，可选择来源真实类目；FBM仅指Amazon商家自配送。TikTok优先取上架日期，缺少时使用来源曝光日期并标注替代口径；其他平台缺上架日期、或所有平台缺销量证据时不入池。销量为来源报告或估算，不是已核实订单；覆盖受来源收录、类目、页数和采集上限影响。入池后保留历史，不因超过所选天数移除；历史宽窗口或官方榜单数据按原入池证据标注。';

// Apply only to future scheduled runs; never rewrite a frozen job/checkpoint.
export function dailyNewProductPlan(plan) {
  if (!['fbm_new', 'regular_new'].includes(plan.kind)) return plan;
  // Legacy persisted settings were hidden by the previous fixed schedule. Keep
  // that effective schedule until an explicit save opts into editable settings.
  const editable = plan.scheduleConfigVersion === 1;
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
    days: editable ? (plan.days ?? 7) : 7,
    completeDays: true,
    frequency: editable ? (plan.frequency ?? 'daily') : 'daily',
    time: editable ? (plan.time ?? '00:00') : '00:00',
  };
}

export function previousListingWindow(days, now = Date.now()) {
  const end = new Date(now + 8 * 3600000 - 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.parse(end) - (days - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}
