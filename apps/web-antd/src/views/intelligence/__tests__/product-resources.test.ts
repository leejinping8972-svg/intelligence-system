import { describe, expect, it } from 'vitest';
import type {
  ResourceDiscoveryInput,
  ResourceProductEvidence,
  ResourceRoute,
} from '../product-resources';
import {
  resourceExportRecord,
  resourceBudgetRows,
  resourceHasUnknownCharge,
  resourceMetricValue,
  resourceOriginalWindow,
  resourceRankingSummary,
  resourceRankingsForMode,
  resourceRouteAvailable,
  resourceSupports,
  resourceTaskCanResume,
  splitResourceLines,
  validateResourceInput,
} from '../product-resources';

const route: ResourceRoute = {
  id: 'amazon-sorftime',
  label: 'Amazon · Sorftime',
  provider: 'sorftime',
  platform: 'amazon',
  markets: ['US', 'MX'],
  modes: ['keyword', 'category', 'urls'],
  rankings: ['sample', 'platform_bestsellers'],
  operations: ['search', 'category', 'detail', 'history'],
  salesFields: [],
  history: { supported: true, reason: '只返回来源已收录历史' },
  verification: { status: 'documented_schema_guarded' },
  cost: { unit: 'sorftime_call' },
  limits: { maxProducts: 100, maxPages: 5 },
  configured: true,
};
function input(
  patch: Partial<ResourceDiscoveryInput> = {},
): ResourceDiscoveryInput {
  return {
    resourceDiscovery: true,
    routeId: route.id,
    market: 'US',
    mode: 'keyword',
    terms: 'creatine gummies',
    urls: '',
    salesWindowDays: 90,
    ranking: 'sample',
    maxProducts: 100,
    includeDetails: true,
    includeHistory: false,
    researchCategory: '运动营养',
    budget: {
      requests: 30,
      providerCalls: 20,
      sorftimeCalls: 10,
      scrapeCredits: 0,
      semrushUnits: 0,
      braveRequests: 0,
      browserPages: 0,
      modelTokens: 0,
      maxPages: 3,
      maxDetailProducts: 10,
    },
    ...patch,
  };
}
function evidence(): ResourceProductEvidence {
  return {
    version: 1,
    jobId: 'job-1',
    routeId: 'tiktok-scrapecreators',
    platform: 'tiktok_shop',
    provider: 'tiktok_shop',
    market: 'US',
    mode: 'keyword',
    queryTerms: ['creatine'],
    requestedWindow: {
      days: 90,
      start: '2026-07-24',
      end: '2026-10-21',
      kind: 'rolling_days',
      purpose: 'sales_statistics',
    },
    metric: {
      status: 'observed',
      kind: 'cumulative_units',
      value: 1200,
      raw: '1.2K+',
      unit: '件',
      precision: 'rounded',
      originalWindow: { kind: 'cumulative' },
      message: '累计已售，非90天销量',
    },
    ranking: {
      kind: 'sample',
      population: 'collected_sample',
      complete: false,
      eligible: 1,
      total: 1,
    },
    coverage: {
      scope: 'collected_sample',
      complete: false,
      reason: '本次有界采集样本',
    },
    collectedAt: '2026-10-22T12:00:00Z',
    price: {
      raw: '19.990',
      amount: 19.99,
      currency: 'USD',
      precision: 'source_decimal',
    },
    identity: {
      sourceProductId: 'product-1',
      shopId: 'shop-1',
      variantId: 'variant-1',
      variants: [{ id: 'variant-1', size: '60 gummies' }],
    },
  };
}

