// member_price is the official 折后价. Never substitute guide/base price or
// infer currency from a market; anonymous placeholders must remain missing.
export function westmonthPrice(row, { at, evidenceUrl } = {}) {
  const raw = row?.member_price;
  const currency =
    typeof row?.price_currency === 'string'
      ? row.price_currency.trim().toUpperCase()
      : '';
  if (
    !['number', 'string'].includes(typeof raw) ||
    (typeof raw === 'string' &&
      !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw.trim()))
  )
    return {};
  const value = Number(String(raw).replaceAll(',', '').trim());
  if (!(value > 0) || !Number.isFinite(value) || !/^[A-Z]{3}$/.test(currency))
    return {};
  return {
    price: value,
    currency,
    collectionFields: ['price'],
    priceEvidence: {
      raw: String(raw),
      kind: 'discount',
      sourceField: 'member_price',
      provider: '西之月官网',
      collectedAt: at,
      evidenceUrl,
      currency,
    },
  };
}
export async function fetchWestmonthSavedPrice(product, fetchPage, at) {
  let api;
  try {
    api = new URL(product.catalogEvidenceUrl);
    if (
      api.origin !== 'https://api-x.westmonth.com' ||
      api.pathname !== '/product-center/shop/products/load-list' ||
      api.username ||
      api.password
    )
      return {};
    const page = Number(api.searchParams.get('page'));
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 1000 ||
      api.searchParams.get('pagesize') !== '60'
    )
      return {};
    const source = api.searchParams.get('source');
    if (!['all_products', 'rankings'].includes(source)) return {};
    api.search = new URLSearchParams({
      page: String(page),
      pagesize: '60',
      source,
      onlyShow: '1',
      locale: 'zh_cn',
      ...(source === 'rankings' ? { ranking_type: 'new' } : {}),
    }).toString();
  } catch {
    return {};
  }
  let id;
  try {
    const productUrl = new URL(product.sourceUrl || product.evidenceUrl);
    if (
      productUrl.protocol !== 'https:' ||
      !['westmonth.com', 'www.westmonth.com'].includes(productUrl.hostname) ||
      productUrl.username ||
      productUrl.password
    )
      return {};
    id = /^\/products\/(\d{1,20})\/?$/.exec(productUrl.pathname)?.[1];
  } catch {
    return {};
  }
  if (!id) return {};
  const response = await fetchPage(api.href, 0, ['application/json'], {
    allowedDomain: 'westmonth.com',
    manualRedirect: true,
  });
  if (response.redirect || (response.url && response.url !== api.href))
    throw new Error('西之月价格目录跳转，未关联价格');
  const body = JSON.parse(response.html);
  if (body.code !== 0 || !Array.isArray(body.data?.data))
    throw new Error('西之月价格目录未返回可验证数据');
  const matches = body.data.data.filter((row) => String(row.product_id) === id);
  return matches.length === 1
    ? westmonthPrice(matches[0], { at, evidenceUrl: api.href })
    : {};
}
