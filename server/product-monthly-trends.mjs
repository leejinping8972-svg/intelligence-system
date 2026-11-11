const metrics = ['SalesVolume', 'SalesAmount'];
export const monthlyTrendMetrics = metrics;
const currencies = {
  US: 'USD',
  MX: 'MXN',
  GB: 'GBP',
  DE: 'EUR',
  FR: 'EUR',
  IN: 'INR',
  CA: 'CAD',
  JP: 'JPY',
  ES: 'EUR',
  IT: 'EUR',
  AE: 'AED',
  AU: 'AUD',
  BR: 'BRL',
  SA: 'SAR',
};
const zones = {
  US: 'America/Los_Angeles',
  MX: 'America/Mexico_City',
  JP: 'Asia/Tokyo',
  AU: 'Australia/Sydney',
};

export function monthlyTrendIdentity(product) {
  return {
    asin: product.sourceProductId,
    market: product.sourceMarket || product.market,
    platform: product.sourcePlatform,
    variant: product.sourceVariantId || product.resourceRaw?.variantId || '',
  };
}
export function sameMonthlyIdentity(history, product) {
  // JSON columns may reorder object keys when persisting the observation.
  // Identity depends on field values, not their serialization order.
  return Boolean(
    history?.identity &&
      Object.entries(monthlyTrendIdentity(product)).every(
        ([key, value]) => history.identity[key] === value,
      ),
  );
}
export function monthlyTrendDue(previous, product, metric, at) {
  if (!sameMonthlyIdentity(previous, product)) return true;
  const checked = Date.parse(previous[metric]?.checkedAt);
  return (
    !Number.isFinite(checked) || Date.parse(at) - checked >= 7 * 86_400_000
  );
}

// A monthly period must be explicit; daily/rolling samples are never summed here.
function monthKey(value) {
  const m = /^(\d{4})(?:[-/年]?)(\d{2})(?:月|-01|\/01)?$/.exec(String(value));
  return m && +m[1] >= 2000 && +m[2] >= 1 && +m[2] <= 12
    ? `${m[1]}-${m[2]}`
    : null;
}
function pointValue(value, metric) {
  if (value === null || value === -1 || value === '-1' || value === '')
    return null;
  let n = Number.NaN;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
    n = Number(value);
  if (
    !Number.isFinite(n) ||
    n < 0 ||
    (metric === 'SalesVolume' && !Number.isInteger(n))
  )
    throw new Error('历史月度数值结构无法识别，未将异常值补零');
  return n;
}
export function parseMonthlyTrend(value, product, metric, at) {
  if (!metrics.includes(metric)) throw new Error('不支持的历史月度指标');
  const market = product.sourceMarket || product.market;
  const currentMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: zones[market] || 'UTC',
    year: 'numeric',
    month: '2-digit',
  })
    .format(new Date(at))
    .slice(0, 7);
  let data = value;
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const inner =
      value.data && !Array.isArray(value.data) && typeof value.data === 'object'
        ? value.data
        : value;
    for (const obj of [value, inner]) {
      if (
        (obj.asin && obj.asin !== product.sourceProductId) ||
        (obj.type && obj.type !== metric) ||
        (obj.amz_site && obj.amz_site !== market)
      )
        throw new Error('历史月度商品、市场或指标不一致');
      for (const key of [
        'product_trend_type',
        'trend_type',
        'productTrendType',
      ])
        if (obj[key] && obj[key] !== metric)
          throw new Error('历史月度指标声明不一致');
      if (
        obj.currency &&
        currencies[market] &&
        obj.currency !== currencies[market]
      )
        throw new Error('历史销售额币种与来源市场不一致');
    }
    data = inner.data ?? inner;
  }
  let pairs;
  if (typeof data === 'string') {
    const parts = data
      .trim()
      .split(/[,，\n]+/)
      .filter((s) => s.trim());
    pairs = parts.map((s) => {
      const p = s.trim().split('=');
      if (p.length !== 2) throw new Error('历史月度文本格式无法识别');
      return p.map((v) => v.trim());
    });
  } else if (Array.isArray(data)) {
    if (data.length === 0) pairs = [];
    else if (data.every((r) => Array.isArray(r) && r.length === 2))
      pairs = data;
    else if (data.every((r) => r && typeof r === 'object' && !Array.isArray(r)))
      pairs = data.map((r) => [r.month ?? r.date ?? r.key, r.value]);
    else {
      if (data.length % 2) throw new Error('历史月度数据不完整');
      pairs = Array.from({ length: data.length / 2 }, (_, i) => [
        data[i * 2],
        data[i * 2 + 1],
      ]);
    }
  } else if (data && typeof data === 'object') pairs = Object.entries(data);
  else throw new Error('历史月度返回格式无法识别');
  const points = new Map();
  for (const [key, raw] of pairs) {
    const date = monthKey(key);
    if (!date) throw new Error('来源没有明确的月份，未将每日数据当作月度历史');
    if (date > currentMonth) throw new Error('历史月度包含未来月份');
    points.set(date, {
      date,
      value: pointValue(raw, metric),
      partial: date === currentMonth,
    });
  }
  const sorted = [...points.values()].toSorted((a, b) =>
    a.date.localeCompare(b.date),
  );
  // Explicit gaps keep the chart and table from implying continuous coverage.
  const filled = [];
  if (sorted.length > 0) {
    const start = Date.parse(`${sorted[0].date}-01T00:00:00Z`);
    const end = Date.parse(`${sorted.at(-1).date}-01T00:00:00Z`);
    if ((end - start) / 86_400_000 > 366 * 30)
      throw new Error('历史月度跨度异常');
    for (
      const cursor = new Date(start);
      cursor.getTime() <= end;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    ) {
      const date = cursor.toISOString().slice(0, 7);
      filled.push(
        points.get(date) || {
          date,
          value: null,
          partial: date === currentMonth,
        },
      );
    }
  }
  return {
    points: filled,
    currency: metric === 'SalesAmount' ? currencies[market] || null : null,
    metric,
    collectedAt: at,
    basis:
      'Sorftime历史月度报告或估算；Listing/变体聚合范围以来源为准，非卖家核实订单',
  };
}
