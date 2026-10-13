import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const configPath = resolve(
  root,
  process.env.HCI_COLLECTOR_SITES || 'public/data/collector-sites.json',
);
const outputPath = resolve(
  root,
  process.env.HCI_COLLECTOR_OUTPUT ||
    'public/data/public-site-observations.json',
);
const previousUrl = process.env.HCI_COLLECTOR_PREVIOUS_URL;
const capturedAt = new Date().toISOString();
const cutoff = Date.now() - 180 * 86_400_000;
const agent =
  'ZhihengPublicResearchBot/0.1 (+https://leejinping8972-svg.github.io/intelligence-system/)';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: 'text/html,application/xml,text/xml,*/*',
      'user-agent': agent,
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 403 || response.status === 429) {
    const error = new Error(`来源返回 ${response.status}，已停止自动采集`);
    error.code = response.status;
    throw error;
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return {
    text: await response.text(),
    url: response.url,
    status: response.status,
  };
}

function robotRules(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);
  let applies = false;
  const disallow = [];
  const sitemaps = [];
  for (const line of lines) {
    const [rawKey, ...rest] = line.split(':');
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') applies = value === '*';
    if (key === 'disallow' && applies && value) disallow.push(value);
    if (key === 'sitemap' && value) sitemaps.push(value);
  }
  return { disallow, sitemaps };
}

function allowedByRobots(url, rules) {
  const path = new URL(url).pathname;
  return !rules.disallow.some((rule) => rule === '/' || path.startsWith(rule));
}

function xmlEntries(text) {
  const entries = [];
  const blocks =
    text.match(/<(?:url|sitemap)>[\s\S]*?<\/(?:url|sitemap)>/gi) || [];
  for (const block of blocks) {
    const location = block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1]?.trim();
    if (!location) continue;
    entries.push({
      url: location.replaceAll('&amp;', '&'),
      lastModified: block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i)?.[1]?.trim(),
    });
  }
  return entries;
}

function removeMarkup(value = '') {
  return value
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;|&#160;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;|&#34;/gi, '"')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function meta(html, name) {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  return (
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
        'i',
      ),
    )?.[1] ||
    html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
        'i',
      ),
    )?.[1]
  );
}

function findProducts(value, found = []) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const entry of value) findProducts(entry, found);
    return found;
  }
  const type = value['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) {
    found.push(value);
  }
  for (const child of Object.values(value)) findProducts(child, found);
  return found;
}

function jsonLdProducts(html) {
  const scripts =
    html.match(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
    ) || [];
  const products = [];
  for (const script of scripts) {
    const raw = script
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();
    try {
      findProducts(JSON.parse(raw), products);
    } catch {
      // Malformed JSON-LD is ignored; visible metadata remains available.
    }
  }
  return products;
}

function firstOffer(product) {
  const offers = Array.isArray(product?.offers)
    ? product.offers[0]
    : product?.offers;
  return offers || {};
}

