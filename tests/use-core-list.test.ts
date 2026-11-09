import { describe, expect, it, vi } from 'vitest';

vi.mock('../apps/web-antd/src/views/intelligence/data', () => ({
  state: { keywords: [], products: [], sites: [], ads: [] },
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({ serverMode: true }));
vi.mock('../apps/web-antd/src/views/intelligence/core-list-context', () => ({ coreListContext: {} }));

import { useCoreList } from '../apps/web-antd/src/views/intelligence/use-core-list';

describe('keyword list association columns', () => {
  it('keeps only the clickable association columns when the page supplies them', () => {
    const base = [
      { key: 'term' },
      { key: 'relatedAds', title: '关联广告' },
      { key: 'relatedProducts', title: '关联商品' },
      { key: 'relatedSites', title: '关联独立站' },
      { key: 'actions' },
    ];
    const columns = useCoreList('keywords').columns(base);
    expect(columns.filter((column) => column.title === '关联商品')).toHaveLength(1);
    expect(columns.filter((column) => /关联.*站/.test(column.title || ''))).toHaveLength(1);
    expect(columns.some((column) => column.key === 'core:linkedProducts')).toBe(false);
    expect(columns.some((column) => column.key === 'core:linkedSites')).toBe(false);
    expect(columns.at(-1)?.key).toBe('actions');
  });

  it('omits retired association metrics for pages without custom columns', () => {
    const keys = useCoreList('keywords').columns([{ key: 'term' }]).map((column) => column.key);
    expect(keys).not.toContain('core:linkedProducts');
    expect(keys).not.toContain('core:linkedSites');
  });
});
