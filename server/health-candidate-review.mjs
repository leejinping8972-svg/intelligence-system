import { HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';
import { newProductEvidence } from './discovery-monitor-domain.mjs';
import { validateHealthProduct, healthProductDecision } from './health-product-domain.mjs';

// An explicit review of retained sources, never an automatic keyword approval.
// Callers retain the previous document and source receipts before applying it.
export function reviewHealthCandidate(candidate, original, plan, review) {
  const product = structuredClone(candidate.product);
  if (original.id !== product.id || original.sourceProductId !== product.sourceProductId ||
      original.market !== product.market) throw Error('候选与原始来源身份不一致');
  const current = product.resourceRaw?.salesEvidence;
  const restored = current == null && original.resourceRaw?.salesEvidence != null;
  if (restored) product.resourceRaw = { ...product.resourceRaw, salesEvidence: original.resourceRaw.salesEvidence };
  let classification = product.fieldAnalysis?.healthProduct;
  if (review?.classification) {
    if (!review.reviewer || !review.reason) throw Error('人工复核缺少负责人或理由');
    classification = validateHealthProduct(review.classification, {
      healthProductPolicy: HEALTH_PRODUCT_POLICY, url: product.sourceUrl || product.evidenceUrl,
      sources: product.fieldAnalysis?.sources || [],
    });
    product.fieldAnalysis = { ...product.fieldAnalysis, healthProduct: classification };
  }
  let decision = healthProductDecision({ healthProduct: classification }, candidate.powderOnly);
  const previousSales = original.resourceRaw?.salesEvidence;
  const sales = product.resourceRaw?.salesEvidence;
  const conflict = current != null && previousSales != null && current.value !== previousSales.value
    ? { original: previousSales, detail: current } : undefined;
  // A zero is a real observation. It must never be replaced by a positive list
  // value just to satisfy admission. Only an explicitly reviewed zero closes it.
  if (decision.status === 'accepted' && !newProductEvidence(product, plan, candidate.asOf)) {
    decision = review?.resolveZeroSales === true && review.reviewer && review.reason &&
      plan.requireSales && sales?.value === 0
      ? { status: 'excluded', reason: 'reviewed_sales_not_positive', salesEvidence: sales }
      : { status: 'pending', reason: 'listing_or_sales_evidence_changed' };
  }
  return { product, decision, restoredSalesEvidence: restored, ...(conflict ? { salesConflict: conflict } : {}) };
}
