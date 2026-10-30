import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvedProductPlatform } from './product-platform.mjs';

test('legacy website products require matching recorded origin, and preserve marketplace platforms', () => {
  const site = { id: 'site', domain: 'shop.example' };
  const product = { siteId: 'site', evidenceUrl: 'https://www.shop.example/products/1' };
  assert.equal(resolvedProductPlatform(product, site), '独立站');
  assert.equal(resolvedProductPlatform({ ...product, sourcePlatform: 'Amazon' }, site), 'Amazon');
  for (const evidenceUrl of ['https://shop.example.evil.test/1', 'https://shop.example@evil.test/1', 'javascript:alert(1)', 'bad-url', undefined])
    assert.equal(resolvedProductPlatform({ siteId: 'site', evidenceUrl }, site), '未记录');
  assert.equal(resolvedProductPlatform({ siteId: 'site' }, site), '未记录');
  assert.equal(resolvedProductPlatform(product, null), '未记录');
  assert.equal(resolvedProductPlatform({ ...product, sourceUrl: 'https://market.example/1' }, site), '未记录');
});
