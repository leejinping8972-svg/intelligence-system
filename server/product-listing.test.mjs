import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesListingRange,
  productListingDate,
  recentListingRange,
  validateListingRange,
} from './product-listing.mjs';
import { shopifyCatalogProducts } from './product-queue.mjs';
import { normalizeProduct } from './product-jobs.mjs';
const at = '2026-10-22T00:00:00Z',
  now = Date.parse(at);
const product = (date) => ({
  market: 'US',
  decisionData: {
    listing: {
      date,
      provider: 'Test',
      platform: 'Shopify',
      market: 'US',
      collectedAt: at,
      evidenceUrl: 'https://brand.com/product',
    },
  },
});
test('listing ranges include both days, reject invalid dates and exclude unknown and future dates', () => {
  assert.equal(
    matchesListingRange(product('2026-10-15'), '2026-10-15', '2026-10-22', now),
    true,
  );
  assert.equal(
    matchesListingRange(product('2026-10-22'), '2026-10-15', '2026-10-22', now),
    true,
  );
  assert.equal(
    matchesListingRange(
      { firstSeenAt: at, publishedAt: at },
      '2026-10-15',
      '',
      now,
    ),
    false,
  );
  assert.equal(productListingDate(product('2026-10-23'), now), '');
  assert.throws(() => validateListingRange('2026-02-30', ''));
  assert.throws(() => validateListingRange('2026-10-22', '2026-10-15'));
});
test('7/30/90 day shortcuts use inclusive Beijing calendar dates across UTC midnight', () => {
  const clock = Date.parse('2026-10-21T18:00:00Z');
  assert.deepEqual(recentListingRange(7, clock), ['2026-10-16', '2026-10-22']);
  assert.deepEqual(recentListingRange(30, clock), ['2026-09-23', '2026-10-22']);
  assert.deepEqual(recentListingRange(90, clock), ['2026-07-25', '2026-10-22']);
});
test('Shopify publication date survives catalog normalization, without using creation or observation dates', () => {
  const site = {
    id: 's',
    domain: 'brand.com',
    brand: 'Brand',
    market: 'US',
    platform: 'Shopify',
  };
  const raw = {
    handle: 'gummies',
    title: 'Gummies',
    published_at: '2026-10-15T10:00:00Z',
    created_at: '2026-01-01',
    variants: [],
  };
  const [parsed] = shopifyCatalogProducts(
    { products: [raw] },
    'https://brand.com',
    site,
  );
  const normalized = normalizeProduct(parsed, site, at);
  assert.equal(productListingDate(normalized, now), '2026-10-15');
  const [unknown] = shopifyCatalogProducts(
    { products: [{ ...raw, published_at: undefined }] },
    'https://brand.com',
    site,
  );
  assert.equal(
    productListingDate(normalizeProduct(unknown, site, at), now),
    '',
  );
});
