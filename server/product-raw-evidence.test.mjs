/* oxlint-disable vitest/no-import-node-test -- Native server tests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { reviewHealthCandidate } from './health-candidate-review.mjs';
import { HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';

const evidence = { value: 5, provider: 'Synthetic', collectedAt: '2026-11-10T01:00:00Z', metric: 'monthly_sales_volume' };
const product = () => ({ id: 'synthetic', sourceProductId: 'B000000001', market: 'US',
  title: 'Synthetic dietary supplement', resourceRaw: { salesEvidence: evidence, fulfillment: 'FBM' },
  decisionData: { listing: { date: '2026-11-09' } }, fieldAnalysis: { healthProduct: { policy: HEALTH_PRODUCT_POLICY, status: 'accepted' },
    sources: [{ id: 'title', text: 'Synthetic dietary supplement' }, { id: 'description-0', text: 'Swallow two capsules daily for nutritional support.' }] } });
const plan = { days: 7, requireSales: true, kind: 'regular_new' };
const candidate = p => ({ product: p, asOf: Date.parse('2026-11-10T03:00:00Z'), powderOnly: false });

test('detail and content merges retain omitted sales proof and fulfillment without mutation', () => {
  const original = product(); const snapshot = structuredClone(original);
  const detail = mergePlatformProduct(original, { id: original.id, resourceRaw: { priceRaw: '20', shopId: 'new' } });
  const content = mergePlatformProduct(detail, { id: original.id, sourceContent: { descriptions: ['Body'] } });
  assert.deepEqual(content.resourceRaw.salesEvidence, evidence);
  assert.equal(content.resourceRaw.fulfillment, 'FBM'); assert.equal(content.resourceRaw.shopId, 'new');
  assert.deepEqual(original, snapshot);
});
test('explicit zero replaces the entire sales observation; missing/null never deletes old proof', () => {
  const zero = { value: 0, provider: 'Detail', collectedAt: 'later' };
  assert.deepEqual(mergePlatformProduct(product(), { resourceRaw: { salesEvidence: zero } }).resourceRaw.salesEvidence, zero);
  for (const missing of [undefined, null]) assert.deepEqual(mergePlatformProduct(product(), { resourceRaw: { salesEvidence: missing } }).resourceRaw.salesEvidence, evidence);
});
test('recover a missing receipt and reapply listing/sales eligibility', () => {
  const original = product(); const damaged = product(); delete damaged.resourceRaw.salesEvidence;
  const result = reviewHealthCandidate(candidate(damaged), original, plan);
  assert.equal(result.restoredSalesEvidence, true); assert.equal(result.decision.status, 'accepted');
  damaged.decisionData.listing.date = '2020-01-01';
  assert.equal(reviewHealthCandidate(candidate(damaged), original, plan).decision.status, 'pending');
  assert.throws(() => reviewHealthCandidate(candidate(damaged), { ...original, id: 'other' }, plan), /身份/);
});
test('manual evidence must be continuous retained text; invalid references remain pending', () => {
  const p = product();
  const classification = { kind: 'oral_supplement', route: 'oral', evidence: { sourceId: 'title', quote: 'dietary supplement' },
    usage: { sourceId: 'description-0', quote: 'Swallow two capsules daily' }, purpose: { sourceId: 'description-0', quote: 'nutritional support' } };
  const review = { reviewer: 'synthetic reviewer', reason: 'Verified retained original text', classification };
  assert.equal(reviewHealthCandidate(candidate(p), p, plan, review).decision.status, 'accepted');
  review.classification.evidence.quote = 'dietary ... supplement';
  assert.equal(reviewHealthCandidate(candidate(p), p, plan, review).decision.status, 'pending');
});
test('newer zero stays pending without explicit review and is excluded only after that review', () => {
  const original = product(); const p = product(); p.resourceRaw.salesEvidence = { ...evidence, value: 0, collectedAt: '2026-11-10T02:00:00Z' };
  const unreviewed = reviewHealthCandidate(candidate(p), original, plan);
  assert.equal(unreviewed.decision.status, 'pending'); assert.equal(unreviewed.product.resourceRaw.salesEvidence.value, 0);
  const reviewed = reviewHealthCandidate(candidate(p), original, plan, { resolveZeroSales: true, reviewer: 'reviewer', reason: 'Latest detail reported zero; positive-sales rule applies' });
  assert.equal(reviewed.decision.status, 'excluded'); assert.equal(reviewed.salesConflict.original.value, 5); assert.equal(reviewed.salesConflict.detail.value, 0);
});
