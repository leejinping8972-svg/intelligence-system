import { describe, expect, it } from 'vitest';
import { platformProductSelection } from '../apps/web-antd/src/views/intelligence/platform-product-selection';

const rows = [
  {
    id: 'us',
    term: 'creatine gummies',
    market: 'US',
    adCollection: { status: 'running' },
  },
  { id: 'mx', term: 'creatina gomitas', market: 'MX' },
  { id: 'vn', term: 'creatine', market: 'VN' },
];

describe('platform product selection follows selected keyword markets', () => {
  it('enables a single-market selection from an all-market list even when its ads are running', () => {
    expect(platformProductSelection(rows, ['us'], true)).toMatchObject({
      disabled: false,
      market: 'US',
      terms: ['creatine gummies'],
    });
  });
  it('prefills the actual MX/VN market instead of defaulting an all-market view to US', () => {
    expect(platformProductSelection(rows, ['mx'], true).market).toBe('MX');
    expect(platformProductSelection(rows, ['vn'], true).market).toBe('VN');
  });
  it('rejects mixed markets with a concrete reason and no guessed target market', () => {
    expect(platformProductSelection(rows, ['us', 'mx'], true)).toMatchObject({
      disabled: true,
      market: undefined,
      reason: '请只勾选同一市场的关键词，再获取平台商品',
    });
  });
  it('explains empty selections and workspace synchronization', () => {
    expect(platformProductSelection(rows, [], true).reason).toContain('先勾选');
    expect(platformProductSelection(rows, ['us'], false).reason).toContain(
      '同步工作区',
    );
  });
  it('does not silently submit a subset when selected records disappeared', () => {
    expect(
      platformProductSelection(rows, ['us', 'removed'], true).reason,
    ).toContain('避免只提交部分');
  });
  it('rejects more than 100 selected keywords', () => {
    const many = Array.from({ length: 101 }, (_, i) => ({
      id: `k-${i}`,
      term: `word ${i}`,
      market: 'US',
    }));
    expect(
      platformProductSelection(
        many,
        many.map((r) => r.id),
        true,
      ).reason,
    ).toContain('最多选择100');
  });
});