function normalizeProduct(product, html, pageUrl, site, lastModified) {
  const offer = firstOffer(product);
  const title =
    product?.name ||
    meta(html, 'og:title') ||
    removeMarkup(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const description = removeMarkup(
    product?.description ||
      meta(html, 'description') ||
      meta(html, 'og:description'),
  );
  const sku = product?.sku || product?.mpn || product?.gtin || '';
  const brand =
    (typeof product?.brand === 'string'
      ? product.brand
      : product?.brand?.name) || site.brand;
  const fingerprint = createHash('sha256')
    .update(`${site.id}|${title}|${sku}|${pageUrl}`.toLowerCase())
    .digest('hex');
  const contentHash = createHash('sha256')
    .update(`${title}|${description}|${offer.price}|${offer.availability}`)
    .digest('hex');
  return {
    id: fingerprint.slice(0, 20),
    siteId: site.id,
    brand,
    market: site.market,
    url: pageUrl,
    title: title || pageUrl,
    sku,
    description,
    price: offer.price ?? null,
    currency: offer.priceCurrency || null,
    availability: offer.availability || null,
    publishedAt:
      product?.datePublished || meta(html, 'article:published_time') || null,
    sourceModifiedAt:
      product?.dateModified ||
      meta(html, 'article:modified_time') ||
      lastModified ||
      null,
    contentHash,
    capturedAt,
  };
}

function likelyProductUrl(url) {
  const path = new URL(url).pathname.toLowerCase();
  return /\/(products?|shop|product-detail|p)\//.test(path);
}

async function sitemapPages(base, rules, maxPages) {
  const initial =
    rules.sitemaps.length > 0
      ? rules.sitemaps
      : [new URL('/sitemap.xml', base).toString()];
  const pending = [...initial];
  const pages = [];
  const seen = new Set();
  while (pending.length > 0 && seen.size < 20 && pages.length < maxPages * 4) {
    const sitemap = pending.shift();
    if (!sitemap || seen.has(sitemap)) continue;
    seen.add(sitemap);
    try {
      const { text } = await fetchText(sitemap);
      for (const entry of xmlEntries(text)) {
        if (entry.url.endsWith('.xml')) pending.push(entry.url);
        else if (likelyProductUrl(entry.url)) pages.push(entry);
      }
    } catch {
      // A missing child sitemap does not fail the whole site.
    }
  }
  return pages.slice(0, maxPages);
}

async function collectSite(site) {
  const base = new URL(site.url || `https://${site.domain}`);
  if (base.hostname.endsWith('.example')) {
    return {
      siteId: site.id,
      status: 'disabled',
      note: '示例域名不会发起网络请求',
    };
  }
  let rules = { disallow: [], sitemaps: [] };
  try {
    const response = await fetchText(new URL('/robots.txt', base).toString());
    rules = robotRules(response.text);
  } catch {
    // A missing robots file means no published robot rules were found.
  }
  if (!allowedByRobots(base.toString(), rules)) {
    return {
      siteId: site.id,
      status: 'restricted',
      note: 'robots.txt 禁止自动访问',
    };
  }
  try {
    const pages = await sitemapPages(base, rules, site.maxPages || 20);
    const observations = [];
    for (const page of pages) {
      if (!allowedByRobots(page.url, rules)) continue;
      try {
        const response = await fetchText(page.url);
        const products = jsonLdProducts(response.text);
        if (products.length > 0) {
          observations.push(
            ...products.map((product) =>
              normalizeProduct(
                product,
                response.text,
                response.url,
                site,
                page.lastModified,
              ),
            ),
          );
        } else {
          observations.push(
            normalizeProduct(
              {},
              response.text,
              response.url,
              site,
              page.lastModified,
            ),
          );
        }
      } catch (error) {
        if (error.code === 403 || error.code === 429) {
          return {
            siteId: site.id,
            status: 'blocked',
            note: error.message,
            observations,
          };
        }
      }
    }
    return {
      siteId: site.id,
      status: pages.length > 0 ? 'ok' : 'partial',
      note:
        pages.length > 0
          ? `检查 ${pages.length} 个商品页`
          : '未在站点地图发现商品页',
      observations,
    };
  } catch (error) {
    return { siteId: site.id, status: 'failed', note: error.message };
  }
}

async function previousData() {
  const local = await readJson(outputPath, null);
  if (local?.observations?.length) return local;
  if (previousUrl) {
    try {
      const response = await fetch(previousUrl, {
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return await response.json();
    } catch {
      // The first deployment has no previous public snapshot.
    }
  }
  return { observations: [], events: [] };
}

const config = await readJson(configPath, { sites: [] });
const previous = await previousData();
const enabledSites = (config.sites || []).filter((site) => site.enabled);
const results = [];
for (const site of enabledSites) results.push(await collectSite(site));

const current = results.flatMap((result) => result.observations || []);
const previousById = new Map(
  (previous.observations || []).map((observation) => [
    observation.id,
    observation,
  ]),
);
const observations = current.map((observation) => {
  const old = previousById.get(observation.id);
  return {
    ...old,
    ...observation,
    firstSeenAt: old?.firstSeenAt || capturedAt,
    lastSeenAt: capturedAt,
    changeType: old
      ? old.contentHash !== observation.contentHash
        ? 'changed'
        : 'unchanged'
      : 'newly-discovered',
  };
});
const events = [
  ...(previous.events || []).filter(
    (event) => new Date(event.observedAt).getTime() >= cutoff,
  ),
  ...observations
    .filter((observation) => observation.changeType !== 'unchanged')
    .map((observation) => ({
      id: `${observation.id}-${capturedAt}`,
      observationId: observation.id,
      siteId: observation.siteId,
      type: observation.changeType,
      observedAt: capturedAt,
      title: observation.title,
      url: observation.url,
    })),
];
const output = {
  version: 1,
  generatedAt: capturedAt,
  policy: {
    retentionDays: 180,
    userAgent: agent,
    stopStatuses: [403, 429],
  },
  configuredSites: enabledSites.length,
  sourceRuns: results.map(({ observations: ignored, ...result }) => result),
  observations,
  events,
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(
  `Public collector finished: ${enabledSites.length} sites, ${observations.length} observations, ${events.length} retained events.`,
);
