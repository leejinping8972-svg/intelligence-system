import { publicProductUrl } from './product-public-enrichment.mjs';

export const trendTypes = ['AsinSalesVolume', 'Rank', 'ReviewCount'];
export const completionKey = (work) =>
  work.op === 'trend'
    ? `trend_${work.trendType || 'AsinSalesVolume'}`
    : work.op;
export function productCompletionWork(product, input, term = '') {
  if (input.mode === 'enrich' && input.publicCompletionVersion === 1 && publicProductUrl(product))
    return [{ provider: 'public_product', op: 'public_detail', productId: product.id, term }];
  if (
    product.sourceProvider !== 'Sorftime' ||
    !/^[A-Z0-9]{10}$/.test(product.sourceProductId || '') ||
    !['US', 'MX'].includes(product.market)
  )
    return [];
  return [
    ...(input.enrich ? ['detail', 'content'].map((op) => ({ op })) : []),
    ...(input.trend
      ? (input.completeAll ? trendTypes : ['AsinSalesVolume']).map(
          (trendType) => ({ op: 'trend', trendType }),
        )
      : []),
  ].map((work) => ({
    provider: 'sorftime',
    productId: product.id,
    term,
    ...work,
  }));
}
export function unsupportedCompletion(product, jobId, at) {
  return {
    status: 'unsupported',
    jobId,
    at,
    message:
      product.sourceProvider === 'Semrush'
        ? '当前 Semrush PLA 报告提供商品广告快照，不提供该 SKU 的历史销量；不能把关键词趋势替代为商品销量。'
        : '该商品没有可核验的 Amazon ASIN，不能把同名商品历史直接套用；需要先关联平台商品标识。',
  };
}
export function completionProgress(checkpoint) {
  const rows = Object.entries(checkpoint.completion || {}).map(
    ([id, steps]) => {
      const values = Object.values(steps);
      let status = 'completed';
      if (values.every((v) => v.status === 'unsupported'))
        status = 'unsupported';
      if (
        values.some((v) =>
          ['failed', 'unknown', 'cancelled'].includes(v.status),
        )
      )
        status = 'partial';
      if (values.some((v) => ['queued', 'running'].includes(v.status)))
        status = 'running';
      return { id, steps, status };
    },
  );
  return {
    total: rows.length,
    done: rows.filter((r) => r.status !== 'running').length,
    withHistory: rows.filter((r) =>
      Object.entries(r.steps).some(
        ([key, value]) => key.startsWith('trend_') && value.points > 0,
      ),
    ).length,
    pending: rows.filter((r) => r.status === 'running').length,
    failed: rows.filter((r) => r.status === 'partial').length,
    unsupported: rows.filter((r) => r.status === 'unsupported').length,
  };
}
