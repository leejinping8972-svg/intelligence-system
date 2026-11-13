/* eslint-disable vitest/no-import-node-test -- Server integration tests use the Node test runner. */
/* eslint-disable unicorn/no-await-expression-member -- Keep asynchronous read assertions together. */
import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { conceptMonitorRows } from './concept-monitor-domain.mjs';
import { createConceptMonitor } from './concept-monitor.mjs';

const now = Date.parse('2026-11-13T01:00:00Z');
const today = '2026-11-12T16:00:00Z';
const yesterday = '2026-11-12T15:59:59.999Z';

test('all traceable batches use saved links in both directions, deduplicate, and isolate markets', () => {
  const rows = conceptMonitorRows(
    {
      keywords: [
        {
          id: 'k1',
          market: 'US',
          batch: ' A ',
          collectedAt: today,
          productIds: ['p1', 'deleted'],
          siteIds: ['s1'],
        },
        { id: 'k2', market: 'US', batch: 'A', collectedAt: yesterday },
        { id: 'k3', market: 'MX', batch: 'A', collectedAt: today },
        { id: 'unrelated', market: 'US', batch: 'B', siteIds: ['s1'] },
        { id: 'demo', market: 'US', batch: 'demo-batch', dataNature: 'demo' },
      ],
      products: [
        {
          id: 'p1',
          market: 'US',
          keywordIds: ['k1'],
          siteId: 's1',
          firstSeenAt: yesterday,
          lastCollectedAt: today,
        },
        {
          id: 'p2',
          market: 'US',
          siteId: 's1',
          firstSeenAt: today,
          lastCollectedAt: today,
        },
        {
          id: 'foreign',
          market: 'VN',
          keywordIds: ['k1'],
          lastCollectedAt: today,
        },
      ],
      sites: [
        {
          id: 's1',
          market: 'US',
          keywordIds: ['k1', 'unrelated'],
          sourceEvidence: [{ collectedAt: yesterday }],
          lastCollectedAt: today,
        },
      ],
      ads: [
        {
          id: 'a1',
          market: 'US',
          keywordIds: ['k1', 'k2'],
          siteIds: ['s1'],
          collectionBatches: ['A', 'A', 'ad-only'],
          firstSeenAt: yesterday,
          lastCollectedAt: today,
        },
        {
          id: 'a2',
          market: 'US',
          siteIds: ['s1'],
          firstSeenAt: today,
          lastCollectedAt: today,
        },
        {
          id: 'solo',
          market: 'VN',
          collectionBatches: ['standalone'],
          lastCollectedAt: today,
        },
      ],
    },
    now,
  );
  assert.deepEqual(rows.map((row) => row.batch).toSorted(), [
    'A',
    'B',
    'ad-only',
    'standalone',
  ]);
  const a = rows.find((row) => row.batch === 'A');
  assert.deepEqual([a.keywords, a.ads, a.sites, a.products], [3, 2, 1, 2]);
  assert.deepEqual(
    [a.keywordsToday, a.adsToday, a.sitesToday, a.productsToday],
    [2, 1, 0, 1],
  );
  assert.deepEqual(a.markets, ['MX', 'US']);
  assert.equal(a.collectedAt, '2026-11-12T16:00:00.000Z');
  const standalone = rows.find((row) => row.batch === 'standalone');
  assert.deepEqual(
    [
      standalone.keywords,
      standalone.ads,
      standalone.sites,
      standalone.products,
    ],
    [0, 1, 0, 0],
  );
  assert.equal(rows.find((row) => row.batch === 'ad-only').keywords, 2);
});

test('unknown dates stay missing; Shanghai boundaries, future dates and empty batch labels are handled', () => {
  const rows = conceptMonitorRows(
    {
      keywords: [
        { id: 'empty', batch: ' ' },
        { id: 'missing', batch: 'missing', collectedAt: 'invalid' },
        { id: 'old', batch: 'old', collectedAt: yesterday },
        { id: 'new', batch: 'new', collectedAt: today },
        {
          id: 'tomorrow',
          batch: 'future',
          collectedAt: '2026-11-13T16:00:00Z',
        },
      ],
    },
    now,
  );
  assert.equal(rows.length, 4);
  assert.equal(rows.at(-1).batch, 'missing');
  assert.equal(rows.at(-1).collectedAt, '');
  assert.deepEqual(
    Object.fromEntries(rows.map((row) => [row.batch, row.keywordsToday])),
    { future: 0, new: 1, old: 0, missing: 0 },
  );
});

