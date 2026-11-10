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
