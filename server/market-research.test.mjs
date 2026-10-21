/* oxlint-disable vitest/no-import-node-test -- Standalone backend tests. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { pool } from './database.mjs';
import {
  marketResearchAction,
  tickMarketResearch,
} from './market-research.mjs';
import {
  buildMarketSnapshot,
  marketModelSample,
  marketObservationRecords,
  publicSnapshot,
  reportRange,
  snapshotEvidence,
  validateMarketReport,
} from './market-report-domain.mjs';
import { runMarketReport } from './market-report-jobs.mjs';
import {
  defaultMarketPlan,
  marketChildRequestId,
  marketRunStages,
  validateMarketPlan,
} from './market-research-domain.mjs';

const plan = (patch = {}) =>
  validateMarketPlan({
    ...defaultMarketPlan('VN'),
    seeds: ['collagen', 'men vi sinh'],
    keywordIds: ['keyword-vn'],
    ...patch,
  });

test('Vietnam market plan keeps TikTok, active Meta and independent-site stages with bounded budgets', () => {
  const value = plan();
  assert.equal(value.market, 'VN');
  assert.equal(value.language, 'vi');
  assert.equal(value.budgets.maxProducts, 1000);
  assert.deepEqual(
    marketRunStages(value).map((stage) => stage.key),
    [
      'tiktok_shop',
      'tiktok_content',
      'tiktok_comments',
      'meta_ads',
      'site_products',
    ],
  );
  assert.throws(() => plan({ budgets: { maxProducts: 1001 } }), /1～1000/);
  assert.throws(
    () =>
      plan({
        keywordIds: [],
        sources: { ...value.sources, metaActiveAds: true },
      }),
    /关键词/,
  );
});

test('country report freezes only records inside the selected period and keeps platform sales as snapshot metadata', () => {
  const request = validateMarketReport({
    market: 'VN',
    period: 'week',
    endDate: '2026-10-21',
  });
  assert.deepEqual(reportRange('week', '2026-10-21'), {
    startAt: '2026-10-15T00:00:00.000Z',
    endAt: '2026-10-21T23:59:59.999Z',
  });
  const product = {
    id: 'p1',
    market: 'VN',
    title: 'Collagen Gummies',
    sourcePlatform: 'TikTok Shop',
    lastCollectedAt: '2026-10-20T08:00:00.000Z',
    sourceMetrics: { reportedSales: 321, reviewCount: 40 },
    ingredientInsights: [{ name: 'Collagen' }],
    evidenceUrl: 'https://shop.tiktok.com/view/product/1',
  };
  const snapshot = buildMarketSnapshot(
    {
      products: [
        product,
        { ...product, id: 'old', lastCollectedAt: '2026-10-01T08:00:00.000Z' },
      ],
      ads: [
        {
          id: 'a1',
          market: 'VN',
          status: 'ACTIVE',
          brand: 'Brand A',
          copy: 'Collagen daily',
          lastCollectedAt: '2026-10-19T08:00:00.000Z',
          evidenceUrl: 'https://www.facebook.com/ads/library/?id=1',
        },
      ],
      sites: [],
      content: [],
      comments: [],
    },
    request,
  );
  assert.equal(snapshot.coverage.products, 1);
  assert.equal(snapshot.coverage.tiktokShopProducts, 1);
  assert.equal(snapshot.coverage.activeMetaAds, 1);
  assert.equal(snapshot.topProducts[0].reportedSales, 321);
  assert.equal(snapshot.topIngredients[0].name, 'Collagen');
  const evidence = snapshotEvidence(snapshot);
  assert.equal(evidence.length, 2);
  assert.ok(evidence.every((record) => record.id.startsWith('market-')));
  assert.equal(Object.hasOwn(publicSnapshot(snapshot), '_records'), false);
});

test('market report job persists a frozen report without requiring a model key', async () => {
  const saved = new Map();
  let finalStatus = '';
  await runMarketReport(
    {
      id: '00000000-0000-4000-8000-000000000001',
      input: {
        kind: 'market_analysis',
        reportType: 'market',
        title: '越南市场周报',
        market: 'VN',
        markets: ['VN'],
        period: 'week',
        endDate: '2026-10-21',
        analyze: false,
        researchFocus: '',
      },
      checkpoint: { submittedAt: '2026-10-21T08:00:00.000Z' },
    },
    {
      products: async () => [
        {
          id: 'p1',
          market: 'VN',
          title: 'Probiotic',
          sourcePlatform: 'TikTok Shop',
          lastCollectedAt: '2026-10-20T08:00:00.000Z',
          evidenceUrl: 'https://shop.tiktok.com/view/product/1',
        },
      ],
      ads: async () => [],
      sites: async () => [],
      content: async () => [],
      comments: async () => [],
      history: async () => ({
        products: [],
        ads: [],
        sites: [],
        content: [],
        comments: [],
      }),
      put: async (key, value) => saved.set(key, structuredClone(value)),
      checkpoint: async (_value, status) => {
        finalStatus = status;
      },
      cancelled: async () => false,
      read: async () => undefined,
    },
  );
  const report = saved.get(
    'business:insightReports:00000000-0000-4000-8000-000000000001',
  );
  assert.equal(finalStatus, 'completed');
  assert.equal(report.reportType, 'market');
  assert.equal(report.marketSnapshot.coverage.tiktokShopProducts, 1);
  assert.equal(report.evidenceIds.length, 1);
  assert.ok(
    saved.has('business:marketSnapshots:00000000-0000-4000-8000-000000000001'),
  );
});

test('real Meta status labels count active ads, exclude unknowns and never recycle generated market evidence', () => {
  const at = '2026-10-20T08:00:00.000Z';
  const snapshot = buildMarketSnapshot(
    {
      products: [
        { id: 'demo', title: 'Demo', dataNature: 'demo', collectedAt: at },
      ],
      ads: ['投放中', '已停止', '未知', 'ACTIVE'].map((status, index) => ({
        id: `ad-${index}`,
        status,
        collectedAt: at,
      })),
      sites: [],
      content: [],
      comments: [
        {
          id: 'native-comment',
          kind: 'comment',
          text: 'price?',
          collectedAt: at,
        },
        {
          id: 'market-derived-comment',
          kind: 'comment',
          text: 'price?',
          collectedAt: at,
        },
      ],
    },
    { market: 'VN', period: 'week', endDate: '2026-10-21' },
  );
  assert.equal(snapshot.coverage.activeMetaAds, 2);
  assert.equal(snapshot.coverage.products, 0);
  assert.equal(snapshot.coverage.consumerComments, 1);
  assert.throws(
    () =>
      validateMarketReport({
        market: 'VN',
        period: 'week',
        endDate: '2026-02-30',
      }),
    /日期/,
  );
});

test('historical observations preserve actual collection dates and do not make stale records current', () => {
  const history = marketObservationRecords([
    {
      capturedAt: '2026-10-20T08:00:00.000Z',
      products: [
        {
          id: 'old',
          title: 'Old item',
          collectedAt: '2026-09-01T08:00:00.000Z',
        },
      ],
      comments: [
        {
          id: 'market-derived-comment',
          text: 'copy',
          collectedAt: '2026-10-20T08:00:00.000Z',
        },
      ],
    },
  ]);
  const snapshot = buildMarketSnapshot(history, {
    market: 'VN',
    period: 'week',
    endDate: '2026-10-21',
  });
  assert.equal(snapshot.coverage.products, 0);
  assert.equal(snapshot.coverage.consumerComments, 0);
});

test('a thousand products remain auditable while model sampling reserves space for every source and different comment videos', () => {
  const at = '2026-10-20T08:00:00.000Z';
  const snapshot = buildMarketSnapshot(
    {
      products: Array.from({ length: 1000 }, (_, index) => ({
        id: `product-${index}`,
        title: `Collagen ${index}`,
        collectedAt: at,
      })),
      ads: [
        { id: 'ad', status: '投放中', copy: 'Daily collagen', collectedAt: at },
      ],
      sites: [{ id: 'site', domain: 'example.com', collectedAt: at }],
      content: [
        {
          id: 'video',
          source: 'tiktok',
          title: 'Collagen',
          summary: 'Original caption',
          collectedAt: at,
        },
      ],
      comments: Array.from({ length: 200 }, (_, index) => ({
        id: `comment-${index}`,
        text: 'price?',
        sourceUrl:
          index < 199
            ? 'https://www.tiktok.com/@a/video/1'
            : 'https://www.tiktok.com/@b/video/2',
        collectedAt: at,
      })),
    },
    { market: 'VN', period: 'week', endDate: '2026-10-21' },
  );
  const evidence = snapshotEvidence(snapshot);
  assert.equal(
    evidence.filter((record) => record.kind === 'product').length,
    1000,
  );
  const sample = marketModelSample(evidence, 10);
  assert.equal(sample.length, 10);
  assert.equal(new Set(sample.map((record) => record.kind)).size, 5);
  assert.equal(
    new Set(
      sample
        .filter((record) => record.kind === 'comment')
        .map((record) => record.sourceUrl),
    ).size,
    2,
  );
  assert.ok(sample.some((record) => record.text.includes('Original caption')));
});

test('child submission IDs remain stable across restarts and differ between stages and content queries', () => {
  const id = marketChildRequestId('run-1', 'tiktok_shop');
  assert.match(id, /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
  assert.equal(marketChildRequestId('run-1', 'tiktok_shop'), id);
  assert.notEqual(marketChildRequestId('run-1', 'meta_ads'), id);
  assert.notEqual(
    marketChildRequestId('run-1', 'tiktok_content', 0),
    marketChildRequestId('run-1', 'tiktok_content', 1),
  );
});

test('report restart reuses frozen records and does not repeat an uncertain model call', async () => {
  const request = { market: 'VN', period: 'week', endDate: '2026-10-21' };
  const frozen = buildMarketSnapshot(
    {
      products: [
        { id: 'p', title: 'Original', collectedAt: '2026-10-20T08:00:00.000Z' },
      ],
      ads: [],
      sites: [],
      content: [],
      comments: [],
    },
    request,
  );
  const saved = new Map([['business:marketSnapshots:report-1', frozen]]);
  let calls = 0;
  await runMarketReport(
    {
      id: 'report-1',
      input: { ...request, analyze: true },
      checkpoint: { modelStarted: true },
    },
    {
      products: async () => [
        {
          id: 'p',
          title: 'Changed after freeze',
          collectedAt: '2026-10-21T08:00:00.000Z',
        },
      ],
      ads: async () => [],
      sites: async () => [],
      content: async () => [],
      comments: async () => [],
      history: async () => ({
        products: [],
        ads: [],
        sites: [],
        content: [],
        comments: [],
      }),
      read: async (key) => saved.get(key),
      put: async (key, value) => saved.set(key, structuredClone(value)),
      checkpoint: async () => {},
      cancelled: async () => false,
      analyze: async () => {
        calls++;
      },
    },
  );
  const report = saved.get('business:insightReports:report-1');
  assert.equal(calls, 0);
  assert.equal(report.marketSnapshot.topProducts[0].title, 'Original');
  assert.equal(report.status, 'partial');
  assert.match(report.modelError, /未自动重复调用/);
});

test('country orchestration queues one real child, polls it, freezes observations and cancels without resubmission', async () => {
  const docs = new Map(),
    jobs = new Map();
  const selected = {
    id: 'keyword-vn',
    term: 'collagen',
    market: 'VN',
    reviewStatus: 'selected',
  };
  const oldQuery = pool.query,
    oldConnect = pool.connect;
  const query = async (statement, params = []) => {
    if (/pg_try_advisory_lock/.test(statement))
      return { rows: [{ locked: true }] };
    if (/pg_advisory_unlock/.test(statement)) return { rows: [] };
    if (/FROM provider_configs/.test(statement))
      return { rows: [{ name: 'provider:scrapecreators:v1' }] };
    if (/FROM research_keywords/.test(statement))
      return { rows: [{ natural_key: 'VN:collagen', data: selected }] };
    if (/INSERT INTO workspace_documents/.test(statement)) {
      docs.set(params[0], structuredClone(params[1]));
      return { rows: [] };
    }
    if (/FROM workspace_documents/.test(statement)) {
      if (/name=\$1/.test(statement))
        return {
          rows: docs.has(params[0])
            ? [{ value: structuredClone(docs.get(params[0])) }]
            : [],
        };
      const prefix = (
        params[0] ||
        statement.match(/name LIKE '([^']+)'/)?.[1] ||
        ''
      ).replace(/%$/, '');
      return {
        rows: [...docs]
          .filter(
            ([name, value]) =>
              name.startsWith(prefix) &&
              (!statement.includes("IN ('queued','running')") ||
                ['queued', 'running'].includes(value.status)),
          )
          .map(([name, value]) => ({ name, value: structuredClone(value) })),
      };
    }
    if (/INSERT INTO research_jobs/.test(statement)) {
      jobs.set(params[0], {
        id: params[0],
        request_id: params[1],
        input: params[2],
        checkpoint: params[3],
        status: 'queued',
        cancelled: false,
      });
      return { rows: [] };
    }
    if (/UPDATE research_jobs SET cancelled=true/.test(statement)) {
      Object.assign(jobs.get(params[0]), {
        cancelled: true,
        status: 'cancelled',
      });
      return { rows: [] };
    }
    if (/FROM research_jobs/.test(statement)) {
      const rows = [...jobs.values()].filter((job) => {
        if (statement.includes('request_id=$1'))
          return job.request_id === params[0];
        if (statement.includes('id=$1')) return job.id === params[0];
        return ['queued', 'running'].includes(job.status) && !job.cancelled;
      });
      return { rows: structuredClone(rows) };
    }
    throw new Error(`Unexpected test query: ${statement}`);
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  try {
    const value = plan({
      sources: {
        tiktokShop: true,
        tiktokContent: false,
        tiktokComments: false,
        metaActiveAds: false,
        independentSites: false,
      },
    });
    const user = { id: 'test-admin', role: 'admin' };
    const start = () =>
      marketResearchAction(
        { action: 'server_market_collection_run', plan: value },
        user,
      );
    const { run } = await start();
    await assert.rejects(start(), /已有运行中的采集计划/);
    await tickMarketResearch();
    await tickMarketResearch();
    assert.equal(jobs.size, 1);
    const child = [...jobs.values()][0];
    assert.deepEqual(child.input.providers, ['tiktok_shop']);
    assert.equal(child.input.market, 'VN');
    child.status = 'completed';
    docs.set('business:products:p', {
      id: 'p',
      market: 'VN',
      title: 'Collagen',
      collectedAt: new Date().toISOString(),
    });
    await tickMarketResearch();
    await tickMarketResearch();
    assert.equal(
      docs.get(`market:collection:run:${run.id}`).status,
      'completed',
    );
    assert.equal(
      docs.get(`market:observation:VN:${run.id}`).products.length,
      1,
    );
    const second = await start();
    await tickMarketResearch();
    await marketResearchAction(
      { action: 'server_market_collection_cancel', runId: second.run.id },
      user,
    );
    await tickMarketResearch();
    assert.equal(jobs.size, 2);
    assert.equal([...jobs.values()][1].cancelled, true);
    assert.equal(
      docs.get(`market:collection:run:${second.run.id}`).status,
      'cancelled',
    );
  } finally {
    pool.query = oldQuery;
    pool.connect = oldConnect;
  }
});
