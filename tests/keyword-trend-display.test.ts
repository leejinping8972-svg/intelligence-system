import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import type { SocialSummary } from '../apps/web-antd/src/views/intelligence/keyword-social-trends';

import { describe, expect, it } from 'vitest';

import { keywordTrendPreview } from '../apps/web-antd/src/views/intelligence/keyword-trend-preview';
import { socialTrendStatus } from '../apps/web-antd/src/views/intelligence/social-trend-status';
import { fourPeriodComparisons } from '../apps/web-antd/src/views/intelligence/trend-comparison';
import { keywordTrendList } from '../server/keyword-trend-list.mjs';

const end = Date.parse('2026-10-21T00:00:00Z');
const points = (n: number) => Array.from({ length: n }, (_, i) => ({ date: new Date(end - (n - i) * 86400000).toISOString().slice(0, 10), value: i % 100 }));
describe('saved trend data on list pages', () => {
  it('keeps calendar comparisons equal before and after opening detail', () => {
    const full = { trendPoints: points(365), trendResolution: 'day', trendCollectedAt: new Date(end).toISOString(), trendDailyPoints: points(60), trendDailyCollectedAt: new Date(end).toISOString() };
    const list = { ...keywordTrendList(full), listSummary: true };
    expect(fourPeriodComparisons(list)).toEqual(fourPeriodComparisons(full));
    expect(list.trendPoints).toHaveLength(365);
    expect(list).not.toHaveProperty('trendDailyPoints');
  });
  it('renders an all-zero curve and uses actual date spacing', () => {
    const record = { series: [], trendPoints: [{ date: '2026-01-01', value: 0 }, { date: '2026-01-02', value: 0 }, { date: '2026-01-11', value: 100 }] } as Keyword;
    expect(keywordTrendPreview(record).coordinates).toBe('4,40 20,40 164,4');
    expect(keywordTrendPreview({ series: [0, 0] } as Keyword).count).toBe(2);
  });
  it('distinguishes reading, not collected, errors and existing values', () => {
    expect(socialTrendStatus(undefined, { loading: true, loaded: false, error: '' })).toContain('读取');
    expect(socialTrendStatus(undefined, { loading: false, loaded: true, error: '' })).toBe('尚未采集此来源');
    expect(socialTrendStatus(undefined, { loading: false, loaded: true, error: 'failed' })).toContain('重试');
    const summary = { periods: [{ count: 0 }], comparisonVersion: 2 } as SocialSummary;
    expect(socialTrendStatus(summary, { loading: false, loaded: true, error: '' })).toContain('内容样本');
    expect(socialTrendStatus(summary, { loading: false, loaded: true, error: 'failed' })).toContain('保留已采集值');
  });
});
