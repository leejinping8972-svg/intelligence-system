import { productListingDate } from './product-listing.mjs';

export const productSortKeys = ['collectedAt', 'core:cumulativeSold', 'core:listingDate', 'core:priceOriginal'];

export function productCollectionTime(product) {
  return [product.lastCollectedAt, product.sourceMetrics?.collectedAt, product.sourceContent?.collectedAt]
    .filter((value) => value && Number.isFinite(Date.parse(value)))
    .toSorted((a, b) => Date.parse(b) - Date.parse(a))[0];
}

export function displayedSalesOrder(metrics = {}) {
  if (metrics.soldRaw) {
    const match = /^(\d+(?:\.\d+)?)\s*([kKmM万亿]?)\+?$/.exec(String(metrics.soldRaw).trim().replaceAll(',', ''));
    if (!match) return null;
    const scale = { k: 1000, m: 1_000_000, '万': 10_000, '亿': 100_000_000 };
    const value = Number(match[1]) * (scale[match[2].toLowerCase()] || 1);
    return Number.isFinite(value) ? value : null;
  }
  return typeof metrics.soldCount === 'number' && Number.isFinite(metrics.soldCount) && metrics.soldCount >= 0
    ? metrics.soldCount : null;
}

export function productSortValue(product, key) {
  if (key === 'collectedAt') {
    const time = productCollectionTime(product);
    return time ? Date.parse(time) : null;
  }
  if (key === 'core:priceOriginal') return typeof product.price === 'number' && Number.isFinite(product.price) && product.price >= 0 ? product.price : null;
  if (key === 'core:cumulativeSold') return displayedSalesOrder(product.sourceMetrics);
  if (key === 'core:listingDate') return productListingDate(product) || null;
  return null;
}

export function compareProductValues(a, b, order) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1;
  if (b === null || b === undefined) return -1;
  const comparison = a < b ? -1 : a > b ? 1 : 0;
  if (!comparison) return 0;
  return order === 'ascend' ? comparison : -comparison;
}
