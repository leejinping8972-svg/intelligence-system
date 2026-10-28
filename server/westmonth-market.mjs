// Official filter-config: delivery regions, not buyer residence or sales market.
const REGIONS = Object.freeze({
  VN: { id: 9, name: '越南' },
  US: { id: 3, name: '美国' },
  MX: { id: 21, name: '墨西哥' },
});
export function westmonthRegion(market) {
  const region = Object.hasOwn(REGIONS, market) ? REGIONS[market] : undefined;
  if (!region)
    throw new Error('西之月未配置该市场的发货区域，已停止未筛选采集');
  return region;
}
export const westmonthCatalogScope = (site) =>
  'westmonth:delivery:' +
  westmonthRegion(site.market).id +
  ':all-in-stock:newest:v1';
export function westmonthChannelKey(kind, site) {
  return kind === 'products' &&
    String(site?.domain)
      .toLowerCase()
      .replace(/^www\./, '') === 'westmonth.com'
    ? kind + ':' + westmonthCatalogScope(site)
    : kind;
}
export function westmonthRegionMatches(row, market) {
  return String(row?.delivery_region_id) === String(westmonthRegion(market).id);
}
