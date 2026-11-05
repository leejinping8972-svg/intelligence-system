export function normalizeAsin(value) {
  const asin = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z0-9]{10}$/.test(asin) ? asin : '';
}

// The saved platform identity also covers records collected before asin existed.
// Never present another marketplace's product ID as an Amazon ASIN.
export function productAsin(product) {
  if (product?.sourcePlatform?.trim().toLowerCase() !== 'amazon') return '';
  return normalizeAsin(product.sourceProductId) || normalizeAsin(product.asin);
}
