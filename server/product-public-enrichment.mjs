import { isIP } from 'node:net';

import { load } from 'cheerio';

import { discoveryDecision, validDiscoveryDate } from './discovery-newness.mjs';
import { fetchPublicPage, landingUrl } from './safe-web.mjs';
import { fetchWestmonthSavedPrice } from './westmonth-price.mjs';
import {
  fetchWestmonthProduct,
  westmonthMetricPatch,
  westmonthProductId,
  westmonthSavedListing,
} from './westmonth-product-metrics.mjs';

const provider = '官网公开商品数据';
const list = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const marketplace =
  /amazon|sorftime|tiktok|instagram|shopee|mercado libre|temu/i;
const productPath = /\/(?:products?|san-pham)\/[^/]+\/?$/i;

function normalizedUrl(value, base) {
  try {
    const url = new URL(value, base);
    if (!landingUrl(url.href)) return '';
    url.hash = '';
    const tracking = [];
    for (const key of url.searchParams.keys())
      if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) tracking.push(key);
    for (const key of tracking) url.searchParams.delete(key);
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    url.searchParams.sort();
    return url.href;
  } catch {
    return '';
  }
}

export function publicProductUrl(product) {
  if (
    marketplace.test(
      `${product?.sourceProvider || ''} ${product?.sourcePlatform || ''}`,
    )
  )
    return '';
  for (const value of [product?.sourceUrl, product?.evidenceUrl]) {
    const candidate = normalizedUrl(value);
    if (!candidate) continue;
    const url = new URL(candidate);
    if (
      isIP(url.hostname.replace(/^\[|\]$/g, '')) ||
      /(?:^|\.)(?:amazon\.[a-z.]+|tiktok\.com|instagram\.com|shopee\.[a-z.]+|temu\.com|mercadolibre\.[a-z.]+)$/i.test(
        url.hostname,
      ) ||
      /^\/(?:index\.(?:html?|php)|collections?|shop|catalog|blogs?|pages?)?\/?$/i.test(
        url.pathname,
      ) ||
      /\.(?:json|js|xml|jpe?g|png|webp|pdf|mp4)$/i.test(url.pathname) ||
      (product?.sourceProvider === 'Semrush' && !productPath.test(url.pathname))
    )
      continue;
    return candidate;
  }
  return '';
}

function sameProductUrl(value, pageUrl) {
  return Boolean(
    value && normalizedUrl(value, pageUrl) === normalizedUrl(pageUrl),
  );
}

