import { load } from 'cheerio';

import { payload } from './platform-product-data.mjs';
import {
  resourceClient,
  safeError,
  schemaValue,
} from './product-resource-sorftime.mjs';
import {
  normalizeSellerId,
  productSellerDetails,
  productSellerId,
  productSellerName,
  sellerNameKey,
} from './product-seller.mjs';

const clean = (value) => {
  if (typeof value !== 'string') return '';
  const $ = load(value, {}, false);
  $('script,style').remove();
  return $.root().text().replaceAll(/\s+/g, ' ').trim().slice(0, 1500);
};
const empty = (usage) => {
  const counts = usage || { requests: 0, sorftimeCalls: 0, providerCalls: 0 };
  return { empty: true, providerCalls: counts.providerCalls, usage: counts };
};

export function needsSellerDetails(product, now = Date.now()) {
  if (product?.sourcePlatform !== 'Amazon' || !productSellerName(product))
    return false;
  const details = productSellerDetails(product);
  const age = now - Date.parse(details?.collectedAt);
  return !details || !Number.isFinite(age) || age < 0 || age >= 7 * 86_400_000;
}

// Each operation makes at most one data call. The intake request journal owns
// retries, unknown responses and budget reservations separately for both steps.
export async function amazonSellerSource(request, overrides = {}) {
  const product = request.product;
  const sellerName = productSellerName(product);
  const sellerId = productSellerId(product);
  const market = product.sourceMarket || product.market;
  if (product.sourcePlatform !== 'Amazon' || !sellerName) return empty();
  if (request.op === 'seller_identity' && sellerId) return empty();
  let token = '';
  try {
    const resource = await resourceClient(overrides);
    token = resource.token;
    const identity = request.op === 'seller_identity';
    const name = identity ? 'seller_search_from_name' : 'seller_detail';
    const tool = resource.client.tools.find((item) => item.name === name);
    const unsupported = () => ({
      unsupported: true,
      message: '当前来源未开放该站点的卖家资料',
      ...empty({
        requests: resource.controlRequests(),
        sorftimeCalls: 0,
        providerCalls: 0,
      }),
    });
    if (
      tool?.inputSchema?.type !== 'object' ||
      ['allOf', 'anyOf', 'oneOf', '$ref'].some((key) =>
        Object.hasOwn(tool.inputSchema, key),
      ) ||
      !tool.inputSchema.properties?.amz_seller_site?.enum?.includes(market)
    )
      return unsupported();
    const args = {
      name: identity || !sellerId ? sellerName : sellerId,
      query_type: identity || !sellerId ? 1 : 2,
      amz_seller_site: market,
    };
    if (identity && tool.inputSchema.properties.page) args.page = 1;
    for (const [key, value] of Object.entries(args))
      args[key] = schemaValue(value, tool.inputSchema.properties[key], key);
    if (
      (tool.inputSchema.required || []).some((key) => !Object.hasOwn(args, key))
    )
      return unsupported();
    const raw = await resource.client.rpc('tools/call', {
      name,
      arguments: args,
    });
    const usage = {
      requests: resource.controlRequests() + 1,
      sorftimeCalls: 1,
      providerCalls: 1,
    };
    if (
      !raw?.isError &&
      raw?.content?.length === 1 &&
      /^No (?:data available|relevant data)\.?$/i.test(
        String(raw.content[0]?.text || '').trim(),
      )
    )
      return empty(usage);
    const value = payload(raw);
    const rows = Array.isArray(value.data)
      ? value.data
      : [value.data].filter(Boolean);
    const matches = rows.filter(
      (row) => sellerNameKey(row.seller_name) === sellerNameKey(sellerName),
    );
    if (matches.length !== 1)
      throw new Error('卖家资料未唯一匹配当前销售方，未保存');
    const row = matches[0];
    const explicitMarket = row.amz_seller_site || row.amz_site || row.market;
    if (explicitMarket && explicitMarket !== market)
      throw new Error('卖家资料站点不一致，未保存');
    const returnedId = normalizeSellerId(row.seller_id);
    if (sellerId && returnedId && returnedId !== sellerId)
      throw new Error('卖家资料标识不一致，未保存');
    if (identity)
      return returnedId
        ? { patch: { sellerId: returnedId }, usage, providerCalls: 1 }
        : empty(usage);
    const address =
      typeof row.business_address === 'string'
        ? row.business_address
            .replaceAll(/<br\s*\/?\s*>/gi, '\n')
            .split(/\r?\n/)
            .map((line) => clean(line))
            .filter(Boolean)
            .slice(0, 20)
        : [];
    const businessName = clean(row.business_name);
    return {
      patch: {
        ...(sellerId || returnedId ? { sellerId: sellerId || returnedId } : {}),
        sellerDetails: {
          status:
            businessName || address.length > 0 ? 'available' : 'unavailable',
          sellerName,
          ...(sellerId || returnedId
            ? { sellerId: sellerId || returnedId }
            : {}),
          market,
          businessName,
          businessAddress: address,
          nationality: clean(row.seller_nationality),
          collectedAt: new Date(overrides.now?.() || Date.now()).toISOString(),
          provider: 'Sorftime',
          lookup: sellerId ? 'id' : 'exact_name',
        },
      },
      usage,
      providerCalls: 1,
    };
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- The raw transport cause can contain a credential-bearing MCP URL.
    throw new Error(safeError(error, token));
  }
}
