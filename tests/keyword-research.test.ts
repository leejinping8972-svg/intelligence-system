import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import type { DiscoveryResponse } from '../apps/web-antd/src/views/intelligence/site-discovery';

import { describe, expect, it } from 'vitest';

import {
  runKeywordResearch,
  runKeywordTrendResearch,
} from '../apps/web-antd/src/views/intelligence/keyword-research';
import {
  assessKeyword,
  gradeForScore,
} from '../apps/web-antd/src/views/intelligence/keyword-scoring';

const today = new Date().toISOString();
function sample(overrides: Partial<Keyword> = {}): Keyword {
  const points = Array.from({ length: 53 }, (_, index) => ({
    date: new Date(Date.now() - (53 - index) * 7 * 86_400_000)
      .toISOString()
      .slice(0, 10),
    value: 40,
  }));
  return {
    id: 'test-keyword',
    term: 'magnesium glycinate gummies supplement',
    market: 'US',
    category: '功能性营养',
    source: 'Google 联想词',
    growth: null,
    series: points.map((point) => point.value),
    trendPoints: points,
    trendResolution: 'week',
    trendCollectedAt: today,
    collectedAt: today,
    favorite: false,
    productIds: [],
    siteIds: [],
    ...overrides,
  };
}
describe('keyword research decision model', () => {
  it('uses the agreed ABCD boundaries', () => {
    expect(
      [80, 79, 65, 64, 50, 49].map((score) => gradeForScore(score)),
    ).toEqual(['A', 'B', 'B', 'C', 'C', 'D']);
  });
  it('does not rate missing trends as a bad opportunity', () => {
    const result = assessKeyword(sample({ series: [], trendPoints: [] }));
    expect(result.grade).toBeNull();
    expect(result.score).toBeNull();
    expect(result.status).toBe('pending');
    expect(result.coverage).toBe(45);
  });
  it('labels the free-data model provisional and exposes missing weights', () => {
    const result = assessKeyword(sample());
    expect(result.status).toBe('provisional');
    expect(result.coverage).toBe(65);
    expect(result.grade).toBe('A');
    expect(result.tags).toContain('待补搜索量');
    expect(
      result.dimensions.find((item) => item.key === 'demand')?.score,
    ).toBeNull();
  });
  it('only produces a full rating when same-market dated indicators are present', () => {
    const result = assessKeyword(
      sample({
        metrics: {
          market: 'US',
          source: 'Semrush report',
          collectedAt: today,
          monthlySearchVolume: 10_000,
          difficulty: 20,
          top3Share: 30,
        },
      }),
    );
    expect(result.status).toBe('rated');
    expect(result.coverage).toBe(100);
    expect(result.grade).toBe('A');
  });
  it('rejects other markets and stale metrics rather than silently using them', () => {
    for (const metrics of [
      {
        market: 'VN' as const,
        source: 'report',
        collectedAt: today,
        monthlySearchVolume: 1000,
        difficulty: 10,
        top3Share: 10,
      },
      {
        market: 'US' as const,
        source: 'report',
        collectedAt: '2020-01-01',
        monthlySearchVolume: 1000,
        difficulty: 10,
        top3Share: 10,
      },
    ]) {
      const result = assessKeyword(sample({ metrics }));
      expect(result.coverage).toBe(65);
      expect(result.tags).toContain('指标待核验');
    }
  });
  it('keeps a verified zero volume distinct from missing data', () => {
    const result = assessKeyword(
      sample({
        metrics: {
          market: 'US',
          source: 'report',
          collectedAt: today,
          monthlySearchVolume: 0,
        },
      }),
    );
    expect(result.dimensions.find((item) => item.key === 'demand')?.score).toBe(
      0,
    );
    expect(result.coverage).toBe(85);
  });
  it('does not call a partial competition estimate complete', () => {
    const result = assessKeyword(
      sample({
        metrics: {
          market: 'US',
          source: 'report',
          collectedAt: today,
          monthlySearchVolume: 1000,
          difficulty: 20,
        },
      }),
    );
    expect(result.coverage).toBe(92.5);
    expect(result.status).toBe('provisional');
  });
  it('treats all-zero Google samples as insufficient evidence', () => {
    const record = sample();
    record.series = record.series.map(() => 0);
    record.trendPoints = record.trendPoints?.map((point) => ({
      ...point,
      value: 0,
    }));
    expect(assessKeyword(record).grade).toBeNull();
  });
  it('keeps Amazon discovery evidence separate from Google search volume', () => {
    const result = assessKeyword(sample({ source: 'Sorftime · Amazon' }));
    expect(result.tags).toContain('Amazon站内来源');
    expect(result.coverage).toBe(65);
    expect(
      result.dimensions.find((item) => item.key === 'demand')?.score,
    ).toBeNull();
  });
  it('marks one-off spikes and off-topic service terms', () => {
    const record = sample();
    record.series = record.series.map((_, index) => (index === 25 ? 100 : 0));
    record.trendPoints = record.trendPoints?.map((point, index) => ({
      ...point,
      value: record.series[index] || 0,
    }));
    expect(assessKeyword(record).tags).toContain('偶发尖峰');
    const off = assessKeyword(sample({ term: "women's health clinic jobs" }));
    expect(off.tags).toContain('非商品需求');
    expect(off.dimensions.find((item) => item.key === 'product')?.score).toBe(
      10,
    );
  });
});
describe('stage one collection boundary', () => {
  it('researches every collected keyword without requesting sites or products', async () => {
    const requests: Array<
      Parameters<
        typeof import('../apps/web-antd/src/views/intelligence/site-discovery').discoverSites
      >[0]
    > = [];
    const collected: Keyword[] = [];
    const trends: string[] = [];
    const transport = async (
      input: (typeof requests)[number],
    ): Promise<DiscoveryResponse> => {
      requests.push(input);
      if (input.sources?.includes('google_trends')) {
        return {
          generatedAt: today,
          groups: [],
          suggestions: [],
          trends: input.keywords.map((keyword) => ({
            keyword,
            market: 'US',
            growth: 0,
            series: [10],
            points: [{ date: '2026-10-01', value: 10 }],
            source: 'Google Trends',
            status: 'success',
            message: '',
          })),
        };
      }
      return {
        generatedAt: today,
        groups: [],
        trends: [],
        suggestions: [
          {
            keyword: 'magnesium',
            market: 'US',
            sources: [],
            items: Array.from({ length: 100 }, (_, index) => ({
              term: `magnesium ${index}`,
              source: 'Google 联想词',
            })),
          },
        ],
      };
    };
    const result = await runKeywordResearch(
      {
        accessKey: 'test',
        apiUrl: 'https://worker.example',
        seeds: ['magnesium'],
        markets: ['US'],
        sources: ['google_autocomplete'],
        limit: 100,
        depth: 1,
      },
      {
        onKeyword: (record) => collected.push(record),
        onTrend: (trend) => trends.push(trend.keyword),
        onProgress: () => {},
      },
      transport,
    );
    expect(result.keywords).toHaveLength(100);
    expect(new Set(trends).size).toBe(100);
    expect(
      collected.every(
        (record) =>
          record.productIds.length === 0 && record.siteIds.length === 0,
      ),
    ).toBe(true);
    expect(
      requests.every((request) => request.action === 'keyword_research'),
    ).toBe(true);
    expect(
      requests.every(
        (request) =>
          !request.sources?.some((source) =>
            ['enrich_products', 'site_discovery'].includes(source),
          ),
      ),
    ).toBe(true);
    expect(
      requests
        .filter((request) => request.sources?.includes('google_trends'))
        .every((request) => request.keywords.length <= 3),
    ).toBe(true);
  });
  it('refreshes only exact selected keyword-market pairs', async () => {
    const requests: Array<{ keywords: string[]; markets: string[] }> = [];
    await runKeywordTrendResearch(
      [
        sample({ term: 'magnesium', market: 'US' }),
        sample({ term: 'men vi sinh', market: 'VN' }),
      ],
      { accessKey: 'test', apiUrl: 'https://worker.example' },
      {
        onKeyword: () => {},
        onTrend: () => {},
        onProgress: () => {},
      },
      async (input) => {
        requests.push(input);
        return { generatedAt: today, groups: [], suggestions: [], trends: [] };
      },
    );
    expect(requests).toEqual([
      expect.objectContaining({ keywords: ['magnesium'], markets: ['US'] }),
      expect.objectContaining({ keywords: ['men vi sinh'], markets: ['VN'] }),
    ]);
  });
  it('reserves a fair quota for every market even if a source overreturns', async () => {
    const result = await runKeywordResearch(
      {
        accessKey: 'test',
        apiUrl: 'https://worker.example',
        seeds: ['magnesium'],
        markets: ['US', 'MX'],
        sources: ['google_autocomplete'],
        limit: 10,
        depth: 1,
      },
      { onKeyword: () => {}, onTrend: () => {}, onProgress: () => {} },
      async (input) => ({
        generatedAt: today,
        groups: [],
        trends: [],
        suggestions: input.sources?.includes('google_trends')
          ? []
          : [
              {
                keyword: 'magnesium',
                market: input.markets[0] || 'US',
                sources: [],
                items: Array.from({ length: 100 }, (_, index) => ({
                  term: `magnesium ${index}`,
                  source: 'Google 联想词',
                })),
              },
            ],
      }),
    );
    expect(result.keywords).toHaveLength(10);
    expect(
      result.keywords.filter((record) => record.market === 'US'),
    ).toHaveLength(5);
    expect(
      result.keywords.filter((record) => record.market === 'MX'),
    ).toHaveLength(5);
  });
  it('reports failed requests as missing trends for each affected word', async () => {
    const errors: string[] = [];
    const result = await runKeywordTrendResearch(
      [sample()],
      { accessKey: 'test', apiUrl: 'https://worker.example' },
      {
        onKeyword: () => {},
        onProgress: () => {},
        onTrend: (trend) => errors.push(trend.message),
      },
      async () => {
        throw new Error('HTTP 429');
      },
    );
    expect(result.trendFailures).toBe(1);
    expect(errors).toEqual(['HTTP 429']);
  });
  it('shares the Sorftime call cap across all markets and preserves source labels', async () => {
    const caps: Array<number | undefined> = [];
    const result = await runKeywordResearch(
      {
        accessKey: 'test',
        apiUrl: 'https://worker.example',
        seeds: ['magnesium'],
        markets: ['US', 'MX'],
        sources: ['sorftime'],
        depth: 1,
        limit: 10,
        sorftimeRequestLimit: 1,
      },
      { onKeyword: () => {}, onTrend: () => {}, onProgress: () => {} },
      async (input) => {
        if (input.sources?.includes('google_trends'))
          return {
            generatedAt: today,
            groups: [],
            suggestions: [],
            trends: [],
          };
        caps.push(input.sorftimeRequestLimit);
        return {
          generatedAt: today,
          groups: [],
          trends: [],
          usage: { sorftimeCalls: input.sorftimeRequestLimit ? 1 : 0 },
          suggestions: [
            {
              keyword: 'magnesium',
              market: input.markets[0] || 'US',
              items: input.sorftimeRequestLimit
                ? [{ term: 'magnesium gummies', source: 'Sorftime · Amazon' }]
                : [],
              sources: [],
            },
          ],
        };
      },
    );
    expect(caps).toEqual([1, 0]);
    expect(result.sorftimeCalls).toBe(1);
    expect(
      result.keywords.find((record) => record.term === 'magnesium gummies')
        ?.source,
    ).toBe('Sorftime · Amazon');
    expect(
      result.keywords.every(
        (record) =>
          record.siteIds.length === 0 && record.productIds.length === 0,
      ),
    ).toBe(true);
  });
  it('reserves uncertain calls after a network failure instead of reusing the same quota', async () => {
    const caps: Array<number | undefined> = [];
    const result = await runKeywordResearch(
      {
        accessKey: 'test',
        apiUrl: 'https://worker.example',
        seeds: ['magnesium'],
        markets: ['US', 'MX'],
        sources: ['sorftime'],
        depth: 1,
        limit: 10,
        sorftimeRequestLimit: 1,
      },
      { onKeyword: () => {}, onTrend: () => {}, onProgress: () => {} },
      async (input) => {
        if (input.sources?.includes('google_trends'))
          return {
            generatedAt: today,
            groups: [],
            suggestions: [],
            trends: [],
          };
        caps.push(input.sorftimeRequestLimit);
        if (caps.length === 1) throw new Error('network disconnected');
        return {
          generatedAt: today,
          groups: [],
          suggestions: [],
          trends: [],
          usage: { sorftimeCalls: 0 },
        };
      },
    );
    expect(caps).toEqual([1, 0]);
    expect(result.sorftimeUnconfirmedCalls).toBe(1);
    expect(result.sorftimeCalls).toBe(0);
  });
});
