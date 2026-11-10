import { productAmazonUrl } from './product-asin.mjs';

const clean = (value) =>
  typeof value === 'string' ? value.trim().slice(0, 500) : '';

// Seller is a source fact. Never substitute the brand, manufacturer or shipper.
export function sourceSellerName(row) {
  const names = [
    'sellerName',
    'seller_name',
    'SellerName',
    'soldBy',
    'sold_by',
    'SoldBy',
    'shopName',
    'shop_name',
    'ShopName',
  ];
  for (const key of names) {
    const name = clean(row?.[key]);
    if (name) return name;
  }
  for (const key of [
    'seller',
    'Seller',
    'seller_info',
    'sellerInfo',
    'shop',
    'shop_info',
  ]) {
    const seller = row?.[key];
    const name =
      clean(seller) ||
      names.map((key) => clean(seller?.[key])).find(Boolean) ||
      clean(seller?.name);
    if (name) return name;
  }
  return '';
}

export function productSellerName(product) {
  return (
    clean(product?.sellerName) ||
    sourceSellerName(product?.resourceRaw) ||
    clean(product?.sourceMetrics?.shopName) ||
    clean(product?.resourceEvidence?.identity?.shopName) ||
    ''
  );
}

export const sellerNameKey = (value) =>
  clean(value).normalize('NFKC').replaceAll(/\s+/g, ' ').toLowerCase();
export const normalizeSellerId = (value) =>
  /^[A-Z0-9]{10,20}$/.test(clean(value)) ? clean(value) : '';

export function sourceSellerId(row) {
  for (const source of [
    row,
    row?.seller,
    row?.seller_info,
    row?.sellerInfo,
    row?.shop,
    row?.shop_info,
  ]) {
    for (const key of [
      'sellerId',
      'seller_id',
      'SellerId',
      'SellerID',
      'shopId',
      'shop_id',
      'merchant_id',
    ]) {
      const id = normalizeSellerId(source?.[key]);
      if (id) return id;
    }
  }
  return '';
}

export function productSellerId(product) {
  if (
    product?.sourcePlatform &&
    product.sourcePlatform.trim().toLowerCase() !== 'amazon'
  )
    return '';
  if (Object.hasOwn(product || {}, 'sellerId'))
    return normalizeSellerId(product.sellerId);
  return sourceSellerId(product?.resourceRaw);
}

export function productSellerDetails(product) {
  const details = product?.sellerDetails;
  if (
    !details ||
    product?.sourcePlatform?.toLowerCase() !== 'amazon' ||
    details.market !== (product.sourceMarket || product.market) ||
    sellerNameKey(details.sellerName) !==
      sellerNameKey(productSellerName(product)) ||
    (productSellerId(product) && details.sellerId !== productSellerId(product))
  )
    return undefined;
  return details;
}

export function productSellerUrl(product) {
  const id = productSellerId(product);
  const url = productAmazonUrl(product);
  return id && url ? `${new URL(url).origin}/sp?seller=${id}` : '';
}
