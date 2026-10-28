export const isWestmonth = (site) => String(site.domain).toLowerCase().replace(/^www\./, '') === 'westmonth.com';
export const westmonthEntry = (newOnly = false) =>
  `https://www.westmonth.com/products/${newOnly ? 'ranking?ranking_type=new&' : 'all?'}page=1`;

export function isWestmonthCatalog(url, site) {
  if (!isWestmonth(site)) return false;
  const parsed = new URL(url);
  return ['westmonth.com', 'www.westmonth.com'].includes(parsed.hostname) &&
    ['/products/all', '/products/ranking'].includes(parsed.pathname);
}

// The public site makes this GET without cookies or an access token.
export async function fetchWestmonthCatalog(url, site, fetchPage) {
  if (!isWestmonthCatalog(url, site)) throw new Error('不是西之月公开商品目录');
  const parsed = new URL(url);
  const page = Number(parsed.searchParams.get('page') || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000) throw new Error('公开目录页码无效');
  const newOnly = parsed.pathname === '/products/ranking';
  const api = new URL('https://api-x.westmonth.com/product-center/shop/products/load-list');
  api.search = new URLSearchParams({ page: String(page), pagesize: '60', source: newOnly ? 'rankings' : 'all_products', onlyShow: '1', locale: 'zh_cn', ...(newOnly ? { ranking_type: 'new' } : {}) }).toString();
  const response = await fetchPage(api.toString(), 0, ['application/json'], { allowedDomain: 'westmonth.com' });
  const body = JSON.parse(response.html);
  const data = body.data;
  if (body.code !== 0 || !Array.isArray(data?.data) || !Number.isSafeInteger(data.total) || data.total < 0 || Number(data.page) !== page || Number(data.pagesize) !== 60)
    throw new Error('西之月公开目录返回异常，未建立完整基线');
  if (data.total > 0 && !data.data.length && (page - 1) * 60 < data.total)
    throw new Error('西之月公开目录分页缺失，未建立完整基线');
  const products = data.data.map((row) => {
    const id = String(row.product_id || '');
    if (!/^\d{1,20}$/.test(id) || typeof row.product_name !== 'string' || !row.product_name.trim())
      throw new Error('西之月目录含无效商品记录，未跳过缺失记录');
    const price = row.member_price || row.base_price;
    const image = typeof row.product_image === 'string' && /^https:\/\//.test(row.product_image) ? row.product_image : undefined;
    return {
      title: row.product_name.trim(), url: `https://www.westmonth.com/products/${id}`,
      sku: String(row.product_sku || ''), brand: typeof row.product_brand === 'string' ? row.product_brand : '品牌未公开',
      image, description: typeof row.category_path === 'string' ? row.category_path : '',
      ...(typeof price === 'string' && price.trim() && Number.isFinite(Number(price)) && row.price_currency ? { price: Number(price), currency: row.price_currency } : {}),
      extractionMethod: '西之月公开商品目录',
      catalogEvidenceUrl: api.toString(), catalogScope: newOnly ? '官网公开新品榜' : '官网公开全部商品目录',
      catalogListedAtRaw: typeof row.product_addtime === 'string' ? row.product_addtime : '',
      catalogProductMetrics: { product_addtime: row.product_addtime, month_sale: row.month_sale },
      collectionFields: ['title', ...(image ? ['image'] : [])],
    };
  });
  let next = '';
  if (page * 60 < data.total) {
    const nextUrl = new URL(newOnly ? westmonthEntry(true) : westmonthEntry());
    nextUrl.searchParams.set('page', String(page + 1));
    next = nextUrl.toString();
  }
  return { html: '', url, catalogProducts: products, catalogLinks: next ? [next] : [], catalogEvidenceUrl: api.toString(), catalogTotal: data.total };
}
