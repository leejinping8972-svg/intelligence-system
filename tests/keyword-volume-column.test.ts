import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it, vi } from 'vitest';
import { useCoreList } from '../apps/web-antd/src/views/intelligence/use-core-list';
vi.mock('../apps/web-antd/src/views/intelligence/data', () => ({
  state: { keywords: [], products: [], sites: [], ads: [] },
}));
vi.mock('../apps/web-antd/src/views/intelligence/session', () => ({
  serverMode: false,
}));
vi.mock('../apps/web-antd/src/views/intelligence/core-list-context', () => ({
  coreListContext: {},
}));

describe('monthly search sorting in local keyword lists', () => {
  it('sorts numbers with real zeros and puts absent/foreign-market estimates last in either direction', () => {
    const core = useCoreList('keywords');
    const column = core.columns([{ key: 'core:searchVolume' }])[0];
    const sorter = (
      column as { sorter: (a: Keyword, b: Keyword, order: string) => number }
    ).sorter;
    const rows = [
      { id: 'unknown', market: 'US' },
      {
        id: 'zero',
        market: 'US',
        metrics: { market: 'US', monthlySearchVolume: 0 },
      },
      {
        id: 'foreign',
        market: 'MX',
        metrics: { market: 'US', monthlySearchVolume: 99_999 },
      },
      {
        id: 'high',
        market: 'US',
        metrics: { market: 'US', monthlySearchVolume: 1000 },
      },
      {
        id: 'low',
        market: 'US',
        metrics: { market: 'US', monthlySearchVolume: 10 },
      },
    ] as Keyword[];
    expect(
      rows.toSorted((a, b) => sorter(a, b, 'ascend')).map((row) => row.id),
    ).toEqual(['zero', 'low', 'high', 'unknown', 'foreign']);
    expect(
      rows.toSorted((a, b) => -sorter(a, b, 'descend')).map((row) => row.id),
    ).toEqual(['high', 'low', 'zero', 'unknown', 'foreign']);
  });
});
