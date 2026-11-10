import { describe, expect, it } from 'vitest';
import { adjacentTrendPeriods } from '../apps/web-antd/src/views/intelligence/product-trend-period';
describe('trend chart period adjacency', () => {
  it('connects consecutive calendar months across year and leap boundaries', () => {
    expect(adjacentTrendPeriods('2025-12', '2026-01', 'month')).toBe(true);
    expect(adjacentTrendPeriods('2024-02', '2024-03', 'month')).toBe(true);
  });
  it('keeps missing months, invalid periods and reverse order disconnected', () => {
    expect(adjacentTrendPeriods('2026-07', '2026-09', 'month')).toBe(false);
    expect(adjacentTrendPeriods('2026-13', '2027-02', 'month')).toBe(false);
    expect(adjacentTrendPeriods('2026-09', '2026-08', 'month')).toBe(false);
  });
  it('preserves daily gap behavior', () => {
    expect(adjacentTrendPeriods('2026-11-01', '2026-11-02', 'day')).toBe(true);
    expect(adjacentTrendPeriods('2026-11-01', '2026-11-03', 'day')).toBe(false);
  });
});
