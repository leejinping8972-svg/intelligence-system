import { describe, expect, it } from 'vitest';

import { keywordChineseName } from '../apps/web-antd/src/views/intelligence/keyword-names';
import {
  collectionTimeLabel,
  productCollectedAt,
  siteCollectedAt,
} from '../apps/web-antd/src/views/intelligence/resource-metadata';

describe('real collection timestamps', () => {
  it('uses successful resource evidence and not source publication or task dates', () => {
    expect(
      siteCollectedAt({
        lastCollectedAt: 'bad',
        sourceEvidence: [
          { source: '官网', collectedAt: '2026-10-19T01:00:00Z' },
          { source: '广告', collectedAt: '2026-10-20T01:00:00Z' },
        ],
      }),
    ).toBe('2026-10-20T01:00:00Z');
    expect(
      productCollectedAt({
        lastCollectedAt: '2026-10-19T00:00:00Z',
        sourceMetrics: { collectedAt: '2026-10-20T01:00:00Z' },
      }),
    ).toBe('2026-10-20T01:00:00Z');
    expect(
      productCollectedAt({
        sourceMetrics: { observedAt: '2026-10-20T01:00:00Z' },
      }),
    ).toBeUndefined();
    expect(siteCollectedAt({})).toBeUndefined();
  });
  it('formats Beijing time, keeps unknown/date-only distinct from a fabricated timestamp', () => {
    expect(collectionTimeLabel('2026-10-20T01:02:03Z')).toBe(
      '2026/10/20 09:02:03',
    );
    expect(collectionTimeLabel('2026-10-20')).toBe('2026-10-20（仅日期）');
    expect(collectionTimeLabel('bad')).toBe('未记录');
    expect(collectionTimeLabel()).toBe('未记录');
  });
});
describe('chinese keyword reading aid', () => {
  it('prefers saved names and translates nutrition terms without altering identifiers or brands', () => {
    expect(
      keywordChineseName({ term: 'creatine gummies', termZh: ' 已校对译名 ' }),
    ).toBe('已校对译名');
    expect(keywordChineseName({ term: 'creatine gummies' })).toBe('肌酸软糖');
    expect(keywordChineseName({ term: 'OMNI creatine gummies 5g' })).toBe(
      'OMNI 肌酸软糖 5g',
    );
    expect(keywordChineseName({ term: 'magnesium glycinate' })).toBe(
      '甘氨酸镁',
    );
    expect(keywordChineseName({ term: 'gomitas de creatina' })).toBe(
      '软糖 de 肌酸',
    );
  });
  it('does not guess unknown words or replace ingredient substrings', () => {
    expect(keywordChineseName({ term: 'creatinine' })).toBe('');
    expect(keywordChineseName({ term: 'UnknownBrand' })).toBe('');
    expect(
      keywordChineseName({ term: 'what is magnesium glycinate good for' }),
    ).toBe('甘氨酸镁有什么作用');
  });
});
