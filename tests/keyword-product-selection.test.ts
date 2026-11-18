import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';
import { assessKeyword } from '../apps/web-antd/src/views/intelligence/keyword-scoring';
import { assessKeyword as serverAssess } from '../server/model.js';

const now = new Date().toISOString();
function sample(overrides: Partial<Keyword> = {}): Keyword {
  return {
    id: 'synthetic-copper',
    term: 'GHK-Cu',
    batch: '蓝铜肽(GHK-Cu)',
    seedTerm: 'GHK-Cu',
    market: 'US',
    category: '美容与抗衰',
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
      monthlySearchVolume: 50_000,
      difficulty: 30,
      searchTrend: {
        version: 1,
        status: 'collected',
        scale: 'relative_0_1',
        values: Array.from({ length: 12 }, () => 0.5),
        collectedAt: now,
        report: 'synthetic',
        message: 'synthetic',
      },
    },
    ...overrides,
  };
}
function metricsFor(input: Keyword) {
  if (!input.metrics) throw new Error('Missing synthetic metrics');
  return input.metrics;
}
function trendFor(input: Keyword) {
  const metrics = metricsFor(input);
  if (!metrics.searchTrend) throw new Error('Missing synthetic trend');
  return metrics.searchTrend;
}
const product: NonNullable<Keyword['productKeywordEvidence']>[number] = {
  basis: 'product_text_candidate',
  kind: 'ingredient',
  productId: 'synthetic-product',
  productTitle: 'GHK-Cu oral dietary supplement',
  fingerprint: 'synthetic-fingerprint',
  sourceId: 'synthetic-source',
  quote: 'GHK-Cu is listed in this oral dietary supplement.',
  url: 'https://example.com/synthetic-product',
  collectedAt: now,
};
const dimension = (row: ReturnType<typeof assessKeyword>, key: string) =>
  row.dimensions.find((d) => d.key === key);
const check = (row: ReturnType<typeof assessKeyword>, key: string) =>
  row.checks?.find((d) => d.key === key);

