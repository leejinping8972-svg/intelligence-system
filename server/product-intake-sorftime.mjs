import { normalizeDiscoveryProduct } from './discovery-sorftime.mjs';
import {
  field,
  normalizeAmazonContent,
  payload,
  publicUrl,
} from './platform-product-data.mjs';
import {
  resourceClient,
  safeError,
  schemaValue,
} from './product-resource-sorftime.mjs';

export function intakeSourceWork(product) {
  if (product.sourceProvider !== 'Sorftime' || !product.sourceProductId)
    return [];
  return (
    {
      Amazon: ['detail', 'content'],
      'TikTok Shop': ['detail'],
      Shopee: ['detail', 'content'],
    }[product.sourcePlatform] || []
  ).map((op) => ({ op }));
}

export async function productIntakeSource(request, overrides = {}) {
  let token = '';
  try {
    const {
      client,
      token: credential,
      controlRequests,
    } = await resourceClient(overrides);
    token = credential;
    const p = request.product;
    const channel = {
      Amazon: 'amazon',
      'TikTok Shop': 'tiktok',
      Shopee: 'shopee',
    }[p.sourcePlatform];
    const name =
      channel === 'amazon'
        ? `product_${request.op}`
        : `${channel}_product_${request.op === 'detail' ? 'request' : 'content'}`;
    const tool = client.tools.find((t) => t.name === name);
    if (!tool)
      return {
        unsupported: true,
        message: '来源未开放此商品资料接口',
        providerCalls: 0,
        usage: { requests: controlRequests(), sorftimeCalls: 0 },
      };
    const site = p.sourceMarket || p.market;
    const args =
      channel === 'amazon'
        ? { asin: p.sourceProductId, amz_site: site }
        : { product_id: p.sourceProductId, site };
    for (const [key, value] of Object.entries(args))
      args[key] = schemaValue(value, tool.inputSchema?.properties?.[key], key);
    for (const key of tool.inputSchema?.required || [])
      if (!Object.hasOwn(args, key)) throw Error('商品资料接口参数已变化');
    const raw = await client.rpc('tools/call', { name, arguments: args });
    const usage = {
      requests: controlRequests() + 1,
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
      return { empty: true, usage, providerCalls: 1 };
    const value = payload(raw);
    const row = Array.isArray(value.data)
      ? value.data[0]
      : value.data || value.Data || value;
    if (!row || typeof row !== 'object' || !Object.keys(row).length)
      return { empty: true, usage, providerCalls: 1 };
    const id = field(
      row,
      'asin',
      'ASIN',
      'Asin',
      'product_id',
      'productId',
      'item_id',
      'itemId',
    );
    if (
      id !== undefined &&
      String(id).toUpperCase() !== p.sourceProductId.toUpperCase()
    )
      throw Error('商品资料来源标识不一致');
    const explicitMarket = field(
      row,
      'amz_site',
      'site',
      'market',
      'country_code',
    );
    if (explicitMarket && String(explicitMarket).toUpperCase() !== site)
      throw Error('商品资料来源市场不一致');
    const at = new Date(overrides.now?.() || Date.now()).toISOString();
    if (request.op === 'content') {
      const patch = normalizeAmazonContent(
        { ...row, asin: p.sourceProductId },
        p,
        at,
      );
      // Shopee content supplies full images, not Amazon-style bullet points.
      const images = field(
        row,
        'images',
        'image_urls',
        'image_list',
        'main_image',
      );
      if (Array.isArray(images)) {
        const urls = images
          .map((v) => publicUrl(typeof v === 'string' ? v : v?.url, false))
          .filter(Boolean)
          .slice(0, 30);
        if (urls.length) {
          patch.imageUrls = urls;
          patch.imageUrl = urls[0];
        }
      }
      return { patch, usage, providerCalls: 1 };
    }
    if (id === undefined) return { empty: true, usage, providerCalls: 1 };
    const product = normalizeDiscoveryProduct(
      {
        ...row,
        title:
          field(row, 'title', 'Title', 'product_name', 'productName', 'name') ||
          p.title,
      },
      { channel, market: p.market, sourceMarket: site },
      at,
    );
    if (!product || product.sourceProductId !== p.sourceProductId)
      throw Error('商品详情未返回可识别的当前商品');
    return { product: { ...product, id: p.id }, usage, providerCalls: 1 };
  } catch (error) {
    throw new Error(safeError(error, token));
  }
}
