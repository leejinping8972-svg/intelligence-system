import { describe, expect, it } from 'vitest';
import type {
  Ad,
  Keyword,
  Product,
  Site,
} from '../apps/web-antd/src/views/intelligence/data';
import {
  adMetrics,
  coreMetrics,
  coreExport,
  keywordMetrics,
  missingStatus,
  productMetrics,
  rollingWindow,
  siteMetrics,
} from '../apps/web-antd/src/views/intelligence/core-list-metrics';
const at = '2026-10-22T01:00:00Z';
const product = (patch = {}) =>
  ({
    id: 'p',
    market: 'VN',
    sourceProvider: 'ScrapeCreators',
    sourcePlatform: 'TikTok Shop',
    sourceProductId: '1',
    price: 250000,
    currency: 'VND',
    sourceMetrics: { collectedAt: at },
    ...patch,
  }) as Product;
const get = (metrics: ReturnType<typeof productMetrics>, key: string) =>
  metrics.find((m) => m.key === key)!;
describe('core metrics with database pagination', () => {
  it('preserves complete period evidence without sending source histories in each page', () => {
    const metric = { ...get(productMetrics(product(), 30), 'sales'), value: 60, status: 'available' as const };
    const record = product({ listSummary: true, coreSummary: { periods: { 30: [metric] } } });
    expect(get(coreMetrics('products', record, 30), 'sales').value).toBe(60);
    expect(get(coreMetrics('products', record, 90), 'sales').value).toBeNull();
  });
  it('uses server market totals and expansion evidence instead of a partial browser cache', () => {
    const site = { id: 's', market: 'US', domain: 'example.test', coreSummary: { related: { products: 120, ads: 31 } } } as Site;
    const metrics = siteMetrics(site, { complete: false, products: [product()], ads: [] });
    expect(get(metrics, 'linkedProducts').value).toBe(120);
    expect(get(metrics, 'linkedAds').value).toBe(31);
    const keyword = { id: 'k', term: 'collagen', market: 'US', coreSummary: { related: { expansions: [{ term: 'collagen gummies', source: 'Google搜索联想' }] } } } as Keyword;
    expect(get(keywordMetrics(keyword, 30, { complete: false, keywords: [] }), 'autocomplete').value).toBe(1);
  });
});
describe('core list evidence and unit boundaries', () => {
  it('uses complete market dates and exact 30/90/365 calendar windows', () => {
    expect(rollingWindow('2026-10-21T18:00:00Z', 'VN', 30)).toMatchObject({
      start: '2026-09-22',
      end: '2026-10-22',
      timezone: 'Asia/Ho_Chi_Minh',
    });
    expect(rollingWindow('2026-10-22T01:00:00Z', 'US', 90)).toMatchObject({
      start: '2026-07-23',
      end: '2026-10-21',
    });
    expect(rollingWindow(at, 'MX', 365).timezone).toBe('America/Mexico_City');
  });
  it('does not call cumulative sold monthly sales or orders', () => {
    const metrics = productMetrics(
      product({
        sourceMetrics: {
          collectedAt: at,
          soldCount: 1234,
          soldRaw: '1,234',
          soldPrecision: 'exact',
        },
      }),
      30,
    );
    expect(get(metrics, 'cumulativeSold').value).toBe('1,234');
    expect(get(metrics, 'sales').value).toBeNull();
    expect(get(metrics, 'dailySales').value).toBeNull();
    expect(get(metrics, 'reportedOrders').value).toBeNull();
    const legacy = productMetrics(
      product({ sourceMetrics: { collectedAt: at, reportedSales: 1234 } }),
      30,
    );
    expect(get(legacy, 'cumulativeSold').value).toBeNull();
    expect(get(legacy, 'unclassifiedSales').value).toBe('1234');
  });
  it('keeps native currency and unknown FX instead of zero', () => {
    expect(get(productMetrics(product(), 30), 'priceUsd').value).toBeNull();
    const fx = {
      rates: { VND: 25000, MXN: 20, USD: 1 },
      source: 'QA rate',
      collectedAt: at,
      date: '2026-10-22',
      evidenceUrl: 'https://fx.example',
    };
    expect(get(productMetrics(product(), 30, { fx }), 'priceUsd').value).toBe(
      10,
    );
    expect(
      get(productMetrics(product(), 30, { fx }), 'priceOriginal').value,
    ).toBe(250000);
    expect(
      get(
        productMetrics(product({ currency: 'USD', price: 9 }), 30),
        'priceUsd',
      ).value,
    ).toBe(9);
  });
  it('retains rounded cumulative text without exact arithmetic', () => {
    const p = product({
      sourceMetrics: {
        collectedAt: at,
        soldRaw: '10K+',
        soldPrecision: 'lower_bound',
      },
    });
    expect(get(productMetrics(p, 90), 'cumulativeSold').value).toBe('10K+');
    expect(get(productMetrics(p, 90), 'sales').value).toBeNull();
  });
  it('rejects natural-month sales as a rolling 30-day window', () => {
    const p = product({
      decisionData: {
        series: [
          {
            provider: 'QA',
            market: 'VN',
            platform: 'TikTok Shop',
            productId: '1',
            metric: 'sales_volume',
            period: 'month',
            collectedAt: at,
            points: [{ start: '2026-09-01', end: '2026-09-30', value: 900 }],
          },
        ],
      },
    });
    expect(get(productMetrics(p, 30), 'sales').value).toBeNull();
    expect(get(productMetrics(p, 30), 'sourceSales').value).toBe(900);
  });
  it('sums only complete contiguous source intervals and calculates units/day', () => {
    const points: Array<{
      start: string;
      end: string;
      value: number;
      partial?: boolean;
    }> = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(Date.parse('2026-09-22T00:00:00Z') + i * 86400000)
        .toISOString()
        .slice(0, 10);
      return { start: date, end: date, value: 3 };
    });
    const p = product({
      decisionData: {
        series: [
          {
            provider: 'QA',
            market: 'VN',
            platform: 'TikTok Shop',
            productId: '1',
            metric: 'sales_volume',
            period: 'day',
            collectedAt: at,
            points,
          },
        ],
      },
    });
    expect(get(productMetrics(p, 30), 'sales').value).toBe(90);
    expect(get(productMetrics(p, 30), 'dailySales').value).toBe(3);
    points[5]!.partial = true;
    expect(get(productMetrics(p, 30), 'sales').value).toBeNull();
  });
  it('requires exact snapshot elapsed time; shows other actual intervals separately', () => {
    const history = [
      { at: '2026-09-21T17:00:00Z', sold: 10 },
      { at: '2026-10-21T17:00:00Z', sold: 100 },
    ].map((v) => ({
      ...v,
      soldPrecision: 'exact',
      scope: '1',
      market: 'VN',
      source: 'ScrapeCreators',
      platform: 'TikTok Shop',
      evidenceUrl: '',
    }));
    const p = product({ coreEvidence: { version: 1, history } });
    expect(get(productMetrics(p, 30), 'sales')).toMatchObject({
      value: 90,
      nature: 'snapshot_delta',
    });
    history[0]!.at = '2026-09-22T02:00:00Z';
    expect(get(productMetrics(p, 30), 'sales').value).toBeNull();
    expect(get(productMetrics(p, 30), 'observedDelta').value).toBe(90);
    history[1]!.sold = 5;
    expect(get(productMetrics(p, 30), 'observedDelta').value).toBeNull();
  });
  it('rejects mismatched market and third-party unknown counts', () => {
    const p = product({
      sourcePlatform: 'Amazon',
      sourceMetrics: { collectedAt: at, reportedSales: 999 },
    });
    expect(get(productMetrics(p, 30), 'cumulativeSold').value).toBeNull();
    const site = {
      id: 's',
      market: 'VN',
      domain: 'example.com',
      metrics: { market: 'US', organicTraffic: 1000 },
    } as Site;
    expect(get(siteMetrics(site), 'organicTraffic').value).toBeNull();
  });
  it.each([
    ['failed', 'failed'],
    ['unsupported', 'unsupported'],
    ['empty', 'not_indexed'],
    ['pending', 'accumulating'],
    ['budget_limited', 'budget_limited'],
  ])('keeps missing status %s distinct', (raw, status) => {
    expect(missingStatus(raw)).toBe(status);
  });
  it('keeps real source zero distinct from no source', () => {
    const s = {
      market: 'VN',
      domain: 'example.com',
      metrics: {
        market: 'VN',
        organicTraffic: 0,
        source: 'Semrush',
        collectedAt: at,
      },
    } as Site;
    expect(get(siteMetrics(s), 'organicTraffic')).toMatchObject({
      value: 0,
      status: 'available',
    });
    expect(get(siteMetrics(s), 'revenue')).toMatchObject({
      value: null,
      status: 'unsupported',
    });
  });
  it('labels paid search separately from social ads and computes reference uses from saved evidence', () => {
    const s = {
      id: 's',
      market: 'VN',
      domain: 'example.com',
      metrics: {
        market: 'VN',
        paidTraffic: 5,
        source: 'Semrush',
        collectedAt: at,
      },
    } as Site;
    const metrics = siteMetrics(s, {
      products: [product({ siteId: 's', ingredient: 'magnesium' })],
      ads: [
        {
          market: 'VN',
          siteIds: ['s'],
          imageUrls: ['https://img.example/a.jpg'],
        } as Ad,
      ],
    });
    expect(get(metrics, 'paidTraffic').reason).toContain('不是FB/TK');
    expect(get(metrics, 'linkedAds').value).toBe(1);
    expect(get(metrics, 'referenceUse').value).toContain('销售参考待证实');
  });
  it('never invents ad business results from active status or long observation', () => {
    const a = {
      market: 'VN',
      status: '投放中',
      startDate: '2025-01-01',
      firstSeenAt: '2026-01-01',
      lastCollectedAt: at,
      source: 'Meta',
      platform: 'Meta',
    } as Ad;
    const metrics = adMetrics(a);
    expect(get(metrics, 'startDate').value).toBe('2025-01-01');
    expect(get(metrics, 'firstObserved').value).toBe('2026-01-01');
    expect(get(metrics, 'roas')).toMatchObject({
      value: null,
      status: 'unsupported',
    });
  });
  it('separates related queries, autocomplete and AI and deduplicates across types', () => {
    const k = {
      id: 'k',
      term: 'collagen',
      market: 'VN',
      productIds: ['p'],
      siteIds: ['s'],
      trendRelatedTop: [
        { query: 'collagen gummy', value: 100, formattedValue: '100' },
      ],
      trendRelatedRising: [
        { query: 'Collagen Gummy', value: null, formattedValue: 'Breakout' },
      ],
    } as Keyword;
    const keywords = [
      {
        term: 'collagen gummy',
        seedTerm: 'collagen',
        market: 'VN',
        source: 'Google 联想词',
      },
      {
        term: 'collagen powder',
        seedTerm: 'collagen',
        market: 'VN',
        source: 'AI建议',
      },
      {
        term: 'ignored',
        seedTerm: 'collagen',
        market: 'US',
        source: 'Google 联想词',
      },
    ] as Keyword[];
    const metrics = keywordMetrics(k, 90, { keywords });
    expect(get(metrics, 'expansionCount').value).toBe(2);
    expect(get(metrics, 'autocomplete').value).toBe(1);
    expect(get(metrics, 'aiSuggestions').value).toBe(1);
    expect(get(metrics, 'searchVolume').value).toBeNull();
    expect(get(metrics, 'relativeHeat').value).toBeNull();
  });
  it('computes relative heat across exact 90 and 365 day windows with no absolute volume conversion', () => {
    const points = Array.from({ length: 730 }, (_, i) => ({
      date: new Date(Date.parse(at.slice(0, 10)) - (730 - i) * 86400000)
        .toISOString()
        .slice(0, 10),
      value: 40,
    }));
    const k = {
      market: 'VN',
      trendHistoryPoints: points,
      trendHistoryResolution: 'day',
      trendHistoryCollectedAt: at,
    } as Keyword;
    for (const days of [90, 365] as const) {
      const metrics = keywordMetrics(k, days);
      expect(get(metrics, 'relativeHeat').value).toBe(40);
      expect(get(metrics, 'trendChange').value).toBe(0);
      expect(get(metrics, 'searchVolume').value).toBeNull();
    }
  });
  it('exports every period, metadata, unknown reasons, raw fields and observations', () => {
    const row = coreExport('products', product());
    expect(row['30天_sales_值']).toBe('');
    expect(row['90天_sales_状态']).toBe('待积累');
    expect(row['365天_sales_单位']).toBe('件');
    expect(row['priceOriginal_值']).toBe(250000);
    expect(row['priceOriginal_市场']).toBe('VN');
    expect(row['原始字段JSON']).toContain('250000');
  });
});
