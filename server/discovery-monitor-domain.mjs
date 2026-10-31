import { createHash } from 'node:crypto';

export const discoveryKinds = {
  fbm_new: 'FBM新品',
  regular_new: '常规新品',
  ingredients: '成分研究',
};
export const discoveryDay = (now) =>
  new Date(now + 8 * 3600_000).toISOString().slice(0, 10);
export const stableId = (value) => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export function discoveryPlan(input, scheduled = false) {
  if (!Object.hasOwn(discoveryKinds, input.kind))
    throw new Error('请选择监控类型');
  if (!['US', 'MX', 'VN'].includes(input.market)) throw new Error('请选择市场');
  const days = input.days ?? 7;
  if (
    !(
      input.kind === 'ingredients' ? [1, 7, 30, 60, 90] : [7, 30, 60, 90]
    ).includes(days)
  )
    throw new Error('抓取时间范围无效');
  const channels = [...new Set(input.channels || [])];
  if (
    !channels.length ||
    channels.length > 30 ||
    channels.some((c) => !/^[a-z][a-z0-9_]{0,50}$/.test(c))
  )
    throw new Error('请选择来源渠道');
  if (input.kind === 'fbm_new' && channels.some((c) => c !== 'amazon'))
    throw new Error('FBM发货方式仅适用于Amazon');
  if (
    input.kind === 'ingredients' &&
    channels.some((c) => !['reddit', 'quora'].includes(c))
  )
    throw new Error('成分研究仅支持Reddit和Quora');
  const topics = [
    ...new Set(
      (Array.isArray(input.topics)
        ? input.topics
        : String(
            input.topics || 'dietary supplements\nnew supplement ingredients',
          ).split(/\r?\n/)
      )
        .map((s) => String(s).trim())
        .filter(Boolean),
    ),
  ];
  if (
    !topics.length ||
    topics.length > 10 ||
    topics.some((s) => s.length > 200)
  )
    throw new Error('请填写1至10个话题，每个不超过200字');
  const limits = {
    maxProducts: input.maxProducts ?? 100,
    maxPages: input.maxPages ?? 3,
    maxDetails: input.maxDetails ?? 5,
  };
  for (const [key, max] of Object.entries({
    maxProducts: 500,
    maxPages: 10,
    maxDetails: 20,
  }))
    if (
      !Number.isInteger(limits[key]) ||
      limits[key] < (key === 'maxDetails' ? 0 : 1) ||
      limits[key] > max
    )
      throw new Error('采集数量或页数无效');
  const sourceMarkets = Object.fromEntries(
    channels
      .filter((c) => input.sourceMarkets?.[c])
      .map((c) => [c, input.sourceMarkets[c]]),
  );
  if (
    Object.values(sourceMarkets).some(
      (m) => typeof m !== 'string' || !/^[A-Z]{2}$/.test(m),
    )
  )
    throw new Error('来源站点无效');
  const plan = {
    kind: input.kind,
    market: input.market,
    days,
    channels,
    sourceMarkets,
    topics,
    ...limits,
    supplementOnly: true,
  };
  if (scheduled) {
    const frequency =
      input.frequency || (input.kind === 'ingredients' ? 'daily' : 'weekly');
    const time = input.time || '09:00';
    const weekday = input.weekday ?? 1;
    const monthDay = input.monthDay ?? 1;
    if (
      !['daily', 'weekly', 'monthly'].includes(frequency) ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      !Number.isInteger(monthDay) ||
      monthDay < 1 ||
      monthDay > 28
    )
      throw new Error('定时周期无效');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw new Error('监控开关无效');
    Object.assign(plan, {
      frequency,
      time,
      weekday,
      monthDay,
      enabled: input.enabled === true,
    });
  }
  return plan;
}
export function scheduleSlot(plan, now = Date.now()) {
  const d = new Date(now + 8 * 3600_000);
  const day = d.toISOString().slice(0, 10);
  if (!plan.enabled || d.toISOString().slice(11, 16) < plan.time) return;
  if (plan.frequency === 'weekly' && d.getUTCDay() !== plan.weekday) return;
  if (plan.frequency === 'monthly' && d.getUTCDate() !== plan.monthDay) return;
  return day;
}
export function dateInWindow(value, days, now = Date.now()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value))
    return false;
  const date = value.slice(0, 10);
  const stamp = Date.parse(date);
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== date
  )
    return false;
  const today = Date.parse(discoveryDay(now));
  return stamp <= today && stamp >= today - (days - 1) * 86400_000;
}
export function newProductEvidence(product, plan, now = Date.now()) {
  const date = product.decisionData?.listing?.date;
  if (!dateInWindow(date, plan.days, now)) return;
  const fulfillment = product.resourceRaw?.fulfillment;
  if (plan.kind === 'fbm_new' && fulfillment !== 'FBM') return;
  return {
    type: plan.days === 7 ? plan.kind : 'new_listing',
    label: plan.days === 7 ? discoveryKinds[plan.kind] : '新上架商品',
    listingDate: date,
    fulfillment: fulfillment || 'unknown',
    observedAt: new Date(now).toISOString(),
    evidenceUrl: product.sourceUrl || product.evidenceUrl,
    source: 'Sorftime',
    days: plan.days,
  };
}
