import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { PGlite } from '@electric-sql/pglite';

import {
  createMonitorUsageReader,
  createUsageEventCache,
  usageReadWithin,
} from './source-usage-reader.mjs';
import { sourceUsageAction } from './source-usage.mjs';

test('concurrent readers share work and invalidation preserves the pending read', async () => {
  let resolve;
  let calls = 0;
  let clock = 0;
  const connection = {};
  const cache = createUsageEventCache(
    async () => {
      calls++;
      return calls === 1
        ? new Promise((done) => {
            resolve = done;
          })
        : [calls];
    },
    { ttl: 100, now: () => clock },
  );
  const first = cache(connection);
  const second = cache(connection);
  await Promise.resolve();
  cache.invalidate();
  const third = cache(connection);
  assert.equal(calls, 1);
  resolve([1]);
  assert.deepEqual(await Promise.all([first, second, third]), [[1], [1], [1]]);
  assert.deepEqual(await cache(connection), [2]);
  assert.deepEqual(await cache(connection), [2]);
  assert.deepEqual(await cache(connection, { refresh: true }), [3]);
  clock = 101;
  assert.deepEqual(await cache(connection), [4]);
  assert.deepEqual(await cache({}), [5]);
});

test('a failed read stays an error and explicit refresh can recover', async () => {
  let calls = 0;
  const connection = {};
  const cache = createUsageEventCache(async () => {
    if (++calls === 1) throw new Error('database unavailable');
    return [];
  });
  await assert.rejects(cache(connection), /database unavailable/);
  await assert.rejects(cache(connection), /database unavailable/);
  assert.equal(calls, 1);
  assert.deepEqual(await cache(connection, { refresh: true }), []);
  assert.equal(calls, 2);
});

test('bounded waits return pending without cancelling or replacing the source read', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  assert.deepEqual(await usageReadWithin(pending, 0), { loading: true });
  resolve([{ id: 'known' }]);
  assert.deepEqual(await usageReadWithin(pending), {
    events: [{ id: 'known' }],
  });
  await assert.rejects(
    usageReadWithin(Promise.reject(new Error('failed'))),
    /failed/,
  );
});

test('pending API responses contain no fabricated totals and become complete after the same read settles', async () => {
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const io = {
    pool: { query: async () => ({ rows: [] }) },
    readEvents: () => pending,
    credentialStatus: async () => ({}),
  };
  assert.deepEqual(
    await sourceUsageAction(
      { action: 'server_source_usage' },
      { role: 'admin' },
      io,
    ),
    { loading: true, retryAfterMs: 2000 },
  );
  resolve([]);
  const ready = await sourceUsageAction(
    { action: 'server_source_usage' },
    { role: 'admin' },
    io,
  );
  assert.equal(ready.loading, undefined);
  assert.equal(ready.sources.length, 18);
  assert.equal(ready.total, 0);
});

