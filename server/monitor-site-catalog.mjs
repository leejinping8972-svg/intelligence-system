import { digest } from './competitor-monitor-domain.mjs';
import { monitorCatalogUrl } from './monitor-catalog-rules.mjs';
import { catalogLinks } from './product-jobs.mjs';

const FEED_VERSION = 1;

export function monitorProductUrl(value, base, shopify = false) {
  const checked = monitorCatalogUrl(value, base);
  if (!checked) return null;
  const url = new URL(checked);
  url.hostname = new URL(base).hostname;
  if (shopify) {
    url.pathname = url.pathname.replace(
      /\/collections\/[^/]+\/products\/([^/]+)\/?$/i,
      '/products/$1',
    );
    if (/\/products\/[^/]+\/?$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/$/, '');
      url.searchParams.delete('variant');
    }
  }
  return url.toString();
}

export function monitorSitemapLinks(html, pageUrl) {
  const links = catalogLinks(html, pageUrl, true);
  if (!/<(?:[\w.-]+:)?sitemapindex\b/i.test(html)) return links;
  const productMaps = links.filter((value) =>
    /(?:^|\/)(?:sitemap_products(?:_\d+)?|product-sitemap(?:\d+)?)\.xml$/i.test(
      new URL(value).pathname,
    ),
  );
  if (productMaps.length === 0) return links;
  const prefix = new URL(pageUrl).pathname.replace(/\/[^/]*$/, '/');
  const identity = (value) => {
    const url = new URL(value);
    return `${url.pathname.split('/').at(-1)}?from=${url.searchParams.get('from') || ''}&to=${url.searchParams.get('to') || ''}`;
  };
  const primary = new Set(
    productMaps
      .filter((value) => {
        const path = new URL(value).pathname;
        return path.slice(0, path.lastIndexOf('/') + 1) === prefix;
      })
      .map((value) => identity(value)),
  );
  // Exclude a translated copy only when the primary index names the same
  // product sitemap and ID range. Different ranges remain part of coverage.
  return productMaps.filter((value) => {
    const path = new URL(value).pathname;
    return (
      path.slice(0, path.lastIndexOf('/') + 1) === prefix ||
      !primary.has(identity(value))
    );
  });
}

export function monitorShopifyFeed(progress) {
  return progress?.version === FEED_VERSION
    ? structuredClone(progress)
    : { version: FEED_VERSION, nextPage: 1, products: 0, signatures: [] };
}

export function monitorShopifyFeedUrl(base, page) {
  return `${base}/products.json?limit=50&page=${page}`;
}

export function advanceMonitorShopifyFeed(feed, data) {
  if (
    !Array.isArray(data?.products) ||
    data.products.some(
      (product) =>
        typeof product?.title !== 'string' ||
        !product.title.trim() ||
        typeof product.handle !== 'string' ||
        !product.handle.trim() ||
        /[/?#\\\s]/.test(product.handle),
    )
  )
    throw new Error('官网商品目录格式不正确，未确认完整目录');
  if (data.products.length === 0)
    return { ...feed, exhausted: true, complete: feed.products > 0 };
  const signature = digest(
    data.products
      .map((product) => product.handle)
      .toSorted()
      .join('\n'),
  );
  if (feed.signatures.includes(signature))
    throw new Error('官网商品目录重复返回同一页，未确认完整目录');
  return {
    ...feed,
    nextPage: feed.nextPage + 1,
    products: feed.products + data.products.length,
    signatures: [...feed.signatures, signature],
  };
}
