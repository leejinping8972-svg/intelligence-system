import { HEALTH_COVERAGE_VERSION, HEALTH_PRODUCT_POLICY, supportsHealthCoverage } from './health-category-domain.mjs';
import { createHash } from 'node:crypto';
import { previousListingWindow } from './product-pool-domain.mjs';
import {
  officialBoards,
  officialBoardUrl,
} from './official-new-release-domain.mjs';

export const discoveryKinds = {
  fbm_new: 'FBM新品',
  regular_new: '常规新品',
  ingredients: '成分研究',
};
export const discoveryDay = (now) =>
  new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
export const stableId = (value) => {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
export function discoveryPlan(input, scheduled = false) {
  if (!Object.hasOwn(discoveryKinds, input.kind))
    throw new Error('请选择监控类型');
  if (!['MX', 'US', 'VN'].includes(input.market)) throw new Error('请选择市场');
  const days = input.days ?? 7;
  if (
    !(
      input.kind === 'ingredients' ? [1, 7, 30, 60, 90] : [7, 30, 60, 90]
    ).includes(days)
  )
    throw new Error('抓取时间范围无效');
  const channels = [...new Set(input.channels || [])];
  if (
    channels.length === 0 ||
    channels.length > 30 ||
    channels.some((c) => !/^[a-z][a-z0-9_]{0,50}$/.test(c))
  )
    throw new Error('请选择来源渠道');
  if (input.kind === 'fbm_new' && channels.some((c) => c !== 'amazon'))
    throw new Error('FBM发货方式仅适用于Amazon');
  if (
    input.kind === 'ingredients' &&
    channels.some((c) => !['quora', 'reddit'].includes(c))
  )
    throw new Error('成分研究仅支持Reddit和Quora');
  const topics =
    input.kind === 'ingredients'
      ? [
          ...new Set(
            (Array.isArray(input.topics)
              ? input.topics
              : String(
                  input.topics ||
                    'dietary supplements\nnew supplement ingredients',
                ).split(/\r?\n/)
            )
              .map((s) => String(s).trim())
              .filter(Boolean),
          ),
        ]
      : [];
  if (
    (input.kind === 'ingredients' && topics.length === 0) ||
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
    maxProducts: input.kind === 'ingredients' ? 5000 : 1000,
    maxPages: input.sourceMode === 'official_new_releases' ? 10 : 100,
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
  if (
    input.sourceMode === 'official_new_releases' &&
    input.kind !== 'ingredients' &&
    channels.some((c) => c !== 'amazon')
  )
    throw new Error(
      '当前仅接入Amazon官方新品榜；其他平台未提供已验证的官方新品榜',
    );
  if (input.kind !== 'ingredients') {
    if (channels.some((c) => !['amazon', 'tiktok', 'shopee', 'temu'].includes(c)))
      throw new Error('新品支持Amazon、TikTok Shop、Shopee和Temu（以账户能力为准）');
    for (const channel of channels)
      sourceMarkets[channel] ||= channel === 'shopee' ? 'VN' : input.market;
  }
  const categories = {};
  for (const channel of channels) {
    const selected = input.categories?.[channel];
    if (!selected) continue;
    if (!Array.isArray(selected) || selected.length > 30 || selected.some(c => !/^\d+$/.test(c.id || '') || !/^[\da-f-]{36}$/i.test(c.receiptId || '') || !Array.isArray(c.path))) throw new Error('请选择来源返回的真实类目');
    categories[channel] = selected;
  }
  const plan = {
    kind: input.kind,
    market: input.market,
    days,
    channels,
    sourceMarkets,
    topics,
    ...limits,
    supplementOnly: input.supplementOnly !== false,
    ...(Object.keys(categories).length ? { categories } : {}),
    ...(input.completeDays === true ? { completeDays: true } : {}),
    ...(input.sourceMode === 'official_new_releases' &&
    input.kind !== 'ingredients'
      ? {
          sourceMode: 'official_new_releases',
          ...(input.requireListingDate === true
            ? { requireListingDate: true }
            : {}),
          officialBoardUrls: officialBoards(
            input.officialBoardUrls,
            sourceMarkets.amazon,
          ),
        }
      : {
          sourceMode: 'sorftime',
          ...(input.kind !== 'ingredients' ? { requireSales: true } : {}),
        }),
  };
  if (input.healthCoverageVersion) {
    if (input.healthCoverageVersion !== HEALTH_COVERAGE_VERSION || !supportsHealthCoverage(plan) ||
      input.healthProductPolicy !== HEALTH_PRODUCT_POLICY) throw Error('保健品类目版本或筛选规则无效');
    Object.assign(plan, { healthCoverageVersion: HEALTH_COVERAGE_VERSION, healthProductPolicy: HEALTH_PRODUCT_POLICY,
      supplementOnly: true, categories: {} });
  }
  if (scheduled) {
    const frequency =
      input.frequency || 'daily';
    const time = input.time || (input.kind === 'ingredients' ? '09:00' : '00:00');
    const weekday = input.weekday ?? 1;
    const monthDay = input.monthDay ?? 1;
    if (
      !['daily', 'monthly', 'weekly'].includes(frequency) ||
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
  const d = new Date(now + 8 * 3_600_000);
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
  return stamp <= today && stamp >= today - (days - 1) * 86_400_000;
}
export function newProductEvidence(product, plan, now = Date.now()) {
  if (plan.sourceMode === 'official_new_releases') {
    const ranking = product.resourceRaw?.officialNewRelease;
    if (
      ranking?.source !== 'amazon_official_new_releases' ||
      !Number.isInteger(ranking.rank) ||
      ranking.rank < 1 ||
      !Number.isFinite(Date.parse(ranking.observedAt))
    )
      return;
    try {
      officialBoardUrl(ranking.boardUrl, plan.sourceMarkets.amazon);
    } catch {
      return;
    }
    const fulfillment = product.resourceRaw?.fulfillment || 'unknown';
    const listingDate = product.decisionData?.listing?.date;
    if (plan.requireListingDate && !dateInWindow(listingDate, plan.days, now))
      return;
    if (plan.kind === 'fbm_new' && fulfillment !== 'FBM') return;
    return {
      type: plan.kind,
      label: plan.kind === 'fbm_new' ? '官方新品榜 · FBM' : '官方新品榜',
      source: 'Amazon Official',
      evidenceUrl: ranking.boardUrl,
      rank: ranking.rank,
      fulfillment,
      observedAt: ranking.observedAt,
      ...(plan.requireListingDate ? { listingDate, days: plan.days } : {}),
      ...(plan.kind === 'fbm_new'
        ? { fulfillmentEvidenceUrl: product.resourceRaw.fulfillmentEvidenceUrl }
        : {}),
    };
  }
  const date = product.decisionData?.listing?.date;
  if (plan.completeDays) {
    const window = previousListingWindow(plan.days, now);
    if (!dateInWindow(date, 36500, now) || date.slice(0, 10) < window.start || date.slice(0, 10) > window.end) return;
  } else if (!dateInWindow(date, plan.days, now)) return;
  if (plan.requireSales && !(product.resourceRaw?.salesEvidence?.value > 0))
    return;
  const fulfillment = product.resourceRaw?.fulfillment;
  if (plan.kind === 'fbm_new' && fulfillment !== 'FBM') return;
  return {
    type:
      plan.sourceMode === 'sorftime' || plan.days === 7
        ? plan.kind
        : 'new_listing',
    label:
      plan.sourceMode === 'sorftime'
        ? `近${plan.days}天 · ${discoveryKinds[plan.kind]}`
        : plan.days === 7
          ? discoveryKinds[plan.kind]
          : '新上架商品',
    listingDate: date,
    dateBasis: product.decisionData?.listing?.dateBasis || 'listing',
    fulfillment: fulfillment || 'unknown',
    observedAt: new Date(now).toISOString(),
    evidenceUrl: product.sourceUrl || product.evidenceUrl,
    source: 'Sorftime',
    days: plan.days,
    ...(plan.completeDays ? { window: previousListingWindow(plan.days, now) } : {}),
    ...(product.resourceRaw?.salesEvidence
      ? { salesEvidence: product.resourceRaw.salesEvidence }
      : {}),
  };
}
