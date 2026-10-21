import { createHash } from 'node:crypto';

import { openAdsKey, scrapeRequest } from './ads-provider.mjs';
import { pool } from './database.mjs';
import {
  matchesProductTerm,
  number,
  publicUrl,
  text,
} from './platform-product-data.mjs';

const CONFIG_NAME = 'provider:scrapecreators:v1';

function first(...values) {
  return values.find(
    (value) => value !== undefined && value !== null && value !== '',
  );
}

function imageUrl(row) {
  const image = first(
    row.image,
    row.image_url,
    row.product_image,
    row.cover,
    row.images?.[0],
  );
  const value =
    typeof image === 'string' ? image : first(image?.url, image?.url_list?.[0]);
  return publicUrl(value || '', false) || undefined;
}

export function normalizeTikTokShopProduct(
  row,
  market,
  at = new Date().toISOString(),
) {
  const sourceProductId = String(
    first(row.product_id, row.productId, row.id, row.item_id) || '',
  ).trim();
  const title = text(first(row.title, row.product_name, row.name));
  if (!sourceProductId || !title) return null;
  const seller = first(row.seller, row.shop, row.shop_info) || {};
  const priceValue = first(
    row.price,
    row.sale_price,
    row.min_price,
    row.price_info?.sale_price,
    row.price_info?.price,
  );
  const parsedPrice = number(
    typeof priceValue === 'object'
      ? first(priceValue.value, priceValue.amount, priceValue.price)
      : priceValue,
  );
  const sourceUrl =
    publicUrl(
      first(row.product_url, row.url, row.share_url, row.canonical_url) || '',
      false,
    ) || '';
  const idHash = createHash('sha256')
    .update(`${market}|${sourceProductId}`)
    .digest('hex')
    .slice(0, 24);
  const image = imageUrl(row);
  const soldCount = number(
    first(row.sold_count, row.soldCount, row.sales, row.order_count),
  );
  const reviewCount = number(
    first(row.review_count, row.reviewCount, row.rating_count),
  );
  const rating = number(first(row.rating, row.rating_score, row.score));
  return {
    id: `${market}-platform-tiktok-shop-${idHash}`,
    title,
    brand:
      text(first(row.brand, row.brand_name, seller.name, seller.shop_name)) ||
      '品牌待确认',
    market,
    category: '待分类',
    form: '待识别',
    size: '平台未返回规格',
    price: parsedPrice || 0,
    currency:
      text(first(row.currency, row.currency_code, row.price_info?.currency)) ||
      { US: 'USD', MX: 'MXN', VN: 'VND' }[market],
    ingredient: '平台未返回可核验配方',
    dose: '平台未返回每份剂量',
    claim: '',
    benefits: [],
    benefitEvidence: '',
    ingredientInsights: [],
    siteId: '',
    color: '#f4efff',
    imageUrl: image,
    reviewed: false,
    favorite: false,
    firstSeenAt: at,
    lastCollectedAt: at,
    evidenceUrl: sourceUrl,
    sourceUrl,
    sourceProvider: 'ScrapeCreators',
    sourcePlatform: 'TikTok Shop',
    sourceProductId,
    dataNature: 'collected',
    collectionFields: [
      'title',
      ...(parsedPrice ? ['price'] : []),
      ...(image ? ['image'] : []),
      ...(soldCount === undefined ? [] : ['soldCountSnapshot']),
    ],
    sourceEvidence: [
      {
        provider: 'ScrapeCreators',
        platform: 'TikTok Shop',
        market,
        collectedAt: at,
        evidenceUrl: sourceUrl,
      },
    ],
    sourceMetrics: {
      collectedAt: at,
      ...(soldCount === undefined ? {} : { reportedSales: soldCount }),
      ...(reviewCount === undefined ? {} : { reviewCount }),
      ...(rating === undefined ? {} : { rating }),
      shopName: text(first(seller.name, seller.shop_name, row.shop_name)),
      salesMetricNature: '当前页面累计销量快照，不等同月销量或GMV',
    },
    decisionData: { series: [] },
  };
}

export function normalizeTikTokShopSearch(
  payload,
  market,
  at = new Date().toISOString(),
) {
  const container = payload?.data || payload?.result || payload;
  const rows = first(
    container?.products,
    container?.items,
    payload?.products,
    payload?.items,
  );
  if (!Array.isArray(rows))
    throw new Error('TikTok Shop 接口未返回商品数组，已停止以避免误报完成');
  const products = rows
    .map((row) => normalizeTikTokShopProduct(row, market, at))
    .filter(Boolean);
  if (rows.length > 0 && products.length === 0)
    throw new Error('TikTok Shop 返回字段已变化，未识别商品标识或标题');
  return {
    products,
    sourceRows: rows.length,
    total: number(
      first(
        container?.total_products,
        container?.total,
        payload?.total_products,
      ),
    ),
  };
}

export async function collectTikTokShop(request, overrides = {}) {
  let stored = overrides.config;
  if (!stored) {
    const result = await pool.query(
      'SELECT value FROM provider_configs WHERE name=$1',
      [CONFIG_NAME],
    );
    stored = result.rows[0]?.value;
  }
  if (!stored)
    throw new Error('请先在数据源与设置中配置 ScrapeCreators API Key');
  const key = overrides.key || openAdsKey(stored);
  const payload = await (overrides.scrapeRequest || scrapeRequest)(
    '/v1/tiktok/shop/search',
    {
      query: request.term,
      page: request.page || 1,
      region: request.market,
    },
    key,
    overrides.fetcher || fetch,
    'GET',
  );
  const normalized = normalizeTikTokShopSearch(payload, request.market);
  const products = normalized.products.filter((product) =>
    matchesProductTerm(product, request.term),
  );
  return {
    ...normalized,
    products,
    hasMore:
      normalized.products.length >= Math.min(20, request.limit || 20) &&
      (!normalized.total ||
        (request.page || 1) * normalized.products.length < normalized.total),
    providerCalls: 1,
    message: `TikTok Shop 返回${normalized.sourceRows}件，标题匹配并保存${products.length}件；销量字段按累计快照保存`,
  };
}
