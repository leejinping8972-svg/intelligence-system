/* eslint-disable unicorn/no-await-expression-member -- Match SQL cache access in existing adapters. */
import { createHash } from 'node:crypto';

import { connectSorftime, readSorftimeToken } from './collector.js';
import { pool, putDocument } from './database.mjs';
import { collectorEnv } from './local-provider.mjs';
import {
  matchesProductTerm,
  normalizeAmazon,
  normalizeAmazonContent,
  normalizeAmazonTrend,
  normalizeShopping,
  payload,
  records,
} from './platform-product-data.mjs';
import { safeSemrushError } from './semrush-mcp.mjs';
import {
  mcpPayload,
  reportRows,
  client as semrushClient,
} from './semrush-reports.mjs';

export async function platformProductRequest(request, overrides = {}) {
  const cache =
    overrides.cache === false
      ? null
      : overrides.cache || {
          read: async (name) =>
            (
              await pool.query(
                'SELECT value FROM provider_configs WHERE name=$1',
                [name],
              )
            ).rows[0]?.value,
          write: (name, value) => putDocument('provider_configs', name, value),
        };
  const discovery = ['domains', 'search', 'shopping'].includes(request.op);
  const signatureParts = [
    request.provider,
    request.op,
    request.market,
    discovery ? request.term : undefined,
    request.domain,
    request.page,
    request.provider === 'semrush' ? request.limit : undefined,
    request.product?.sourceProductId,
  ];
  if (discovery && request.discoveryDay)
    signatureParts.push('daily', request.discoveryDay);
  if (
    request.op === 'trend' &&
    request.trendType &&
    request.trendType !== 'AsinSalesVolume'
  )
    signatureParts.push(request.trendType);
  const signature = JSON.stringify(signatureParts);
  const name = `platform-products:${createHash('sha256').update(signature).digest('hex')}`;
  const previous = await cache?.read(name);
  const emptyTrend =
    previous?.result &&
    (previous.result.empty ||
      (request.op === 'trend' &&
        previous.result.series?.points?.length === 0) ||
      (request.op === 'content' && emptyContent(previous.result.patch)));
  let ttl = 86_400_000;
  if (['content', 'detail'].includes(request.op)) ttl = 7 * 86_400_000;
  if (emptyTrend) ttl = 15 * 60_000;
  if (
    previous &&
    !(request.refreshEmpty && emptyTrend) &&
    Date.now() - Date.parse(previous.cachedAt) < ttl
  )
    return { ...previous.result, cached: true, apiUnits: 0, providerCalls: 0 };
  const result = await collectProductData(request, overrides);
  const { semrushKeyId: _semrushKeyId, ...cacheResult } = result;
  if (JSON.stringify(cacheResult).length < 250_000)
    await cache?.write(name, {
      cachedAt: new Date().toISOString(),
      result: cacheResult,
    });
  return result;
}
const clients = new Map();
function emptyContent(patch) {
  const c = patch?.sourceContent;
  return (
    !patch?.imageUrl &&
    !patch?.ingredient &&
    !patch?.dose &&
    !c?.descriptions?.length &&
    Object.keys(c?.attributes || {}).length === 0 &&
    Object.keys(c?.productInfo || {}).length === 0 &&
    !c?.aPlusImages?.length
  );
}
async function collectProductData(request, overrides = {}) {
  const at = new Date().toISOString();
  if (request.provider === 'sorftime') {
    const env = await (overrides.collectorEnv || collectorEnv)();
    const token = await (overrides.readSorftimeToken || readSorftimeToken)(env);
    try {
      const fingerprint = createHash('sha256').update(token).digest('hex');
      let cached = overrides.connectSorftime ? null : clients.get(fingerprint);
      if (!cached || cached.expires < Date.now()) {
        cached = {
          client: await (overrides.connectSorftime || connectSorftime)(
            token,
            fetch,
            true,
          ),
          expires: Date.now() + 300_000,
        };
        if (!overrides.connectSorftime) {
          clients.clear();
          clients.set(fingerprint, cached);
        }
      }
      const c = cached.client;
      const names = {
        search: 'product_search_from_name',
        detail: 'product_detail',
        content: 'product_content',
        trend: 'product_trend',
      };
      const name = names[request.op];
        const tool = c.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`Sorftime MCP 未开放 ${name} 工具`);
      const args =
        request.op === 'search'
          ? {
              name: request.term,
              query_type: 2,
              page: request.page || 1,
              amz_site: request.market,
            }
          : {
              asin: request.product.sourceProductId,
              amz_site: request.market,
              ...(request.op === 'trend'
                ? { type: request.trendType || 'AsinSalesVolume' }
                : {}),
            };
      const allowedMarkets = tool.inputSchema?.properties?.amz_site?.enum;
      if (!allowedMarkets?.includes(request.market))
        throw new Error('此 Sorftime 商品工具不支持所选市场，未跨国替代');
      for (const key of Object.keys(args))
        if (!tool.inputSchema?.properties?.[key])
          throw new Error(`Sorftime 商品工具参数 ${key} 已变化，请重新适配`);
      const value = payload(
        await c.rpc('tools/call', { name, arguments: args }),
      );
      if (request.op === 'search') {
        const sourceRows = records(value);
        const normalized = sourceRows
          .map((r) => normalizeAmazon(r, request.market, at))
          .filter(Boolean);
        if (sourceRows.length > 0 && normalized.length === 0)
          throw new Error(
            'Sorftime 返回了数据，但商品标识或标题格式未识别；未编造商品入库，请核对工具字段',
          );
        const products = normalized.filter((p) =>
          matchesProductTerm(p, request.term),
        );
        return {
          products,
          pageFingerprint: createHash('sha256')
            .update(normalized.map((p) => p.sourceProductId).join('|'))
            .digest('hex'),
          hasMore: sourceRows.length === 20,
          sourceRows: sourceRows.length,
          rejected: normalized.length - products.length,
          collectedAt: at,
          providerCalls: 1,
          message: `平台返回${sourceRows.length}件，标题/副标题匹配${products.length}件，排除不相关${normalized.length - products.length}件`,
        };
      }
      if (request.op === 'detail') {
        const row =
          records(value).find(
            (r) =>
              String(r.asin || r.Asin || r.ASIN || '').toUpperCase() ===
              request.product.sourceProductId,
          ) ||
          value.data ||
          value.Data ||
          value;
        if (
          !row ||
          Object.keys(row).filter((k) => !['asin', 'Asin', 'ASIN'].includes(k))
            .length === 0
        )
          return {
            empty: true,
            providerCalls: 1,
            message: '平台未返回基础详情，已有资料保留',
          };
        const product = normalizeAmazon(
          { ...row, title: row.title || row.Title || request.product.title },
          request.market,
          at,
          request.product.sourceProductId,
        );
        if (!product)
          throw new Error('Sorftime 商品详情标识不一致或格式不可识别');
        return { product, providerCalls: 1 };
      }
      if (request.op === 'content') {
        const patch = normalizeAmazonContent(value, request.product, at);
          const empty = emptyContent(patch);
        return {
          patch: empty ? undefined : patch,
          empty,
          providerCalls: 1,
          message: empty
            ? '平台未返回该商品的图片、属性或描述，未伪造填充字段'
            : '已保存平台图片与属性原文；未公开的配方/剂量保持未知',
        };
      }
      const series = normalizeAmazonTrend(
        value,
        request.product,
        at,
        request.trendType || 'AsinSalesVolume',
      );
      return {
        series,
        providerCalls: 1,
        message:
          series.points.length > 0
            ? `已取得 ${request.trendType || 'AsinSalesVolume'} 历史 ${series.points.length} 个周期；未结束月份不参与标签计算`
            : `平台未返回 ${request.trendType || 'AsinSalesVolume'} 有效历史（缺失值不按0处理），可查看其他趋势指标`,
      };
    } catch (error) {
      clients.clear();
      // Never attach the raw cause, which can contain the MCP token.

      throw new Error(
        String(error.message)
          .replaceAll(token || '\u0000', '[已隐藏]')
          .replaceAll(
            /https:\/\/mcp\.sorftime\.com[^\s"<>]*/gi,
            'Sorftime MCP',
          ),
      );
    }
  }
  if (request.provider !== 'semrush') throw new Error('不支持的商品平台');
  const { c, key, semrushKeyId } = await (
    overrides.semrushClient || semrushClient
  )();
  try {
    const report =
      request.op === 'domains' ? 'phrase_adwords' : 'domain_shopping';
    const schema = mcpPayload(
      await c.rpc('tools/call', {
        name: 'get_report_schema',
        arguments: { report },
      }),
    );
    if (
      schema.report !== report ||
      !schema.parameters?.database?.enum?.includes(request.market.toLowerCase())
    )
      throw new Error('Semrush 商品报告不支持所选市场');
    const params = {
      database: request.market.toLowerCase(),
      display_limit: request.limit,
    };
    if (request.op === 'domains') {
      params.phrase = request.term;
      params.export_columns = ['domain', 'url'];
    } else {
      params.domain = request.domain;
      params.export_columns = [
        'keyword',
        'position',
        'volume',
        'shop_name',
        'url',
        'ad_title',
        'price',
        'timestamp',
      ];
      params.display_filter = [
        {
          field: 'keyword',
          operation: 'contains',
          sign: '+',
          value: request.term,
        },
      ];
    }
    const allowed = schema.parameters.export_columns?.items?.enum || [];
    if (params.export_columns.some((k) => !allowed.includes(k)))
      throw new Error('Semrush 商品报告字段结构已变化，请重新适配');
    const value = mcpPayload(
      await c.rpc('tools/call', {
        name: 'execute_report',
        arguments: { report, params },
      }),
    );
    const apiUnits = value.metadata?.usage?.api_units;
      const rows = reportRows(value);
    if (request.op === 'domains')
      return {
        domains: [
          ...new Set(
            rows
              .map((r) =>
                String(r.domain || r.Domain || r.Dn || '').toLowerCase(),
              )
              .filter((v) =>
                /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(v),
              ),
          ),
        ],
        apiUnits,
        semrushKeyId,
      };
    const products = rows
      .map((r) => normalizeShopping(r, request.market, at))
      .filter(Boolean)
      .filter((p) => matchesProductTerm(p, request.term));
    return {
      products,
      sourceRows: rows.length,
      apiUnits,
      collectedAt: at,
      semrushKeyId,
    };
  } catch (error) {
    // Never attach the raw cause: provider errors can contain authentication URLs.

    throw new Error(safeSemrushError(error, key));
  }
}
