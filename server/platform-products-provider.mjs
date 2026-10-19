/* eslint-disable unicorn/no-await-expression-member -- Match SQL cache access in existing adapters. */
import { collectorEnv } from './local-provider.mjs';
import { createHash } from 'node:crypto';
import { pool, putDocument } from './database.mjs';
import { connectSorftime, readSorftimeToken } from './collector.js';
import {
  client as semrushClient,
  mcpPayload,
  reportRows,
} from './semrush-reports.mjs';
import { safeSemrushError } from './semrush-mcp.mjs';
import {
  payload,
  records,
  normalizeAmazon,
  normalizeShopping,
  normalizeAmazonContent,
  normalizeAmazonTrend,
  matchesProductTerm,
} from './platform-product-data.mjs';

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
  const discovery = ['search', 'domains', 'shopping'].includes(request.op);
  const signature = JSON.stringify([
    request.provider,
    request.op,
    request.market,
    discovery ? request.term : undefined,
    request.domain,
    request.page,
    request.provider === 'semrush' ? request.limit : undefined,
    request.product?.sourceProductId,
  ]);
  const name = `platform-products:${createHash('sha256').update(signature).digest('hex')}`;
  const previous = await cache?.read(name);
  const ttl = ['detail', 'content'].includes(request.op)
    ? 7 * 86_400_000
    : 86_400_000;
  if (previous && Date.now() - Date.parse(previous.cachedAt) < ttl)
    return { ...previous.result, cached: true, apiUnits: 0, providerCalls: 0 };
  const result = await collectProductData(request, overrides);
  if (JSON.stringify(result).length < 250_000)
    await cache?.write(name, { cachedAt: new Date().toISOString(), result });
  return result;
}
const clients = new Map();
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
      const name = names[request.op],
        tool = c.tools.find((t) => t.name === name);
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
              ...(request.op === 'trend' ? { type: 'AsinSalesVolume' } : {}),
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
      if (request.op === 'content')
        return {
          patch: normalizeAmazonContent(value, request.product, at),
          providerCalls: 1,
        };
      const series = normalizeAmazonTrend(value, request.product, at);
      return {
        series,
        providerCalls: 1,
        message:
          series.points.length > 0
            ? '已获取当前ASIN的月销量历史；未结束月份不参与标签计算'
            : '平台历史格式尚未识别或没有数据，未计算增长标签',
      };
    } catch (error) {
      clients.clear();
      // Never attach the raw cause, which can contain the MCP token.
      // eslint-disable-next-line preserve-caught-error
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
  const { c, key } = await (overrides.semrushClient || semrushClient)();
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
    const rows = reportRows(value),
      apiUnits = value.metadata?.usage?.api_units;
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
      };
    const products = rows
      .map((r) => normalizeShopping(r, request.market, at))
      .filter(Boolean)
      .filter((p) => matchesProductTerm(p, request.term));
    return { products, sourceRows: rows.length, apiUnits, collectedAt: at };
  } catch (error) {
    // Never attach the raw cause: provider errors can contain authentication URLs.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(safeSemrushError(error, key));
  }
}
