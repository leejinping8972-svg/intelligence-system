import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createKeywordSaver } from './keyword-store.mjs';
import { cleanKeyword } from './domain.mjs';
import { mergeKeyword, mergeKeywordMetrics } from './keyword-data.mjs';

const oldAt = '2026-10-20T00:00:00Z';
const newAt = '2026-10-26T00:00:00Z';
const metrics = (patch = {}) => ({
  market: 'US',
  source: 'Semrush',
  collectedAt: oldAt,
  monthlySearchVolume: 100,
  cpc: 2,
  ...patch,
});
const keyword = (patch = {}) =>
  cleanKeyword({
    term: 'Magnesium Glycinate',
    market: 'US',
    dataNature: 'collected',
    collectedAt: oldAt,
    updatedAt: oldAt,
    ...patch,
  });

test('reruns refresh partial metrics including zero while retaining manual edits, links and source history', () => {
  const current = keyword({
    id: 'original',
    favorite: true,
    reviewStatus: 'selected',
    reviewNote: 'keep',
    termZh: 'manual translation',
    productIds: ['p1'],
    siteIds: ['s1'],
    metrics: metrics(),
    source: 'Semrush热词',
  });
  const next = mergeKeyword(
    current,
    keyword({
      id: 'new',
      metrics: metrics({
        collectedAt: newAt,
        monthlySearchVolume: 0,
        cpc: undefined,
      }),
      productIds: ['p2'],
      siteIds: [],
      source: '用户种子词',
      collectedAt: newAt,
    }),
  );
  assert.equal(next.id, 'original');
  assert.equal(next.metrics.monthlySearchVolume, 0);
  assert.equal(next.metrics.cpc, 2);
  assert.equal(next.metrics.collectedAt, newAt);
  assert.equal(next.favorite, true);
  assert.equal(next.reviewStatus, 'selected');
  assert.equal(next.reviewNote, 'keep');
  assert.equal(next.termZh, 'manual translation');
  assert.deepEqual(next.productIds, ['p1', 'p2']);
  assert.deepEqual(next.siteIds, ['s1']);
  assert.equal(next.source, 'Semrush热词 / 用户种子词');
});

test('empty, invalid, other-market and older results cannot erase successful metrics', () => {
  const current = keyword({ metrics: metrics({ collectedAt: newAt }) });
  for (const value of [
    null,
    undefined,
    {},
    metrics({ market: 'MX' }),
    metrics(),
    { market: 'US', source: 'Semrush', collectedAt: newAt },
    metrics({ collectedAt: newAt, monthlySearchVolume: -1, cpc: NaN }),
  ])
    assert.deepEqual(mergeKeywordMetrics(current, value), current.metrics);
});

test('source groups update independently and delayed trend snapshots cannot revert newer metrics or daily data', () => {
  const current = keyword({
    series: [10],
    trendCollectedAt: oldAt,
    trendStatus: 'collected',
    metrics: metrics({ collectedAt: newAt }),
    trendDailyPoints: [{ date: '2026-10-25', value: 30 }],
    trendDailyCollectedAt: newAt,
  });
  const next = mergeKeyword(
    current,
    keyword({
      series: [20],
      trendCollectedAt: newAt,
      trendStatus: 'collected',
      metrics: metrics(),
      trendDailyPoints: [{ date: '2026-10-19', value: 5 }],
      trendDailyCollectedAt: oldAt,
    }),
  );
  assert.deepEqual(next.series, [20]);
  assert.equal(next.trendCollectedAt, newAt);
  assert.deepEqual(next.metrics, current.metrics);
  assert.deepEqual(next.trendDailyPoints, current.trendDailyPoints);
  const failed = mergeKeyword(
    next,
    keyword({
      series: [],
      trendStatus: 'failed',
      trendCollectedAt: newAt,
      trendDailyPoints: [],
      trendDailyCollectedAt: newAt,
      updatedAt: newAt,
    }),
  );
  assert.deepEqual(failed.series, [20]);
  assert.equal(failed.trendStatus, 'collected');
  assert.equal(failed.trendCollectedAt, newAt);
  assert.deepEqual(failed.trendDailyPoints, current.trendDailyPoints);
});

test('duplicate imports only fill missing source groups and retain collected metrics and user fields', () => {
  const current = keyword({
    id: 'original',
    termZh: 'keep',
    metrics: metrics(),
    series: [],
  });
  const imported = keyword({
    termZh: 'replace',
    metrics: metrics({ monthlySearchVolume: 300, collectedAt: newAt }),
    series: [20],
    trendCollectedAt: newAt,
  });
  const next = mergeKeyword(current, imported, true);
  assert.equal(next.id, 'original');
  assert.equal(next.termZh, 'keep');
  assert.equal(next.metrics.monthlySearchVolume, 100);
  assert.deepEqual(next.series, [20]);
});

test('SQL persistence keeps one canonical row and stable ID across reruns, imports and separate markets', async () => {
  const db = new PGlite();
  // PGlite has one connection; serialize connection leases just as a database locks rows.
  let available = Promise.resolve();
  const query = (statement, params = []) =>
    db.query(
      statement,
      params.map((p) => (p && typeof p === 'object' ? JSON.stringify(p) : p)),
    );
  const pool = {
    query,
    async connect() {
      const previous = available;
      let release;
      available = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      return { query, release };
    },
  };
  const save = createKeywordSaver({ pool, sql: (pg) => pg });
  try {
    await db.exec(
      'CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now())',
    );
    const original = await save(
      keyword({
        id: 'original',
        favorite: true,
        metrics: metrics(),
        productIds: ['p1'],
      }),
    );
    const rerun = await save(
      keyword({
        term: '  ＭＡＧＮＥＳＩＵＭ   GLYCINATE ',
        metrics: metrics({ monthlySearchVolume: 200, collectedAt: newAt }),
      }),
    );
    assert.equal(rerun.id, original.id);
    assert.equal(rerun.metrics.monthlySearchVolume, 200);
    assert.equal(rerun.favorite, true);
    const concurrent = await Promise.all(
      ['MAGNESIUM GLYCINATE', 'magnesium glycinate'].map((term, index) =>
        save(keyword({ term, productIds: [`p${index + 2}`] })),
      ),
    );
    assert.ok(concurrent.every((record) => record.id === original.id));
    assert.deepEqual(
      (await query('SELECT data FROM research_keywords')).rows[0].data
        .productIds,
      ['p1', 'p2', 'p3'],
    );
    const imported = await save(
      keyword({ term: 'magnesium glycinate', metrics: metrics() }),
      true,
    );
    assert.equal(imported.id, original.id);
    assert.equal(imported.metrics.monthlySearchVolume, 200);
    assert.equal(
      (await query('SELECT count(*)::integer AS count FROM research_keywords'))
        .rows[0].count,
      1,
    );
    const otherMarket = await save(keyword({ market: 'MX' }));
    assert.notEqual(otherMarket.id, original.id);
    assert.equal(
      (await query('SELECT count(*)::integer AS count FROM research_keywords'))
        .rows[0].count,
      2,
    );
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await save(keyword({ term: 'rollback' }), false, c);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    assert.equal(
      (await query('SELECT count(*)::integer AS count FROM research_keywords'))
        .rows[0].count,
      2,
    );
  } finally {
    await db.close();
  }
});