test('persisted compact accounting survives reader restart, updates revisions and removes deleted journals', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE workspace_documents(name text primary key,value jsonb,revision bigint not null default 1)',
    );
    const originals = [
      {
        name: 'competitor:request:2026-10-28:job:zero',
        value: {
          at: '2026-10-27T16:01:00Z',
          step: 'semrush:zero',
          status: 'completed',
          response: {
            apiUnits: 0,
            secret: 'never-cache-secret',
            payload: 'x'.repeat(100_000),
          },
        },
      },
      {
        name: 'competitor:request:2026-10-28:job:string',
        value: {
          step: 'semrush:string',
          status: 'completed',
          response: { apiUnits: '9' },
        },
      },
      {
        name: 'competitor:request:2026-10-28:job:failed',
        value: {
          step: 'semrush:failed',
          status: 'failed',
          response: { apiUnits: 9 },
        },
      },
      {
        name: 'competitor:request:2026-10-28:job:cached',
        value: {
          step: 'semrush:cached',
          status: 'completed',
          response: { cached: true, apiUnits: 900 },
        },
      },
    ];
    for (const row of originals)
      await db.query(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
        [row.name, row.value],
      );
    let projected = [];
    let writes = 0;
    const connection = {
      query: async (statement, params) => {
        if (statement.includes('jsonb_build_object')) projected.push(...params);
        return db.query(statement, params);
      },
    };
    const options = {
      write: async (name, value) => {
        writes++;
        await db.query(
          'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=excluded.value',
          [name, value],
        );
      },
    };
    const first = await createMonitorUsageReader(options)(connection);
    assert.equal(first.length, 4);
    const zero = first.find((row) => row.id.includes(':zero:'));
    assert.equal(zero.amount, 0);
    assert.equal(zero.billing, 'confirmed');
    assert.equal(zero.day, '2026-10-28');
    assert.equal(first.find((row) => row.id.includes(':string:')).amount, null);
    assert.equal(first.find((row) => row.id.includes(':failed:')).amount, null);
    assert.equal(
      first.find((row) => row.id.includes(':cached:')).billing,
      'cached',
    );
    const cache = (
      await db.query(
        "SELECT value FROM workspace_documents WHERE name='read:source-usage:monitor:v1'",
      )
    ).rows[0].value;
    const uncompressed = inflateRawSync(
      Buffer.from(cache.body, 'base64'),
    ).toString();
    assert.equal(uncompressed.includes('never-cache-secret'), false);
    assert.equal(uncompressed.includes('payload'), false);
    assert.deepEqual(
      (
        await db.query(
          "SELECT name,value FROM workspace_documents WHERE name LIKE 'competitor:request:%' ORDER BY name",
        )
      ).rows,
      [...originals].sort((a, b) => a.name.localeCompare(b.name)),
    );
    projected = [];
    assert.deepEqual(
      await createMonitorUsageReader(options)(connection),
      first,
    );
    assert.deepEqual(projected, []);
    assert.equal(writes, 1);
    await db.query(
      'UPDATE workspace_documents SET value=$1,revision=revision+1 WHERE name=$2',
      [{ ...originals[0].value, response: { apiUnits: 7 } }, originals[0].name],
    );
    const changed = await createMonitorUsageReader(options)(connection);
    assert.deepEqual(projected, [originals[0].name]);
    assert.equal(changed.find((row) => row.id.includes(':zero:')).amount, 7);
    projected = [];
    await db.query('DELETE FROM workspace_documents WHERE name=$1', [
      originals[1].name,
    ]);
    assert.equal(
      (await createMonitorUsageReader(options)(connection)).length,
      3,
    );
    assert.deepEqual(projected, []);
    await db.query(
      "UPDATE workspace_documents SET value=$1 WHERE name='read:source-usage:monitor:v1'",
      [{ version: 1, codec: 'deflate-json-v1', body: 'invalid' }],
    );
    assert.equal(
      (await createMonitorUsageReader(options)(connection)).length,
      3,
    );
    assert.equal(projected.length, 3);
  } finally {
    await db.close();
  }
});

test('an interrupted backfill resumes saved batches and never returns partial totals', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE workspace_documents(name text primary key,value jsonb,revision bigint not null default 1)',
    );
    await db.query(
      "INSERT INTO workspace_documents(name,value) SELECT 'competitor:request:'||lpad(n::text,4,'0'),$1 FROM generate_series(1,205) AS n",
      [
        {
          step: 'semrush:test',
          status: 'completed',
          response: { apiUnits: 1 },
        },
      ],
    );
    let batches = 0;
    let fail = true;
    const connection = {
      query: async (statement, params) => {
        if (statement.includes('jsonb_build_object') && ++batches === 2 && fail)
          throw new Error('interrupted read');
        return db.query(statement, params);
      },
    };
    const options = {
      write: (name, value) =>
        db.query(
          'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=excluded.value',
          [name, value],
        ),
    };
    await assert.rejects(
      createMonitorUsageReader(options)(connection),
      /interrupted read/,
    );
    fail = false;
    batches = 0;
    const events = await createMonitorUsageReader(options)(connection);
    assert.equal(events.length, 205);
    assert.equal(
      events.reduce((sum, event) => sum + event.amount, 0),
      205,
    );
    assert.equal(batches, 1);
    await db.query(
      "UPDATE workspace_documents SET revision=revision+1 WHERE name='competitor:request:0001'",
    );
    let warning;
    const withoutWritableCache = createMonitorUsageReader({
      write: async () => {
        throw new Error('cache read-only');
      },
      onCacheError: (error) => {
        warning = error.message;
      },
    });
    assert.equal((await withoutWritableCache(connection)).length, 205);
    assert.equal(warning, 'cache read-only');
  } finally {
    await db.close();
  }
});
