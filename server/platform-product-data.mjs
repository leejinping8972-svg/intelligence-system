import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export const text = (value) =>
  typeof value === 'string' ? value.trim().slice(0, 12_000) : '';
export function field(row, ...names) {
  for (const name of names)
    if (row?.[name] !== undefined && row[name] !== null && row[name] !== '')
      return row[name];
}
export function number(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (
    typeof value === 'string' &&
    !/^\d+(?:,\d{3})*(?:\.\d+)?$/.test(value.trim())
  )
    return undefined;
  const n = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
export function payload(result) {
  if (result?.isError)
    throw new Error(
      `平台工具返回错误：${(result.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .slice(0, 300)}；未自动重复收费请求`,
    );
  let value = result?.structuredContent;
  if (!value) {
    for (const block of result?.content || []) {
      if (block.type !== 'text') continue;
      try {
        value = JSON.parse(block.text);
        break;
      } catch {}
    }
  }
  if (!value || typeof value !== 'object')
    throw new Error('平台返回格式无法识别，未编造商品或指标');
  if (
    value.success === false ||
    value.Success === false ||
    (value.code && ![0, 200, '0', '200'].includes(value.code))
  )
    throw new Error('平台未返回成功结果，请核对权限、余额及查询条件');
  return value;
}
export function records(value, depth = 0) {
  if (depth > 8) return [];
  if (typeof value === 'string') {
    try {
      return records(JSON.parse(value), depth + 1);
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  for (const key of [
    'data',
    'Data',
    'items',
    'Items',
    'list',
    'List',
    'rows',
    'Rows',
    'products',
    'Products',
    'result',
    'Result',
    'results',
    'Results',
  ]) {
    if (Array.isArray(value?.[key])) return value[key];
    if (value?.[key] && ['object', 'string'].includes(typeof value[key])) {
      const nested = records(value[key], depth + 1);
      if (nested.length > 0) return nested;
    }
  }
  return [];
}
export function publicUrl(value, secure = true) {
  try {
    const u = new URL(value);
    if (
      !(secure ? ['https:'] : ['https:', 'http:']).includes(u.protocol) ||
      u.username ||
      u.password ||
      isIP(u.hostname.replaceAll(/^\[|\]$/g, '')) ||
      !u.hostname.includes('.') ||
      /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname)
    )
      return '';
    u.hash = '';
    for (const k of [...u.searchParams.keys()])
      if (/^utm_|^(gclid|fbclid)$/i.test(k)) u.searchParams.delete(k);
    return u.href;
  } catch {
    return '';
  }
}
const hash = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
const amazonHosts = { US: 'www.amazon.com', MX: 'www.amazon.com.mx' };
export function sourceContext(provider, market, at, url) {
  return {
    provider,
    platform: provider === 'Sorftime' ? 'Amazon' : 'Google Shopping',
    market,
    collectedAt: at,
    evidenceUrl: url,
  };
}
function baseProduct(context, key, row, title, url) {
  const parsedPrice = number(
    field(
      row,
      'price',
      'Price',
      'productPrice',
      'ProductPrice',
      'Product Price',
      'Pr',
    ),
  );
  const price = parsedPrice > 0 ? parsedPrice : undefined;
  return {
    id: `${context.market}-platform-${context.provider.toLowerCase()}-${hash(key)}`,
    title,
    brand:
      text(field(row, 'brand', 'Brand', 'brandName', 'BrandName')) ||
      '品牌待确认',
    market: context.market,
    category: '待分类',
    form: '待识别',
    size: '平台未返回规格',
    price: price ?? 0,
    currency: { MX: 'MXN', VN: 'VND', US: 'USD' }[context.market],
    ingredient: '平台未返回可核验配方',
    dose: '平台未返回每份剂量',
    claim: '',
    benefits: [],
    benefitEvidence: '',
    ingredientInsights: [],
    siteId: '',
    color: '#edf2ff',
    reviewed: false,
    favorite: false,
    firstSeenAt: context.collectedAt,
    evidenceUrl: url,
    sourceUrl: url,
    sourceProvider: context.provider,
    sourcePlatform: context.platform,
    sourceProductId: key,
    dataNature: 'collected',
    collectionFields: ['title', ...(price === undefined ? [] : ['price'])],
    sourceEvidence: [context],
    sourceMetrics: { collectedAt: context.collectedAt },
    decisionData: { series: [] },
  };
}
export function normalizeAmazon(
  row,
  market,
  at = new Date().toISOString(),
  expectedAsin,
) {
  const asin = String(
    field(row, 'asin', 'Asin', 'ASIN') || expectedAsin || '',
  ).toUpperCase();
  if (
    !amazonHosts[market] ||
    !/^[A-Z0-9]{10}$/.test(asin) ||
    (expectedAsin && asin !== expectedAsin)
  )
    return null;
  const title = text(
    field(row, 'title', 'Title', 'productName', 'ProductName', 'name', 'Name'),
  );
  if (!title) return null;
  const url = `https://${amazonHosts[market]}/dp/${asin}`;
  const context = sourceContext('Sorftime', market, at, url);
  const p = baseProduct(context, asin, row, title, url);
  p.searchSubtitle = text(field(row, 'sub_title', 'subTitle', 'SubTitle'));
  const image = field(
    row,
    'imageUrl',
    'ImageUrl',
    'image',
    'Image',
    'mainImage',
    'MainImage',
    'main_image',
  );
  if (typeof image === 'string' && publicUrl(image)) {
    p.imageUrl = publicUrl(image);
    p.collectionFields.push('image');
  }
  for (const [key, aliases] of Object.entries({
    rating: [
      'rating',
      'Rating',
      'star',
      'Star',
      'score',
      'Score',
      'star_rating',
    ],
    reviewCount: [
      'reviewCount',
      'ReviewCount',
      'ratingsCount',
      'RatingsCount',
      'commentCount',
      'CommentCount',
      'review_count',
    ],
    monthlySales: [
      'monthlySales',
      'MonthlySales',
      'monthSalesVolume',
      'MonthSalesVolume',
      'monthly_sale_volume',
    ],
    reportedSales: ['salesVolume', 'SalesVolume'],
    salesRank: ['bsr', 'Bsr', 'rank', 'Rank'],
    platformPotential: ['potential_index'],
  })) {
    const n = number(field(row, ...aliases));
    if (n !== undefined) p.sourceMetrics[key] = n;
  }
  const listing = text(
    field(
      row,
      'launchDate',
      'LaunchDate',
      'onlineDate',
      'OnlineDate',
      'listingDate',
      'ListingDate',
      'dateFirstAvailable',
      'DateFirstAvailable',
      'online_date',
    ),
  ).slice(0, 10);
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(listing) &&
    Number.isFinite(Date.parse(listing)) &&
    listing <= at.slice(0, 10)
  )
    p.decisionData.listing = { ...context, date: listing };
  return p;
}
export function normalizeShopping(row, market, at = new Date().toISOString()) {
  const title = text(field(row, 'ad_title', 'Title', 'title', 'Tt'));
  const url = publicUrl(field(row, 'url', 'Url', 'Ur'), false);
  if (!title || !url) return null;
  const context = sourceContext('Semrush', market, at, url);
  const p = baseProduct(
    context,
    `pla-${hash(`${url}|${title}`)}`,
    row,
    title,
    url,
  );
  p.sourceMetrics.shopName = text(field(row, 'shop_name', 'Shop Name', 'Sn'));
  for (const [key, aliases] of Object.entries({
    keywordsCount: ['keywords_count', 'Number of Keywords', 'Pc'],
    position: ['position', 'Position', 'Po'],
    keywordVolume: ['volume', 'Search Volume', 'Nq'],
  })) {
    const n = number(field(row, ...aliases));
    if (n !== undefined) p.sourceMetrics[key] = n;
  }
  p.sourceMetrics.keyword = text(field(row, 'keyword', 'Keyword', 'Ph'));
  p.sourceMetrics.timestamp = field(row, 'timestamp', 'Timestamp', 'Ts');
  const stamp = number(p.sourceMetrics.timestamp);
  if (stamp && Number.isFinite(new Date(stamp * 1000).getTime()))
    p.sourceMetrics.observedAt = new Date(stamp * 1000).toISOString();
  p.sourceMetrics.urlKind =
    new URL(url).pathname === '/' ? 'merchant_landing' : 'listing_landing';
  // A single indexed snapshot is not a monthly sales history.
  return p;
}
export function matchesProductTerm(product, term) {
  const words = (value) =>
    String(value)
      .normalize('NFKD')
      .replaceAll(/\p{M}/gu, '')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) || [];
  const stem = (word) => {
    if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    return word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word;
  };
  const wanted = words(term)
    .filter(
      (w) =>
        ![
          'for',
          'with',
          'the',
          'and',
          'of',
          'a',
          'to',
          'in',
          'para',
          'con',
          'de',
          'el',
          'la',
        ].includes(w),
    )
    .map((word) => stem(word));
  const actual = new Set(
    words(`${product.title} ${product.searchSubtitle || ''}`).map((word) =>
      stem(word),
    ),
  );
  return wanted.length > 0 && wanted.every((w) => actual.has(w));
}
export function normalizeAmazonContent(value, product, at) {
  const row =
    records(value).find(
      (r) =>
        String(
          field(r, 'asin', 'ASIN', 'Asin') || product.sourceProductId,
        ).toUpperCase() === product.sourceProductId,
    ) ||
    value.data ||
    value.Data ||
    value;
  if (
    field(row, 'asin', 'ASIN', 'Asin') &&
    String(field(row, 'asin', 'ASIN', 'Asin')).toUpperCase() !==
      product.sourceProductId
  )
    throw new Error('商品详情 ASIN 不一致，未混入其他商品');
  const descriptions = [
    field(
      row,
      'description',
      'Description',
      'productDescription',
      'ProductDescription',
    ),
    field(
      row,
      'bulletPoints',
      'BulletPoints',
      'bulletPoint',
      'BulletPoint',
      'features',
      'Features',
    ),
  ]
    .flatMap((v) => {
      if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
      return typeof v === 'string' ? [v] : [];
    })
    .map((v) =>
      text(v)
        .replaceAll(/<br\s*\/?\s*>/gi, '\n')
        .replaceAll(/<[^>]*>/g, '')
        .replaceAll('&amp;', '&'),
    );
  const attributes = attributeTable(
    field(
      row,
      'property',
      'attributes',
      'Attributes',
      'attributeTable',
      'AttributeTable',
    ),
  );
  const patch = {
    sourceContent: {
      collectedAt: at,
      descriptions,
      attributes,
      productInfo: attributeTable(row.product_info),
    },
  };
  const image = field(
    row,
    'mainImages',
    'MainImages',
    'images',
    'Images',
    'imageUrls',
    'ImageUrls',
    'mainImage',
    'MainImage',
    'main_image',
  );
  const first = (Array.isArray(image) ? image : [image]).find(
    (v) => typeof v === 'string' && publicUrl(v),
  );
  if (first) patch.imageUrl = publicUrl(first);
  patch.imageUrls = (Array.isArray(image) ? image : [image])
    .filter((v) => typeof v === 'string' && publicUrl(v))
    .map((v) => publicUrl(v))
    .slice(0, 20);
  patch.sourceContent.aPlusImages = (
    Array.isArray(row.a_plus_images) ? row.a_plus_images : []
  )
    .filter((v) => typeof v === 'string' && publicUrl(v))
    .map((v) => publicUrl(v))
    .slice(0, 30);
  if (descriptions.length > 0) {
    patch.claim = descriptions
      .map((value) => text(value))
      .join('\n')
      .slice(0, 12_000);
    patch.benefitEvidence = `${product.sourceProvider} · ${product.sourcePlatform} 商品原文：${patch.claim}`;
  }
  const ingredient = text(
    field(row, 'ingredients', 'Ingredients', 'ingredient', 'Ingredient') ||
      attributes['Ingredients'] ||
      attributes['Special Ingredients'],
  );
  const dose = text(
    field(row, 'servingSize', 'ServingSize', 'serving_size') ||
      attributes['Serving Size'],
  );
  if (ingredient) patch.ingredient = ingredient;
  if (dose) patch.dose = dose;
  if (attributes['Item Form']) patch.form = attributes['Item Form'];
  if (attributes['Unit Count']) patch.size = attributes['Unit Count'];
  if (ingredient)
    patch.ingredientInsights = [
      {
        name: ingredient,
        amount: dose || '平台未返回含量',
        role: '平台商品属性提及，完整配方与含量待核验',
        evidence: `Sorftime · Amazon 属性原文：${ingredient}`,
      },
    ];
  patch.collectionFields = [
    ...new Set([
      ...(product.collectionFields || []),
      ...(patch.imageUrl ? ['image'] : []),
      ...(patch.claim ? ['description'] : []),
      ...(ingredient ? ['ingredients'] : []),
      ...(dose ? ['servingSize'] : []),
    ]),
  ];
  return patch;
}
export function normalizeAmazonTrend(
  value,
  product,
  at,
  trendType = 'AsinSalesVolume',
) {
  const metrics = {
    AsinSalesVolume: 'sales_volume',
    Rank: 'sales_rank',
    ReviewCount: 'review_count',
  };
  if (!metrics[trendType]) throw new Error('不支持的商品趋势口径');
  const points = [];
  const inner = value.data || value.Data || value;
  if (
    (inner.asin && inner.asin !== product.sourceProductId) ||
    (inner.type && inner.type !== trendType)
  )
    throw new Error('趋势商品或指标口径不一致，未混入其他ASIN或父体销量');
  const raw = records(value);
  const rows =
    raw.length > 0 && typeof raw[0] !== 'object'
      ? Array.from({ length: Math.floor(raw.length / 2) }, (_, i) => ({
          key: String(raw[i * 2]),
          value: raw[i * 2 + 1],
        }))
      : raw;
  let recognized = 0;
  for (const row of rows) {
    const key = String(
      Array.isArray(row)
        ? row[0]
        : field(row, 'key', 'Key', 'date', 'Date', 'month', 'Month') || '',
    );
    const rawNumber = Array.isArray(row)
      ? row[1]
      : field(row, 'value', 'Value', 'salesVolume', 'SalesVolume');
    const n = number(rawNumber);
    // Do not convert rolling daily observations into completed calendar months.
    const match = /^(\d{4})[-/]?(\d{2})(?:-01(?:T.*)?)?$/.exec(key);
    if (
      !match ||
      Number(match[2]) < 1 ||
      Number(match[2]) > 12
    )
      continue;
    if (n === undefined && ![-1, '-1', null].includes(rawNumber)) continue;
    recognized++;
    if (n === undefined) continue;
    const year = Number(match[1]),
      month = Number(match[2]);
    const start = `${match[1]}-${match[2]}-01`,
      end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    points.push({ start, end, value: n, partial: end >= at.slice(0, 10) });
  }
  if (raw.length > 0 && recognized === 0)
    throw new Error('平台返回了历史数据，但日期或数值结构无法识别；请检查字段，不能视为无历史');
  return {
    ...sourceContext('Sorftime', product.market, at, product.sourceUrl),
    productId: product.sourceProductId,
    metric: metrics[trendType],
    period: 'month',
    points,
    basis: {
      AsinSalesVolume: 'AsinSalesVolume：仅当前ASIN，不混合子变体',
      Rank: 'Rank：平台月度大类排名，数字降低表示位置改善，不等于销量',
      ReviewCount: 'ReviewCount：平台月度评论数，不等于销量',
    }[trendType],
  };
}
export function attributeTable(raw) {
  let value = raw;
  for (let i = 0; typeof value === 'string' && i < 3; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      try {
        value = JSON.parse(value.replaceAll(String.raw`\"`, '"'));
      } catch {
        return {};
      }
    }
  }
  if (!value || typeof value !== 'object') return {};
  if (!Array.isArray(value))
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => typeof v === 'string')
        .slice(0, 100)
        .map(([k, v]) => [text(k), text(v)]),
    );
  const entries = [];
  for (let i = 0; i + 1 < value.length && entries.length < 100; i += 2)
    if (typeof value[i] === 'string' && typeof value[i + 1] === 'string')
      entries.push([text(value[i]), text(value[i + 1])]);
  return Object.fromEntries(entries);
}
export function protectPlatformClientEdit(old, incoming) {
  if (!old?.sourceProvider || !old.sourceProductId)
    return old?.dataCompletion
      ? { ...incoming, dataCompletion: old.dataCompletion }
      : incoming;
  return {
    ...old,
    favorite:
      typeof incoming.favorite === 'boolean' ? incoming.favorite : old.favorite,
    reviewed:
      typeof incoming.reviewed === 'boolean' ? incoming.reviewed : old.reviewed,
  };
}
export function mergePlatformProduct(old, patch) {
  if (!old) return patch;
  const merged = {
    ...old,
    ...patch,
    favorite: old.favorite ?? false,
    reviewed: old.reviewed ?? false,
    firstSeenAt: old.firstSeenAt || patch.firstSeenAt,
  };
  for (const key of [
    'imageUrl',
    'claim',
    'ingredient',
    'dose',
    'benefitEvidence',
    'size',
    'brand',
    'category',
    'form',
  ]) {
    if (
      !patch[key] ||
      /^(平台未返回|品牌待确认|待分类|待识别)/.test(patch[key])
    )
      merged[key] = old[key] || patch[key];
  }
  if (
    patch.price === 0 &&
    !patch.collectionFields?.includes('price') &&
    old.price > 0
  )
    merged.price = old.price;
  for (const key of [
    'keywordIds',
    'queryTerms',
    'collectionFields',
    'sourceEvidence',
    'imageUrls',
  ])
    merged[key] = [
      ...new Map(
        [...(old[key] || []), ...(patch[key] || [])].map((v) => [
          JSON.stringify(v),
          v,
        ]),
      ).values(),
    ];
  merged.sourceEvidence = merged.sourceEvidence.slice(-100);
  merged.sourceMetrics = { ...old.sourceMetrics, ...patch.sourceMetrics };
  for (const key of ['benefits', 'ingredientInsights'])
    if (patch[key]?.length === 0 && old[key]?.length > 0)
      merged[key] = old[key];
  const series = new Map();
  for (const s of [
    ...(old.decisionData?.series || []),
    ...(patch.decisionData?.series || []),
  ]) {
    const key = [
      s.provider,
      s.platform,
      s.market,
      s.productId,
      s.metric,
      s.period,
    ].join(':');
    const previous = series.get(key);
    const points = [
      ...new Map(
        [...(previous?.points || []), ...s.points].map((p) => [p.start, p]),
      ).values(),
    ].toSorted((a, b) => a.start.localeCompare(b.start));
    series.set(key, { ...s, points });
  }
  merged.decisionData = {
    ...old.decisionData,
    ...patch.decisionData,
    listing: patch.decisionData?.listing || old.decisionData?.listing,
    series: [...series.values()],
  };
  merged.dataCompletion = { ...old.dataCompletion };
  for (const [key, state] of Object.entries(patch.dataCompletion || {})) {
    const current = merged.dataCompletion[key];
    if (
      !current?.jobId ||
      current.jobId === state.jobId ||
      state.status === 'queued'
    )
      merged.dataCompletion[key] = state;
  }
  return merged;
}
