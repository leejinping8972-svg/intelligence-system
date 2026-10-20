import type { Ad, Market, Site } from './data';

export interface AdvertiserRow {
  id: string;
  pageId: string;
  market: Market;
  name: string;
  adId: string;
  adIds: string[];
  active: number;
  stopped: number;
  siteIds: string[];
  domains: string[];
  collectedAt?: string;
  dataNature?: string;
}
export function groupAdvertisers(ads: Ad[], sites: Site[]): AdvertiserRow[] {
  const groups = new Map<string, AdvertiserRow>();
  const knownSites = new Map(sites.map((s) => [s.id, s]));
  const sorted = [...ads].toSorted((a, b) =>
    (b.lastCollectedAt || '').localeCompare(a.lastCollectedAt || ''),
  );
  for (const ad of sorted) {
    if (!/^\d{1,40}$/.test(String(ad.pageId || ''))) continue;
    const id = `${ad.market}:${ad.pageId}`;
    const row = groups.get(id) || {
      id,
      pageId: String(ad.pageId),
      market: ad.market,
      name: ad.brand || `广告主 ${ad.pageId}`,
      adId: ad.id,
      adIds: [],
      active: 0,
      stopped: 0,
      siteIds: [],
      domains: [],
      collectedAt: undefined,
      dataNature: ad.dataNature,
    };
    if (row.adIds.includes(ad.id)) continue;
    if (row.dataNature === 'demo' && ad.dataNature !== 'demo') {
      row.adId = ad.id;
      row.dataNature = ad.dataNature;
      row.name = ad.brand || row.name;
    }
    row.adIds.push(ad.id);
    if (ad.status === '投放中') row.active++;
    if (ad.status === '已停止') row.stopped++;
    for (const siteId of ad.siteIds || []) {
      const site = knownSites.get(siteId);
      if (site?.market === ad.market && !row.siteIds.includes(siteId)) {
        row.siteIds.push(siteId);
        row.domains.push(site.domain);
      }
    }
    if (
      ad.lastCollectedAt &&
      Number.isFinite(Date.parse(ad.lastCollectedAt)) &&
      (!row.collectedAt ||
        Date.parse(ad.lastCollectedAt) > Date.parse(row.collectedAt))
    )
      row.collectedAt = ad.lastCollectedAt;
    groups.set(id, row);
  }
  return [...groups.values()];
}
