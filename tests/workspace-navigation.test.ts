import { describe, it, expect } from 'vitest';
import { workspaceActivePath, workspaceTabs, workspaceSections } from '../apps/web-antd/src/views/intelligence/navigation';
import { productPlatform, productProvider } from '../apps/web-antd/src/views/intelligence/product-source';
describe('consolidated workspace navigation', () => {
  it('keeps old routes within the correct group and separates monitor views', () => {
    expect(workspaceActivePath('/selected-keywords')).toBe('/research');
    expect(workspaceActivePath('/consumer-insights/reports/123')).toBe('/consumer-insights');
    expect(workspaceActivePath('/monitor', 'monitors')).toBe('/monitor?tab=monitors');
    expect(workspaceActivePath('/monitor', 'tasks')).toBe('/monitor?tab=tasks');
    expect(workspaceTabs('/trends', false).map(t => t.path)).toContain('/selected-keywords');
  });
  it('does not advertise restricted source or model settings to researchers', () => {
    expect(workspaceTabs('/administration', false).map(t => t.path)).not.toContain('/settings');
    expect(workspaceSections.flatMap(s => s.links).find(l => l.path === '/usage')?.admin).toBe(true);
  });
  it('does not infer a platform from the provider name', () => {
    expect(productPlatform({ sourcePlatform: 'Amazon', siteId: '' })).toBe('Amazon');
    expect(productProvider({ sourceProvider: 'Sorftime', siteId: '' })).toBe('Sorftime');
    expect(productPlatform({ siteId: '' })).toBe('未记录');
    expect(productPlatform({ siteId: 's1' })).toBe('未记录');
  });
});