describe('resource discovery contracts', () => {
  it('deduplicates only exact input lines, preserving distinct URLs and keyword text', () => {
    expect(splitResourceLines(' creatine \n\ncreatine\r\nCreatine\n')).toEqual([
      'creatine',
      'Creatine',
    ]);
    expect(validateResourceInput(input(), route)).toBe('');
  });

  it('rejects unsupported countries, operations, rankings and source caps before submission', () => {
    expect(validateResourceInput(input({ market: 'VN' }), route)).toContain(
      '国家',
    );
    expect(
      validateResourceInput(input({ ranking: 'period_sales' }), route),
    ).toContain('排名口径');
    expect(validateResourceInput(input({ maxProducts: 101 }), route)).toContain(
      '最多100件',
    );
    expect(
      validateResourceInput(
        input({
          terms: Array.from({ length: 21 }, (_, i) => `word-${i}`).join('\n'),
        }),
        route,
      ),
    ).toContain('20');
    expect(
      validateResourceInput(
        input({ mode: 'keyword', ranking: 'platform_bestsellers' }),
        route,
      ),
    ).toContain('排名口径');
  });

  it('requires category receipts from the selected country and keeps the provider category identity', () => {
    const category = {
      id: '12345',
      path: ['Health', 'Sports Nutrition'],
      market: 'US',
      receiptId: 'receipt-1',
    };
    expect(
      validateResourceInput(
        input({ mode: 'category', category, ranking: 'platform_bestsellers' }),
        route,
      ),
    ).toBe('');
    expect(
      validateResourceInput(
        input({ mode: 'category', category: { ...category, receiptId: '' } }),
        route,
      ),
    ).toContain('真实平台类目');
    expect(
      validateResourceInput(
        input({ mode: 'category', category: { ...category, market: 'MX' } }),
        route,
      ),
    ).toContain('当前国家');
  });

  it('requires HTTPS public URLs and an explicit domain for local brand website paths', () => {
    expect(
      validateResourceInput(
        input({ mode: 'urls', urls: 'http://example.com/product' }),
        route,
      ),
    ).toContain('HTTPS');
    expect(
      validateResourceInput(
        input({ mode: 'urls', urls: 'https://user:pass@example.com/product' }),
        route,
      ),
    ).toContain('HTTPS');
    expect(
      validateResourceInput(
        input({ mode: 'urls', urls: 'https://example.com/product' }),
        route,
      ),
    ).toBe('');
    const website = { ...route, platform: 'website' };
    expect(validateResourceInput(input(), website)).toContain('域名');
    expect(
      validateResourceInput(input({ websiteDomain: 'example.com' }), website),
    ).toBe('');
    expect(
      validateResourceInput(
        input({ websiteDomain: 'example.com/other' }),
        website,
      ),
    ).toContain('域名');
  });

  it('keeps requests, provider credits and API units independent and bounded', () => {
    const request = input();
    request.budget.sorftimeCalls = 0;
    expect(validateResourceInput(request, route)).toContain('来源额度为0');
    request.budget.sorftimeCalls = 10;
    request.budget.requests = Number.POSITIVE_INFINITY;
    expect(validateResourceInput(request, route)).toContain('有限非负整数');
    request.budget.requests = 30;
    request.budget.scrapeCredits = 101;
    expect(validateResourceInput(request, route)).toContain('有限非负整数');
    request.budget.scrapeCredits = 0;
    request.budget.maxPages = 6;
    expect(validateResourceInput(request, route)).toContain('翻页5次');
    request.budget.maxPages = 3;
    request.budget.browserPages = 1;
    expect(validateResourceInput(request, route)).toContain('有限非负整数');
  });

  it('does not enable unconfigured routes or unsupported detail/history controls', () => {
    expect(resourceRouteAvailable(route, { sorftime: false })).toBe(false);
    expect(
      resourceRouteAvailable(
        { ...route, configured: false },
        { sorftime: true },
      ),
    ).toBe(false);
    expect(resourceSupports(route, 'history')).toBe(true);
    const limited = {
      ...route,
      operations: ['search'],
      history: { supported: false },
    };
    expect(resourceSupports(limited, 'history')).toBe(false);
    expect(resourceSupports(limited, 'detail')).toBe(false);
    expect(
      validateResourceInput(
        input({ includeDetails: false, includeHistory: true }),
        limited,
      ),
    ).toContain('不提供历史');
  });

  it('only offers bestsellers for category or actual store-list routes', () => {
    expect(resourceRankingsForMode(route, 'keyword')).toEqual(['sample']);
    expect(resourceRankingsForMode(route, 'category')).toEqual([
      'sample',
      'platform_bestsellers',
    ]);
    expect(
      resourceRankingsForMode(
        { ...route, id: 'tiktok-shop-scrapecreators' },
        'urls',
      ),
    ).toContain('platform_bestsellers');
  });
});

