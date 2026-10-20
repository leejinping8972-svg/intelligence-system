import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DemoState,
  Product,
  Ad,
} from '../apps/web-antd/src/views/intelligence/data';
import {
  buildRadarFindings,
  buildRadarReport,
} from '../apps/web-antd/src/views/intelligence/radar-engine';
const now = new Date('2026-10-20T04:00:00Z');
const p = (patch: Partial<Product> = {}): Product => ({
  id: 'p',
  title: 'Synthetic fiber',
  brand: 'QA',
  market: 'US',
  category: '营养',
  form: 'capsule',
  size: '',
  price: 20,
  currency: 'USD',
  ingredient: '',
  dose: '',
  claim: '',
  benefits: [],
  benefitEvidence: '',
  ingredientInsights: [],
  siteId: '',
  color: '',
  reviewed: false,
  favorite: false,
  firstSeenAt: '2026-10-20T01:00:00Z',
  evidenceUrl: 'https://example.com/product',
  dataNature: 'collected',
  ...patch,
});
const ad = (patch: Partial<Ad> = {}): Ad => ({
  id: 'a',
  market: 'US',
  brand: 'QA',
  platform: 'Meta',
  headline: 'Synthetic ad',
  copy: 'QA',
  format: 'IMAGE',
  productId: '',
  status: '投放中',
  color: '',
  firstSeenAt: '2026-10-20T01:00:00Z',
  lastCollectedAt: '2026-10-20T01:00:00Z',
  startDate: '2026-10-19',
  source: 'Meta',
  evidenceUrl: 'https://facebook.com/ads/library/?id=1',
  dataNature: 'collected',
  keywordIds: ['k'],
  ...patch,
});
const state = (products: Product[] = [], ads: Ad[] = []) =>
  ({
    products,
    ads,
    keywords: [
      {
        id: 'k',
        term: 'fiber',
        market: 'US',
        category: '营养',
        productIds: ['p'],
        series: [],
        growth: null,
      },
    ],
  }) as unknown as DemoState;
afterEach(() => vi.useRealTimers());
describe('daily discovery enters radar with truthful source decisions', () => {
  it('shows separate new ad and product candidates, report includes new ads', () => {
    vi.useFakeTimers().setSystemTime(now);
    const findings = buildRadarFindings(state([p()], [ad()]), 7, false);
    expect(findings.map((f) => f.type).toSorted()).toEqual(['ad', 'product']);
    expect(findings.find((f) => f.type === 'ad')?.status).toBe('confirmed');
    expect(findings.find((f) => f.type === 'product')?.status).toBe(
      'newly-discovered',
    );
    expect(buildRadarReport(findings, 7, 'US')).toContain('1条新广告线索');
  });
  it('excludes old dates even if discovered today and never promotes unverified publishedAt', () => {
    vi.useFakeTimers().setSystemTime(now);
    const old = p({
      decisionData: {
        listing: {
          date: '2025-01-01',
          provider: 'Sorftime',
          platform: 'Amazon',
          market: 'US',
          collectedAt: now.toISOString(),
          evidenceUrl: 'https://example.com/product',
        },
      },
    });
    expect(
      buildRadarFindings(
        state([old], [ad({ startDate: '2025-01-01' })]),
        7,
        false,
      ),
    ).toHaveLength(0);
    expect(
      buildRadarFindings(state([p({ publishedAt: '2026-10-19' })]), 7, false)[0]
        ?.status,
    ).toBe('newly-discovered');
  });
  it('missing/invalid/future first observations do not turn into today', () => {
    vi.useFakeTimers().setSystemTime(now);
    for (const firstSeenAt of [
      undefined,
      'invalid',
      '2026-11-01',
      '2026-10-20T23:00:00Z',
      '2026-02-30',
    ])
      expect(
        buildRadarFindings(
          state([p({ firstSeenAt })], [ad({ firstSeenAt })]),
          7,
          false,
        ),
      ).toHaveLength(0);
  });
  it('same ad ID stays one candidate after recurring collection, linked word evidence is retained', () => {
    vi.useFakeTimers().setSystemTime(now);
    const findings = buildRadarFindings(
      state([], [ad({ lastCollectedAt: now.toISOString() })]),
      7,
      false,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rationale.join(' ')).toContain('fiber');
    expect(findings[0]?.gaps.join(' ')).toContain('广告传播不单独证明');
  });
  it('demo ads stay excluded by default and can be explicitly included', () => {
    vi.useFakeTimers().setSystemTime(now);
    expect(
      buildRadarFindings(state([], [ad({ dataNature: 'demo' })]), 7, false),
    ).toHaveLength(0);
    expect(
      buildRadarFindings(state([], [ad({ dataNature: 'demo' })]), 7, true)[0]
        ?.status,
    ).toBe('demo');
  });
});
