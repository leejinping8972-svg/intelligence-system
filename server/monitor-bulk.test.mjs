/* oxlint-disable vitest/no-import-node-test -- Server regressions use the Node test runner. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('bulk monitor actions use the admin/config lock and preserve data in isolated SQL', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/nonexistent-bulk-qa.json',
  );
  process.env.DATABASE_URL = 'postgres://disposable@127.0.0.1:1/not-used';
  const memory = new PGlite();
  await memory.exec(
    'CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1)',
  );
  const { pool } = await import('./database.mjs');
  const previousQuery = pool.query;
  const previousConnect = pool.connect;
  let locks = 0;
  pool.query = async (statement, params = []) => {
    if (statement.includes('pg_try_advisory_lock')) {
      locks++;
      return { rows: [{ locked: true }] };
    }
    if (statement.includes('pg_advisory_unlock')) return { rows: [] };
    return memory.query(
      statement,
      params.map((value) =>
        value && typeof value === 'object' ? JSON.stringify(value) : value,
      ),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  t.after(async () => {
    pool.query = previousQuery;
    pool.connect = previousConnect;
    await memory.close();
    await pool.end();
  });
  const { competitorAction, createMonitorStore } =
    await import('./competitor-monitor-store.mjs');
  const db = createMonitorStore();
  const id = (n) => n.toString(16).padStart(32, '0');
  const config = (n, extra = {}) => ({
    id: id(n),
    kind: 'site',
    siteId: `site-${n}`,
    market: n % 2 ? 'US' : 'MX',
    pageId: '',
    enabled: true,
    hour: n % 24,
    maxPages: (n % 100) + 1,
    requested: true,
    publicRetryRequested: true,
    ...extra,
  });
  const save = (value) => db.write(`competitor:target:${value.id}`, value);
  const action = (input) => competitorAction(input, { role: 'admin' });
  await t.test('researchers cannot submit bulk mutations', async () => {
    await assert.rejects(
      competitorAction(
        { action: 'server_competitor_batch_remove', ids: [id(1)] },
        { role: 'researcher' },
      ),
      /管理员/,
    );
    assert.equal(locks, 0);
  });
  await t.test(
    'settings patch spans all 100 targets, deduplicates and leaves all unchecked settings intact',
    async () => {
      const targets = Array.from({ length: 100 }, (_, i) => config(i + 1));
      for (const target of targets) await save(target);
      const result = await action({
        action: 'server_competitor_batch_update',
        ids: targets.map((value) => value.id),
        patch: { hour: 22 },
      });
      assert.equal(result.succeededIds.length, 100);
      assert.equal(result.failed.length, 0);
      for (const target of targets) {
        const saved = await db.read(`competitor:target:${target.id}`);
        assert.equal(saved.hour, 22);
        for (const key of [
          'enabled',
          'maxPages',
          'market',
          'siteId',
          'requested',
          'publicRetryRequested',
        ])
          assert.equal(saved[key], target[key]);
      }
      const deduplicated = await action({
        action: 'server_competitor_batch_update',
        ids: [id(1), id(1)],
        patch: { maxPages: 100 },
      });
      assert.deepEqual(deduplicated.succeededIds, [id(1)]);
    },
  );
  await t.test(
    'invalid and empty patches reject before any partial update',
    async () => {
      const before = await db.read(`competitor:target:${id(1)}`);
      for (const patch of [
        {},
        { hour: null },
        { hour: 24 },
        { maxPages: 0 },
        { enabled: 'false' },
        { market: 'VN' },
        { id: id(2) },
      ])
        await assert.rejects(
          action({
            action: 'server_competitor_batch_update',
            ids: [id(1), id(2)],
            patch,
          }),
        );
      assert.deepEqual(await db.read(`competitor:target:${id(1)}`), before);
      await assert.rejects(
        action({ action: 'server_competitor_batch_remove', ids: ['bad:id'] }),
        /有效监控/,
      );
    },
  );
  await t.test(
    'pause clears queued work and changes pause marker without touching checkpoints/history',
    async () => {
      const preserved = { status: 'started', response: { raw: 'unknown' } };
      await db.write(`competitor:request:qa:${id(1)}:journal`, preserved);
      await db.write(`competitor:crawl:${id(1)}:products`, {
        queue: ['next'],
        visited: ['done'],
      });
      const result = await action({
        action: 'server_competitor_batch_update',
        ids: [id(1)],
        patch: { enabled: false },
      });
      assert.equal(result.succeededIds.length, 1);
      const paused = await db.read(`competitor:target:${id(1)}`);
      assert.equal(paused.enabled, false);
      assert.equal(paused.requested, false);
      assert.equal(paused.publicRetryRequested, false);
      assert.ok(paused.pausedAt);
      assert.deepEqual(
        await db.read(`competitor:request:qa:${id(1)}:journal`),
        preserved,
      );
      assert.deepEqual(await db.read(`competitor:crawl:${id(1)}:products`), {
        queue: ['next'],
        visited: ['done'],
      });
    },
  );
  await t.test(
    'remove skips running/missing targets and keeps source results, seen state and history',
    async () => {
      await db.write(`competitor:run:${id(2)}`, { status: 'running' });
      await db.write(`competitor:baseline:${id(1)}:products`, { at: 'old' });
      await db.write(`competitor:seen:${id(1)}:products:old`, { at: 'old' });
      await db.write('business:products:old', { title: 'kept' });
      const result = await action({
        action: 'server_competitor_batch_remove',
        ids: [id(1), id(2), id(500)],
      });
      assert.deepEqual(result.succeededIds, [id(1)]);
      assert.equal(result.failed.length, 2);
      assert.match(result.failed[0].error, /先批量暂停/);
      assert.equal(await db.read(`competitor:target:${id(1)}`), undefined);
      assert.ok(await db.read(`competitor:target:${id(2)}`));
      assert.equal(
        await db.read(`competitor:baseline:${id(1)}:products`),
        undefined,
      );
      assert.equal(
        await db.read(`competitor:crawl:${id(1)}:products`),
        undefined,
      );
      assert.ok(await db.read(`competitor:seen:${id(1)}:products:old`));
      assert.deepEqual(await db.read('business:products:old'), {
        title: 'kept',
      });
      const journal = await db.read(`competitor:request:qa:${id(1)}:journal`);
      assert.equal(journal.status, 'started');
    },
  );
  await t.test(
    'database failure rolls the whole write batch back',
    async () => {
      const before = await db.read(`competitor:target:${id(3)}`);
      const query = pool.query;
      pool.query = async (statement, params) => {
        if (
          statement.startsWith('INSERT INTO workspace_documents') &&
          params[0] === `competitor:target:${id(4)}`
        )
          throw new Error('synthetic database error');
        return query(statement, params);
      };
      try {
        await assert.rejects(
          action({
            action: 'server_competitor_batch_update',
            ids: [id(3), id(4)],
            patch: { hour: 7 },
          }),
          /synthetic database error/,
        );
      } finally {
        pool.query = query;
      }
      assert.deepEqual(await db.read(`competitor:target:${id(3)}`), before);
    },
  );
});
