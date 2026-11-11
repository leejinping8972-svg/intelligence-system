import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('daily product watch SQL: schedule idempotency, product updates, observations, failure gaps and cancellation', async () => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/watch-test-no-config.json',
  );
  process.env.DATABASE_URL =
    'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const db = new PGlite();
  const { pool, putDocument } = await import('./database.mjs');
  const originalQuery = pool.query,
    originalConnect = pool.connect,
    originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error('No network in synthetic tests');
  };
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (
      !params.length &&
      statement
        .trim()
        .split(';')
        .filter((s) => s.trim()).length > 1
    )
      return (await db.exec(statement)).at(-1);
    return db.query(
      statement,
      params.map((v) =>
        v && typeof v === 'object' && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      ),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  try {
    const { migrate } = await import('./store.mjs');
    const { productWatchAction, tickProductWatch, runProductWatch } =
      await import('./product-watch-store.mjs');
    const { readProduct } = await import('./platform-products-jobs.mjs');
    const { jobTasks } = await import('./runner.mjs');
    await migrate();
    const admin = { role: 'admin', id: 'test' };
    const p = {
      id: 'US-watch-synthetic',
      title: 'Synthetic supplement',
      titleZh: '合成补充剂',
      market: 'US',
      sourceMarket: 'US',
      sourceProvider: 'Sorftime',
      sourcePlatform: 'Amazon',
      sourceProductId: 'SYNTHETIC',
      sourceUrl: 'https://www.amazon.com/dp/SYNTHETIC',
      currency: 'USD',
      price: 10,
      collectionFields: ['title', 'price'],
      newProductClassifications: [
        { type: 'fbm_new', fulfillment: 'FBM', listingDate: '2026-01-01' },
      ],
    };
    await putDocument(
      'workspace_documents',
      `business:products:${p.id}`,
      p,
      false,
    );
    await putDocument(
      'workspace_documents',
      'business:products:US-ordinary',
      { ...p, id: 'US-ordinary', newProductClassifications: [] },
      false,
    );
    await putDocument(
      'workspace_documents',
      'business:products:VN-other',
      { ...p, id: 'VN-other', market: 'VN' },
      false,
    );
    await productWatchAction(
      {
        action: 'server_product_watch_save',
        market: 'US',
        enabled: true,
        time: '01:00',
      },
      admin,
    );
    const now = Date.parse('2026-11-05T01:00:00+08:00');
    await tickProductWatch(now);
    await tickProductWatch(now);
    const jobs = (await pool.query('SELECT * FROM research_jobs')).rows;
    assert.equal(jobs.length, 1);
    const get = async () =>
      (
        await pool.query('SELECT * FROM research_jobs WHERE id=$1', [
          jobs[0].id,
        ])
      ).rows[0];
    let calls = 0;
    const collect = async (_job, step, request) => {
      calls++;
      if (request.monthlyMetric)
        return {
          monthlyTrend: {
            metric: request.monthlyMetric,
            currency: request.monthlyMetric === 'SalesAmount' ? 'USD' : null,
            points: [
              {
                date: '2026-10',
                value: request.monthlyMetric === 'SalesAmount' ? 250 : 15,
              },
            ],
            collectedAt: new Date(now).toISOString(),
          },
        };
      return step.includes(':detail:')
        ? {
            product: {
              ...p,
              title: 'Synthetic new title',
              titleZh: '合成更新商品',
              price: 12,
              sourceMetrics: { monthlySales: 20 },
              resourceRaw: {
                salesEvidence: { metric: 'monthly_sales_volume', value: 20 },
              },
            },
          }
        : { dailySales: [{ date: '2026-11-04', value: 3, partial: false }] };
    };
    for (let i = 0; i < 5; i++) {
      const job = await get();
      if (job.status === 'completed') break;
      await runProductWatch(job, { collect, now: () => now });
    }
    const complete = await get();
    assert.equal(
      complete.status,
      'completed',
      JSON.stringify(complete.checkpoint),
    );
    assert.equal(complete.checkpoint.succeeded, 1);
    assert.equal(calls, 4);
    assert.match(jobTasks(complete)[0].title, /商品持续监控/);
    const updatedProduct = await readProduct(p.id);
    assert.equal(updatedProduct.price, 12);
    assert.equal(updatedProduct.sourceMetrics.monthlySales, 20);
    let history = await productWatchAction(
      { action: 'server_product_watch_history', productId: p.id },
      admin,
    );
    assert.equal(history.snapshots.length, 1);
    assert.equal(history.snapshots[0].monthlySales, 20);
    assert.equal(history.dailySales[0].value, 3);
    assert.ok(history.monthlyTrends, JSON.stringify(history));
    assert.equal(history.monthlyTrends.SalesVolume.points[0].value, 15);
    assert.equal(history.monthlyTrends.SalesAmount.points[0].value, 250);
    // Simulate restart before the post-write checkpoint: stored observation suppresses paid calls.
    await runProductWatch(
      {
        ...complete,
        status: 'running',
        checkpoint: { ...complete.checkpoint, pending: [p.id] },
      },
      { collect, now: () => now },
    );
    assert.equal(calls, 4);
    await runProductWatch(await get(), { collect, now: () => now });
    await tickProductWatch(now + 86400000);
    const second = (
      await pool.query(
        "SELECT * FROM research_jobs WHERE id<>$1 AND input->>'kind'='product_watch'",
        [complete.id],
      )
    ).rows[0];
    await runProductWatch(second, { now: () => now + 86400000 });
    const secondLoaded = (
      await pool.query('SELECT * FROM research_jobs WHERE id=$1', [second.id])
    ).rows[0];
    await runProductWatch(secondLoaded, {
      collect: async () => {
        throw Error('previous request outcome unknown');
      },
      now: () => now + 86400000,
    });
    history = await productWatchAction(
      { action: 'server_product_watch_history', productId: p.id },
      admin,
    );
    assert.equal(history.snapshots.at(-1).status, 'failed');
    assert.equal(history.snapshots.at(-1).price, undefined);
    const preservedProduct = await readProduct(p.id);
    assert.equal(preservedProduct.price, 12);
    assert.equal(preservedProduct.sourceMetrics.monthlySales, 20);
    await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [
      second.id,
    ]);
    await runProductWatch(secondLoaded, {
      collect: async () => assert.fail('cancelled job must not call source'),
    });
    assert.equal(
      (
        await pool.query('SELECT status FROM research_jobs WHERE id=$1', [
          second.id,
        ])
      ).rows[0].status,
      'cancelled',
    );
    await assert.rejects(
      productWatchAction(
        {
          action: 'server_product_watch_save',
          market: 'US',
          enabled: true,
          time: '01:00',
        },
        { role: 'viewer' },
      ),
    );
  } finally {
    globalThis.fetch = originalFetch;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await pool.end();
    await db.close();
  }
});
