/* oxlint-disable vitest/no-import-node-test -- Server regression uses the Node test runner. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { watchConfig, watchDefaults } from './product-watch-domain.mjs';

test('monthly history is standard for new configurations, including legacy opt-out payloads', () => {
  assert.equal(watchDefaults('US').monthlyHistory, true);
  assert.equal(watchDefaults('US').enabled, false);
  for (const monthlyHistory of [undefined, false, true]) {
    assert.equal(
      watchConfig({
        market: 'US',
        enabled: true,
        time: '01:00',
        monthlyHistory,
      }).monthlyHistory,
      true,
    );
  }
  assert.throws(() =>
    watchConfig({
      market: 'US',
      enabled: true,
      time: '01:00',
      monthlyHistory: 'true',
    }),
  );
});

test('existing monitors enable monthly history for future tasks and preserve same-day frozen requests', async () => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/watch-defaults-no-config.json',
  );
  process.env.DATABASE_URL =
    'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const { pool, putDocument } = await import('./database.mjs');
  const { migrate } = await import('./store.mjs');
  const { productWatchAction, tickProductWatch } =
    await import('./product-watch-store.mjs');
  const db = new PGlite();
  const previous = {
    query: pool.query,
    connect: pool.connect,
    fetch: globalThis.fetch,
  };
  globalThis.fetch = async () =>
    assert.fail('configuration tests must not make network requests');
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (
      params.length === 0 &&
      statement
        .trim()
        .split(';')
        .filter((s) => s.trim()).length > 1
    ) {
      const results = await db.exec(statement);
      return results.at(-1);
    }
    return db.query(
      statement,
      params.map((value) =>
        value && typeof value === 'object' && !(value instanceof Date)
          ? JSON.stringify(value)
          : value,
      ),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  const admin = { id: 'synthetic-admin', role: 'admin' };
  const configKey = 'product-watch:config:US';
  try {
    await migrate();
    await putDocument(
      'workspace_documents',
      configKey,
      { market: 'US', enabled: true, time: '00:00', monthlyHistory: false },
      false,
    );
    const before = await productWatchAction(
      { action: 'server_product_watch_config', market: 'US' },
      admin,
    );
    assert.equal(before.config.monthlyHistory, true);
    assert.equal(before.config.enabled, true);
    assert.equal(before.config.time, '00:00');
    const now = Date.now();
    await tickProductWatch(now);
    let result = await pool.query(
      'SELECT * FROM research_jobs ORDER BY created_at,id',
    );
    assert.equal(result.rows.length, 1);
    const first = result.rows[0];
    assert.equal(first.input.monthlyHistory, true);
    assert.equal(first.input.monthlyHistoryCadence, 'watch');
    // Model a task that was already frozen with the previous disabled setting.
    await pool.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
      first.id,
      {
        ...first.input,
        monthlyHistory: false,
        monthlyHistoryCadence: undefined,
      },
    ]);
    const existing = await productWatchAction(
      { action: 'server_product_watch_run', market: 'US' },
      admin,
    );
    assert.equal(existing.jobId, first.id);
    await tickProductWatch(now);
    result = await pool.query(
      'SELECT * FROM research_jobs ORDER BY created_at,id',
    );
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].input.monthlyHistory, false);
    assert.equal(result.rows[0].input.monthlyHistoryCadence, undefined);
    await pool.query(
      "UPDATE research_jobs SET status='completed' WHERE id=$1",
      [first.id],
    );
    await tickProductWatch(now + 86_400_000);
    result = await pool.query('SELECT * FROM research_jobs WHERE id<>$1', [
      first.id,
    ]);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].input.monthlyHistory, true);
    assert.equal(result.rows[0].input.monthlyHistoryCadence, 'watch');
    const saved = await productWatchAction(
      {
        action: 'server_product_watch_save',
        market: 'US',
        enabled: true,
        time: '01:00',
        monthlyHistory: false,
      },
      admin,
    );
    assert.equal(saved.config.monthlyHistory, true);
    assert.equal(saved.config.enabled, true);
    assert.equal(saved.config.time, '01:00');
  } finally {
    pool.query = previous.query;
    pool.connect = previous.connect;
    globalThis.fetch = previous.fetch;
    await pool.end();
    await db.close();
  }
});
