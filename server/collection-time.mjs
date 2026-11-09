import { productCollectionTime } from './product-list-sort.mjs';
import { validDiscoveryDate } from './discovery-newness.mjs';

export function resourceCollectionTime(collection, value) {
  let values;
  if (collection === 'products') values = [productCollectionTime(value)];
  else if (collection === 'sites')
    values = [
      value.lastCollectedAt,
      ...(value.sourceEvidence || []).map((e) => e.collectedAt),
    ];
  else if (collection === 'ads') values = [value.lastCollectedAt];
  else values = [value.collectedAt];
  const latest = values
    .filter((v) => v && Number.isFinite(Date.parse(v)))
    .toSorted((a, b) => Date.parse(b) - Date.parse(a))[0];
  return latest ? new Date(latest).toISOString() : '';
}
export function shanghaiDay(now = Date.now()) {
  return new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
}
export function collectionRange(from = '', to = '') {
  for (const day of [from, to]) {
    if (
      day &&
      (typeof day !== 'string' ||
        day.length !== 10 ||
        validDiscoveryDate(day) === undefined)
    )
      throw new Error('采集日期必须为有效的YYYY-MM-DD日期');
  }
  if (from && to && from > to) throw new Error('采集开始日期不能晚于结束日期');
  return {
    from: from ? new Date(`${from}T00:00:00+08:00`).toISOString() : '',
    to: to
      ? new Date(Date.parse(`${to}T00:00:00+08:00`) + 86_400_000).toISOString()
      : '',
  };
}
export function matchesCollectionRange(collection, value, from = '', to = '') {
  const range = collectionRange(from, to);
  if (!from && !to) return true;
  const at = resourceCollectionTime(collection, value);
  return (
    !!at && (!range.from || at >= range.from) && (!range.to || at < range.to)
  );
}
export function productDiscoveryDay(value) {
  const at = value.discovery?.firstSeenAt || value.firstSeenAt;
  return at && Number.isFinite(Date.parse(at))
    ? shanghaiDay(Date.parse(at))
    : '';
}
