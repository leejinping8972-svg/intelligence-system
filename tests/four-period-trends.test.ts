import { describe, expect, it } from 'vitest';

import { fourPeriodComparisons } from '../apps/web-antd/src/views/intelligence/trend-comparison';

const end = Date.parse('2026-10-21T00:00:00Z');
const points = (n: number, step = 1) =>
  Array.from({ length: n }, (_, i) => ({
    date: new Date(end - (n - i) * step * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value: 50,
  }));
describe('four calendar trend periods', () => {
  it('uses Monday and month start with matching elapsed previous-week/month periods', () => {
    const r = fourPeriodComparisons({
      trendDailyPoints: points(80),
      trendDailyCollectedAt: '2026-10-21T02:00:00Z',
      trendHistoryPoints: points(740),
      trendHistoryResolution: 'day',
    });
    expect(r.map((v) => v.label)).toEqual([
      '本周',
      '本月',
      '近3个月',
      '近6个月',
    ]);
    expect(r.map((v) => v.start)).toEqual([
      '2026-10-19',
      '2026-10-01',
      '2026-07-21',
      '2026-04-21',
    ]);
    expect(r.map((v) => v.change)).toEqual([0, 0, 0, 0]);
  });
  it('does not fill missing daily data using weekly points or legacy arrays', () => {
    const r = fourPeriodComparisons({
      trendPoints: points(106, 7),
      trendResolution: 'week',
    });
    expect(r[0]?.heat).toBeNull();
    expect(r[1]?.heat).toBeNull();
    expect(r[2]?.heat).toBe(50);
    expect(r[3]?.heat).toBe(50);
  });
  it('keeps the first day of a calendar week unknown until a full day is observed', () => {
    const finish = Date.parse('2026-10-19T00:00:00Z');
    const d = points(80).map((v) => ({
      ...v,
      date: new Date(Date.parse(v.date) - (end - finish))
        .toISOString()
        .slice(0, 10),
    }));
    expect(
      fourPeriodComparisons({
        trendDailyPoints: d,
        trendDailyCollectedAt: '2026-10-19T02:00:00Z',
      })[0]?.heat,
    ).toBeNull();
  });
  it('never computes changes across an internal missing daily bucket', () => {
    const d = points(80).filter((v) => v.date !== '2026-10-20');
    expect(
      fourPeriodComparisons({
        trendDailyPoints: d,
        trendDailyCollectedAt: '2026-10-21T02:00:00Z',
      })[0]?.heat,
    ).toBeNull();
  });
});
