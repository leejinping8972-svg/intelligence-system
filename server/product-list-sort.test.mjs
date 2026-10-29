import assert from 'node:assert/strict';
import test from 'node:test';
import { compareProductValues, displayedSalesOrder, productCollectionTime, productSortValue } from './product-list-sort.mjs';

test('collection sort uses the same latest successful capture displayed by the UI', () => {
  const product = { firstSeenAt: '2026-10-29T10:00:00Z', lastCollectedAt: '2026-10-29T08:00:00+08:00', sourceMetrics: { collectedAt: '2026-10-29T00:06:31Z' }, sourceContent: { collectedAt: 'invalid' } };
  assert.equal(productCollectionTime(product), '2026-10-29T00:06:31Z');
  assert.equal(productSortValue(product, 'collectedAt'), Date.parse('2026-10-29T00:06:31Z'));
  assert.equal(productSortValue({ firstSeenAt: product.firstSeenAt }, 'collectedAt'), null);
});

test('displayed sales order preserves lower bounds and supports abbreviated source displays', () => {
  for (const [raw, expected] of [['500+', 500], ['3,000+', 3000], ['12.3K', 12300], ['1.2万+', 12000], ['0', 0], ['unknown', null]]) {
    const metrics = { soldRaw: raw, soldCount: 999 };
    assert.equal(displayedSalesOrder(metrics), expected);
    assert.equal(metrics.soldRaw, raw);
  }
  assert.equal(displayedSalesOrder({ soldCount: 0 }), 0);
  assert.equal(displayedSalesOrder({ soldCount: -1 }), null);
});

test('unknown values remain last in both directions and equal keys remain ties', () => {
  for (const order of ['ascend', 'descend']) {
    assert.equal(compareProductValues(null, 0, order), 1);
    assert.equal(compareProductValues(0, null, order), -1);
    assert.equal(compareProductValues(null, null, order), 0);
    assert.equal(compareProductValues(500, 500, order), 0);
  }
});

test('original price ordering keeps zero and unknown values distinct', () => {
  assert.equal(productSortValue({ price: 0 }, 'core:priceOriginal'), 0);
  assert.equal(productSortValue({ price: 12.5 }, 'core:priceOriginal'), 12.5);
  assert.equal(productSortValue({}, 'core:priceOriginal'), null);
});
