import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import {
  dedupeKeywords,
  keywordIdentity,
} from '../apps/web-antd/src/views/intelligence/keyword-identity';
import { assessKeyword } from '../apps/web-antd/src/views/intelligence/keyword-scoring';
import { assessKeyword as serverAssess } from '../server/model.js';
import { keywordIdentity as serverIdentity } from '../server/keyword-identity.mjs';

describe('plural variants share one list identity', () => {
  it.each([
    ['Copper Peptide', 'copper peptides'],
    ['COPPER-PEPTIDES', ' copper peptide '],
    ['magnesium capsules', 'magnesium capsule'],
    ['vitamins supplements', 'vitamin supplement'],
    ['creatine gummies', 'creatine gummy'],
    ['peptides peptides', 'peptide peptide'],
  ])('%s = %s without rewriting displayed records', (left, right) => {
    expect(keywordIdentity(left)).toBe(keywordIdentity(right));
    expect(serverIdentity(left)).toBe(keywordIdentity(right));
    const records = [
      { term: left, market: 'US' },
      { term: right, market: 'US' },
      { term: right, market: 'MX' },
    ];
    expect(dedupeKeywords(records)).toEqual([records[0], records[2]]);
    expect(records[1].term).toBe(right);
  });

  it.each([
    'diabetes',
    'citrus',
    'stress',
    'gas',
    'oasis',
    'analysis',
    'omega 3',
    'ghk cu',
  ])('does not stem arbitrary words: %s', (term) => {
    expect(keywordIdentity(term)).toBe(term);
  });

  it.each([
    ['GHK-Cu', 'GHK'],
    ['copper peptide', 'copper tripeptide 1'],
    ['vitamin c', 'vitamin d'],
    ['magnesium 100 mg', 'magnesium 200 mg'],
    ['copper peptide', 'copper peptide vs ghk cu'],
  ])('preserves different expressions: %s / %s', (left, right) => {
    expect(keywordIdentity(left)).not.toBe(keywordIdentity(right));
  });
});

describe('comparison searches cannot become selection keywords', () => {
  it.each([
    'copper tripeptide 1 vs ghk cu',
    'copper tripeptide 1 VS. GHK-Cu',
    'GHK-Cu versus copper peptides',
    'compare ghk cu and copper peptides',
    'GHK-Cu compared to copper peptides',
    'difference between copper peptides and ghk cu',
    'is ghk cu better than copper peptides',
    'is copper tripeptide 1 the same as ghk cu',
    'GHK-Cu different from copper peptide',
    'which is better ghk cu or copper peptides',
    '铜三肽-1与ghk cu对比',
    '蓝铜肽和铜肽的区别',
    '蓝铜肽与铜肽哪个好',
    'ghk cu comparación',
    'ghk cu so sánh',
    'GHK-Cu oral capsules vs copper peptide supplements',
  ])('caps even strong commercial evidence: %s', (term) => {
    const now = new Date().toISOString();
    const input: Keyword = {
      id: 'synthetic-comparison',
      term,
      batch: '蓝铜肽(GHK-Cu)',
      seedTerm: 'GHK-Cu',
      market: 'US',
      category: '待分类',
      source: 'Semrush',
      growth: null,
      series: [],
      favorite: true,
      reviewStatus: 'selected',
      productIds: [],
      siteIds: [],
      metrics: {
        market: 'US',
        source: 'Semrush',
        collectedAt: now,
        intent: '3',
        monthlySearchVolume: 100_000,
        difficulty: 0,
        searchTrend: {
          version: 1,
          status: 'collected',
          scale: 'relative_0_1',
          values: Array.from({ length: 12 }, () => 0.9),
          collectedAt: now,
          report: 'synthetic',
          message: 'synthetic',
        },
      },
    };
    const before = structuredClone(input);
    const result = assessKeyword(input);
    expect(result.score).toBeLessThanOrEqual(39);
    expect(result.grade).toBe('D');
    expect(result.tags).toContain('对比查询词');
    expect(result.tags).not.toContain('商品需求词');
    expect(result.tags).not.toContain('成分研究词');
    expect(result.decision?.action).toBe('content');
    expect(result.decision?.reason).toContain('不作为商品、成分或广告检索主词');
    expect(serverAssess(input)).toEqual(result);
    expect(input).toEqual(before);
  });
});