describe('selection research evidence and decision gates', () => {
  it.each([
    'GHK-Cu',
    'GHK Cu',
    'ghkcu',
    'Copper Tripeptide-1',
    'ghk copper peptide',
    '蓝铜肽',
  ])('recognizes the core ingredient without a dosage form: %s', (term) => {
    const result = assessKeyword(sample({ term }));
    expect(dimension(result, 'relevance')?.score).toBe(95);
    expect(result.score).toBe(79);
    expect(result.decision?.label).toBe('继续观察');
    expect(result.coverage).toBe(85);
    expect(result.status).toBe('provisional');
  });
  it('does not treat commercial intent, forms or linked IDs as oral product proof', () => {
    for (const term of [
      'GHK-Cu',
      'GHK-Cu supplement',
      'GHK-Cu capsules 100mg',
    ]) {
      const input = sample({
        term,
        productIds: ['synthetic-product'],
        siteIds: ['synthetic-site'],
      });
      metricsFor(input).intent = '0';
      const result = assessKeyword(input);
      expect(result.score).toBe(79);
      expect(dimension(result, 'product')?.score).toBeNull();
      expect(check(result, 'product')?.status).toBe('missing');
    }
  });
  it('allows A only after traceable oral product text and core demand/trend are present', () => {
    const input = sample({
      productIds: [product.productId],
      productKeywordEvidence: [product],
    });
    const result = assessKeyword(input);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.grade).toBe('A');
    expect(result.coverage).toBe(100);
    expect(result.status).toBe('rated');
    expect(result.decision?.action).toBe('research');
    expect(result.recommendation).toContain('销量');
    expect(check(result, 'product')?.source).toBe(product.url);
    expect(serverAssess(input)).toEqual(result);
  });
  it.each([
    { url: 'javascript:invalid' },
    { sourceId: '' },
    { fingerprint: '' },
    { collectedAt: '2020-01-01' },
    { quote: 'An unrelated oral dietary supplement' },
    { quote: 'GHK-Cu topical cream', productTitle: 'GHK-Cu cream' },
    { quote: 'GHK-Cu vial for research use only' },
    { quote: 'GHK-Cu is not for oral use' },
    { quote: 'GHK-Cu: do not swallow' },
    { quote: 'GHK-Cu', productTitle: 'Unspecified peptide' },
  ])(
    'does not promote untraceable, stale or incompatible product evidence: %j',
    (override) => {
      const result = assessKeyword(
        sample({
          productIds: [product.productId],
          productKeywordEvidence: [{ ...product, ...override }],
        }),
      );
      expect(result.score).toBeLessThanOrEqual(79);
      expect(dimension(result, 'product')?.score).toBeNull();
    },
  );
  it('requires the product link and does not increase score by duplicating evidence', () => {
    expect(
      dimension(
        assessKeyword(sample({ productKeywordEvidence: [product] })),
        'product',
      )?.score,
    ).toBeNull();
    const input = sample({
      productIds: [product.productId],
      productKeywordEvidence: [product],
    });
    expect(
      assessKeyword({ ...input, productKeywordEvidence: [product, product] })
        .score,
    ).toBe(assessKeyword(input).score);
  });
  it.each([
    'Tripeptide-1',
    'GHK',
    'palmitoyl tripeptide-1',
    'biotinoyl tripeptide-1',
    'tripeptide-10',
  ])(
    'keeps other peptide entities outside the GHK-Cu task even if the seed is broad: %s',
    (term) => {
      const result = assessKeyword(sample({ term, seedTerm: 'Tripeptide-1' }));
      expect(result.score).toBeLessThanOrEqual(39);
      expect(result.decision?.action).toBe('exclude');
    },
  );
  it.each([
    'ghk cu cream',
    'topical ghk-cu',
    'GHK-Cu serum',
    'GHK-Cu injections',
    'geek and gorgeous',
    'the ordinary copper peptides',
  ])(
    'excludes explicit topical, injection and skincare expressions: %s',
    (term) => {
      const result = assessKeyword(sample({ term }));
      expect(result.score).toBeLessThanOrEqual(19);
      expect(result.decision?.action).toBe('exclude');
    },
  );
  it('separates generic copper peptides from a specific copper complex', () => {
    const result = assessKeyword(sample({ term: 'copper peptides' }));
    expect(result.score).toBeLessThanOrEqual(74);
    expect(result.tags).toContain('铜肽范围待核验');
  });
  it('uses Semrush relative trend as a fallback and responds to decline', () => {
    const growing = sample();
    const declining = sample();
    trendFor(growing).values = [
      ...Array.from({ length: 9 }, () => 0.3),
      ...Array.from({ length: 3 }, () => 0.6),
    ];
    trendFor(declining).values = [
      ...Array.from({ length: 9 }, () => 0.6),
      ...Array.from({ length: 3 }, () => 0.2),
    ];
    const up = assessKeyword(growing),
      down = assessKeyword(declining);
    expect(dimension(up, 'trend')?.score).toBeGreaterThan(
      dimension(down, 'trend')?.score ?? 0,
    );
    expect(dimension(down, 'trend')?.evidence).toContain('最近3点');
    expect(down.tags).toContain('近期回落');
  });
  it('rejects stale or foreign-market Semrush curves', () => {
    for (const invalid of [
      { market: 'VN' as const },
      { collectedAt: '2020-01-01' },
    ]) {
      const input = sample();
      Object.assign(metricsFor(input), invalid);
      const result = assessKeyword(input);
      expect(dimension(result, 'trend')?.score).toBeNull();
      expect(result.decision?.action).toBe('collect');
      expect(result.score).toBeLessThanOrEqual(49);
    }
    const input = sample();
    trendFor(input).collectedAt = '2020-01-01';
    expect(check(assessKeyword(input), 'trend')?.status).toBe('stale');
  });
  it('prefers valid Google data and does not double count fallback evidence', () => {
    const input = sample({
      trendCollectedAt: now,
      trendPoints: Array.from({ length: 53 }, (_, i) => ({
        date: new Date(Date.now() - (52 - i) * 7 * 86_400_000).toISOString(),
        value: 50,
      })),
    });
    expect(check(assessKeyword(input), 'trend')?.source).toBe('Google Trends');
    expect(dimension(assessKeyword(input), 'trend')?.score).toBe(70);
    input.trendCollectedAt = '2020-01-01';
    expect(check(assessKeyword(input), 'trend')?.source).toBe(
      'Semrush月度相对趋势',
    );
  });
  it('interprets Semrush 0/1/2/3 correctly without inventing oral demand', () => {
    const results = ['0', '1', '2', '3'].map((intent) => {
      const input = sample();
      metricsFor(input).intent = intent;
      return assessKeyword(input);
    });
    expect(results[0]?.tags).toContain('商业意图线索');
    expect(results[1]?.score).toBe(79);
    expect(results[2]?.score).toBeLessThanOrEqual(64);
    expect(results[2]?.tags).not.toContain('商业意图线索');
    expect(results[3]?.tags).toContain('商业意图线索');
    expect(results.every((r) => dimension(r, 'product')?.score === null)).toBe(
      true,
    );
  });
  it('distinguishes missing, failed, pending, unavailable, stale and actual zero', () => {
    for (const [status, expected] of [
      ['failed', 'failed'],
      ['running', 'pending'],
      ['collected', 'unavailable'],
    ] as const) {
      const result = assessKeyword(
        sample({ metrics: undefined, semrushCollection: { status } }),
      );
      expect(check(result, 'demand')?.status).toBe(expected);
      expect(dimension(result, 'demand')?.score).toBeNull();
      expect(result.decision?.action).toBe('collect');
    }
    expect(
      check(assessKeyword(sample({ metrics: undefined })), 'demand')?.status,
    ).toBe('missing');
    const zero = sample();
    metricsFor(zero).monthlySearchVolume = 0;
    expect(check(assessKeyword(zero), 'demand')?.status).toBe('available');
    expect(dimension(assessKeyword(zero), 'demand')?.score).toBe(0);
    expect(assessKeyword(zero).decision?.action).toBe('defer');
  });
  it('gates strong partial data and keeps scores numeric with actionable gaps', () => {
    const input = sample({
      productIds: [product.productId],
      productKeywordEvidence: [product],
    });
    metricsFor(input).searchTrend = undefined;
    const result = assessKeyword(input);
    expect(result.score).toBeLessThanOrEqual(64);
    expect(result.decision?.action).toBe('collect');
    expect(assessKeyword(sample({ metrics: undefined })).score).toBe(49);
  });
});
