import { describe, expect, it } from 'vitest';
import {
  productDecisions,
  type ProductMetricSeries,
} from '../apps/web-antd/src/views/intelligence/product-decisions';
const now = Date.parse('2026-10-19T00:00:00Z');
function series(
  values: number[],
  patch: Partial<ProductMetricSeries> = {},
): ProductMetricSeries {
  return {
    provider: 'Sorftime',
    platform: 'Amazon',
    market: 'US',
    productId: 'B0EXAMPLE',
    metric: 'sales_volume',
    period: 'month',
    collectedAt: '2026-10-18T00:00:00Z',
    points: values.map((value, i) => {
      const month = 9 - values.length + i;
      return {
        start: new Date(Date.UTC(2026, month, 1)).toISOString().slice(0, 10),
        end: new Date(Date.UTC(2026, month + 1, 0)).toISOString().slice(0, 10),
        value,
      };
    }),
    ...patch,
  };
}
const tags = (s: ProductMetricSeries[]) =>
  productDecisions({ market: 'US', decisionData: { series: s } }, now);
const keys = (s: ProductMetricSeries[]) => tags(s).map((t) => t.key);
describe('product decision labels use comparable product evidence', () => {
  it('distinguishes first discovery from new product without listing evidence', () => {
    const result = productDecisions(
      { market: 'US', firstSeenAt: '2026-10-18' },
      now,
    );
    expect(result.map((t) => t.key)).toEqual(['first_seen', 'insufficient']);
  });
  it('requires source and matching country for a new listing and rejects future dates', () => {
    const listing = {
      date: '2026-10-01',
      provider: 'Sorftime',
      platform: 'Amazon',
      market: 'US',
      collectedAt: '2026-10-18',
    };
    expect(
      productDecisions({ market: 'US', decisionData: { listing } }, now).map(
        (t) => t.key,
      ),
    ).toContain('new_product');
    for (const patch of [
      { market: 'MX' },
      { date: '2026-10-20' },
      { date: '2026-02-30' },
      { provider: '' },
    ])
      expect(
        productDecisions(
          { market: 'US', decisionData: { listing: { ...listing, ...patch } } },
          now,
        ).map((t) => t.key),
      ).not.toContain('new_product');
  });
  it('calculates growth and sustained increase over four full months', () => {
    expect(keys([series([100, 130, 150, 210])])).toEqual([
      'growing',
      'sustained',
    ]);
    expect(tags([series([100, 125])])[0]?.change).toBe(25);
    expect(tags([series([100, 125])])[0]?.reason).toContain('2026-09-01');
  });
  it('identifies decline and low-base growth separately', () => {
    expect(keys([series([100, 70])])).toEqual(['declining']);
    expect(keys([series([1, 2, 4, 10])])).toEqual(['low_base']);
  });
  it('does not invent a percentage from zero, missing observations, or NaN', () => {
    expect(keys([series([0, 0, 0, 10])])).toEqual(['emerging']);
    expect(tags([series([0, 0, 0, 10])])[0]?.change).toBeUndefined();
    expect(keys([series([0, 10])])).toEqual(['low_base']);
    const s = series([100, 200]);
    s.points[0]!.value = NaN;
    expect(keys([s])).toEqual(['insufficient']);
  });
  it('detects a spike only after observing two subsequent periods back near baseline', () => {
    expect(keys([series([100, 110, 100, 400, 110, 100])])).toEqual(['spike']);
    expect(keys([series([100, 110, 100, 400])])).not.toContain('spike');
  });
  it('does not use an incomplete month or bridge a gap', () => {
    const s = series([100, 200]);
    s.points[1]!.partial = true;
    expect(keys([s])).toEqual(['insufficient']);
    const gap = series([100, 120, 200]);
    gap.points.splice(1, 1);
    expect(keys([gap])).toEqual(['insufficient']);
    const ongoing = series([100, 200]);
    ongoing.points[1] = { start: '2026-10-01', end: '2026-10-31', value: 900 };
    expect(keys([ongoing])).toEqual(['insufficient']);
  });
  it('keeps ranking, keyword coverage, and sales labels distinct', () => {
    expect(
      keys([
        series([100, 50], {
          metric: 'shopping_rank',
          provider: 'Semrush',
          platform: 'Google Shopping',
        }),
      ]),
    ).toEqual(['rank_improving']);
    expect(
      keys([
        series([10, 20], {
          metric: 'keywords_count',
          provider: 'Semrush',
          platform: 'Google Shopping',
        }),
      ]),
    ).toEqual(['coverage_growing']);
    expect(keys([series([0, 50], { metric: 'sales_rank' })])).toEqual([
      'insufficient',
    ]);
  });
  it('never combines countries or series to manufacture a comparison', () => {
    expect(keys([series([100, 200], { market: 'MX' })])).toEqual([
      'insufficient',
    ]);
    const first = series([100, 200]);
    const second = series([100, 200], { provider: 'Other' });
    first.points.pop();
    second.points.shift();
    expect(keys([first, second])).toEqual(['insufficient']);
  });
  it('marks stale history and rejects duplicate time buckets', () => {
    expect(
      productDecisions(
        { market: 'US', decisionData: { series: [series([100, 200])] } },
        Date.parse('2027-01-01'),
      ).map((t) => t.key),
    ).toEqual(['stale']);
    const duplicate = series([100, 200]);
    duplicate.points.push({ ...duplicate.points[1]!, value: 300 });
    expect(keys([duplicate])).toEqual(['insufficient']);
  });
});
