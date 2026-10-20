import { describe, expect, it } from 'vitest';

import {
  formatTrendComparison,
  trendComparisons,
} from '../apps/web-antd/src/views/intelligence/trend-comparison';
import { trendComparisons as serverComparisons } from '../server/model.js';

const DAY = 86_400_000;
const end = Date.parse('2026-10-20T00:00:00Z');
const points = (
  count: number,
  value: (i: number) => number,
  step = 1,
  finish = end,
) =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(finish - (count - i) * step * DAY)
      .toISOString()
      .slice(0, 10),
    value: value(i),
  }));
describe('period comparisons use actual Google time series', () => {
  it('uses 30 complete UTC days and preceding30, ignoring persisted28-day growth', () => {
    const keyword = {
      growth: 999,
      trendDailyPoints: points(60, (i) => (i < 30 ? 50 : 75)),
      trendDailyCollectedAt: '2026-10-20T19:00:00Z',
    };
    const result = trendComparisons(keyword)[0];
    expect(result.currentMean).toBe(75);
    expect(result.previousMean).toBe(50);
    expect(result.change).toBe(50);
    expect(result.start).toBe('2026-09-20');
    expect(result.end).toBe('2026-10-19');
    expect(formatTrendComparison(result)).toBe('近30天：75(+50%)');
  });
  it('formats requested compact heat and percentage, including zero and decline', () => {
    const result = trendComparisons({
      trendDailyPoints: points(60, (i) => (i < 30 ? 78 / 1.03 : 78)),
    })[0];
    expect(formatTrendComparison(result)).toBe('近30天：78(+3%)');
    expect(formatTrendComparison({ ...result, change: 0 })).toBe(
      '近30天：78(0%)',
    );
    expect(formatTrendComparison({ ...result, change: -3 })).toBe(
      '近30天：78(-3%)',
    );
  });
  it('requires real dated daily data, not weekly samples or an undated legacy array', () => {
    const result = trendComparisons({
      trendPoints: points(106, () => 50, 7),
      trendResolution: 'week',
    });
    expect(result[0].heat).toBeNull();
    expect(result[1].change).toBe(0);
    expect(result[2].change).toBe(0);
  });
  it('does not turn a zero baseline into an infinite, zero, or fabricated percentage', () => {
    const result = trendComparisons({
      trendDailyPoints: points(60, (i) => (i < 30 ? 0 : 40)),
    })[0];
    expect(result.heat).toBe(40);
    expect(result.change).toBeNull();
    expect(result.reason).toContain('新出现信号');
    expect(formatTrendComparison(result)).toContain('基期为0');
  });
  it('keeps missing dates unknown, filters partial/invalid/duplicate points and sorts dates', () => {
    const complete = points(60, () => 50);
    const missing = complete.filter((_, i) => i !== 40);
    expect(trendComparisons({ trendDailyPoints: missing })[0].heat).toBeNull();
    const extra = [
      ...complete.toReversed(),
      { date: '2026-08-21', value: 50 },
      { date: '2026-10-20', value: 99, isPartial: true },
      { date: 'bad', value: 20 },
      { date: '2026-10-25', value: 500 },
    ];
    expect(trendComparisons({ trendDailyPoints: extra })[0].change).toBe(0);
  });
  it('distinguishes a known current-year average from a missing previous year', () => {
    const result = trendComparisons({
      trendPoints: points(53, () => 48, 7),
      trendResolution: 'week',
    })[2];
    expect(result.heat).toBe(48);
    expect(result.change).toBeNull();
    expect(formatTrendComparison(result)).toBe('近一年：48（待补对比）');
  });
  it('compares annual and half-year periods on one common history scale without splicing daily samples', () => {
    const record = {
      trendHistoryPoints: points(740, (i) => (i < 375 ? 40 : 60)),
      trendHistoryResolution: 'day',
      trendDailyPoints: points(60, (i) => (i < 30 ? 10 : 20)),
    };
    const result = trendComparisons(record);
    expect(result[0].change).toBe(100);
    expect(result[1].change).toBe(0);
    expect(result[2].heat).toBe(60);
    expect(result[2].change).toBe(50);
    expect(serverComparisons(record)).toEqual(result);
  });
  it('uses calendar half-years across month ends and leap days', () => {
    const finish = Date.parse('2024-03-31T00:00:00Z');
    const result = trendComparisons({
      trendHistoryPoints: points(740, () => 40, 1, finish),
      trendHistoryResolution: 'day',
    })[1];
    expect(result.start).toBe('2023-09-30');
    expect(result.previousStart).toBe('2023-03-31');
    expect(result.change).toBe(0);
  });
  it('never bridges an internal missing weekly bucket or includes an incomplete current day', () => {
    const weekly = points(106, () => 50, 7).filter((_, i) => i !== 90);
    expect(
      trendComparisons({
        trendHistoryPoints: weekly,
        trendHistoryResolution: 'week',
      })[1].heat,
    ).toBeNull();
    const daily = [...points(60, () => 50), { date: '2026-10-20', value: 100 }];
    expect(
      trendComparisons({
        trendDailyPoints: daily,
        trendDailyCollectedAt: '2026-10-20T12:00:00Z',
      })[0].currentMean,
    ).toBe(50);
  });
});
