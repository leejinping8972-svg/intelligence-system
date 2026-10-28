import { discoveryDecision } from './discovery-newness.mjs';
import { fetchWestmonthCatalog, westmonthEntry } from './westmonth-catalog.mjs';
import { fetchWestmonthProduct, westmonthMetricPatch, westmonthProductId, westmonthSavedListing } from './westmonth-product-metrics.mjs';

const missingSales = (product) => !product.sourceMetrics?.soldRaw && product.sourceMetrics?.soldCount === undefined;

export function westmonthBackfillPatch(product, observed = {}, at = new Date().toISOString()) {
  if (product.siteId !== 'VN-westmonth.com' || product.market !== 'VN' || !westmonthProductId(product.evidenceUrl)) return;
  const patch = { id: product.id };
  if (!discoveryDecision(product, 'product', Date.parse(at)).evidenceDate) {
    const listing = westmonthSavedListing(product, at) || observed.decisionData?.listing;
    if (listing) patch.decisionData = { listing };
  }
  if (missingSales(product) && observed.sourceMetrics?.soldRaw)
    patch.sourceMetrics = observed.sourceMetrics;
  return patch.decisionData || patch.sourceMetrics ? patch : undefined;
}

export async function planWestmonthMetricsBackfill(products, options) {
  const { fetchPage, wait = async () => {}, onProgress = async () => {}, maxRequests = 160 } = options;
  const at = new Date(options.now ?? Date.now()).toISOString();
  const site = { id: 'VN-westmonth.com', domain: 'westmonth.com', market: 'VN' };
  const eligible = products.filter((product) => product.siteId === site.id && product.market === site.market && westmonthProductId(product.evidenceUrl));
  const observations = new Map();
  const errors = [];
  let requests = 0;
  async function boundedFetch(...args) {
    if (requests >= maxRequests) throw new Error('西之月回填达到公开请求上限');
    if (requests) await wait();
    requests++;
    return fetchPage(...args);
  }
  let next = eligible.some(missingSales) ? westmonthEntry(true) : '';
  let stopped = false;
  while (next && requests < maxRequests) {
    try {
      const page = await fetchWestmonthCatalog(next, site, boundedFetch);
      for (const product of page.catalogProducts) {
        const id = westmonthProductId(product.url);
        const patch = westmonthMetricPatch(product.catalogProductMetrics, { market: site.market, at, evidenceUrl: product.catalogEvidenceUrl });
        const prior = observations.get(id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(patch)) {
          // Pagination can move while reading. Resolve that identity separately.
          observations.set(id, null);
        } else if (prior !== null) observations.set(id, patch);
      }
      next = page.catalogLinks[0] || '';
      await onProgress({ phase: 'catalog', requests, observed: observations.size });
    } catch (error) {
      errors.push({ phase: 'catalog', status: error.status, message: error.message });
      stopped = true;
      break;
    }
  }
  const entries = [];
  for (const product of eligible) {
    let observed = observations.get(westmonthProductId(product.evidenceUrl));
    if (!observed?.sourceMetrics && missingSales(product) && !stopped && requests < maxRequests) {
      try {
        const result = await fetchWestmonthProduct(product, boundedFetch);
        observed = westmonthMetricPatch(result.row, { market: site.market, at, evidenceUrl: result.evidenceUrl, kind: result.kind });
        await onProgress({ phase: 'product', requests, id: product.id, found: Boolean(result.row) });
      } catch (error) {
        errors.push({ id: product.id, status: error.status, message: error.message });
        if (error.status === 429) stopped = true;
      }
    }
    const patch = westmonthBackfillPatch(product, observed || {}, at);
    if (patch) entries.push({ id: product.id, evidenceUrl: product.evidenceUrl, patch });
  }
  return {
    at, requests, total: eligible.length, entries, errors,
    listing: entries.filter((entry) => entry.patch.decisionData?.listing).length,
    sales: entries.filter((entry) => entry.patch.sourceMetrics?.soldRaw).length,
    unresolvedSales: eligible.filter((product) => missingSales(product) && !entries.some((entry) => entry.id === product.id && entry.patch.sourceMetrics?.soldRaw)).map((product) => product.id),
  };
}
