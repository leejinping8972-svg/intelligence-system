import { createHash } from 'node:crypto';

import { connectSorftime, readSorftimeToken } from './collector.js';
import { collectorEnv } from './local-provider.mjs';
import {
  attributeTable, field, matchesProductTerm, normalizeAmazon, normalizeAmazonContent,
  normalizeAmazonTrend, number, payload, records, text,
} from './platform-product-data.mjs';
import { normalizeTikTokShopProduct } from './tiktok-shop-provider.mjs';

const prefixes = { amazon: '', tiktok_shop: 'tiktok_', shopee: 'shopee_', temu: 'temu_' };
const marketAliases = ['amz_site', 'amzSite', 'site', 'country', 'region', 'shopee_site', 'tiktok_site', 'temu_site'];
const categoryIdAliases = ['node_id', 'nodeId', 'category_id', 'categoryId', 'cate_id', 'parent_id', 'parentId'];
const categoryPathAliases = ['node_path', 'nodePath', 'category_path', 'categoryPath'];
const productIdAliases = ['product_id', 'productId', 'item_id', 'itemId', 'asin', 'Asin', 'ASIN'];
const variantIdAliases = ['variant_id', 'variantId', 'sku_id', 'skuId', 'source_variant_id'];
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cleanId = (value) => ['string', 'number'].includes(typeof value) ? String(value).trim().slice(0, 500) : '';
const safeError = (error, token) => String(error?.message || 'Sorftime 来源请求失败')
  .replaceAll(token || '\0', '[redacted]')
  .replaceAll(/https?:\/\/mcp\.sorftime\.com[^\s"<>]*/gi, 'Sorftime MCP')
  .replaceAll(/(?:api[_-]?key|token|authorization)\s*[:=]\s*[^\s,;]+/gi, 'credential=[redacted]')
  .slice(0, 700);

// These are compatibility candidates, not a claim about every account's MCP
// catalogue. Only an exact listed tool with an understood schema can be called.
function toolNames(request) {
  const prefix = prefixes[request.platform];
  if (prefix === undefined) throw new Error('Sorftime 不支持此平台适配');
  const names = {
    search: ['product_search_from_name'],
    categories: request.query || request.term
      ? ['category_name_search', 'category_search_from_name', 'category_tree']
      : ['category_search_from_top_node', 'category_tree'],
    category: ['category_products', 'category_report', 'category_request'],
    bestsellers: ['category_products', 'category_report', 'category_request'],
    detail: ['product_detail'],
    history: ['product_trend'],
  }[request.op];
  if (!names) throw new Error('Sorftime 不支持此资源操作');
  return names.map((name) => `${prefix}${name}`);
}

function schemaValue(value, schema, name) {
  if (!schema || typeof schema !== 'object' || ['$ref', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'const', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'contains'].some((key) => Object.hasOwn(schema, key))) throw new Error(`Sorftime 不支持尚未适配的 ${name} 参数schema`);
  if (!['string', 'integer', 'number', 'boolean', 'array'].includes(schema.type)) throw new Error(`Sorftime 不支持尚未适配的 ${name} 参数类型`);
  if (schema.type === 'integer' || schema.type === 'number') {
    if (!/^\d+(?:\.\d+)?$/.test(String(value))) throw new Error(`Sorftime 不支持当前 ${name} 参数结构`);
    value = Number(value);
    if (schema.type === 'integer' && !Number.isInteger(value)) throw new Error(`Sorftime 不支持当前 ${name} 参数结构`);
  } else if (schema.type === 'string' && typeof value !== 'string') {
    if (typeof value !== 'number') throw new Error(`Sorftime 不支持当前 ${name} 字符串参数结构`);
    value = String(value);
  }
  else if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`Sorftime 不支持当前 ${name} 布尔参数结构`);
  else if (schema.type === 'array') {
    if (!Array.isArray(value) || !schema.items || Array.isArray(schema.items)) throw new Error(`Sorftime 不支持当前 ${name} 数组参数结构`);
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) throw new Error(`Sorftime 不支持当前 ${name} 数组长度`);
    value = value.map((item) => schemaValue(item, schema.items, name));
  }
  if (typeof value === 'string') {
    if ((schema.minLength !== undefined && value.length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength)) throw new Error(`Sorftime 不支持当前 ${name} 字符串长度`);
    if (schema.pattern !== undefined && (typeof schema.pattern !== 'string' || schema.pattern.length > 256 || !new RegExp(schema.pattern).test(value))) throw new Error(`Sorftime 不支持当前 ${name} 字符串格式`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`Sorftime 不支持当前 ${name} 参数值`);
  if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new Error(`Sorftime 不支持当前 ${name} 参数范围`);
  return value;
}

function sourceProductId(request) {
  if (request.product?.sourceProductId) return cleanId(request.product.sourceProductId);
  if (!request.url) return '';
  const url = new URL(request.url);
  if (request.platform === 'amazon') {
    const expected = { US: 'amazon.com', MX: 'amazon.com.mx' }[request.market];
    if (!expected || !(url.hostname === expected || url.hostname.endsWith(`.${expected}`))) throw new Error('Sorftime 商品链接与所选平台或国家不一致');
    return /\/(?:dp|gp\/product)\/([a-z\d]{10})(?:\/|$)/i.exec(url.pathname)?.[1]?.toUpperCase() || '';
  }
  const explicit = cleanId(request.sourceProductId || request.productId);
  if (explicit) return explicit;
  if (request.platform === 'shopee') {
    if (request.market !== 'VN' || !(url.hostname === 'shopee.vn' || url.hostname.endsWith('.shopee.vn'))) throw new Error('Sorftime 商品链接与所选平台或国家不一致');
    return /\/product\/\d+\/(\d+)/.exec(url.pathname)?.[1] || /-i\.\d+\.(\d+)/.exec(url.pathname)?.[1] || '';
  }
  if (request.platform === 'tiktok_shop') {
    if (!(url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com'))) throw new Error('Sorftime 商品链接与所选平台不一致');
    return /\/(?:product|pdp)\/(?:[^/]+\/)?(\d{8,})(?:\/|$)/.exec(url.pathname)?.[1] || '';
  }
  if (request.platform === 'temu') {
    if (!(url.hostname === 'temu.com' || url.hostname.endsWith('.temu.com'))) throw new Error('Sorftime 商品链接与所选平台不一致');
    return /-g-(\d+)\.html/.exec(url.pathname)?.[1] || cleanId(url.searchParams.get('goods_id'));
  }
  return '';
}

function argumentsFor(tool, request) {
  const schema = tool.inputSchema;
  if (!schema || schema.type !== 'object' || ['$ref', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else'].some((key) => Object.hasOwn(schema, key)) || (schema.required !== undefined && (!Array.isArray(schema.required) || schema.required.some((key) => typeof key !== 'string')))) throw new Error('Sorftime 工具参数结构不支持，未发起数据调用');
  const properties = schema.properties || {};
  const args = {};
  const marketField = marketAliases.find((name) => properties[name] && Array.isArray(properties[name].enum) && properties[name].enum.some((value) => String(value).toUpperCase() === request.market));
  if (!marketField) throw new Error('Sorftime 工具未明确支持所选国家，未发起数据调用或跨国替代');
  args[marketField] = schemaValue(properties[marketField].enum.find((value) => String(value).toUpperCase() === request.market), properties[marketField], marketField);
  const setFirst = (aliases, value) => {
    if (value === undefined || value === null || value === '') return;
    const name = aliases.find((alias) => properties[alias]);
    if (name) args[name] = schemaValue(value, properties[name], name);
  };
  if (['search', 'categories'].includes(request.op)) setFirst(['name', 'keyword', 'query', 'searchKeyword', 'category_name', 'categoryName'], request.query || request.term);
  if (['category', 'bestsellers', 'categories'].includes(request.op)) {
    setFirst(categoryIdAliases, request.category?.id ?? request.parentId);
    setFirst(categoryPathAliases, request.category?.rawPath ?? request.category?.idPath ?? request.rawPath);
  }
  if (['detail', 'history'].includes(request.op)) {
    const id = sourceProductId(request);
    if (!id) throw new Error('Sorftime 不支持缺少真实来源商品ID的详情或历史请求');
    setFirst(request.platform === 'amazon' ? ['asin', 'Asin', 'ASIN', ...productIdAliases] : productIdAliases, id);
    const variantId = request.product?.sourceVariantId || request.product?.resourceRaw?.variantId;
    if (variantId) {
      setFirst(variantIdAliases, variantId);
      if (request.op === 'history' && !Object.keys(args).some((name) => variantIdAliases.includes(name))) throw new Error('Sorftime 历史工具不支持此变体独立查询，未混用父商品销量');
    }
  }
  if (request.op === 'history') {
    const typeField = ['type', 'trend_type', 'trendType', 'metric'].find((key) => properties[key]);
    if (typeField) {
      const allowed = properties[typeField].enum;
      const type = allowed
        ? ['AsinSalesVolume', 'ProductSalesVolume', 'sales_volume', 'salesVolume'].find((candidate) => allowed.includes(candidate))
        : request.platform === 'amazon' ? 'AsinSalesVolume' : undefined;
      if (!type) throw new Error('Sorftime 历史工具不支持已适配的商品销量指标');
      args[typeField] = type;
    }
  }
  setFirst(['page', 'page_no', 'pageNo', 'page_index'], request.page || 1);
  setFirst(['page_size', 'pageSize', 'limit', 'count'], Math.max(1, Math.min(100, request.limit || 20)));
  setFirst(['cursor', 'page_token'], request.cursor);
  if (request.op === 'search' && properties.query_type) args.query_type = schemaValue(2, properties.query_type, 'query_type');
  for (const name of schema.required || []) {
    if (args[name] !== undefined) continue;
    const known = [...marketAliases, ...categoryIdAliases, ...categoryPathAliases, ...productIdAliases, ...variantIdAliases, 'name', 'keyword', 'query', 'searchKeyword', 'category_name', 'categoryName', 'page', 'page_no', 'pageNo', 'page_index', 'page_size', 'pageSize', 'limit', 'count', 'cursor', 'page_token', 'query_type', 'type', 'trend_type', 'trendType', 'metric'];
    if (known.includes(name) && properties[name]?.default !== undefined) args[name] = schemaValue(properties[name].default, properties[name], name);
    else throw new Error(`Sorftime 不支持尚未适配的必填参数 ${name}，未发起数据调用`);
  }
  if (['search', 'categories'].includes(request.op) && (request.query || request.term) && !Object.keys(args).some((key) => ['name', 'keyword', 'query', 'searchKeyword', 'category_name', 'categoryName'].includes(key))) throw new Error('Sorftime 工具不支持当前查询参数，未发起数据调用');
  if (['category', 'bestsellers'].includes(request.op) && !Object.keys(args).some((key) => [...categoryIdAliases, ...categoryPathAliases].includes(key))) throw new Error('Sorftime 类目工具不支持真实类目ID或原始路径参数');
  if (['detail', 'history'].includes(request.op) && !Object.keys(args).some((key) => productIdAliases.includes(key))) throw new Error('Sorftime 商品工具不支持已适配商品ID参数');
  return args;
}

async function resourceClient(overrides) {
  if (overrides.client) return { client: overrides.client, token: '', controlRequests: () => 0 };
  const env = overrides.env || await (overrides.collectorEnv || collectorEnv)();
  const token = overrides.token || overrides.config?.token || await (overrides.readSorftimeToken || readSorftimeToken)(env);
  let controls = 0;
  let calls = 0;
  const fetcher = async (url, init) => {
    let method;
    try { method = JSON.parse(init?.body || '{}').method; } catch {}
    if (method === 'tools/call') {
      if (++calls > 1) throw new Error('Sorftime 单步数据请求次数已达上限');
    } else if (++controls > 4) throw new Error('Sorftime MCP 工具发现控制请求已达上限');
    return (overrides.fetch || overrides.fetcher || fetch)(url, init);
  };
  try {
    const client = await (overrides.connectSorftime || connectSorftime)(token, fetcher, true);
    return { client, token, controlRequests: () => controls };
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- The raw transport cause can contain the credential-bearing MCP URL.
    throw new Error(safeError(error, token));
  }
}

function categoryRows(value, request) {
  const result = new Map();
  let visited = 0;
  const walk = (node, ancestors = [], depth = 0) => {
    if (!node || depth > 12 || ++visited > 5000) return;
    if (typeof node === 'string') {
      try { walk(JSON.parse(node), ancestors, depth + 1); } catch {}
      return;
    }
    if (Array.isArray(node)) { for (const item of node) walk(item, ancestors, depth + 1); return; }
    if (typeof node !== 'object') return;
    const id = cleanId(field(node, ...categoryIdAliases, 'id', 'Id'));
    const name = text(field(node, 'node_name', 'nodeName', 'category_name', 'categoryName', 'name', 'Name', 'label'));
    const explicitMarket = field(node, ...marketAliases, 'market');
    if (explicitMarket && String(explicitMarket).toUpperCase() !== request.market) return;
    let path = ancestors;
    if (id && name) {
      const original = field(node, ...categoryPathAliases, 'path', 'Path');
      const labels = Array.isArray(original) && original.every((part) => typeof part === 'string') ? original : undefined;
      path = labels?.length ? labels : [...ancestors, name];
      result.set(id, { id, name, path, market: request.market, provider: 'sorftime', platform: request.platform, ...(original !== undefined ? { rawPath: original } : {}) });
    }
    for (const key of ['data', 'Data', 'result', 'Result', 'list', 'List', 'rows', 'items', 'categories', 'children', 'nodes', 'childs', 'subCategories']) if (node[key]) walk(node[key], path, depth + 1);
  };
  walk(value, request.parentPath || []);
  return [...result.values()].slice(0, 100);
}

function productRows(value, depth = 0) {
  if (depth > 8 || !value) return [];
  if (typeof value === 'string') { try { return productRows(JSON.parse(value), depth + 1); } catch { return []; } }
  if (Array.isArray(value)) return value;
  for (const key of ['products', 'Products', 'top50_products', 'top_products', 'top50', 'items', 'Items', 'rows', 'Rows', 'list', 'List', 'data', 'Data', 'result', 'Result']) {
    if (value[key]) { const rows = productRows(value[key], depth + 1); if (rows.length) return rows; }
  }
  return [];
}

function aggregateReceipt(value, request, tool, at, token) {
  const allowed = new Set([
    'data', 'result', 'results', 'rows', 'items', 'list', 'top50', 'top100', 'top50_products', 'top_products', 'summary', 'report', 'metrics', 'statistics', 'aggregate',
    'id', 'name', 'title', 'label', 'value', 'total', 'count', 'total_count', 'sales', 'sales_volume', 'sale_volume', 'monthly_sales', 'monthly_sale_volume', 'gmv', 'revenue',
    'price', 'min_price', 'max_price', 'currency', 'rank', 'position', 'percentage', 'share', 'growth', 'period', 'date', 'start', 'end', 'start_date', 'end_date',
    'category_id', 'category_name', 'category_path', 'node_id', 'node_name',
  ]);
  let nodes = 0;
  let truncated = false;
  let filtered = false;
  const sanitize = (raw, depth = 0) => {
    if (++nodes > 500 || depth > 6) { truncated = true; return undefined; }
    if (raw === null || typeof raw === 'boolean' || typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
      if (raw.length > 700) truncated = true;
      return raw ? safeError({ message: raw }, token).replaceAll(/https?:\/\/[^\s"<>]+/gi, '[url omitted]') : '';
    }
    if (Array.isArray(raw)) {
      if (raw.length > 50) truncated = true;
      return raw.slice(0, 50).map((item) => sanitize(item, depth + 1)).filter((item) => item !== undefined);
    }
    if (!raw || typeof raw !== 'object') return undefined;
    const result = {};
    for (const [key, item] of Object.entries(raw)) {
      if (!allowed.has(key.toLowerCase())) { filtered = true; continue; }
      const captured = sanitize(item, depth + 1);
      if (captured !== undefined) result[key] = captured;
    }
    return result;
  };
  const aggregate = sanitize(value);
  const receipt = { tool, collectedAt: at, market: request.market, platform: request.platform, aggregate, filtered, truncated };
  if (Buffer.byteLength(JSON.stringify(receipt), 'utf8') <= 20_000) return receipt;
  const excerpt = JSON.stringify(aggregate);
  delete receipt.aggregate;
  receipt.aggregateExcerpt = excerpt;
  receipt.truncated = true;
  while (Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 20_000) receipt.aggregateExcerpt = receipt.aggregateExcerpt.slice(0, Math.floor(receipt.aggregateExcerpt.length * 0.75));
  return receipt;
}

function cleanVariant(variant) {
  if (!variant || typeof variant !== 'object') return undefined;
  const result = {};
  for (const key of ['id', 'sku_id', 'variant_id', 'name', 'title', 'price', 'currency', 'specification', 'attributes', 'stock']) if (variant[key] !== undefined) result[key] = variant[key];
  return result;
}

function rawEvidence(row, request) {
  const price = field(row, 'price', 'Price', 'sale_price', 'min_price', 'salePrice') ?? row.product_price_info?.sale_price_decimal ?? row.price_info?.sale_price;
  const rawPrice = price && typeof price === 'object' ? price.value ?? price.amount ?? price.price : price;
  const variants = field(row, 'variants', 'skus', 'sku_list', 'variations');
  const shop = row.shop || row.seller || row.shop_info || {};
  const sourceRank = number(field(row, 'source_rank', 'sourceRank', 'position', 'Position', ...(request.op === 'bestsellers' || request.op === 'category' ? ['rank', 'Rank'] : [])));
  return {
    ...(typeof rawPrice === 'string' || typeof rawPrice === 'number' ? { priceRaw: String(rawPrice) } : {}),
    shopId: cleanId(field(row, 'shop_id', 'shopId', 'seller_id') || shop.id || shop.shop_id),
    shopName: text(field(row, 'shop_name', 'shopName', 'ShopName', 'seller_name', 'sellerName', 'SellerName') || shop.name || shop.shop_name),
    variantId: cleanId(field(row, 'variant_id', 'sku_id')),
    ...(Array.isArray(variants) ? { variants: variants.slice(0, 100).map(cleanVariant).filter(Boolean) } : {}),
    ...(sourceRank !== undefined ? { sourceRank } : {}),
    ...(request.category ? { category: request.category } : {}),
  };
}

function normalizeProduct(row, request, at) {
  if (!row || typeof row !== 'object') return null;
  if (row.product_info && typeof row.product_info === 'object') row = { ...row, ...row.product_info };
  const explicitMarket = field(row, ...marketAliases, 'market', 'country_code');
  if (explicitMarket && String(explicitMarket).toUpperCase() !== request.market) return null;
  if (request.platform === 'amazon') {
    const expected = request.product?.sourceProductId || (request.op === 'detail' ? sourceProductId(request) : undefined);
    const p = normalizeAmazon({ ...(request.product ? { title: request.product.title } : {}), ...row }, request.market, at, expected);
    if (!p) return null;
    const content = normalizeAmazonContent(row, p, at);
    return { ...p, ...content, resourceRaw: rawEvidence(row, request) };
  }
  const id = cleanId(field(row, ...productIdAliases) || (!['category', 'bestsellers'].includes(request.op) ? row.id : undefined));
  if (!id) return null;
  const expected = request.product?.sourceProductId || (request.op === 'detail' ? sourceProductId(request) : undefined);
  if (expected && expected !== id) throw new Error('Sorftime 详情商品ID不一致，未混入其他商品');
  const normalized = normalizeTikTokShopProduct({ ...(request.product ? { title: request.product.title } : {}), ...row, product_id: id }, request.market, at);
  if (!normalized) return null;
  const sourcePlatform = { tiktok_shop: 'TikTok Shop', shopee: 'Shopee', temu: 'Temu' }[request.platform];
  const p = {
    ...normalized,
    id: `${request.market}-platform-${request.platform}-${hash(`${request.market}|${request.platform}|${id}`).slice(0, 24)}`,
    sourceProvider: 'Sorftime', sourcePlatform,
    resourceRaw: rawEvidence(row, request),
  };
  const monthlySales = number(field(row, 'monthly_sale_volume', 'monthlySales', 'month_sales', 'monthly_sales'));
  if (monthlySales !== undefined) p.sourceMetrics.monthlySales = monthlySales;
  const attributes = attributeTable(row.attributes || row.properties);
  const specification = text(field(row, 'specification', 'spec', 'size') || attributes.Specification);
  if (specification) { p.size = specification; if (!p.collectionFields.includes('size')) p.collectionFields.push('size'); }
  return p;
}

function historySeries(value, request, at) {
  const product = request.product;
  if (!product) throw new Error('Sorftime 历史请求缺少已入库的来源商品');
  const inner = value.data || value.Data || value;
  const explicitMarket = field(inner, ...marketAliases, 'market', 'country_code');
  if (explicitMarket && String(explicitMarket).toUpperCase() !== product.market) throw new Error('Sorftime 历史国家不一致，未跨国合并销量');
  const explicitId = cleanId(field(inner, ...productIdAliases));
  if (explicitId && explicitId !== product.sourceProductId) throw new Error('Sorftime 历史商品ID不一致，未混入其他商品或变体');
  const explicitVariant = cleanId(field(inner, ...variantIdAliases));
  if (explicitVariant && explicitVariant !== String(product.sourceVariantId || product.resourceRaw?.variantId || '')) throw new Error('Sorftime 历史变体ID不一致，未混用其他变体销量');
  if (['day', 'daily'].includes(String(inner.period || inner.granularity || inner.resolution || '').toLowerCase())) {
    const points = new Map();
    const raw = records(value);
    let recognized = 0;
    for (const row of raw) {
      const date = text(field(row, 'date', 'Date', 'day', 'start'));
      const end = text(row.end) || date;
      const dailyValue = number(field(row, 'value', 'sales_volume', 'salesVolume', 'sales'));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== end || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) continue;
      recognized++;
      if (dailyValue === undefined) continue;
      if (points.has(date) && points.get(date).value !== dailyValue) throw new Error('Sorftime 同日销量冲突，未合并成虚假统计窗口');
      points.set(date, { start: date, end: date, value: dailyValue, partial: date >= at.slice(0, 10) });
    }
    if (raw.length && !recognized) throw new Error('Sorftime 历史日期结构不支持，未补造逐日销量');
    return { provider: 'Sorftime', source: 'Sorftime', platform: product.sourcePlatform || { amazon: 'Amazon', tiktok_shop: 'TikTok Shop', shopee: 'Shopee', temu: 'Temu' }[request.platform], market: product.market, productId: product.sourceProductId, ...(product.sourceVariantId || product.resourceRaw?.variantId ? { sourceVariantId: product.sourceVariantId || product.resourceRaw.variantId } : {}), metric: 'sales_volume', period: 'day', points: [...points.values()].toSorted((a, b) => a.start.localeCompare(b.start)), collectedAt: at, basis: '来源明确逐日销售件数；缺失日期未补0，当前日为未完结。' };
  }
  const series = normalizeAmazonTrend(value, product, at, 'AsinSalesVolume');
  return { ...series, platform: product.sourcePlatform || { amazon: 'Amazon', tiktok_shop: 'TikTok Shop', shopee: 'Shopee', temu: 'Temu' }[request.platform], ...(product.sourceVariantId || product.resourceRaw?.variantId ? { sourceVariantId: product.sourceVariantId || product.resourceRaw.variantId } : {}), basis: request.platform === 'amazon' ? series.basis : '来源当前商品自然月销售件数，不混合其他商品或变体；不能换算为滚动天数。' };
}

export async function collectSorftimeResource(request, overrides = {}) {
  let token = '';
  try {
    const connected = await resourceClient(overrides);
    token = connected.token;
    const client = connected.client;
    const candidates = toolNames(request);
    let selected;
    let args;
    let rejected;
    for (const name of candidates) {
      const tool = client.tools?.find((item) => item.name === name);
      if (!tool) continue;
      try { args = argumentsFor(tool, request); selected = tool; break; }
      catch (error) { rejected = error; }
    }
    if (!selected) throw rejected || new Error('Sorftime 账户未开放已适配的资源工具；此操作不支持，未发起数据调用');
    const at = new Date(overrides.now ? overrides.now() : Date.now()).toISOString();
    const value = payload(await client.rpc('tools/call', { name: selected.name, arguments: args }));
    const controlRequests = connected.controlRequests();
    const usage = { requests: controlRequests + 1, providerCalls: 1, sorftimeCalls: 1 };
    const common = { collectedAt: at, providerCalls: 1, usage, controlRequests, dataRequests: 1, sourceTool: selected.name };
    if (request.op === 'categories') {
      const categories = categoryRows(value, request);
      return { ...common, categories, empty: !categories.length, message: categories.length ? `来源实际返回${categories.length}个类目；保留ID、路径与国家` : '来源未返回可识别的真实类目ID和名称，未生成关键词假类目' };
    }
    if (request.op === 'history') {
      try {
        const series = historySeries(value, request, at);
        return { ...common, series, empty: series.points.length === 0, message: series.points.length ? `保存${series.points.length}个来源${series.period === 'month' ? '自然月' : '逐日'}数据点；不补造缺失窗口` : '来源未收录该商品可识别的历史，保持待积累' };
      } catch (error) { return { ...common, unsupported: true, message: safeError(error, token) }; }
    }
    let rows = productRows(value);
    if (request.op === 'detail' && !rows.length) rows = [value.data || value.Data || value];
    const normalized = rows.slice(0, 100).map((row) => normalizeProduct(row, request, at)).filter(Boolean);
    const products = request.op === 'search' && request.term ? normalized.filter((p) => matchesProductTerm(p, request.term)) : normalized;
    const report = value?.data || value?.Data || value;
    const aggregateOnly = !rows.length && ['category', 'bestsellers'].includes(request.op) && report && typeof report === 'object' && ['sales', 'sales_volume', 'monthly_sales', 'monthly_sale_volume', 'gmv', 'revenue', 'report', 'summary', 'aggregate'].some((key) => Object.hasOwn(report, key));
    if ((rows.length && !normalized.length) || aggregateOnly) return { ...common, products: [], unsupported: true, sourceReceipt: aggregateReceipt(value, request, selected.name, at, token), message: '来源返回了报告，但缺少可核验商品ID、标题或对应国家；未按标题拼造商品，仅保留有界聚合回执供核对' };
    if (request.op === 'detail') return { ...common, ...(products[0] ? { product: { ...products[0], ...(request.product ? { id: request.product.id } : {}) } } : {}), empty: !products.length, message: products.length ? '已保存真实商品详情，未返回字段保持未知' : '来源未收录该商品详情' };
    const inner = value.data || value.Data || value;
    const explicitMore = inner.has_more ?? inner.hasMore ?? value.has_more ?? value.hasMore;
    const nextCursor = inner.next_cursor ?? inner.nextCursor;
    const canPage = Object.keys(selected.inputSchema.properties || {}).some((key) => ['page', 'page_no', 'pageNo', 'page_index', 'cursor', 'page_token'].includes(key));
    return {
      ...common, products,
      hasMore: typeof explicitMore === 'boolean' ? explicitMore : Boolean(nextCursor) || (canPage && rows.length === 20),
      ...(nextCursor ? { nextCursor: String(nextCursor).slice(0, 1000) } : {}),
      pageFingerprint: hash(JSON.stringify(normalized.map((p) => [p.sourceProductId, p.sourceVariantId || p.resourceRaw?.variantId || '']))),
      empty: rows.length === 0, sourceRows: rows.length, rejected: normalized.length - products.length,
      message: `来源返回${rows.length}条，可识别商品${products.length}件；仅是本次来源样本，不代表指定周期全类目前100`,
    };
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- The raw provider cause can contain credentials and must not escape sanitization.
    throw new Error(safeError(error, token));
  }
}
