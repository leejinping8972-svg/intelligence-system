import { canonicalCatalogUrl } from './product-queue.mjs';
// Public product/catalog pages only; resume old queues without fetching assets.
export function monitorCatalogUrl(value, base) {
  const url = canonicalCatalogUrl(value, base);
  if (!url) return null;
  const path = new URL(url).pathname;
  if (
    /^\/(?:cdn|assets|static|wp-content|wp-includes)(?:\/|$)/i.test(path) ||
    /\.(?:css|js|mjs|map|jsonld|atom|rss|oembed|jpe?g|png|gif|webp|svg|ico|woff2?|ttf|eot|pdf|mp4|webm|zip)$/i.test(
      path,
    )
  )
    return null;
  return url;
}
