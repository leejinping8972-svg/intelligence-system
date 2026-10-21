import type { SocialPeriod } from '../apps/web-antd/src/views/intelligence/keyword-social-trends';

import { describe, expect, it } from 'vitest';

import {
  formatSocialPeriod,
  socialPeriodTitle,
} from '../apps/web-antd/src/views/intelligence/social-trend-format';

const period: SocialPeriod = {
  key: 'quarter',
  label: '近3个月',
  start: '2026-07-21',
  end: '2026-10-20',
  previousStart: '2026-04-21',
  previousEnd: '2026-07-20',
  count: 184,
  previousCount: 91,
  currentMean: 2,
  previousMean: 1,
  currentComplete: true,
  previousComplete: true,
  change: 100,
  state: 'ready',
  reason: '前后期日均发布量比较',
};
describe('historical social trend labels', () => {
  it('immediately presents first-backfill percentages and both comparison ranges', () => {
    expect(formatSocialPeriod(period)).toBe('近3个月：184条(+100%)');
    expect(socialPeriodTitle(period)).toContain(
      '前期2026-04-21至2026-07-20：91条',
    );
    expect(socialPeriodTitle(period)).toContain('日均2.00，此前日均1.00');
  });
  it('labels truncated counts and historical gaps without asking for future accumulation', () => {
    const value = formatSocialPeriod({
      ...period,
      change: null,
      currentComplete: false,
      state: 'coverage_insufficient',
    });
    expect(value).toBe('近3个月：≥184条（历史不足）');
    expect(value).not.toContain('待积累');
  });
  it('hides legacy playback percentages and preserves zero base as unknown', () => {
    expect(
      formatSocialPeriod({ ...period, state: 'legacy', change: 999 }),
    ).toBe('近3个月：184条（需回查）');
    expect(
      formatSocialPeriod({ ...period, state: 'zero_base', change: null }),
    ).toBe('近3个月：184条（基期为0）');
  });
  it('distinguishes missing, stale and first-day periods from measured zero or decline', () => {
    expect(
      formatSocialPeriod({ ...period, count: null, change: null }),
    ).toContain('待回查');
    expect(formatSocialPeriod({ ...period, stale: true })).toContain('上次');
    expect(
      formatSocialPeriod({ ...period, state: 'empty_period', change: null }),
    ).toContain('未满1日');
    expect(formatSocialPeriod({ ...period, change: 0 })).toContain('(0%)');
    expect(formatSocialPeriod({ ...period, change: -25 })).toContain('(-25%)');
  });
});
