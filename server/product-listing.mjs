import { discoveryDecision, validDiscoveryDate } from './discovery-newness.mjs';

export function productListingDate(product, now = Date.now()) {
  return discoveryDecision(product, 'product', now).evidenceDate;
}
export function validateListingRange(from = '', to = '') {
  for (const day of [from, to])
    if (
      day &&
      (typeof day !== 'string' ||
        day.length !== 10 ||
        validDiscoveryDate(day) === undefined)
    )
      throw new Error('上架日期必须为有效的YYYY-MM-DD日期');
  if (from && to && from > to) throw new Error('上架开始日期不能晚于结束日期');
  return { from, to };
}
export function matchesListingRange(
  product,
  from = '',
  to = '',
  now = Date.now(),
) {
  validateListingRange(from, to);
  if (!from && !to) return true;
  const date = productListingDate(product, now);
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}
export function recentListingRange(days, now = Date.now()) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now));
  const start = new Date(
    Date.parse(`${today}T00:00:00Z`) - (days - 1) * 86400000,
  )
    .toISOString()
    .slice(0, 10);
  return [start, today];
}
