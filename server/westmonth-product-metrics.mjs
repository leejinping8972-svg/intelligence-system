import { validDiscoveryDate } from './discovery-newness.mjs';
import { westmonthPrice } from './westmonth-price.mjs';

export function westmonthProductId(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !['westmonth.com', 'www.westmonth.com'].includes(url.hostname)
    )
      return '';
    return /^\/products\/(\d{1,20})\/?$/.exec(url.pathname)?.[1] || '';
  } catch {
    return '';
  }
}

function displayedSales(value) {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value >= 0 ? `${value}+` : '';
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  return /^(?:\d+|\d{1,3}(?:,\d{3})+)\+?$/.test(raw)
    ? raw.endsWith('+')
      ? raw
      : `${raw}+`
    : '';
}

export function westmonthMetricPatch(
  row,
  { market, at, evidenceUrl, kind = 'catalog' },
) {
  const patch = westmonthPrice(row, { at, evidenceUrl });
  const context = {
    provider:
      kind === 'detail' ? '西之月官网公开商品详情' : '西之月官网公开商品目录',
    platform: '西之月',
    market,
    collectedAt: at,
    evidenceUrl,
  };
  const dateField = kind === 'detail' ? 'onsale_at' : 'product_addtime';
  const prefix =
    kind === 'detail' ? 'Westmonth detail JSON' : 'Westmonth catalog JSON';
  const rawDate = row?.[dateField];
  const date = typeof rawDate === 'string' ? rawDate.slice(0, 10) : '';
  if (
    typeof rawDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:$| (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$)/.test(
      rawDate,
    ) &&
    validDiscoveryDate(date) !== undefined &&
    Date.parse(date) <= Date.parse(at)
  ) {
    patch.decisionData = {
      listing: {
        ...context,
        date,
        rawDate,
        sourceField: `${prefix}.${dateField}`,
      },
    };
  }
  const soldRaw = displayedSales(row?.month_sale);
  if (soldRaw)
    patch.sourceMetrics = {
      soldRaw,
      soldCount: undefined,
      soldPrecision: 'lower_bound',
      soldPeriod: 'unspecified',
      collectedAt: at,
      soldCollectedAt: at,
      soldProvider: context.provider,
      soldPlatform: context.platform,
      soldEvidenceUrl: evidenceUrl,
      soldSourceField: `${prefix}.month_sale (官网销量展示加号)`,
    };
  return patch;
}

export function westmonthSavedListing(product, at) {
  try {
    const url = new URL(product.catalogEvidenceUrl);
    if (
      url.origin === 'https://api-x.westmonth.com' &&
      url.pathname === '/product-center/shop/products/load-list' &&
      Date.parse(product.lastCollectedAt) <= Date.parse(at)
    )
      return westmonthMetricPatch(
        { product_addtime: product.catalogListedAtRaw },
        {
          market: product.market,
          at: product.lastCollectedAt,
          evidenceUrl: url.href,
        },
      ).decisionData?.listing;
  } catch {}
}

export async function fetchWestmonthProduct(product, fetchPage) {
  const id = westmonthProductId(product.sourceUrl || product.evidenceUrl);
  if (!id) throw new Error('西之月商品缺少精确链接');
  const api = new URL(
    'https://api-x.westmonth.com/product-center/shop/products/detail',
  );
  api.search = new URLSearchParams({
    product_id: id,
    locale: 'zh_cn',
  }).toString();
  const response = await fetchPage(api.href, 0, ['application/json'], {
    allowedDomain: 'westmonth.com',
    manualRedirect: true,
  });
  if (response.redirect || (response.url && response.url !== api.href))
    throw new Error('西之月商品接口跳转，未关联数据');
  const body = JSON.parse(response.html);
  if (
    body.code !== 0 ||
    !body.data ||
    typeof body.data !== 'object' ||
    Array.isArray(body.data)
  )
    throw new Error('西之月商品接口返回异常');
  if (String(body.data.id) !== id)
    throw new Error('西之月商品编号不匹配，未关联数据');
  return { row: body.data, evidenceUrl: api.href, kind: 'detail' };
}
