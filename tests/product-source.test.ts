import { describe, expect, it } from 'vitest';
import { productPlatform, productProvider, productSiteLabel } from '../apps/web-antd/src/views/intelligence/product-source';
describe('platform and collection provider retain their own evidence', () => {
  it('does not convert an associated site to a source or selling platform', () => {
    const p = { siteId: 'brand-site', dataNature: 'imported' as const };
    expect(productPlatform(p)).toBe('未记录');
    expect(productProvider(p)).toBe('人工导入 / 来源待确认');
  });
  it('keeps the recorded selling platform independent of the provider', () => {
    const p = { sourcePlatform: 'TikTok Shop', sourceProvider: 'ScrapeCreators' };
    expect(productPlatform(p)).toBe('TikTok Shop');
    expect(productProvider(p)).toBe('ScrapeCreators');
  });
  it('uses the page relation immediately and never calls a pending relation unlinked', () => {
    expect(productSiteLabel({ siteId: 'site', linkedSite: { id: 'site', domain: 'store.example', brand: 'Store', market: 'US' } })).toBe('store.example');
    expect(productSiteLabel({ siteId: 'site' })).toBe('站点信息待加载');
    expect(productSiteLabel({ siteId: 'site' }, 'store.example')).toBe('store.example');
    expect(productSiteLabel({ siteId: 'site', linkedSite: null }, 'stale.example')).toBe('关联站点已移除');
    expect(productSiteLabel({ siteId: '' })).toBe('未关联');
  });
});
