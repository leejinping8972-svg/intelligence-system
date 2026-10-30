import {
  field,
  number,
  payload,
  publicUrl,
  records,
  text,
} from './platform-product-data.mjs';
import {
  normalizeSorftimeProduct,
  resourceClient,
  safeError,
  schemaValue,
} from './product-resource-sorftime.mjs';
import {
  dateInWindow,
  discoveryDay,
  stableId,
} from './discovery-monitor-domain.mjs';

const aliases = {
  query: [
    'search_name',
    'attribute_name',
    'keyword',
    'query',
    'name',
    'category_name',
    'search',
    'search_keyword',
    'topic',
  ],
  market: [
    'amz_site',
    'site',
    'country',
    'region',
    'country_code',
    'shopee_site',
    'tiktok_site',
    'temu_site',
    'market',
  ],
  start: [
    'online_date_range_min',
    'sale_time_min',
    'exposure_time_min',
    'start_date',
    'startDate',
    'listing_date_start',
    'launch_date_start',
    'online_date_start',
    'date_from',
    'after',
  ],
  end: [
    'online_date_range_max',
    'sale_time_max',
    'exposure_time_max',
    'end_date',
    'endDate',
    'listing_date_end',
    'launch_date_end',
    'online_date_end',
    'date_to',
    'before',
  ],
  page: ['page', 'page_no', 'pageNo', 'page_index'],
  limit: ['page_size', 'pageSize', 'limit', 'count', 'num_results'],
  url: ['url', 'post_url', 'question_url', 'permalink', 'link'],
  id: ['reddit_id', 'quora_id', 'post_id', 'question_id', 'id'],
};
const socialNames = new Set([
  'reddit_post_search',
  'reddit_comment_request',
  'quora_question_search',
  'quora_answer_request',
]);
function productChannel(tool) {
  if (
    !/product/i.test(tool.name) ||
    !/search|new|launch|listing/i.test(tool.name) ||
    /trend|review|comment|ads|advertis|image|history|traffic/i.test(tool.name)
  )
    return;
  const match = /^(.*?)product/.exec(tool.name);
  if (!match) return;
  return (
    match[1].replace(/_$/, '').replace(/^amazon$|^amz$/, 'amazon') || 'amazon'
  );
}
export function discoveryCatalogue(tools) {
  const channels = [...new Set(tools.map(productChannel).filter(Boolean))].map(
    (id) => ({
      id,
      name:
        {
          amazon: 'Amazon',
          tiktok: 'TikTok Shop',
          tiktok_shop: 'TikTok Shop',
          shopee: 'Shopee',
          temu: 'Temu',
          walmart: 'Walmart',
          ali1688: '1688（中国货源）',
        }[id] || id,
      tools: tools.filter((t) => productChannel(t) === id).map((t) => t.name),
      markets: [
        ...new Set(
          tools
            .filter((t) => productChannel(t) === id)
            .flatMap((t) =>
              aliases.market.flatMap(
                (k) => t.inputSchema?.properties?.[k]?.enum || [],
              ),
            ),
        ),
      ].filter((m) => /^[A-Z]{2}$/.test(m)),
      sourceMarket:
        id === 'ali1688' ? 'CN' : id === 'walmart' ? 'US' : undefined,
    }),
  );
  return {
    channels,
    social: ['reddit', 'quora'].map((id) => ({
      id,
      supported: tools.some(
        (t) =>
          t.name === `${id}_${id === 'reddit' ? 'post' : 'question'}_search`,
      ),
      details: tools.some(
        (t) =>
          t.name === `${id}_${id === 'reddit' ? 'comment' : 'answer'}_request`,
      ),
    })),
    discoveredAt: new Date().toISOString(),
  };
}
function buildArguments(tool, request) {
  const schema = tool.inputSchema;
  if (
    !schema ||
    schema.type !== 'object' ||
    schema.$ref ||
    schema.anyOf ||
    schema.oneOf ||
    schema.allOf
  )
    throw new Error('工具参数结构尚未适配');
  const properties = schema.properties || {};
  const args = {};
  const set = (names, value) => {
    const key = names.find((name) => properties[name]);
    if (key && value !== undefined)
      args[key] = schemaValue(value, properties[key], key);
    return key;
  };
  if (!request.social) {
    const key = aliases.market.find((name) =>
      properties[name]?.enum?.some(
        (v) => String(v).toUpperCase() === request.market,
      ),
    );
    if (!key && !['walmart', 'ali1688'].includes(request.channel))
      throw new Error('来源未明确支持此市场');
    if (request.channel === 'walmart' && request.market !== 'US')
      throw new Error('Walmart工具仅提供美国来源，未替代所选市场');
    if (key)
      set(
        [key],
        properties[key].enum.find(
          (v) => String(v).toUpperCase() === request.market,
        ),
      );
  }
  const queryKey = !request.detail && set(aliases.query, request.topic);
  if (
    !request.detail &&
    !queryKey &&
    !request.categoryLookup &&
    !request.nodeId &&
    !aliases.start.some((k) => properties[k]) &&
    !/new|launch|listing/i.test(tool.name)
  )
    throw new Error('来源不支持话题或新品查询');
  set(['node_id', 'category_id'], request.nodeId);
  if (request.detail) {
    if (
      request.channel === 'reddit' &&
      !/^t3_[a-z\d]+$/i.test(request.record?.sourceId || '')
    )
      throw new Error('Reddit帖子ID必须是来源返回的t3_编号');
    if (
      request.channel === 'quora' &&
      !/^\d+$/.test(request.record?.sourceId || '')
    )
      throw new Error('Quora问题ID必须是来源返回的数字编号');
    if (
      !set(aliases.url, request.record?.url) &&
      !set(aliases.id, request.record?.sourceId)
    )
      throw new Error('来源详情参数尚未适配');
  }
  const now = request.now || Date.now();
  set(aliases.start, discoveryDay(now - (request.days - 1) * 86400_000));
  set(aliases.end, discoveryDay(now));
  set(aliases.page, request.page || 1);
  set(aliases.limit, 20);
  const sort = ['sort', 'sort_by', 'sortBy', 'order'].find(
    (k) => properties[k]?.enum,
  );
  if (sort) {
    const value = properties[sort].enum.find((v) =>
      /^(new|newest|recent|date|launch_date_desc|online_date_desc|listing_date_desc)$/i.test(
        String(v),
      ),
    );
    if (value !== undefined) set([sort], value);
  }
  const fulfillment = [
    'fulfillment',
    'fulfillment_type',
    'fulfillmentType',
    'shipping_type',
    'delivery_type',
  ].find(
    (k) =>
      properties[k]?.enum?.includes('FBM') ||
      (k === 'shipping_type' && tool.name === 'product_search'),
  );
  if (fulfillment && request.kind === 'fbm_new') set([fulfillment], 'FBM');
  if (tool.name === 'temu_product_search')
    for (const key of ['node_id', 'brand', 'seller_name'])
      if (properties[key] && args[key] === undefined) set([key], '');
  for (const key of schema.required || [])
    if (args[key] === undefined) {
      if (properties[key]?.default !== undefined)
        args[key] = schemaValue(properties[key].default, properties[key], key);
      else throw new Error(`工具必填参数${key}尚未适配，未调用数据工具`);
    }
  return args;
}
const listingKeys = [
  'online_date',
  'onlineDate',
  'launchDate',
  'launch_date',
  'listingDate',
  'listing_date',
  'dateFirstAvailable',
  'date_first_available',
  'listed_at',
  'published_at',
  'sale_time',
];
function sourceDate(value) {
  if (typeof value === 'string' && /^\d{10,13}$/.test(value))
    value = Number(value);
  if (typeof value === 'number') {
    const d = new Date(value < 1e12 ? value * 1000 : value);
    if (!Number.isFinite(d.getTime())) return '';
    value = d.toISOString();
  }
  return typeof value === 'string'
    ? value.replaceAll('/', '-').slice(0, 10)
    : '';
}
export function normalizeDiscoveryProduct(row, request, at) {
  const targetMarket = request.market;
  request = { ...request, market: request.sourceMarket || request.market };
  row = { ...row, ...row.product_info };
  row.title ||= field(
    row,
    'product_name',
    'productName',
    'product_title',
    'name',
    'Name',
  );
  const platform =
    request.channel === 'tiktok' ? 'tiktok_shop' : request.channel;
  let product;
  if (['amazon', 'tiktok_shop', 'shopee', 'temu'].includes(platform))
    product = normalizeSorftimeProduct(
      row,
      { ...request, platform, op: 'search' },
      at,
    );
  else {
    const id = field(
      row,
      'product_id',
      'productId',
      'item_id',
      'offer_id',
      'asin',
      'id',
    );
    const title = text(
      field(row, 'title', 'name', 'product_name', 'productName', 'subject'),
    );
    const canonical = /^\d+$/.test(String(id))
      ? platform === 'ali1688'
        ? `https://detail.1688.com/offer/${id}.html`
        : platform === 'walmart'
          ? `https://www.walmart.com/ip/${id}`
          : ''
      : '';
    const url = publicUrl(
      field(row, 'url', 'product_url', 'link') || canonical,
      false,
    );
    if (id && title && url)
      product = {
        id: `${request.market}-sorftime-${stableId(`${platform}|${id}`)}`,
        sourceProductId: String(id),
        title,
        market: request.market,
        sourceMarket: platform === 'ali1688' ? 'CN' : request.market,
        sourceUrl: url,
        evidenceUrl: url,
        sourcePlatform:
          platform === 'ali1688'
            ? '1688'
            : platform === 'walmart'
              ? 'Walmart'
              : platform,
        sourceProvider: 'Sorftime',
        dataNature: 'collected',
        price: 0,
        collectionFields: ['title'],
        sourceContent: {
          descriptions: [text(row.description)],
          attributes: row.attributes || {},
          rawFields: {
            ...(typeof row.ingredients === 'string'
              ? { ingredients: row.ingredients }
              : {}),
          },
        },
      };
  }
  if (!product) return;
  product.sourceMarket = request.channel === 'ali1688' ? 'CN' : request.market;
  product.market = targetMarket;
  if (['ali1688', 'walmart'].includes(platform)) {
    const price = number(
      field(row, 'price', 'sale_price', 'dropshipping_price'),
    );
    if (price !== undefined) {
      product.price = price;
      product.collectionFields.push('price');
    }
    product.currency = platform === 'ali1688' ? 'CNY' : 'USD';
    product.brand = text(row.brand) || '品牌待确认';
    product.imageUrl =
      publicUrl(field(row, 'image', 'image_url', 'imageUrl'), false) ||
      undefined;
  }
  product.sourceContent = {
    ...product.sourceContent,
    rawFields: {
      ...product.sourceContent?.rawFields,
      ...Object.fromEntries(
        ['ingredients', 'Ingredients', 'servingSize', 'serving_size']
          .filter((k) => typeof row[k] === 'string')
          .map((k) => [k, row[k]]),
      ),
    },
  };
  const raw = { ...row, ...row.product_info };
  const dateKey = listingKeys.find((key) => raw[key] !== undefined);
  const date = product.decisionData?.listing?.date || sourceDate(raw[dateKey]);
  if (dateInWindow(date, 36500, Date.parse(at)))
    product.decisionData = {
      ...product.decisionData,
      listing: {
        date,
        sourceField: dateKey || 'listingDate',
        provider: 'Sorftime',
        collectedAt: at,
        evidenceUrl: product.sourceUrl,
        sourceMarket: product.sourceMarket || request.market,
      },
    };
  const delivery = field(
    raw,
    'fulfillment',
    'fulfillment_type',
    'fulfillmentType',
    'shipping_type',
    'shippingType',
    'delivery_type',
    'deliveryType',
    'fba_or_fbm',
  );
  const fulfillment =
    /^(FBM|MFN|merchant fulfilled|fulfilled by merchant)$/i.test(
      String(delivery).trim(),
    )
      ? 'FBM'
      : /^FBA$/i.test(String(delivery).trim())
        ? 'FBA'
        : undefined;
  product.resourceRaw = {
    ...product.resourceRaw,
    ...(fulfillment ? { fulfillment, fulfillmentRaw: String(delivery) } : {}),
  };
  return product;
}
export function normalizeSocialRows(value, request, at) {
  return discoveryRows(value)
    .slice(0, 100)
    .flatMap((row) => {
      const url = publicUrl(
        field(row, 'url', 'permalink', 'link', 'post_url', 'question_url') ||
          request.record?.url,
        false,
      );
      const sourceId = String(
        field(
          row,
          'reddit_id',
          'quora_id',
          'id',
          'post_id',
          'question_id',
          'comment_id',
          'answer_id',
        ) || '',
      );
      const body = text(
        field(
          row,
          'body',
          'text',
          'content',
          'selftext',
          'answer',
          'description',
          'post_content',
          'comment_content',
          'answer_content',
        ),
      );
      const title = text(
        field(
          row,
          'title',
          'question',
          'question_text',
          'post_title',
          'question_title',
        ),
      );
      const publishedAt = sourceDate(
        field(
          row,
          'published_at',
          'created_at',
          'created_utc',
          'publish_time',
          'post_time',
          'created_time',
          'date',
          'time',
        ),
      );
      if (
        !url ||
        (!body && !title) ||
        !dateInWindow(publishedAt, request.days, request.now)
      )
        return [];
      const host = new URL(url).hostname;
      if (
        !host.endsWith(`.${request.channel}.com`) &&
        host !== `${request.channel}.com`
      )
        return [];
      return [
        {
          id: stableId(`${request.channel}|${sourceId}|${url}|${body}`),
          sourceId,
          platform: request.channel,
          url,
          title,
          text: body,
          publishedAt,
          collectedAt: at,
          topic: request.topic,
          detail: request.detail === true,
        },
      ];
    });
}
function discoveryRows(value, depth = 0) {
  if (depth > 8) return [];
  const rows = records(value);
  if (rows.length) return rows;
  for (const key of [
    'posts',
    'comments',
    'questions',
    'answers',
    'products',
    'data',
    'Data',
    'result',
  ])
    if (value?.[key]) {
      if (Array.isArray(value[key])) return value[key];
      const nested = discoveryRows(value[key], depth + 1);
      if (nested.length) return nested;
    }
  return [];
}
export async function discoverySorftime(request, overrides = {}) {
  const { client, token, controlRequests } = await resourceClient(overrides);
  if (request.op === 'catalogue') return discoveryCatalogue(client.tools || []);
  const categoryName =
    request.channel === 'amazon'
      ? 'category_name_search'
      : `${request.channel}_category_${request.channel === 'ali1688' ? 'tree' : 'search_from_name'}`;
  const tools = (client.tools || []).filter((tool) =>
    request.categoryLookup
      ? tool.name === categoryName
      : request.social
        ? socialNames.has(tool.name) &&
          tool.name ===
            `${request.channel}_${request.detail ? (request.channel === 'reddit' ? 'comment_request' : 'answer_request') : request.channel === 'reddit' ? 'post_search' : 'question_search'}`
        : productChannel(tool) === request.channel,
  );
  let chosen, args, failure;
  const score = (tool) =>
    aliases.start.some((k) => tool.inputSchema?.properties?.[k])
      ? 2
      : /new|launch|listing/.test(tool.name)
        ? 3
        : 0;
  for (const tool of tools.toSorted((a, b) => score(b) - score(a))) {
    try {
      args = buildArguments(tool, {
        ...request,
        market: request.sourceMarket || request.market,
      });
      chosen = tool;
      break;
    } catch (error) {
      failure = error;
    }
  }
  if (!chosen)
    throw new Error(failure?.message || '账户没有开放可用的此渠道工具');
  let value;
  try {
    value = payload(
      await client.rpc('tools/call', { name: chosen.name, arguments: args }),
    );
  } catch (error) {
    throw new Error(safeError(error, token));
  }
  const usage = {
    sorftimeCalls: 1,
    providerCalls: 1,
    requests: controlRequests() + 1,
  };
  const at = new Date(request.now || Date.now()).toISOString();
  const rows = discoveryRows(value);
  const inner = value.data || value;
  if (request.categoryLookup) {
    const categories = [];
    let visited = 0;
    const walk = (node, depth = 0) => {
      if (!node || typeof node !== 'object' || depth > 10 || ++visited > 3000)
        return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item, depth + 1);
        return;
      }
      const id = field(
        node,
        'node_id',
        'nodeId',
        'NodeId',
        'NodeID',
        'category_id',
        'id',
      );
      const name = text(
        field(node, 'node_name', 'nodeName', 'Name', 'name', 'category_name'),
      );
      if (
        id &&
        /supplement|nutrition|vitamin|health|膳食|营养|保健|维生素/i.test(name)
      )
        categories.push({ id: String(id), name });
      for (const child of Object.values(node))
        if (child && typeof child === 'object') walk(child, depth + 1);
    };
    walk(value);
    return {
      categories: categories.slice(0, 3),
      sourceRows: categories.length,
      sourceTool: chosen.name,
      usage,
      collectedAt: at,
    };
  }
  return {
    ...(request.social
      ? { records: normalizeSocialRows(value, request, at) }
      : {
          products: rows
            .slice(0, 100)
            .map((row) => normalizeDiscoveryProduct(row, request, at))
            .filter(Boolean),
        }),
    sourceRows: rows.length,
    sourceTool: chosen.name,
    hasMore:
      inner.has_more === true ||
      inner.hasMore === true ||
      (rows.length === 20 &&
        Object.keys(args).some((key) => aliases.page.includes(key))),
    usage,
    collectedAt: at,
  };
}