function productNodes(value) {
  const queue = [{ value, depth: 0 }];
  const nodes = [];
  let visited = 0;
  while (queue.length && visited++ < 600) {
    const entry = queue.shift();
    if (!entry.value || typeof entry.value !== 'object' || entry.depth > 12)
      continue;
    if (
      !Array.isArray(entry.value) &&
      list(entry.value['@type']).some((type) =>
        /(?:^|[/#])Product$/i.test(type),
      )
    )
      nodes.push(entry.value);
    for (const child of Object.values(entry.value))
      if (child && typeof child === 'object')
        queue.push({ value: child, depth: entry.depth + 1 });
  }
  return nodes;
}

function jsonScriptValues($, type) {
  const values = [];
  $(`script[type="${type}"]`)
    .slice(0, 40)
    .each((_index, element) => {
      try {
        values.push(JSON.parse($(element).text()));
      } catch {}
    });
  return values;
}

function matchJsonLd(node, nodes, pageUrl, canonical, product) {
  const explicit = node.url || node['@id'];
  if (explicit) return sameProductUrl(explicit, pageUrl);
  // A URL-less node needs an exact page binding and a unique matching product.
  return (
    nodes.length === 1 &&
    sameProductUrl(canonical, pageUrl) &&
    text(node.name).normalize('NFKC') === text(product.title).normalize('NFKC')
  );
}

function publishedValue(node, at, prefix) {
  for (const key of ['published_at', 'datePublished', 'releaseDate']) {
    const value = node[key];
    if (
      validDiscoveryDate(value) === undefined ||
      Date.parse(value) > Date.parse(at)
    )
      continue;
    return {
      value: value.slice(0, 10),
      raw: value,
      sourceField: `${prefix}.${key}`,
    };
  }
}

function soldNumber(value) {
  let number = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (
      value.unitCode &&
      !/^(?:C62|H87|EA|PCS?|pieces?|items?|units?)$/i.test(value.unitCode)
    )
      return undefined;
    number = value.value;
  }
  if (typeof number === 'string') {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(number.trim())) return undefined;
    number = Number(number.replaceAll(',', '').trim());
  }
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function cumulativeWindow(node) {
  for (const key of [
    'period',
    'window',
    'interval',
    'salesPeriod',
    'soldPeriod',
    'sold_count_period',
    'time_window',
  ]) {
    const value = node?.[key];
    if (
      value !== undefined &&
      !/^(?:all[_ -]?time|total|cumulative|lifetime)$/i.test(String(value))
    )
      return false;
  }
  return true;
}

function soldValue(node, prefix) {
  if (!cumulativeWindow(node)) return undefined;
  for (const key of ['numberOfItemsSold', 'soldCount', 'sold_count']) {
    if (!cumulativeWindow(node[key])) continue;
    const value = soldNumber(node[key]);
    if (value !== undefined)
      return {
        value,
        raw: typeof node[key] === 'string' ? node[key].trim() : String(value),
        sourceField: `${prefix}.${key}`,
      };
  }
}

function shopifyHandle(pageUrl) {
  const url = new URL(pageUrl);
  const handle = /\/products\/([^/]+)\/?$/i.exec(url.pathname)?.[1];
  if (!handle || /\.(?:json|js)$/i.test(handle)) return '';
  try {
    const decoded = decodeURIComponent(handle);
    return /^[^/\\\s?#<>]+$/.test(decoded) ? decoded : '';
  } catch {
    return '';
  }
}

function shopifyNodes(value, handle, pageUrl) {
  if (!handle) return [];
  const queue = [{ value, depth: 0 }];
  const nodes = [];
  let visited = 0;
  while (queue.length && visited++ < 600) {
    const entry = queue.shift();
    if (!entry.value || typeof entry.value !== 'object' || entry.depth > 12)
      continue;
    const node = entry.value;
    if (
      node.handle === handle &&
      text(node.title) &&
      (!node.url || sameProductUrl(node.url, pageUrl))
    )
      nodes.push(node);
    for (const child of Object.values(node))
      if (child && typeof child === 'object')
        queue.push({ value: child, depth: entry.depth + 1 });
  }
  return nodes;
}

function fieldResult(values) {
  const present = values.filter(Boolean);
  const unique = new Set(present.map((row) => row.value));
  return unique.size === 1
    ? { value: present[0] }
    : {
        reason:
          unique.size > 1
            ? 'conflicting_public_values'
            : 'not_publicly_provided',
      };
}

function htmlEvidence(html, pageUrl, product) {
  const $ = load(html);
  const canonical =
    $('link[rel="canonical"]').first().attr('href') ||
    $('meta[property="og:url"]').first().attr('content');
  const nodes = jsonScriptValues($, 'application/ld+json').flatMap(
    productNodes,
  );
  const matched = nodes.filter((node) =>
    matchJsonLd(node, nodes, pageUrl, canonical, product),
  );
  const handle = shopifyHandle(pageUrl);
  const embedded = jsonScriptValues($, 'application/json').flatMap((value) =>
    shopifyNodes(value, handle, pageUrl),
  );
  const records = [
    ...matched.map((node) => ({ node, prefix: 'Product JSON-LD' })),
    ...embedded.map((node) => ({ node, prefix: 'Shopify product JSON' })),
  ];
  return {
    records,
    shopify: Boolean(
      handle &&
      (embedded.length ||
        /cdn\.shopify\.com|myshopify\.com|Shopify\.(?:shop|theme)|shopify-payment-button/i.test(
          html,
        ) ||
        /shopify/i.test(product.sourcePlatform || '')),
    ),
  };
}

function stateFor(found, previous, reason, fallbackUrl) {
  return found
    ? {
        status: 'observed',
        evidenceUrl: found.evidenceUrl,
        sourceField: found.sourceField,
      }
    : {
        status: previous ? 'preserved' : 'missing',
        reason,
        evidenceUrl: fallbackUrl,
      };
}

export async function enrichPublicProduct(request, overrides = {}) {
  const product = request.product;
  if (!product?.id || !product.market)
    throw new Error('公开商品补全缺少商品标识或市场');
  const maxPages = overrides.maxPages ?? request.publicMaxPages ?? 2;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 2)
    throw new Error('单商品公开补全页面上限须为1～2');
  const now =
    typeof overrides.now === 'function'
      ? overrides.now()
      : (overrides.now ?? Date.now());
  const at = new Date(now).toISOString();
  const original = publicProductUrl(product);
  const records = [];
  const errors = [];
  const fetchPage = overrides.fetchPage || fetchPublicPage;
  let providerCalls = 0;
  let stopReason = original
    ? 'not_publicly_provided'
    : 'unsupported_product_url';

  if (westmonthProductId(original)) {
    let patch = {};
    try {
      providerCalls++;
      const result = await fetchWestmonthProduct(
        { ...product, sourceUrl: original },
        fetchPage,
      );
      patch = westmonthMetricPatch(result.row, {
        market: product.market,
        at,
        evidenceUrl: result.evidenceUrl,
        kind: result.kind,
      });
    } catch (error) {
      stopReason = error.status === 429 ? 'rate_limited' : 'request_failed';
      errors.push({
        url: original,
        reason: stopReason,
        ...(Number.isInteger(error.status) ? { status: error.status } : {}),
      });
    }
    if (
      !patch.priceEvidence &&
      providerCalls < maxPages &&
      product.catalogEvidenceUrl
    ) {
      try {
        providerCalls++;
        Object.assign(
          patch,
          await fetchWestmonthSavedPrice(product, fetchPage, at),
        );
      } catch (error) {
        errors.push({
          url: original,
          reason:
            error.status === 429 ? 'rate_limited' : 'price_request_failed',
        });
      }
    }
    const savedListing = westmonthSavedListing(product, at);
    if (savedListing) patch.decisionData = { listing: savedListing };
    const listing = patch.decisionData?.listing;
    const sold = patch.sourceMetrics;
    const price = patch.priceEvidence;
    patch.id = product.id;
    patch.publicDataEvidence = {
      checkedAt: at,
      evidenceUrl: original,
      requests: providerCalls,
      listing: stateFor(
        listing,
        Boolean(discoveryDecision(product, 'product', now).evidenceDate),
        stopReason,
        original,
      ),
      price: stateFor(
        price,
        product.price > 0,
        errors.length
          ? stopReason
          : 'discount_price_not_returned_check_session',
        original,
      ),
      sold: stateFor(
        sold && {
          evidenceUrl: sold.soldEvidenceUrl,
          sourceField: sold.soldSourceField,
        },
        Boolean(product.sourceMetrics?.soldRaw) ||
          product.sourceMetrics?.soldCount !== undefined,
        stopReason,
        original,
      ),
      ...(errors.length ? { errors } : {}),
    };
    return {
      patch,
      empty: !listing && !sold && !price,
      providerCalls,
      message:
        listing || sold || price
          ? `已取得西之月官网${[listing && '上架日期', sold && '展示销量', price && '折后价'].filter(Boolean).join('、')}，保留原值及来源`
          : '未取得该编号的西之月公开商品数据，已有结果保留',
    };
  }

  let pages = 0;
  async function readExact(url, types, identityUrl = url) {
    if (pages >= maxPages) { stopReason = 'page_limit'; return; }
    pages++;
    let current = url;
    for (let redirects = 0; redirects <= 5; redirects++) {
      providerCalls++;
      let response;
      try {
        response = await fetchPage(current, 0, types, {
          allowedDomain: new URL(original).hostname,
          manualRedirect: true,
        });
      } catch (error) {
        stopReason = error.status === 429 ? 'rate_limited' : 'request_failed';
        errors.push({
          url: current,
          reason: stopReason,
          ...(Number.isInteger(error.status) ? { status: error.status } : {}),
        });
        return;
      }
      if (response.redirect) {
        const target = normalizedUrl(response.redirect, current);
        const before = new URL(current);
        const after = target && new URL(target);
        if (
          !after ||
          before.hostname !== after.hostname ||
          before.pathname !== after.pathname ||
          before.search !== after.search ||
          (before.protocol === 'https:' && after.protocol !== 'https:')
        ) {
          stopReason = 'product_redirect_mismatch';
          errors.push({ url: current, reason: stopReason });
          return;
        }
        current = target;
        continue;
      }
      if (!sameProductUrl(response.url || current, current)) {
        stopReason = 'product_response_mismatch';
        errors.push({ url: current, reason: stopReason });
        return;
      }
      return { ...response, url: response.url || current, identityUrl };
    }
    stopReason = 'redirect_limit';
  }

  if (original) {
    const page = await readExact(original, ['text/html']);
    if (page) {
      const evidence = htmlEvidence(page.html, page.url, product);
      for (const row of evidence.records)
        records.push({ ...row, evidenceUrl: page.url });
      const dates = records.map((row) =>
        publishedValue(row.node, at, row.prefix),
      );
      const sold = records.map((row) => soldValue(row.node, row.prefix));
      const needsEndpoint =
        evidence.shopify && (!dates.some(Boolean) || !sold.some(Boolean));
      if (needsEndpoint && pages >= maxPages)
        stopReason = 'page_limit';
      if (needsEndpoint && pages < maxPages) {
        const url = new URL(page.url);
        const handle = shopifyHandle(page.url);
        const endpoint = new URL(
          `/products/${encodeURIComponent(handle)}.js`,
          url.origin,
        ).href;
        const json = await readExact(endpoint, [
          'application/json',
          'text/javascript',
        ]);
        if (json) {
          try {
            for (const node of shopifyNodes(
              JSON.parse(json.html),
              handle,
              page.url,
            ))
              records.push({
                node,
                prefix: 'Shopify product JSON',
                evidenceUrl: json.url,
              });
          } catch {
            stopReason = 'invalid_product_json';
            errors.push({ url: json.url, reason: stopReason });
          }
        }
      }
    }
  }

  const candidates = (read) =>
    records.map((row) => {
      const found = read(row.node, at, row.prefix);
      return found && { ...found, evidenceUrl: row.evidenceUrl };
    });
  const listing = fieldResult(candidates(publishedValue));
  const sold = fieldResult(
    candidates((node, _at, prefix) => soldValue(node, prefix)),
  );
  const patch = { id: product.id };
  const platform = product.sourcePlatform || '官网';
  if (listing.value) {
    const found = listing.value;
    patch.decisionData = {
      listing: {
        date: found.value,
        rawDate: found.raw,
        provider,
        platform,
        market: product.market,
        collectedAt: at,
        evidenceUrl: found.evidenceUrl,
        sourceField: found.sourceField,
      },
    };
  }
  if (sold.value) {
    const found = sold.value;
    patch.sourceMetrics = {
      soldCount: found.value,
      soldRaw: found.raw,
      soldPrecision: 'exact',
      soldCollectedAt: at,
      collectedAt: at,
      soldEvidenceUrl: found.evidenceUrl,
      soldSourceField: found.sourceField,
      soldProvider: provider,
      soldPlatform: platform,
    };
  }
  patch.publicDataEvidence = {
    checkedAt: at,
    evidenceUrl: original,
    requests: providerCalls,
    listing: stateFor(
      listing.value,
      Boolean(discoveryDecision(product, 'product', now).evidenceDate),
      listing.reason === 'conflicting_public_values'
        ? listing.reason
        : stopReason,
      original,
    ),
    sold: stateFor(
      sold.value,
      product.sourceMetrics?.soldCount !== undefined ||
        Boolean(product.sourceMetrics?.soldRaw),
      sold.reason === 'conflicting_public_values' ? sold.reason : stopReason,
      original,
    ),
    ...(errors.length ? { errors } : {}),
  };
  const labels = [listing.value && '上架日期', sold.value && '累计已售'].filter(
    Boolean,
  );
  return {
    patch,
    empty: labels.length === 0,
    providerCalls,
    message: labels.length
      ? `已取得官网公开${labels.join('、')}；保留来源字段与采集时间`
      : '官网未取得可核验的上架日期或累计已售，已有数据保留',
  };
}
