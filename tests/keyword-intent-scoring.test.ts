import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import { assessKeyword } from '../apps/web-antd/src/views/intelligence/keyword-scoring';
import { assessKeyword as assessServerKeyword } from '../server/model.js';

function sample(term: string, intent = '1'): Keyword {
  const now = new Date().toISOString();
  return {
    id: 'synthetic-intent',
    term,
    batch: '蓝铜肽(GHK-Cu)',
    seedTerm: 'GHK-Cu',
    market: 'US',
    category: '待分类',
    source: 'Semrush',
    growth: null,
    series: [],
    favorite: false,
    productIds: [],
    siteIds: [],
    metrics: {
      market: 'US',
      source: 'Semrush',
      collectedAt: now,
      intent,
      monthlySearchVolume: 100_000,
      difficulty: 0,
      searchTrend: {
        version: 1,
        status: 'collected',
        scale: 'relative_0_1',
        values: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.8, 0.8, 0.8],
        collectedAt: now,
        report: 'synthetic',
        message: 'synthetic',
      },
    },
  };
}

describe('query purpose takes precedence over ingredient traffic', () => {
  it.each([
    'ghk cu before and after',
    'is ghk cu safe',
    'ghk-cu dosage',
    'GHK-Cu before & after',
    'GHK-Cu before-and-after',
    'GHK-Cu before/after',
    'GHK-Cu before after',
    'GHK-Cu safety',
    'GHK-Cu dose',
    'GHK-Cu dosing',
    'GHK-Cu side effects',
    'GHK-Cu benefits',
    'does ghk cu work',
    'can you use copper peptides with vitamin c',
    'can I use copper peptides with retinol',
    'is ghk cu fda approved',
    'GHK-Cu clinical studies',
    'GHK-Cu 使用前后的对比',
    'GHK-Cu 是否安全',
    '蓝铜肽剂量',
    '蓝铜肽怎么用',
    '蓝铜肽有效吗',
    'ghk-cu es seguro',
    'ghk-cu dosis',
    'ghk-cu antes y después',
    'ghk-cu an toàn',
    'ghk-cu liều dùng',
    'ghk-cu trước và sau',
  ])(
    'keeps unqualified information queries outside product selection: %s',
    (term) => {
      const input = sample(term, '3');
      const original = structuredClone(input);
      const result = assessKeyword(input);
      expect(result.score).toBeLessThanOrEqual(49);
      expect(result.grade).toBe('D');
      expect(result.tags).toContain('内容研究词');
      expect(result.tags).not.toContain('商品需求词');
      expect(result.decision?.action).toBe('content');
      expect(result.decision?.label).toBe('仅供内容研究');
      expect(
        result.dimensions.find((d) => d.key === 'relevance')?.evidence,
      ).toContain('最高49');
      expect(result.checks?.find((c) => c.key === 'intent')?.message).toContain(
        '未明确口服',
      );
      expect(assessServerKeyword(input)).toEqual(result);
      expect(input).toEqual(original);
    },
  );

  it.each([
    'GHK-Cu oral supplement dosage',
    'are GHK-Cu capsules safe',
    'GHK-Cu supplement benefits',
    'GHK-Cu 口服安全性',
  ])('keeps oral information separate from purchase demand: %s', (term) => {
    const result = assessKeyword(sample(term));
    expect(result.score).toBe(64);
    expect(result.decision?.action).toBe('content');
    expect(result.tags).not.toContain('商品需求词');
    expect(result.tags).not.toContain('非保健品类目');
    expect(result.checks?.find((c) => c.key === 'intent')?.message).toContain(
      '明确口服',
    );
  });

  it('does not turn an informational query into product demand after finding an oral quote', () => {
    const input = sample('GHK-Cu dosage', '3');
    input.productIds = ['synthetic-product'];
    input.productKeywordEvidence = [
      {
        basis: 'product_text_candidate',
        kind: 'ingredient',
        productId: 'synthetic-product',
        productTitle: 'GHK-Cu oral supplement',
        fingerprint: 'synthetic-fingerprint',
        sourceId: 'synthetic-source',
        quote: 'GHK-Cu dosage guidance for this oral dietary supplement.',
        url: 'https://example.com/synthetic-product',
        collectedAt: new Date().toISOString(),
      },
    ];
    const result = assessKeyword(input);
    expect(result.checks?.find((c) => c.key === 'product')?.status).toBe(
      'available',
    );
    expect(result.coverage).toBe(100);
    expect(result.score).toBe(49);
    expect(result.decision?.action).toBe('content');
    expect(result.tags).not.toContain('商品需求词');
  });

  it.each([
    'GHK-Cu',
    'GHK Cu',
    'ghkcu',
    'ghk cu peptide',
    'Copper Tripeptide-1',
  ])(
    'retains an ingredient discovery entry despite source informational intent: %s',
    (term) => {
      const result = assessKeyword(sample(term));
      expect(result.score).toBe(79);
      expect(result.tags).toContain('成分研究词');
      expect(result.tags).toContain('用途待核验');
      expect(result.tags).not.toContain('商品需求词');
      expect(result.tags).not.toContain('内容研究词');
      expect(result.decision?.action).toBe('observe');
    },
  );

  it.each([
    'where to buy GHK-Cu capsules',
    'how to buy GHK-Cu',
    'can I buy GHK-Cu',
    'GHK-Cu supplement',
  ])(
    'retains explicit product expressions and purchasing questions: %s',
    (term) => {
      const result = assessKeyword(sample(term));
      expect(result.score).toBe(79);
      expect(result.tags).toContain('商品需求词');
      expect(result.tags).not.toContain('内容研究词');
      expect(result.checks?.find((c) => c.key === 'product')?.status).toBe(
        'missing',
      );
    },
  );

  it.each(['copper peptides for skin', 'ghk cu hair', 'ghk-cu powder'])(
    'requires oral-use verification for ambiguous use and material expressions: %s',
    (term) => {
      const result = assessKeyword(sample(term));
      expect(result.score).toBeLessThanOrEqual(64);
      expect(result.decision?.label).toBe('先核验用途');
      expect(result.tags).toContain('用途待核验');
      expect(result.tags).not.toContain('非保健品类目');
      expect(result.tags).not.toContain('商品需求词');
    },
  );

  it('does not exclude an oral supplement merely because it mentions skin or hair', () => {
    const result = assessKeyword(
      sample('GHK-Cu oral supplement for skin and hair'),
    );
    expect(result.score).toBe(79);
    expect(result.tags).toContain('商品需求词');
    expect(result.tags).not.toContain('非保健品类目');
    const combination = assessKeyword(
      sample('GHK-Cu oral supplement with retinol'),
    );
    expect(combination.tags).not.toContain('非保健品类目');
  });

  it.each([
    'GHK-Cu skincare',
    'copper peptides with retinol skincare',
    'copper peptides with tretinoin',
    'apply ghk cu on skin',
    'GHK-Cu topical dosage',
    'GHK-Cu injection safety',
    'GHK-Cu oral supplement not for oral use',
    'GHK-Cu 不可口服',
  ])(
    'excludes explicit incompatible use before any commercial or oral hints: %s',
    (term) => {
      const input = sample(term, '3');
      const result = assessKeyword(input);
      expect(result.score).toBeLessThanOrEqual(19);
      expect(result.decision?.action).toBe('exclude');
      expect(result.tags).not.toContain('商品需求词');
      expect(assessServerKeyword(input)).toEqual(result);
    },
  );

  it('uses fresh same-market informational intent only to resolve ambiguous query qualifiers', () => {
    expect(assessKeyword(sample('GHK-Cu reviews')).score).toBe(49);
    for (const intent of ['0', '1,0', '3', '2']) {
      const result = assessKeyword(sample('GHK-Cu reviews', intent));
      expect(result.tags).not.toContain('内容研究词');
    }
    for (const override of [
      { market: 'VN' as const },
      { collectedAt: '2020-01-01' },
    ]) {
      const input = sample('GHK-Cu reviews');
      if (!input.metrics) throw new Error('Missing synthetic metrics');
      Object.assign(input.metrics, override);
      const result = assessKeyword(input);
      expect(result.tags).not.toContain('内容研究词');
      expect(result.tags).not.toContain('来源偏信息查询');
    }
  });

  it('does not let mixed or transactional source intent undo explicit safety semantics', () => {
    for (const intent of ['0', '1', '2', '3', '1,0', '1,3']) {
      const result = assessKeyword(sample('is ghk cu safe', intent));
      expect(result.score).toBe(49);
      expect(result.decision?.action).toBe('content');
    }
  });
});
