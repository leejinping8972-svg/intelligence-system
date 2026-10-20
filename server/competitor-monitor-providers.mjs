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

export async function scanSite(
  site,
  request,
  limit,
  fetchPage = fetchPublicPage,
  progress = null,
  wait = () => pause(20_000),
) {
  const base = siteBase(site);
  const queue = progress?.queue || [
    ...(site.platform === 'Shopify'
      ? [`${base}/products.json?limit=250&page=1`]
      : []),
    ...fallbackProductUrls(site),
  ];
  const visited = new Set(progress?.visited || []),
    attempted = new Set(),
    products = new Map(),
    errors = [];
  let truncated = progress?.truncated === true;
  while (attempted.size < limit) {
    const index = queue.findIndex((url) => !attempted.has(url));
    if (index === -1) break;
    const url = canonicalCatalogUrl(queue.splice(index, 1)[0], base);
    if (!url || visited.has(url)) continue;
    if (attempted.size > 0) await wait();
    attempted.add(url);
    try {
      const page = await request(url, () =>
        fetchPage(url, 0, [
          'text/html',
          'application/xml',
          'text/xml',
          'application/json',
        ]),
      );
      if (!canonicalCatalogUrl(page.url, base))
        throw new Error('页面跳转至其他站点，未作为本站商品证据');
      let list;
      if (/\/products\.json/.test(url)) {
        const data = JSON.parse(page.html);
        list = shopifyCatalogProducts(data, base, site);
        if (data.products.length === 250) {
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
      if (/429|403|401|预算|额度/.test(error.message)) break;
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
    },
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
