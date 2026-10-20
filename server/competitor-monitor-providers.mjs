import { fetchPublicPage } from './safe-web.mjs';
import { collectAds } from './ads-provider.mjs';
import {
  extractJsonLdProducts,
  productFromJsonLd,
  productPageUrls,
} from './collector.js';
import { catalogLinks, normalizeProduct, siteBase } from './product-jobs.mjs';
import {
  canonicalCatalogUrl,
  fallbackProductUrls,
  productFromMetadata,
  shopifyCatalogProducts,
} from './product-queue.mjs';
import {
  client,
  mcpPayload,
  reportRows,
  rowMetrics,
  rowTerm,
} from './semrush-reports.mjs';
import { safeSemrushError } from './semrush-mcp.mjs';
import { setTimeout as pause } from 'node:timers/promises';
import { publicRetryDelay } from './monitor-public-recovery.mjs';
import { dayKey } from './competitor-monitor-domain.mjs';
import { fetchFallbackPage, renderedPageNeeded } from './site-page-fallbacks.mjs';

export async function scanSite(
  site,
  request,
  limit,
  fetchPage = fetchPublicPage,
  progress = null,
  wait = () => pause(20_000),
  options = {},
) {
  const now = options.now || Date.now;
  const day = dayKey(now());
  const fetchBrowser = options.fetchBrowser || ((url, source) => fetchFallbackPage(url, source, 'browser'));
  const base = siteBase(site);
  const queue = progress?.queue || [
    ...(site.platform === 'Shopify'
      ? [`${base}/products.json?limit=50&page=1`]
      : []),
    ...fallbackProductUrls(site),
  ];
  const visited = new Set(progress?.visited || []),
    attempted = new Set(),
    products = new Map(),
    errors = [];
  let truncated = progress?.truncated === true;
  const methods = { ...progress?.methods };
  const failures = progress?.day === day ? { ...progress?.failures } : {};
  let browserPages = progress?.day === day ? progress.browserPages || 0 : 0;
  let nextRunAt = progress?.nextRunAt || 0, lastHttpStatus = progress?.lastHttpStatus || 0, manualRequired = false;
  if (nextRunAt > now()) return {
    items: [], complete: false, requests: 0, errors: ['官网仍在冷却，尚未发起新请求'],
    progress: { ...progress, queue, visited: [...visited], nextRunAt, day }, retryAt: nextRunAt,
  };
  nextRunAt = 0;
  while (attempted.size < limit) {
    const index = queue.findIndex((url) => !attempted.has(url));
    if (index === -1) break;
    const url = canonicalCatalogUrl(queue.splice(index, 1)[0], base);
    if (!url || visited.has(url)) continue;
    if (attempted.size > 0) await wait();
    attempted.add(url);
    try {
      const mode = methods[url] || 'direct';
      if (mode === 'browser' && options.browserEnabled === false) {
        manualRequired = true; queue.push(url); errors.push('动态页面需要浏览器，当前未启用'); break;
      }
      if (mode === 'browser' && browserPages >= 2) {
        manualRequired = true; queue.push(url); errors.push('今日浏览器备用已达2页上限'); break;
      }
      if (mode === 'browser') browserPages++;
      const page = await request(mode === 'browser' ? `browser:${url}` : url, () => mode === 'browser' ? fetchBrowser(url, site) :
        fetchPage(url, 0, [
          'text/html',
          'application/xml',
          'text/xml',
          'application/json',
        ]),
      );
      if (!canonicalCatalogUrl(page.url, base))
        throw new Error('页面跳转至其他站点，未作为本站商品证据');
      if (/<title[^>]*>\s*(?:Just a moment|Access denied|Security check|Verify you are human)/i.test(page.html))
        throw Object.assign(new Error('官网返回访问验证页，未当作商品数据'), { status: 403 });
      let list;
      if (/\/products\.json/.test(url)) {
        const data = JSON.parse(page.html);
        list = shopifyCatalogProducts(data, base, site);
        if (data.products.length === 50) {
          const next = new URL(url);
          next.searchParams.set(
            'page',
            Number(next.searchParams.get('page') || 1) + 1,
          );
          queue.unshift(next.toString());
        }
      } else {
        list = extractJsonLdProducts(page.html).map((p) =>
          productFromJsonLd(p, page.url, site.market, site.brand),
        );
        const metadata =
          list.length === 0 && productFromMetadata(page.html, page.url, site);
        if (metadata) list.push(metadata);
        for (const link of [
          ...productPageUrls(page.html, page.url, 1000),
          ...catalogLinks(page.html, page.url, /sitemap.*\.xml/.test(url)),
        ]) {
          const next = canonicalCatalogUrl(link, base);
          if (next && !visited.has(next) && !queue.includes(next)) {
            if (queue.length < 5000 && visited.size < 10_000) queue.push(next);
            else truncated = true;
          }
        }
        if (list.length === 0 && renderedPageNeeded(page, url, list, catalogLinks(page.html, page.url))) {
          if (mode === 'direct') {
            if (options.browserEnabled === false) { manualRequired = true; queue.push(url); errors.push('动态页面需要浏览器，当前未启用'); break; }
            methods[url] = 'browser'; queue.push(url); nextRunAt = now() + 30_000;
            errors.push('动态页面尚无可验证商品，等待浏览器备用');
            break;
          }
          manualRequired = true; queue.push(url);
          errors.push('浏览器仍未读取到可验证的商品目录，需检查公开来源');
          break;
        }
      }
      for (const p of list) {
        try {
          if (!p.title || !p.url) continue;
          const product = normalizeProduct(p, site);
          products.set(product.id, product);
        } catch {
          /* Cross-domain structured data is excluded. */
        }
      }
      visited.add(url);
    } catch (error) {
      if (
        [404, 410].includes(error.status) &&
        /sitemap|\/products\.json/.test(url)
      ) {
        visited.add(url);
        continue;
      }
      errors.push(error.message);
      queue.push(url);
      lastHttpStatus = error.status || Number(error.message.match(/HTTP\s+(\d{3})/)?.[1]) || 0;
      failures[url] = (failures[url] || 0) + 1;
      if (lastHttpStatus === 401 || (lastHttpStatus === 403 && methods[url] === 'browser')) manualRequired = true;
      if (lastHttpStatus === 403 && !/\.(?:json|xml)$/i.test(new URL(url).pathname)) methods[url] = 'browser';
      if ([401,403,429].includes(lastHttpStatus) || /HTTP\s+5\d\d|超时|timeout|ECONNRESET|ETIMEDOUT/i.test(error.message)) {
        nextRunAt = now() + publicRetryDelay(error, failures[url] - 1);
        break;
      }
      if (/预算|额度|浏览器渲染已关闭|Chromium/i.test(error.message)) { manualRequired = true; break; }
    }
  }
  return {
    items: [...products.values()],
    complete:
      errors.length === 0 && !truncated && !queue.some((u) => !visited.has(u)),
    requests: attempted.size,
    errors: [
      ...errors,
      ...(truncated ? ['站点目录超过本轮覆盖上限，不能确认完整基线'] : []),
    ],
    progress: {
      queue: queue.filter((u) => !visited.has(u)),
      visited: [...visited],
      truncated,
      day, methods, failures, browserPages, nextRunAt, lastHttpStatus, manualRequired,
    },
    retryAt: nextRunAt,
    manualRequired,
    browserPages,
  };
}

