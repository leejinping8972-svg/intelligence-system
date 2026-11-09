import { discoveryDecision } from './discovery-newness.mjs';
import {
  previousListingWindow,
  inNewProductPool,
} from './product-pool-domain.mjs';
import { displayedSalesOrder } from './product-list-sort.mjs';

export function admitMonitoredProduct(old, observed, item, now = Date.now()) {
  if (inNewProductPool(old)) return observed;
  const listing = item.decisionData?.listing;
  const date = discoveryDecision(item, 'product', now).evidenceDate;
  const window = previousListingWindow(7, now);
  const sales = item.sourceMetrics || {};
  const sold = displayedSalesOrder(sales);
  const salesAt = Date.parse(sales.soldCollectedAt || sales.collectedAt || '');
  const listingAt = Date.parse(listing?.collectedAt || '');
  const publicUrl = (value) => {
    try {
      const u = new URL(value);
      return (
        ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  };
  if (
    !date ||
    listing?.dateBasis === 'exposure' ||
    date < window.start ||
    date > window.end ||
    !(sold > 0) ||
    !Number.isFinite(salesAt) ||
    salesAt > now ||
    salesAt !== listingAt ||
    !sales.soldProvider ||
    !sales.soldPlatform ||
    sales.soldProvider !== listing.provider ||
    sales.soldPlatform !== listing.platform ||
    !sales.soldSourceField ||
    !publicUrl(sales.soldEvidenceUrl)
  )
    return observed;
  const evidence = {
    type: 'new_listing',
    label: '近7天 · 独立站新品',
    source: listing.provider,
    listingDate: date,
    dateBasis: 'listing',
    days: 7,
    window,
    observedAt: new Date(now).toISOString(),
    fulfillment: 'unknown',
    evidenceUrl: listing.evidenceUrl,
    salesEvidence: {
      value: sold,
      raw: sales.soldRaw,
      provider: sales.soldProvider,
      platform: sales.soldPlatform,
      sourceField: sales.soldSourceField,
      evidenceUrl: sales.soldEvidenceUrl,
      collectedAt: sales.soldCollectedAt || sales.collectedAt,
    },
  };
  return {
    ...observed,
    newProductClassifications: [
      ...(observed.newProductClassifications || []),
      evidence,
    ],
  };
}
