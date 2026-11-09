import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it } from 'vitest';
import { keywordAssociationColumns } from '../apps/web-antd/src/views/intelligence/keyword-association-columns';

describe('keyword association sorting columns', () => {
  const count = (row: Keyword, collection: 'ads' | 'products' | 'sites') => row.relatedCounts?.[collection] ?? 0;

  it('uses server sorting for all three clickable association columns', () => {
    const columns = keywordAssociationColumns(true, count);
    expect(columns.map(column => column.key)).toEqual(['relatedAds', 'relatedProducts', 'relatedSites']);
    for (const column of columns) {
      expect(column.sorter).toBe(true);
      expect(column.sortDirections).toEqual(['descend', 'ascend']);
    }
  });

  it.each(['ads', 'products', 'sites'] as const)('compares %s counts numerically across local results and treats no links as zero', (collection) => {
    const index = ['ads', 'products', 'sites'].indexOf(collection);
    const sorter = keywordAssociationColumns(false, count)[index]!.sorter;
    expect(typeof sorter).toBe('function');
    if (typeof sorter !== 'function') throw Error('Expected local comparator');
    const row = (value?: number) => ({ relatedCounts: value === undefined ? undefined : { [collection]: value } }) as Keyword;
    expect(sorter(row(2), row(10))).toBeLessThan(0);
    expect(sorter(row(), row(2))).toBeLessThan(0);
    expect(sorter(row(2), row(2))).toBe(0);
  });
});
