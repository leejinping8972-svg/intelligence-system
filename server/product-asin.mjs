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

const amazonHosts = {
  US: 'www.amazon.com',
  MX: 'www.amazon.com.mx',
  GB: 'www.amazon.co.uk',
  CA: 'www.amazon.ca',
  DE: 'www.amazon.de',
  FR: 'www.amazon.fr',
  IT: 'www.amazon.it',
  ES: 'www.amazon.es',
  JP: 'www.amazon.co.jp',
  IN: 'www.amazon.in',
  AU: 'www.amazon.com.au',
  BR: 'www.amazon.com.br',
  AE: 'www.amazon.ae',
  SA: 'www.amazon.sa',
};

export function productAmazonUrl(product) {
  const asin = productAsin(product);
  if (!asin) return '';
  let host = amazonHosts[product.sourceMarket?.trim().toUpperCase()];
  for (const value of [product.sourceUrl, product.evidenceUrl]) {
    if (host) break;
    try {
      const url = new URL(value);
      const canonicalHost = `www.${url.hostname.replace(/^www\./, '')}`;
      if (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        Object.values(amazonHosts).includes(canonicalHost) &&
        normalizeAsin(
          /\/(?:dp|gp\/product)\/([a-z0-9]{10})(?:[/?]|$)/i.exec(
            url.pathname,
          )?.[1],
        ) === asin
      )
        host = canonicalHost;
    } catch {
      /* Missing or unrecognized evidence URL. */
    }
  }
  host ||= amazonHosts[product.market?.trim().toUpperCase()];
  return host ? `https://${host}/dp/${asin}` : '';
}
