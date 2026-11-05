import { payload } from './platform-product-data.mjs';
import {
  resourceClient,
  safeError,
  schemaValue,
} from './product-resource-sorftime.mjs';
import { parseAmazonDaily } from './product-watch-domain.mjs';

export async function productWatchSource(request, overrides = {}) {
  let token = '';
  try {
    const r = await resourceClient(overrides);
    token = r.token;
    const tool = r.client.tools.find((t) => t.name === 'product_trend');
    if (request.product.sourcePlatform !== 'Amazon' || !tool)
      return {
        unsupported: true,
        message: '该来源未开放已适配的每日销量接口',
        usage: { requests: r.controlRequests(), sorftimeCalls: 0 },
      };
    const args = {
      asin: request.product.sourceProductId,
      amz_site: request.product.sourceMarket || request.product.market,
      type: 'DailySalesVolume',
    };
    for (const [key, value] of Object.entries(args))
      args[key] = schemaValue(value, tool.inputSchema?.properties?.[key], key);
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
      return { dailySales: [], empty: true, usage };
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