test('persisted batch snapshots are atomic, scheduled, sorted before pagination and read without source aggregation', async () => {
  let current = now;
  const clock = mock.method(Date, 'now', () => current);
  const db = new PGlite();
  const statements = [];
  let failMarker = false;
  const pool = {
    async query(statement, params = []) {
      statements.push(statement);
      if (
        failMarker &&
        statement.includes('INSERT INTO workspace_documents') &&
        params[0] === 'read:concept-monitor-version'
      )
        throw new Error('synthetic publish failure');
      return db.query(
        statement,
        params.map((value) =>
          value && typeof value === 'object' ? JSON.stringify(value) : value,
        ),
      );
    },
    async connect() {
      return { query: (...args) => pool.query(...args), release() {} };
    },
  };
  const putDocument = (_table, name, value, _importOnly, connection) =>
    connection.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',
      [name, value],
    );
  const create = () =>
    createConceptMonitor({ pool, sql: (pg) => pg, putDocument });
  let monitor = create();
  async function rebuild(revision) {
    await pool.query('BEGIN');
    try {
      await monitor.rebuild(pool, revision);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
  try {
    await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL);
      CREATE TABLE workspace_read_rows(collection text,id text,payload jsonb,PRIMARY KEY(collection,id));
      CREATE TABLE workspace_statistic_rows(kind text,market text,variant text,position integer,subtype text,payload jsonb,PRIMARY KEY(kind,market,variant,position));`);
    assert.equal((await monitor.read({})).snapshot, null);
    // More than one projection fetch and more than one results page.
    for (let i = 0; i < 235; i++)
      await pool.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', [
        'keywords',
        `k${i}`,
        {
          id: `k${i}`,
          batch: `Batch ${String(i).padStart(3, '0')}`,
          market: i % 2 ? 'MX' : 'US',
          collectedAt: new Date(now - i * 1000).toISOString(),
        },
      ]);
    await pool.query('INSERT INTO workspace_read_rows VALUES($1,$2,$3)', [
      'ads',
      'direct',
      {
        id: 'direct',
        market: 'VN',
        collectionBatches: ['100%_special'],
        lastCollectedAt: today,
      },
    ]);
    await rebuild(12);
    const initial = await monitor.read({});
    assert.equal(initial.total, 236);
    assert.equal(initial.snapshot.revision, '12');
    assert.equal(initial.snapshot.day, '2026-11-13');
    assert.equal(initial.rows[0].batch, 'Batch 000');
    assert.equal((await monitor.read({ market: 'US' })).total, 118);
    assert.equal(
      (await monitor.read({ market: 'VN' })).rows[0].batch,
      '100%_special',
    );
    assert.equal((await monitor.read({ search: '%_' })).total, 1);
    assert.equal((await monitor.read({ search: "' OR 1=1 --" })).total, 0);
    for (const sort of [
      'batch',
      'markets',
      'keywords',
      'ads',
      'sites',
      'products',
      'keywordsToday',
      'adsToday',
      'sitesToday',
      'productsToday',
      'collectedAt',
    ])
      for (const order of ['ascend', 'descend']) {
        const read = await monitor.read({ sort, order, pageSize: 7, page: 3 });
        assert.equal(read.rows.length, 7);
        assert.equal(read.page, 3);
      }
    const asc = await monitor.read({
      sort: 'collectedAt',
      order: 'ascend',
      pageSize: 7,
    });
    assert.equal(asc.rows[0].batch, '100%_special');
    assert.equal(
      (await monitor.read({ sort: 'ads', order: 'descend', pageSize: 1 }))
        .rows[0].ads,
      1,
    );
    const numeric = await monitor.read({
      sort: 'keywords',
      order: 'ascend',
      pageSize: 1,
    });
    assert.equal(numeric.rows[0].keywords, 0);
    assert.equal(
      (await monitor.read({ pageSize: 1000, page: -5 })).pageSize,
      100,
    );
    const injected = await monitor.read({
      sort: 'ads) DESC; DROP TABLE workspace_read_rows;--',
    });
    assert.equal(injected.rows[0].batch, 'Batch 000');
    const readStart = statements.length;
    await monitor.read({ page: 2, sort: 'keywordsToday' });
    assert.ok(
      statements
        .slice(readStart)
        .every(
          (statement) =>
            !statement.includes('workspace_read_rows') &&
            !/INSERT|UPDATE|DELETE/.test(statement),
        ),
      'request reads only stored summaries',
    );
    await pool.query('DELETE FROM workspace_read_rows');
    const beforeSkip = statements.length;
    await rebuild(13);
    assert.equal((await monitor.read({})).total, 236);
    assert.ok(
      !statements
        .slice(beforeSkip)
        .some((statement) => statement.includes('FROM workspace_read_rows')),
    );
    current += 86_400_000;
    monitor = create(); // Scheduler survives process restart using its persisted marker.
    failMarker = true;
    await assert.rejects(rebuild(14), /synthetic publish failure/);
    assert.equal(
      (await monitor.read({})).total,
      236,
      'failed publication rolls back every market',
    );
    failMarker = false;
    await rebuild(14);
    assert.equal((await monitor.read({})).total, 0);
    assert.equal((await monitor.read({})).snapshot.day, '2026-11-14');
  } finally {
    clock.mock.restore();
    await db.close();
  }
});
