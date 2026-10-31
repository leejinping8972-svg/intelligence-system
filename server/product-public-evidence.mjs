export const publicEvidenceReasons = {
  not_publicly_provided: '官网未公开该字段',
  unsupported_product_url: '缺少可核验的官网商品链接',
  rate_limited: '官网限流，本次未取得完整数据',
  request_failed: '官网访问失败，本次未取得完整数据',
  product_redirect_mismatch: '页面跳转后无法确认仍是同一商品',
  product_response_mismatch: '返回页面与请求商品不一致',
  invalid_product_json: '官网商品数据格式无法识别',
  conflicting_public_values: '公开来源字段相互冲突，需核实',
  request_limit: '请求预算已用完，未完成字段核验',
  page_limit: '达到页面上限，未完成字段核验',
  redirect_limit: '页面连续跳转过多，未完成字段核验',
};
export function publicEvidenceReason(reason) {
  return publicEvidenceReasons[reason] || '未取得可核验的公开字段';
}
export function publicEvidenceStatus(reason) {
  if (reason === 'not_publicly_provided') return 'not_disclosed';
  if (['request_limit', 'page_limit'].includes(reason)) return 'budget_limited';
  if (reason === 'unsupported_product_url') return 'unsupported';
  if (['rate_limited', 'request_failed', 'product_redirect_mismatch', 'product_response_mismatch', 'invalid_product_json'].includes(reason)) return 'failed';
  return 'unverified';
}
