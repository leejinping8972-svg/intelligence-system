import { sameMonthlyIdentity } from './product-monthly-trends.mjs';

const validNumber = (n) =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;
export const watchDefaults = (market = 'US') => ({
  market,
  enabled: false,
  time: '01:00',
  frequency: 'daily',
  monthlyHistory: true,
});
export function watchConfig(input) {
  if (!['MX', 'US', 'VN'].includes(input.market))
    throw new Error('请选择监控市场');
  if (
    typeof input.enabled !== 'boolean' ||
    (input.monthlyHistory !== undefined &&
      typeof input.monthlyHistory !== 'boolean') ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)
  )
    throw new Error('监控时间或开关无效');
  return {
    ...watchDefaults(input.market),
    enabled: input.enabled,
    time: input.time,
    // Historical monthly metrics are now part of every new watch task. Accept
    // the legacy boolean field, but normalize old opt-out configurations.
    monthlyHistory: true,
  };
}
export function parseAmazonDaily(value, product, at) {
  const inner = value.data || value;
  if (
    inner.asin !== product.sourceProductId ||
    inner.type !== 'DailySalesVolume' ||
    !Array.isArray(inner.data)
  )
    throw new Error('每日销量商品标识或指标结构不一致');
  const timeZone =
    {
      US: 'America/Los_Angeles',
      MX: 'America/Mexico_City',
      VN: 'Asia/Ho_Chi_Minh',
    }[product.sourceMarket || product.market] || 'UTC';
  const sourceDay = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
  const points = new Map();
  for (let i = 0; i + 1 < inner.data.length; i += 2) {
    const raw = String(inner.data[i]);
    if (!/^\d{8}$/.test(raw)) continue;
    const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      continue;
    const value = inner.data[i + 1];
    points.set(date, {
      date,
      value: validNumber(value) ? value : null,
      partial: date >= sourceDay,
    });
  }
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function observation(product, previous, at, day, daily = []) {
  const info = {};
  for (const key of [
    'title',
    'brand',
    'imageUrl',
    'size',
    'ingredient',
    'claim',
    'sourceUrl',
  ]) {
    const value = product[key];
    if (
      typeof value === 'string' &&
      value &&
      !/^(平台未返回|官网未公开|品牌待确认|待分类|待识别)/.test(value)
    )
      info[key] = value;
  }
  if (product.sourceContent?.sellingPoints?.length)
    info.sellingPoints = product.sourceContent.sellingPoints;
  for (const key of ['attributes', 'descriptions']) {
    const value = product.sourceContent?.[key];
    if (value && Object.keys(value).length) info[key] = value;
  }
  const changes = Object.entries(info)
    .filter(
      ([key, value]) =>
        previous?.info &&
        JSON.stringify(previous.info[key]) !== JSON.stringify(value),
    )
    .map(([field, value]) => ({
      field,
      before: previous.info[field],
      after: value,
    }));
  const price =
    product.collectionFields?.includes('price') && validNumber(product.price)
      ? product.price
      : null;
  const monthly =
    product.resourceRaw?.salesEvidence?.metric === 'monthly_sales_volume' &&
    validNumber(product.resourceRaw.salesEvidence.value)
      ? product.resourceRaw.salesEvidence.value
      : null;
  return {
    productId: product.id,
    sourceProductId: product.sourceProductId,
    sourceVariantId:
      product.sourceVariantId || product.resourceRaw?.variantId || '',
    platform: product.sourcePlatform,
    market: product.sourceMarket || product.market,
    day,
    at,
    price,
    currency: product.currency || null,
    monthlySales: monthly,
    dailySales: daily,
    info,
    changes,
    salesBasis: 'Sorftime来源报告或估算，非核实订单；月销量快照不折算为日销量',
    status: 'completed',
  };
}
export function watchTrends(observations) {
  const rows = observations
    .filter((o) => o.status === 'completed')
    .sort((a, b) => a.at.localeCompare(b.at));
  const daily = new Map();
  for (const row of rows)
    for (const point of row.dailySales || [])
      daily.set(point.date, { ...point, collectedAt: row.at });
  const latest = rows.at(-1);
  const monthlyTrends =
    latest?.monthlyTrends &&
    sameMonthlyIdentity(latest.monthlyTrends, {
      sourceProductId: latest.sourceProductId,
      sourceMarket: latest.market,
      sourcePlatform: latest.platform,
      sourceVariantId: latest.sourceVariantId,
    })
      ? latest.monthlyTrends
      : undefined;
  return {
    monthlyTrends,
    dailySales: [...daily.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    snapshots: observations.sort((a, b) => a.day.localeCompare(b.day)),
  };
}
