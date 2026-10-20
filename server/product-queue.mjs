import { createHash } from 'node:crypto';
import { pool, putDocument } from './database.mjs';
import { saveCheckpoint } from './store.mjs';
import { fetchPublicPage } from './safe-web.mjs';
import {
  fetchFallbackPage,
  renderedPageNeeded,
} from './site-page-fallbacks.mjs';
import {
  extractJsonLdProducts,
  productFromJsonLd,
  productPageUrls,
} from './collector.js';
import { mergeBusiness } from './market-jobs.mjs';
import {
  catalogLinks,
  normalizeProduct,
  siteBase,
  siteHostAllowed,
} from './product-jobs.mjs';

const done = (w) =>
  ['completed', 'empty', 'partial', 'blocked', 'failed'].includes(w.status);
const at = (now) => new Date(now).toISOString();
export const PRODUCT_POLICY_VERSION = 3;
export function productPacing(random = Math.random) {
  return 20000 + Math.floor(Math.max(0, Math.min(1, random())) * 10000);
}
const jsonCatalog = (url) => /\/products\.json$/i.test(new URL(url).pathname);
const hostKey = (site) =>
  'product-host:' +
  createHash('sha256')
    .update(new URL(siteBase(site)).hostname.replace(/^www\./, ''))
    .digest('hex');
