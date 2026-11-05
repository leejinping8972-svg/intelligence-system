import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDiscoveryProduct } from './discovery-sorftime.mjs';
import {
  mergePlatformProduct,
  normalizeAmazon,
  normalizeAmazonContent,
} from './platform-product-data.mjs';
import { normalizeAsin, productAsin } from './product-asin.mjs';
import { normalizeSorftimeProduct } from './product-resource-sorftime.mjs';
import { projectRecord } from './workspace-reads.mjs';

const at = '2026-11-05T10:30:00Z';
const asin = 'B000000001';
const row = { asin, title: 'Synthetic dietary supplement' };

test('Amazon ASIN is saved for platform search, resource collection and new-product discovery', () => {
  for (const product of [
    normalizeAmazon(row, 'US', at),
    normalizeSorftimeProduct(row, { platform: 'amazon', market: 'US', op: 'search' }, at),
    normalizeDiscoveryProduct({ product_info: row }, { channel: 'amazon', market: 'US' }, at),
  ]) {
    assert.equal(product.asin, asin);
    assert.equal(product.sourceProductId, asin);
    assert.ok(product.collectionFields.includes('asin'));
    assert.equal(projectRecord('products', product).data.asin, asin);
  }
});

test('ASIN aliases normalize whitespace and case and keep detail identity checks', () => {
  for (const key of ['asin', 'Asin', 'ASIN']) {
    const source = { [key]: ' b000000001 ', title: row.title };
    assert.equal(normalizeAmazon(source, 'US', at).asin, asin);
    assert.equal(normalizeSorftimeProduct(source, { platform: 'amazon', market: 'US', op: 'search' }, at).asin, asin);
  }
  assert.equal(normalizeAsin(1000000001), '');
  assert.equal(normalizeAsin('B000000001-extra'), '');
  assert.equal(normalizeAmazon(row, 'US', at, 'B000000002'), null);
});

test('legacy Amazon records expose ASIN without a refetch and prefer the saved source identity', () => {
  const legacy = { id: 'legacy', title: row.title, sourcePlatform: 'Amazon', sourceProvider: 'Sorftime', sourceProductId: asin };
  assert.equal(productAsin(legacy), asin);
  assert.equal(projectRecord('products', legacy).data.asin, asin);
  const merged = mergePlatformProduct(legacy, { id: legacy.id, asin: undefined, titleZh: '合成商品' });
  assert.equal(merged.asin, asin);
  assert.equal(productAsin({ ...legacy, asin: 'B000000002' }), asin);
  assert.equal(productAsin({ sourcePlatform: 'Amazon', asin }), asin);
});

test('Amazon content keeps ASIN and still rejects another product response', () => {
  const product = normalizeAmazon(row, 'US', at);
  const patch = normalizeAmazonContent({ asin, description: 'Synthetic source content' }, product, at);
  assert.equal(patch.asin, asin);
  assert.ok(patch.collectionFields.includes('asin'));
  assert.equal(mergePlatformProduct(product, patch).asin, asin);
  assert.throws(() => normalizeAmazonContent({ asin: 'B000000002' }, product, at), /ASIN/);
});

test('other platforms and invalid Amazon identifiers never become ASINs', () => {
  for (const sourcePlatform of ['Shopee', 'Temu', 'TikTok Shop', 'Google Shopping', '独立站', undefined]) {
    const product = { id: 'other', sourcePlatform, sourceProvider: 'Sorftime', sourceProductId: asin };
    assert.equal(productAsin({ ...product, asin }), '');
    assert.equal(projectRecord('products', product).data.asin, undefined);
    const patch = normalizeAmazonContent({ description: 'Synthetic content' }, product, at);
    assert.equal(patch.asin, undefined);
    assert.ok(!patch.collectionFields.includes('asin'));
  }
  assert.equal(productAsin({ sourcePlatform: 'Amazon', sourceProductId: 'not-an-asin' }), '');
});
