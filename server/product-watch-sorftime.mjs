import { payload } from './platform-product-data.mjs';
import {
  resourceClient,
  safeError,
  schemaValue,
} from './product-resource-sorftime.mjs';
import { parseAmazonDaily } from './product-watch-domain.mjs';
import {
  monthlyTrendMetrics,
  parseMonthlyTrend,
} from './product-monthly-trends.mjs';

export async function productWatchSource(request, overrides = {}) {
  let token = '';
  try {
    const r = await resourceClient(overrides);
    token = r.token;
    const tool = r.client.tools.find((t) => t.name === 'product_trend');
    const monthly = request.monthlyMetric !== undefined;
    if (monthly && !monthlyTrendMetrics.includes(request.monthlyMetric))
      throw new Error('不支持的历史月度指标');
    if (request.product.sourcePlatform !== 'Amazon' || !tool)
      return {
        unsupported: true,
        message: monthly
          ? '该来源未开放已适配的历史月度接口'
          : '该来源未开放已适配的每日销量接口',
        usage: { requests: r.controlRequests(), sorftimeCalls: 0 },
      };
    if (
      monthly &&
      (request.product.sourceVariantId ||
        request.product.resourceRaw?.variantId)
    )
      throw new Error('历史月度接口未明确支持此独立变体，未混用父商品数据');
    const properties = tool.inputSchema?.properties || {};
    const metric = monthly ? request.monthlyMetric : 'DailySalesVolume';
    const typeField = [
      'type',
      'product_trend_type',
      'trend_type',
      'productTrendType',
    ].find((key) => {
      const schema = properties[key];
      if (Array.isArray(schema?.enum)) return schema.enum.includes(metric);
      // Sorftime also declares supported dimensions as "Metric=meaning" in
      // the string parameter's description, without a structured enum.
      return schema?.type === 'string' && schema.enum === undefined &&
        new RegExp(`(?:^|[\\s;；,:，：])${metric}\\s*[=＝:：]`).test(schema.description || '');
    });
    if (!typeField)
      return {
        unsupported: true,
        message: monthly
          ? '当前Sorftime接口未明确开放此历史月度指标'
          : '当前Sorftime接口未明确开放每日销量指标',
        usage: { requests: r.controlRequests(), sorftimeCalls: 0 },
      };
    const args = {
      asin: request.product.sourceProductId,
      amz_site: request.product.sourceMarket || request.product.market,
      [typeField]: metric,
    };
    for (const [key, value] of Object.entries(args))
      args[key] = schemaValue(value, tool.inputSchema?.properties?.[key], key);
    for (const key of tool.inputSchema?.required || [])
      if (!(key in args))
        throw new Error('Sorftime趋势接口必填参数已变化，未发起数据查询');
    const raw = await r.client.rpc('tools/call', {
      name: tool.name,
      arguments: args,
    });
    const usage = {
      requests: r.controlRequests() + 1,
      sorftimeCalls: 1,
      providerCalls: 1,
    };
    if (
      !raw.isError &&
      raw.content?.length === 1 &&
      /^No (data available|relevant data)\.?$/i.test(
        raw.content[0].text?.trim(),
      )
    )
      return monthly
        ? {
            monthlyTrend: parseMonthlyTrend(
              [],
              request.product,
              metric,
              new Date().toISOString(),
            ),
            empty: true,
            usage,
          }
        : { dailySales: [], empty: true, usage };
    if (monthly) {
      let value;
      if (
        !raw.isError &&
        !raw.structuredContent &&
        raw.content?.length === 1 &&
        /^\s*\d{4}(?:年|[-/]?)\d{2}/.test(raw.content[0].text || '')
      )
        value = raw.content[0].text;
      else value = payload(raw);
      return {
        monthlyTrend: parseMonthlyTrend(
          value,
          request.product,
          metric,
          new Date().toISOString(),
        ),
        usage,
        providerCalls: 1,
      };
    }
    const dailySales = parseAmazonDaily(
      payload(raw),
      request.product,
      new Date().toISOString(),
    );
    return { dailySales, usage, providerCalls: 1 };
  } catch (error) {
    throw new Error(safeError(error, token));
  }
}