export function canonicalCatalogUrl(value, base) {
  try {
    const u = new URL(value, base);
    let path = u.pathname;
    for (let i = 0; i < 2; i++) path = decodeURIComponent(path);
    if (
      /[{}<>\[\]`$\\]/.test(path) ||
      path
        .split('/')
        .some(
          (part) =>
            /^(?:(?:item|product|variant|card|result|entry)\.(?:url|handle|link|id)|undefined|null|:?(?:handle|slug|product_url))$/i.test(
              part,
            ) || /object\s+object/i.test(part),
        )
    )
      return null;
    if (
      !['http:', 'https:'].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hostname.replace(/^www\./, '') !==
        new URL(base).hostname.replace(/^www\./, '')
    )
      return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()])
      if (
        !['page', 'paged', 'limit'].includes(key) &&
        !(/sitemap.*\.xml/i.test(u.pathname) && ['from', 'to'].includes(key))
      )
        u.searchParams.delete(key);
    u.searchParams.sort();
    return u.toString();
  } catch {
    return null;
  }
}
export function fallbackProductUrls(site) {
  const base = siteBase(site);
  return [
    ...new Set(
      [
        `${base}/sitemap.xml`,
        site.evidenceUrl,
        ...(site.platform === 'Shopify' ? [`${base}/collections/all`] : []),
        base,
      ]
        .filter(Boolean)
        .map((url) => canonicalCatalogUrl(url, base))
        .filter(Boolean),
    ),
  ];
}
function cleanProductQueue(work, site, addFallbacks = false) {
  const base = siteBase(site);
  work.visited = [
    ...new Set(
      (work.visited || [])
        .map((u) => canonicalCatalogUrl(u, base))
        .filter(Boolean),
    ),
  ];
  work.rejectedUrls ||= [];
  const rejected = new Set(work.rejectedUrls.map((v) => v.url));
  work.urls = [
    ...new Set(
      [...(addFallbacks ? fallbackProductUrls(site) : []), ...(work.urls || [])]
        .map((u) => canonicalCatalogUrl(u, base))
        .filter(Boolean),
    ),
  ].filter(
    (u) =>
      !work.visited.includes(u) &&
      (!rejected.has(u) || work.methods?.[u] === 'hosted') &&
      !(
        work.catalogUnavailable &&
        jsonCatalog(u) &&
        work.methods?.[u] !== 'hosted'
      ),
  );
}
export function initialProductWork(site) {
  const base = siteBase(site);
  return {
    status: 'pending',
    requests: 0,
    productIds: [],
    visited: [],
    attempts: {},
    failures: 0,
    nextRunAt: 0,
    noProductPages: 0,
    message: '待采集',
    urls: [
      ...new Set(
        [
          ...(site.platform === 'Shopify'
            ? [`${base}/products.json?limit=50&page=1`]
            : []),
          ...fallbackProductUrls(site),
        ]
          .map((u) => canonicalCatalogUrl(u, base))
          .filter(Boolean),
      ),
    ],
  };
}
export function initializeProducts(job, now = Date.now()) {
  const cp = {
    logs: [],
    products: 0,
    requests: 0,
    index: 0,
    failures: 0,
    ...structuredClone(job.checkpoint),
  };
  if (cp.productQueueVersion === 2) {
    for (const [i, w] of cp.siteWork.entries())
      cleanProductQueue(w, job.input.records[i]);
    cp.productPolicyVersion = PRODUCT_POLICY_VERSION;
    return cp;
  }
  cp.productQueueVersion = 2;
  cp.productPolicyVersion = PRODUCT_POLICY_VERSION;
  cp.startedAt ||= at(now);
  cp.deadlineAt = now + 86400000;
  cp.cursor = cp.index || 0;
  cp.requestLog = [];
  cp.siteWork = job.input.records.map((s, i) => {
    const w = initialProductWork(s);
    if (i < (cp.index || 0))
      Object.assign(w, {
        status: 'partial',
        message: '历史任务已执行，原结果保留；本轮继续处理剩余站点',
        urls: [],
      });
    else if (i === cp.index && cp.urls) {
      w.urls = cp.urls
        .map((u) => canonicalCatalogUrl(u, siteBase(s)))
        .filter(Boolean);
      w.visited = cp.visited || [];
      w.productIds = cp.productIds || [];
      w.requests = cp.requests || 0;
    }
    return w;
  });
  return cp;
}
// Explicit, bounded recovery: retain all counters, products and audit history.
// A deployment never silently reopens terminal tasks.
export function resumeProductFallbacks(job, now = Date.now()) {
  if (
    job.input.kind !== 'products' ||
    job.cancelled ||
    job.status !== 'partial'
  )
    return null;
  const cp = initializeProducts(job, now);
  const perSite =
    job.input.maxRequestsPerSite ||
    Math.ceil(job.input.maxRequests / job.input.records.length);
  if (cp.requests >= job.input.maxRequests || now >= cp.deadlineAt) return null;
  let resumed = 0;
  for (const [i, w] of cp.siteWork.entries()) {
    if (
      w.status !== 'blocked' ||
      !/429/.test(w.message) ||
      w.requests >= perSite ||
      w.fallbackRecoveryVersion === PRODUCT_POLICY_VERSION
    )
      continue;
    const rejected = job.checkpoint.siteWork?.[i]?.urls?.[0];
    if (
      rejected &&
      w.attempts?.[rejected] &&
      canonicalCatalogUrl(rejected, siteBase(job.input.records[i]))
    ) {
      w.rejectedUrls.push({ url: rejected, status: 429, at: at(now) });
      if (jsonCatalog(rejected)) w.catalogUnavailable = true;
    }
    cleanProductQueue(w, job.input.records[i], true);
    if (!w.urls.length) continue;
    Object.assign(w, {
      status: 'retry_wait',
      nextRunAt: now + 1800000,
      consecutive429: 0,
      lastHttpStatus: 429,
      errorKind: 'rate_limit',
      fallbackRecoveryVersion: PRODUCT_POLICY_VERSION,
      message: '保留历史结果和请求计数；冷却30分钟后尝试尚未访问的公开入口',
    });
    resumed++;
  }
  if (!resumed) return null;
  cp.finishedAt = undefined;
  cp.nextRunAt = Math.min(
    ...cp.siteWork.filter((w) => !done(w)).map((w) => w.nextRunAt || now),
  );
  cp.index = cp.siteWork.filter(done).length;
  cp.failures = cp.siteWork.filter((w) =>
    ['partial', 'blocked', 'failed'].includes(w.status),
  ).length;
  cp.logs.push(
    `已恢复${resumed}家站点的公开入口补齐；不重置请求预算，不重复被拒地址`,
  );
  return cp;
}
export function productProgress(cp, input) {
  const works = cp.siteWork || [];
  return {
    done: works.filter(done).length,
    total: input.records.length,
    products: cp.products || 0,
    requests: cp.requests || 0,
    requestLimit: input.maxRequests,
    previousRequests: cp.previousRequests || 0,
    browserPages: cp.browserPages || 0,
    browserPageLimit: input.maxBrowserPages || 0,
    paidRequests: cp.paidRequests || 0,
    paidRequestLimit: input.maxPaidRequests || 0,
    waiting: works.filter((w) => w.status === 'retry_wait').length,
    nextRunAt: cp.nextRunAt ? at(cp.nextRunAt) : '',
    rows: input.records.map((s, i) => {
      const w = works[i] || {};
      return {
        id: s.id,
        brand: s.brand,
        domain: new URL(siteBase(s)).hostname,
        status: w.status || 'pending',
        lastHttpStatus: w.lastHttpStatus,
        errorKind: w.errorKind,
        requests: w.requests || 0,
        products: w.productIds?.length || 0,
        nextRunAt: w.nextRunAt ? at(w.nextRunAt) : '',
        message: w.message || '待执行',
      };
    }),
    requestLog: cp.requestLog || [],
  };
}
export function shopifyCatalogProducts(data, base, site) {
  if (!Array.isArray(data.products)) throw new Error('商品目录格式不正确');
  return data.products
    .filter(
      (item) =>
        item.handle &&
        item.title &&
        canonicalCatalogUrl(
          `${base}/products/${encodeURIComponent(item.handle)}`,
          base,
        ),
    )
    .map((item) => {
      const variant =
        item.variants?.find((v) => v.available) || item.variants?.[0] || {};
      const url = `${base}/products/${encodeURIComponent(item.handle)}`;
      const size = [
        ...(item.options || [])
          .filter((o) => /size|count|weight|servings/i.test(o.name))
          .flatMap((o) => o.values || []),
      ].join(' / ');
      return productFromJsonLd(
        {
          '@type': 'Product',
          name: item.title,
          brand: item.vendor || site.brand,
          description: item.body_html || '',
          size,
          image: item.images?.[0]?.src || item.image?.src,
          url,
          sku: variant.sku,
          offers: {
            price: variant.price,
            priceCurrency: data.currency || site.currency,
          },
        },
        url,
        site.market,
        site.brand,
        item.body_html || '',
      );
    });
}
export function productKeywordIds(site, records) {
  const term = (v) =>
    String(v || '')
      .normalize('NFKC')
      .trim()
      .replaceAll(/\s+/g, ' ')
      .toLowerCase();
  const terms = new Set(
    [site.keyword, ...(site.sourceEvidence || []).map((e) => e.keyword)]
      .filter(Boolean)
      .map(term),
  );
  return [
    ...new Set([
      ...(site.keywordIds || []),
      ...records
        .filter(
          (k) =>
            k.market === site.market &&
            (k.siteIds?.includes(site.id) || terms.has(term(k.term))),
        )
        .map((k) => k.id),
    ]),
  ];
}
export function productFromMetadata(html, pageUrl, site) {
  const decode = (v) =>
    String(v || '')
      .replaceAll(/<[^>]*>/g, ' ')
      .replaceAll(/&amp;/gi, '&')
      .replaceAll(/&quot;/gi, '"')
      .replaceAll(/&#39;|&apos;/gi, "'")
      .replaceAll(/&nbsp;/gi, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    for (const m of tag.matchAll(
      /\b(property|name|content)\s*=\s*(["'])([\s\S]*?)\2/gi,
    ))
      attrs[m[1].toLowerCase()] = m[3];
    if (attrs.property || attrs.name)
      meta[(attrs.property || attrs.name).toLowerCase()] = decode(
        attrs.content,
      );
  }
  const u = new URL(pageUrl),
    title = meta['og:title'],
    h1 = decode(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  // Product-directory URL + matching page title + canonical evidence + image.
  // Generic blog/category pages and navigation headings are not product evidence.
  if (
    !/\/(?:products?|san-pham)\/.+/.test(u.pathname) ||
    !['product', 'article'].includes(meta['og:type']) ||
    !title ||
    title.toLowerCase() !== h1.toLowerCase() ||
    !meta['og:image'] ||
    canonicalCatalogUrl(meta['og:url'], u.origin) !==
      canonicalCatalogUrl(pageUrl, u.origin)
  )
    return null;
  const p = productFromJsonLd(
    {
      name: title,
      url: pageUrl,
      image: meta['og:image'],
      brand: site.brand,
      description: meta['og:description'] || meta.description || '',
    },
    pageUrl,
    site.market,
    site.brand,
  );
  p.extractionMethod =
    '官网产品目录：标题、主标题、地址和图片交叉验证；配方未推断';
  return p;
}
function discoveredUrls(html, url, sitemap) {
  return [
    ...productPageUrls(html, url, 1000),
    ...catalogLinks(html, url, sitemap),
  ].filter(
    (u) =>
      !sitemap ||
      !/sitemap/i.test(new URL(u).pathname) ||
      /product|san-pham|sitemap\.xml/i.test(new URL(u).pathname),
  );
}
async function persistProducts(list, site, work, cp, io) {
  for (const p of list) {
    if (work.productIds.length >= io.maxProducts) break;
    if (!p.title || !canonicalCatalogUrl(p.url, siteBase(site))) continue;
    const product = normalizeProduct(p, site),
      old = await io.readProduct(product.id),
      preserved = {};
    for (const [field, available] of [
      ['ingredient', p.ingredients],
      ['dose', p.servingSize],
      ['size', p.size],
      ['form', p.form],
      ['claim', p.description],
      ['benefitEvidence', p.description],
      ['imageUrl', p.image],
      ['price', Number.isFinite(p.price)],
    ])
      if (!available && old?.[field]) preserved[field] = old[field];
    for (const field of ['benefits', 'ingredientInsights'])
      if (!p[field]?.length && old?.[field]?.length)
        preserved[field] = old[field];
    await io.mergeBusiness(`products:${product.id}`, {
      ...product,
      ...preserved,
      reviewed: Boolean(
        old?.reviewed &&
        (!p.ingredients || p.ingredients === old.ingredient) &&
        (!p.servingSize || p.servingSize === old.dose),
      ),
      favorite: old?.favorite || false,
      firstSeenAt: old?.firstSeenAt || product.firstSeenAt,
    });
    if (!work.productIds.includes(product.id)) {
      work.productIds.push(product.id);
      cp.products++;
    }
  }
}
export async function runProductsJob(job, overrides = {}) {
  const read = async (key) =>
    (
      await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
        `business:${key}`,
      ])
    ).rows[0]?.value;
  const io = {
    fetchPage: fetchPublicPage,
    fetchFallback: fetchFallbackPage,
    saveCheckpoint,
    mergeBusiness,
    now: () => Date.now(),
    random: Math.random,
    patchSite: async (id, patch) => {
      if (await read(`sites:${id}`)) await mergeBusiness(`sites:${id}`, patch);
    },
    readProduct: (id) => read(`products:${id}`),
    getHostGate: async (site) =>
      (
        await pool.query('SELECT value FROM provider_configs WHERE name=$1', [
          hostKey(site),
        ])
      ).rows[0]?.value || {},
    setHostGate: (site, value) =>
      putDocument('provider_configs', hostKey(site), value),
    linkKeywords: async (site, ids, collection) => {
      const { readKeyword, patchCollection } =
        await import('./enrichment-jobs.mjs');
      const rows = (await pool.query('SELECT data FROM research_keywords'))
        .rows;
      for (const id of productKeywordIds(
        site,
        rows.map((r) => r.data),
      )) {
        const k = await readKeyword(id);
        if (k)
          await patchCollection(
            id,
            'productCollection',
            { ...collection, sourceSiteId: site.id },
            { productIds: [...new Set([...(k.productIds || []), ...ids])] },
          );
      }
    },
    cancelled: async () =>
      Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      ),
    ...overrides,
  };
  io.maxProducts = job.input.maxProducts;
  const cp = initializeProducts(job, io.now()),
    v = job.input,
    perSite =
      v.maxRequestsPerSite ||
      Math.max(1, Math.ceil(v.maxRequests / v.records.length));
  const browserLimit = v.collectionPolicyVersion ? v.maxBrowserPages || 0 : 0;
  const paidLimit = v.collectionPolicyVersion ? v.maxPaidRequests || 0 : 0;
  function fallback(
    work,
    url,
    method,
    until = io.now() + productPacing(io.random),
  ) {
    if (method === 'hosted' && (cp.paidRequests || 0) >= paidLimit)
      return false;
    if (method === 'browser' && (cp.browserPages || 0) >= browserLimit)
      return false;
    if (work.methodAttempts?.[url]?.includes(method)) return false;
    (work.methods ||= {})[url] = method;
    work.urls = [url, ...work.urls.filter((u) => u !== url)];
    work.visited = work.visited.filter((u) => u !== url);
    work.status = 'retry_wait';
    work.nextRunAt = until;
    work.message =
      method === 'browser'
        ? '动态页面待浏览器渲染；按站点间隔执行'
        : '直连未成功，冷却后按本任务预算尝试托管备用';
    return true;
  }
  async function patch(i) {
    const w = cp.siteWork[i],
      collection = {
        jobId: job.id,
        status: w.status === 'blocked' ? 'partial' : w.status,
        count: w.productIds.length,
        target: v.maxProducts,
        requests: w.requests,
        nextRunAt: w.nextRunAt ? at(w.nextRunAt) : '',
        message: w.message,
        ...(done(w) ? { finishedAt: at(io.now()) } : {}),
      };
    await io.patchSite(v.records[i].id, { productCollection: collection });
    await io.linkKeywords(v.records[i], w.productIds, collection);
  }
  async function save() {
    cp.index = cp.siteWork.filter(done).length;
    cp.failures = cp.siteWork.filter((w) =>
      ['partial', 'blocked', 'failed'].includes(w.status),
    ).length;
    const active = cp.siteWork.filter((w) => !done(w));
    cp.nextRunAt = active.length
      ? Math.min(cp.deadlineAt, ...active.map((w) => w.nextRunAt || 0))
      : 0;
    const status = active.length
      ? 'running'
      : cp.failures || !cp.products
        ? 'partial'
        : 'completed';
    if (!active.length) {
      cp.finishedAt = at(io.now());
      cp.currentTerm = '';
    }
    await io.saveCheckpoint(job, cp, status);
  }
  try {
    if (await io.cancelled()) {
      cp.logs.push('任务已取消，已保存商品保留');
      return io.saveCheckpoint(job, cp, 'cancelled');
    }
    if (cp.inFlight) {
      const w = cp.siteWork[cp.inFlight.index];
      cp.requestLog.push({
        ...cp.inFlight,
        status: 'unknown',
        message: '服务中断，免费网页请求结果未知；稍后再试',
      });
      w.status = cp.inFlight.method === 'hosted' ? 'partial' : 'retry_wait';
      w.nextRunAt = cp.inFlight.method === 'hosted' ? 0 : io.now() + 60000;
      w.message =
        cp.inFlight.method === 'hosted'
          ? '托管请求结果未知，已保留次数，不自动重放；已有商品保留'
          : '免费网页请求结果未知，等待恢复';
      cp.inFlight = null;
    }
    for (const [i, w] of cp.siteWork.entries())
      if (
        !done(w) &&
        (cp.requests >= v.maxRequests ||
          w.requests >= perSite ||
          io.now() >= cp.deadlineAt)
      ) {
        w.status = 'partial';
        w.nextRunAt = 0;
        w.message =
          io.now() >= cp.deadlineAt
            ? '已达到24小时补齐期限'
            : cp.requests >= v.maxRequests
              ? '整批网页请求上限已用完，保留已有结果'
              : '达到单站请求上限，已给其他站点保留执行机会';
        await patch(i);
      }
    let index = -1;
    for (let n = 0; n < cp.siteWork.length; n++) {
      const i = ((cp.cursor || 0) + n) % cp.siteWork.length,
        w = cp.siteWork[i];
      if (done(w) || w.nextRunAt > io.now()) continue;
      const gate = await io.getHostGate(v.records[i]);
      if (gate.until > io.now()) {
        w.status = 'retry_wait';
        w.nextRunAt = gate.until;
        w.message = '此站点限流冷却，其他站点继续';
        await patch(i);
        continue;
      }
      index = i;
      break;
    }
    if (index < 0) return save();
    const site = v.records[index],
      w = cp.siteWork[index],
      base = siteBase(site);
    cp.cursor = (index + 1) % cp.siteWork.length;
    cp.currentTerm = site.brand;
    w.status = 'running';
    cleanProductQueue(w, site);
    w.urls = w.urls.slice(0, 2000);
    if (!w.urls.length) {
      w.status = w.failures
        ? 'partial'
        : w.productIds.length
          ? 'completed'
          : 'empty';
      w.message = '公开目录遍历结束';
      await patch(index);
      return save();
    }
    const url = w.urls[0];
    const method = w.methods?.[url] || 'direct';
    if (
      (method === 'browser' && (cp.browserPages || 0) >= browserLimit) ||
      (method === 'hosted' && (cp.paidRequests || 0) >= paidLimit)
    ) {
      w.status = 'partial';
      w.nextRunAt = 0;
      w.message = '备用页面预算已用完，已有商品保留';
      await patch(index);
      return save();
    }
    w.requests++;
    cp.requests++;
    w.attempts[url] = (w.attempts[url] || 0) + 1;
    if (method === 'browser') cp.browserPages = (cp.browserPages || 0) + 1;
    if (method === 'hosted') cp.paidRequests = (cp.paidRequests || 0) + 1;
    ((w.methodAttempts ||= {})[url] ||= []).push(method);
    cp.inFlight = {
      index,
      url,
      at: at(io.now()),
      attempt: w.attempts[url],
      method,
    };
    await io.saveCheckpoint(job, cp);
    let page, failure;
    try {
      page =
        method !== 'direct'
          ? await io.fetchFallback(url, site, method)
          : await io.fetchPage(
              url,
              0,
              ['text/html', 'application/xml', 'text/xml', 'application/json'],
              { allowedDomain: site.domain },
            );
    } catch (e) {
      failure = e;
    }
    let entry = { ...cp.inFlight, status: 'success', products: 0 };
    if (failure) {
      const status =
        Number(failure.status) ||
        Number(failure.message.match(/HTTP\s*(\d{3})/)?.[1]) ||
        0;
      const retry =
        status >= 500 ||
        (!status &&
          /timeout|超时|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(
            failure.message,
          ));
      const header = Number(failure.retryAfterSeconds),
        delay = Math.max(
          [120000, 300000, 900000][Math.min(w.attempts[url] - 1, 2)],
          Number.isFinite(header) ? Math.max(0, header) * 1000 : 0,
        );
      w.lastHttpStatus = status;
      w.errorKind = status === 429 ? 'rate_limit' : status ? 'http' : 'network';
      if (status === 429) {
        w.failures++;
        w.consecutive429 = (w.consecutive429 || 0) + 1;
        w.rejectedUrls.push({ url, status, at: at(io.now()) });
        if (jsonCatalog(url)) w.catalogUnavailable = true;
        cleanProductQueue(w, site, true);
        const cooldown = Math.max(
          [600000, 1800000, 3600000][Math.min(w.consecutive429 - 1, 2)],
          Number.isFinite(header) ? Math.max(0, header) * 1000 : 0,
        );
        const until =
          io.now() + cooldown + Math.floor(cooldown * 0.1 * io.random());
        await io.setHostGate(site, { until, reason: 'rate_limit' });
        if (method === 'hosted') {
          w.status = 'partial';
          w.nextRunAt = 0;
          w.message = '托管备用仍受限，停止本站，不自动重复收费；已有商品保留';
        } else if (w.consecutive429 >= 3 || !w.urls.length) {
          w.status = 'blocked';
          w.nextRunAt = 0;
          w.message =
            '官网HTTP 429：多个公开入口被拒或已无可用入口，本站停止；已有商品保留';
          fallback(w, url, 'hosted', until);
        } else {
          w.status = 'retry_wait';
          w.nextRunAt = until;
          w.message =
            '官网HTTP 429：已跳过被拒地址，冷却后尝试其他公开入口；不重复请求同一被拒地址';
        }
      } else if (method === 'hosted') {
        w.status = 'partial';
        w.nextRunAt = 0;
        w.failures++;
        w.message = `${failure.message}；本站托管尝试停止，不自动重复收费`;
      } else if (retry && w.attempts[url] <= 3) {
        w.status = 'retry_wait';
        w.nextRunAt = io.now() + delay + Math.floor(delay * 0.1 * io.random());
        w.message = `${status ? `官网HTTP ${status}` : '网络故障'}，本站暂停，等待第${w.attempts[url]}/3次自动重试`;
        await io.setHostGate(site, { until: w.nextRunAt, reason: w.errorKind });
      } else if (status === 403) {
        w.status = 'blocked';
        w.nextRunAt = 0;
        w.failures++;
        w.message = `官网HTTP ${status}，需人工处理；其他站点继续`;
        const until = io.now() + 1800000;
        await io.setHostGate(site, { until, reason: 'forbidden' });
        fallback(w, url, 'hosted', until);
      } else {
        w.failures++;
        w.visited.push(url);
        w.urls.shift();
        w.status = 'pending';
        w.nextRunAt = io.now() + productPacing(io.random);
        w.message = failure.message;
        if (method === 'browser') fallback(w, url, 'hosted');
        if (jsonCatalog(url)) {
          w.catalogUnavailable = true;
          cleanProductQueue(w, site, true);
          w.message += '；公开目录不可用，改用站点地图和商品入口';
        }
        await io.setHostGate(site, { until: w.nextRunAt, reason: 'pacing' });
      }
      entry = {
        ...entry,
        status: 'error',
        httpStatus: status,
        message: failure.message,
        nextRunAt: w.nextRunAt,
      };
    } else {
      w.consecutive429 = 0;
      w.lastHttpStatus = 200;
      w.errorKind = '';
      if (!siteHostAllowed(new URL(page.url).hostname, site.domain))
        throw new Error('页面跳转到其他域名，未采集');
      let list = [],
        links = [];
      if (/\/products\.json$/.test(new URL(url).pathname)) {
        let data;
        try {
          data = JSON.parse(page.html);
          list = shopifyCatalogProducts(data, base, site);
        } catch {
          w.failures++;
          w.catalogUnavailable = true;
          entry.message = '公开JSON目录不可用，继续验证商品页与站点地图';
        }
        // Follow detail pages for evidence, but save catalog images/specifications now.
        links = list.map((p) => p.url);
        if (data?.products?.length === 50) {
          const next = new URL(url);
          next.searchParams.set(
            'page',
            String(Number(next.searchParams.get('page') || 1) + 1),
          );
          links.unshift(next.toString());
        }
      } else if (/<urlset|<sitemapindex/i.test(page.html))
        links = discoveredUrls(page.html, page.url, true);
      else {
        const raws = extractJsonLdProducts(page.html);
        list = raws.map((p) =>
          productFromJsonLd(p, page.url, site.market, site.brand, page.html),
        );
        if (!list.length) {
          const p = productFromMetadata(page.html, page.url, site);
          if (p) list = [p];
        }
        links = discoveredUrls(page.html, page.url, false);
        if (/\/products?\//.test(new URL(url).pathname) && !list.length)
          w.noProductPages++;
      }
      const before = w.productIds.length;
      if (method !== 'direct')
        for (const p of list)
          p.extractionMethod = `${p.extractionMethod || '官网商品字段提取'}；采集方式：${method === 'browser' ? '浏览器渲染' : 'Firecrawl托管备用'}`;
      await persistProducts(list, site, w, cp, io);
      entry.products = w.productIds.length - before;
      w.visited.push(url);
      w.urls.shift();
      w.urls = [
        ...new Set(
          [...links, ...w.urls]
            .map((u) => canonicalCatalogUrl(u, base))
            .filter((u) => u && !w.visited.includes(u)),
        ),
      ].slice(0, 2000);
      cleanProductQueue(w, site, w.catalogUnavailable);
      w.status = 'pending';
      w.nextRunAt = io.now() + productPacing(io.random);
      w.message = `已保存${w.productIds.length}件商品；本页新增${entry.products}件`;
      if (method !== 'direct')
        w.message = `${method === 'browser' ? '浏览器渲染' : '托管备用'}：${w.message}`;
      if (page.resourceRequests) entry.resourceRequests = page.resourceRequests;
      if (method === 'direct' && renderedPageNeeded(page, url, list, links))
        fallback(w, url, 'browser');
      else if (method === 'browser' && !list.length && !links.length)
        fallback(w, url, 'hosted');
      if (
        w.noProductPages >= 4 &&
        !w.productIds.length &&
        w.status !== 'retry_wait'
      ) {
        w.status = 'partial';
        w.nextRunAt = 0;
        w.message =
          '连续4个商品页无可验证的商品结构化数据，停止空抓；可能需要动态页面解析';
      }
      await io.setHostGate(site, { until: w.nextRunAt, reason: 'pacing' });
    }
    cp.inFlight = null;
    cp.requestLog.push(entry);
    cp.requestLog = cp.requestLog.slice(-200);
    cp.logs.push(
      `${site.brand}：${w.message}（本站${w.requests}/${perSite}次，整批${cp.requests}/${v.maxRequests}次）`,
    );
    cp.logs = cp.logs.slice(-200);
    if (!done(w) && w.status !== 'retry_wait') {
      if (w.productIds.length >= v.maxProducts) {
        w.status = 'completed';
        w.nextRunAt = 0;
        w.message = '已达到本次商品目标上限，未声称全站无遗漏';
      } else if (!w.urls.length) {
        w.status = w.failures
          ? 'partial'
          : w.productIds.length
            ? 'completed'
            : 'empty';
        w.nextRunAt = 0;
        w.message = '公开目录遍历结束，缺失字段保留未知';
      } else if (cp.requests >= v.maxRequests || w.requests >= perSite) {
        w.status = 'partial';
        w.nextRunAt = 0;
        w.message = '达到网页请求上限，已保存结果保留';
      }
    }
    await patch(index);
    // Close other unfinished sites explicitly when the batch budget is exhausted.
    if (cp.requests >= v.maxRequests)
      for (const [i, other] of cp.siteWork.entries())
        if (!done(other)) {
          other.status = 'partial';
          other.nextRunAt = 0;
          other.message = '整批网页请求上限已用完，保留已有结果';
          await patch(i);
        }
    if (await io.cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
    await save();
  } catch (error) {
    // Storage/parse errors release this dispatch; never spin through the same page.
    const index = cp.inFlight?.index;
    if (index !== undefined) {
      const w = cp.siteWork[index];
      w.status = 'partial';
      w.nextRunAt = 0;
      w.message = error.message;
      cp.requestLog.push({
        ...cp.inFlight,
        status: 'error',
        message: error.message,
      });
      cp.inFlight = null;
      await patch(index);
    }
    cp.logs.push(error.message);
    await save();
  }
}