export async function scanAdvertiser(
  target,
  request,
  limit,
  collect = collectAds,
  progress = null,
) {
  const ads = new Map();
  const cursors = new Set(progress?.cursors || []),
    errors = [];
  let cursor = progress?.cursor || '',
    pages = 0;
  do {
    try {
      const result = await request(`ads:${cursor || 'first'}`, () =>
        collect({
          pageId: target.pageId,
          record: { id: '', term: target.label, market: target.market },
          cursor,
          adStatus: 'ALL',
        }),
      );
      pages++;
      for (const ad of result.ads) {
        // Never accept search matches or another company's page as advertiser evidence.
        if (ad.pageId !== target.pageId) continue;
        ads.set(ad.id, {
          ...ad,
          keywordIds: [],
          siteIds: target.siteId ? [target.siteId] : [],
        });
      }
      cursor = result.cursor;
      if (cursor && cursors.has(cursor))
        throw new Error('广告接口重复游标，未报告完整监控');
      cursors.add(cursor);
    } catch (error) {
      errors.push(error.message);
      if (/cursor|游标/i.test(error.message)) {
        cursor = '';
        cursors.clear();
      }
      break;
    }
  } while (cursor && pages < limit);
  return {
    items: [...ads.values()],
    complete: !cursor && errors.length === 0,
    requests: pages,
    errors,
    progress: { cursor, cursors: [...cursors] },
  };
}

export async function fetchHotwordSeed(
  config,
  seed,
  request,
  connect = client,
) {
  const { c, key } = await connect();
  try {
    const report = 'phrase_fullsearch';
    const schema = mcpPayload(
      await c.rpc('tools/call', {
        name: 'get_report_schema',
        arguments: { report },
      }),
    );
    if (
      schema.report !== report ||
      !schema.parameters?.database?.enum?.includes(config.market.toLowerCase())
    )
      throw new Error('Semrush 当前报告不支持所选市场');
    const allowed = schema.parameters.export_columns?.items?.enum || [];
    if (!allowed.includes('keyword') || !allowed.includes('volume'))
      throw new Error('Semrush 报告缺少关键词或搜索量字段');
    const params = {
      database: config.market.toLowerCase(),
      phrase: seed,
      display_limit: 100,
      display_sort: 'nq_desc',
      export_columns: [
        'keyword',
        'volume',
        'keyword_difficulty',
        'cpc',
        'competitive_density',
        'intent',
      ].filter((k) => allowed.includes(k)),
    };
    if (
      schema.parameters.display_sort?.enum &&
      !schema.parameters.display_sort.enum.includes('nq_desc')
    )
      throw new Error('Semrush 不支持按搜索量排序');
    return await request(`semrush:${seed}`, async () => {
      const payload = mcpPayload(
        await c.rpc('tools/call', {
          name: 'execute_report',
          arguments: { report, params },
        }),
      );
      const collectedAt = new Date().toISOString();
      return {
        rows: reportRows(payload)
          .slice(0, 100)
          .map((r) => ({
            term: rowTerm(r),
            volume: rowMetrics(r, config.market, collectedAt, report)
              .monthlySearchVolume,
            metrics: rowMetrics(r, config.market, collectedAt, report),
            seed,
            collectedAt,
          })),
        apiUnits: Number.isFinite(payload.metadata?.usage?.api_units)
          ? payload.metadata.usage.api_units
          : null,
      };
    });
  } catch (error) {
    throw new Error(safeSemrushError(error, key), { cause: error });
  } finally {
    await c.close?.();
  }
}
