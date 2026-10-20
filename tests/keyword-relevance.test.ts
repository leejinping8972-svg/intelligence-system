import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import { assessKeyword } from '../apps/web-antd/src/views/intelligence/keyword-scoring';
import { assessKeyword as assessServerKeyword } from '../server/model.js';

function sample(term: string, overrides: Partial<Keyword> = {}): Keyword {
  const now = new Date().toISOString();
  return {
    id: 'synthetic-keyword',
    term,
    seedTerm: 'omega-3',
    market: 'US',
    category: '功能性营养',
    source: 'Sorftime · Amazon / Semrush',
    growth: null,
    series: [],
    trendPoints: Array.from({ length: 53 }, (_, index) => ({
      date: new Date(Date.now() - (52 - index) * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      value: 50,
    })),
    trendCollectedAt: now,
    metrics: {
      market: 'US',
      source: 'Semrush',
      collectedAt: now,
      monthlySearchVolume: 100_000,
      difficulty: 0,
      intent: 'commercial',
    },
    favorite: false,
    productIds: [],
    siteIds: [],
    ...overrides,
  };
}

const dimension = (assessment: ReturnType<typeof assessKeyword>, key: string) =>
  assessment.dimensions.find((item) => item.key === key)?.score;

describe('supplement relevance and specificity outrank unrelated traffic', () => {
  it.each([
    'omega watches',
    'Omega Seamaster price',
    'OMEGA Speedmaster',
    'omega constellation',
    'omega de ville',
    'reloj omega',
    'relojes omega',
    'đồng hồ omega',
    '欧米茄手表',
    'omega-3 watch',
    'omega 3 for dogs',
    'omega 3 para perros',
    'omega 3 pet food',
    'omega 3 shampoo',
    'omega 3 face cream',
    'omega engine oil',
  ])(
    'caps incompatible objects despite inherited category, seed and strong metrics: %s',
    (term) => {
      const result = assessKeyword(sample(term));
      expect(result.score).toBeLessThanOrEqual(19);
      expect(result.grade).toBe('D');
      expect(dimension(result, 'relevance')).toBe(0);
      expect(result.tags).toContain('非保健品类目');
      expect(result.tags).not.toContain('商品需求词');
      expect(result.tags).not.toContain('成分词');
      expect(result.recommendation).toContain('建议排除');
    },
  );

  it.each([
    'omega',
    'omega price',
    'omega supplements',
    'omegaverse',
    'capsule wardrobe',
    'tablet computer',
  ])(
    'does not infer supplement ingredients from a seed or substrings: %s',
    (term) => {
      const result = assessKeyword(sample(term));
      expect(result.score).toBeLessThanOrEqual(49);
      expect(result.tags).not.toContain('成分词');
      expect(dimension(result, 'relevance')).toBeLessThan(50);
    },
  );

  it.each([
    'fish oil',
    'fish-oil supplements',
    'best fish oil',
    '鱼油',
    'aceite de pescado',
    'dầu cá',
  ])('lowers broad fish-oil expressions: %s', (term) => {
    const result = assessKeyword(sample(term));
    expect(result.score).toBe(59);
    expect(result.tags).toContain('泛词降权');
    expect(result.tags).toContain('种子成分匹配');
    expect(result.recommendation).toContain('细化');
  });

  it.each([
    'dietary supplements',
    '膳食补充剂',
    '保健品',
    'suplementos alimenticios',
    'thực phẩm bổ sung',
  ])('lowers category expressions even with transaction intent: %s', (term) => {
    const result = assessKeyword(sample(term));
    expect(result.score).toBeLessThanOrEqual(49);
    expect(result.tags).toContain('泛词降权');
    expect(dimension(result, 'product')).toBe(25);
  });

  it.each([
    'omega-3 softgels 1000 mg',
    'omega‑3 capsules',
    'omega 3 cápsulas',
    'viên omega 3',
    'Omega-3胶囊',
    '鱼油软胶囊1000毫克',
    'fish oil 1000mg softgels',
    'fish oil EPA DHA softgels',
  ])('recognizes specific supplement demand across markets: %s', (term) => {
    const result = assessKeyword(sample(term));
    expect(result.grade).toBe('A');
    expect(result.tags).toContain('成分词');
    expect(result.tags).toContain('剂型词');
    expect(result.tags).not.toContain('泛词降权');
    expect(result.tags).not.toContain('偏离种子成分');
    expect(result.tags).not.toContain('非保健品类目');
  });

  it('prioritizes a precise product with modest demand above broad high-volume words and watches', () => {
    const precise = sample('omega-3 softgels 1000 mg');
    Object.assign(precise.metrics ?? {}, {
      monthlySearchVolume: 1000,
      difficulty: 40,
    });
    const scores = [
      'omega seamaster',
      'dietary supplements',
      'fish oil',
      'omega-3',
      'omega-3 softgels 1000 mg',
    ].map(
      (term) =>
        assessKeyword(term === precise.term ? precise : sample(term)).score ??
        -1,
    );
    expect(scores).toEqual(scores.toSorted((a, b) => a - b));
    expect(scores[4]).toBeGreaterThan(scores[3] ?? -1);
  });

  it('keeps the keyword category out of the evidence and applies seed matching only to observed ingredients', () => {
    const row = sample('omega watch');
    const categorized = assessKeyword(row);
    expect(assessKeyword({ ...row, category: '待分类' })).toEqual(categorized);
    expect(assessKeyword(sample('creatine gummies')).tags).toContain(
      '偏离种子成分',
    );
    expect(assessKeyword(sample('creatine gummies')).score).toBeLessThanOrEqual(
      59,
    );
    expect(
      assessKeyword(sample('creatine gummies', { seedTerm: '肌酸' })).grade,
    ).toBe('A');
    expect(
      assessKeyword(
        sample('magnesium glycinate capsules', { seedTerm: 'magnesium' }),
      ).grade,
    ).toBe('A');
    expect(
      assessKeyword(sample('men vi sinh dạng viên', { seedTerm: 'probiotics' }))
        .grade,
    ).toBe('A');
    expect(
      assessKeyword(sample('unknown wellness', { category: '女性健康' })).score,
    ).toBeLessThanOrEqual(49);
  });

  it('limits informational queries and does not let stronger purchase intent undo the restriction', () => {
    const result = assessKeyword(sample('omega 3 capsules side effects'));
    expect(result.score).toBeLessThanOrEqual(64);
    expect(result.tags).toContain('内容研究词');
    expect(
      assessKeyword(sample('omega 3 capsules clinic jobs')).score,
    ).toBeLessThanOrEqual(39);
    expect(
      assessKeyword(sample('omega 3 capsules iherb')).score,
    ).toBeLessThanOrEqual(64);
  });

  it('keeps missing data pending, preserves human decisions and never mutates source records', () => {
    const row = sample('omega watches', {
      metrics: undefined,
      trendPoints: [],
      reviewStatus: 'selected',
      reviewNote: '人工备注',
      productIds: ['product-1'],
      siteIds: ['site-1'],
    });
    const before = structuredClone(row);
    const result = assessKeyword(row);
    expect(result.score).toBeNull();
    expect(result.status).toBe('pending');
    expect(result.recommendation).toContain('建议排除');
    expect(result.version).toBe('keyword-research-v3.0');
    expect(row).toEqual(before);
    expect(
      assessKeyword(sample('omega-3 softgels', { metrics: undefined })).score,
    ).toBeNull();
    const zero = sample('omega-3 softgels');
    Object.assign(zero.metrics ?? {}, { monthlySearchVolume: 0 });
    expect(assessKeyword(zero).score).toBeLessThanOrEqual(49);
    const stale = sample('omega-3 softgels');
    Object.assign(stale.metrics ?? {}, { collectedAt: '2020-01-01' });
    expect(assessKeyword(stale).score).toBeNull();
  });

  it.each([
    'omega watch',
    'omega',
    'fish oil',
    'dietary supplements',
    'omega-3',
    'omega-3 softgels 1000 mg',
    'omega-3 benefits',
    'creatine gummies',
  ])(
    'keeps the shipped server model identical to frontend results: %s',
    (term) => {
      const row = sample(term);
      expect(assessServerKeyword(row)).toEqual(assessKeyword(row));
    },
  );
});
