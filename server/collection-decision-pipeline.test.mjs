/* eslint-disable vitest/no-import-node-test -- Server suite uses node --test. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  collectionPolicyMessage,
  resolveCollectionPolicy,
} from './collection-policy.mjs';
import {
  normalizeIngredientName,
  summarizeFormulas,
  withFormulaIntelligence,
} from './formula-intelligence.mjs';
import { validatePlatformProducts } from './platform-products-jobs.mjs';
import {
  collectTikTokShop,
  normalizeTikTokShopSearch,
} from './tiktok-shop-provider.mjs';

test('collection profiles provide finite per-site and batch budgets', () => {
  assert.deepEqual(resolveCollectionPolicy({}, 5), {
    profile: 'explore',
    maxProducts: 30,
    maxDetailProducts: 10,
    maxRequests: 100,
    maxRequestsPerSite: 20,
    maxBrowserPages: 5,
    recommendedSiteLimit: 20,
  });
  const deep = resolveCollectionPolicy({ profile: 'deep' }, 20);
  assert.equal(deep.maxRequests, 2400);
  assert.match(collectionPolicyMessage(deep, 20).join('；'), /16站/);
});

test('formula normalization separates observed from verified evidence and ranks repeated combinations', () => {
  assert.equal(normalizeIngredientName('Ascorbic Acid 500 mg'), 'Vitamin C');
  const observed = withFormulaIntelligence({
    id: 'p1',
    brand: 'A',
    market: 'US',
    ingredient: 'Ascorbic Acid 500 mg; Zinc 10 mg',
    ingredientInsights: [],
    reviewed: false,
    evidenceUrl: 'https://example.com/p1',
    sourceMetrics: { reviewCount: 100 },
  });
  const verified = withFormulaIntelligence({
    ...observed,
    id: 'p2',
    brand: 'B',
    reviewed: true,
  });
  assert.equal(observed.formula.status, 'observed');
  assert.equal(verified.formula.status, 'verified');
  assert.equal(observed.formula.fingerprint, verified.formula.fingerprint);
  const summary = summarizeFormulas([observed, verified]);
  assert.equal(summary[0].productCount, 2);
  assert.equal(summary[0].verified, 1);
  assert.deepEqual(summary[0].ingredients, ['Vitamin C', 'Zinc']);
});

test('TikTok Shop normalization preserves source identity and labels sales as a snapshot', async () => {
  const jobInput = validatePlatformProducts({
    requestId: randomUUID(),
    terms: 'creatine gummies',
    market: 'VN',
    providers: ['tiktok_shop'],
    maxRequests: 1,
    completeAll: false,
  });
  assert.deepEqual(jobInput.providers, ['tiktok_shop']);
  const payload = {
    data: {
      total_products: 1,
      products: [
        {
          product_id: '723456789',
          title: 'Creatine Gummies',
          product_url: 'https://shop.tiktok.com/view/product/723456789',
          price: '19.99',
          currency: 'USD',
          sold_count: 321,
          review_count: 12,
          rating: 4.7,
          seller: { name: 'QA Nutrition' },
          image: 'https://cdn.example.com/tiktok.jpg',
        },
      ],
    },
  };
  const normalized = normalizeTikTokShopSearch(payload, 'US');
  assert.equal(normalized.products[0].sourcePlatform, 'TikTok Shop');
  assert.equal(normalized.products[0].sourceMetrics.reportedSales, 321);
  assert.match(
    normalized.products[0].sourceMetrics.salesMetricNature,
    /累计销量快照/,
  );
  let request;
  const result = await collectTikTokShop(
    { term: 'creatine gummies', market: 'US', page: 1, limit: 20 },
    {
      config: { ciphertext: 'synthetic' },
      key: 'synthetic-key',
      scrapeRequest: async (path, params, key, _fetcher, method) => {
        request = { path, params, key, method };
        return payload;
      },
    },
  );
  assert.deepEqual(request, {
    path: '/v1/tiktok/shop/search',
    params: { query: 'creatine gummies', page: 1, region: 'US' },
    key: 'synthetic-key',
    method: 'GET',
  });
  assert.equal(result.products.length, 1);
});