describe('resource task budgets and recovery', () => {
  it('keeps missing accounting distinct from confirmed zero and independent units', () => {
    const rows = resourceBudgetRows({
      usage: { requests: 0, scrapeCredits: 2 },
      reserved: { scrapeCredits: 3 },
      budget: { requests: 30, scrapeCredits: 5, modelTokens: 0 },
    });
    expect(rows.find((row) => row.key === 'requests')).toMatchObject({
      confirmed: 0,
      reserved: null,
      limit: 30,
    });
    expect(rows.find((row) => row.key === 'scrapeCredits')).toMatchObject({
      confirmed: 2,
      reserved: 3,
      limit: 5,
    });
    expect(rows.find((row) => row.key === 'semrushUnits')).toMatchObject({
      confirmed: null,
      reserved: null,
      limit: null,
    });
    expect(rows.find((row) => row.key === 'modelTokens')?.limit).toBe(0);
  });

  it('only offers recovery for a cancelled job explicitly marked resumable by the server', () => {
    const task = {
      status: 'cancelled',
      researchProgress: { resource: { resumable: true } },
    };
    expect(resourceTaskCanResume(task)).toBe(true);
    expect(resourceTaskCanResume({ ...task, status: 'partial' })).toBe(false);
    expect(
      resourceTaskCanResume({
        ...task,
        researchProgress: { resource: { resumable: false } },
      }),
    ).toBe(false);
  });

  it('never recovers unknown charges even when a stale resume flag is present', () => {
    const progress = {
      resumable: true,
      stopReasons: [
        {
          reason: 'charge_unknown',
          status: 'unknown',
          message: '未返回扣费回执',
        },
      ],
    };
    expect(resourceHasUnknownCharge(progress)).toBe(true);
    expect(
      resourceTaskCanResume({
        status: 'cancelled',
        researchProgress: { resource: progress },
      }),
    ).toBe(false);
    expect(
      resourceTaskCanResume({
        status: 'cancelled',
        researchProgress: { unknownCharges: 1, resource: { resumable: true } },
      }),
    ).toBe(false);
  });
});

describe('resource evidence display and export', () => {
  it('preserves cumulative sold text, original currency precision and variant evidence', () => {
    const source = evidence();
    const record = resourceExportRecord({
      resourceEvidence: source,
      resourceHistory: [source],
    });
    expect(record.原始销量值).toBe('1.2K+');
    expect(record.原始销量口径).toBe('采集时点累计售出件数');
    expect(record.原始统计区间).toBe('累计至采集时点');
    expect(record.销量请求窗口天数).toBe(90);
    expect(record.原币标价原文).toBe('19.990');
    expect(JSON.parse(record.资源采集证据JSON).identity.variantId).toBe(
      'variant-1',
    );
    expect(JSON.parse(record.资源历史证据JSON)).toHaveLength(1);
    expect(JSON.stringify(record)).not.toContain('订单数');
  });

  it('never displays missing, unsupported, failed or truncated metrics as zero', () => {
    for (const [status, expected] of [
      ['missing', '来源未返回'],
      ['unsupported', '不支持'],
      ['pending_history', '历史待积累'],
      ['failed', '失败'],
      ['budget_limited', '预算截断'],
    ]) {
      const source = evidence();
      source.metric = { status: status!, kind: 'units', value: 0 };
      expect(resourceMetricValue(source)).toBe(expected);
      expect(
        resourceExportRecord({ resourceEvidence: source }).原始销量值,
      ).toBe('');
    }
    const actualZero = evidence();
    actualZero.metric = {
      status: 'observed',
      kind: 'units',
      value: 0,
      unit: '件',
    };
    expect(resourceMetricValue(actualZero)).toBe('0 件');
    expect(
      resourceExportRecord({ resourceEvidence: actualZero }).原始销量值,
    ).toBe(0);
  });

  it('retains a calendar month instead of relabelling it as the requested rolling window', () => {
    const source = evidence();
    source.metric.originalWindow = {
      kind: 'calendar_month',
      start: '2026-09-01',
      end: '2026-09-30',
    };
    expect(resourceOriginalWindow(source)).toBe(
      '自然月 · 2026-09-01 至 2026-09-30',
    );
    expect(resourceOriginalWindow(source)).not.toContain('90天');
  });

  it('does not claim a top rank without comparable evidence or full-market coverage', () => {
    const source = evidence();
    expect(resourceRankingSummary(source)).toBe(
      '已采集样本排名 · 暂无可比名次 · 已采集样本范围',
    );
    source.ranking.rank = 1;
    expect(resourceRankingSummary(source)).toContain('已采集样本范围');
    expect(resourceRankingSummary(source)).not.toContain('全类目');
  });
});
