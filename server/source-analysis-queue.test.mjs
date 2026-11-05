import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  runSourceAnalysisBatch,
  sourceAnalysisConcurrency,
  sourceAnalysisFilter,
  SOURCE_ANALYSIS_LOCK,
} from './source-analysis-queue.mjs';

async function fixture() {
  const db = new PGlite();
  await db.exec(
    `CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb NOT NULL,checkpoint jsonb DEFAULT '{}',status text DEFAULT 'queued',cancelled boolean DEFAULT false,updated_at timestamptz DEFAULT now());`,
  );
  const query = async (q, p = []) => {
    const result = await db.query(
      q,
      p.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  const leases = new Set(),
    events = [];
  const io = {
    pool: {
      query,
      connect: async () => ({
        query,
        on() {},
        removeListener() {},
        release() {
          events.push('released');
        },
      }),
    },
    sql: (pg) => pg,
    now: () => Date.now(),
    concurrency: 3,
    lock: async (_c, name) => {
      if (leases.has(name)) return false;
      leases.add(name);
      return true;
    },
    unlock: async (_c, name) => {
      events.push('unlocked');
      leases.delete(name);
    },
    onError: (error) => events.push(error.message),
    run: async (job) =>
      query("UPDATE research_jobs SET status='completed' WHERE id=$1", [
        job.id,
      ]),
  };
  const insert = (
    id,
    kind = 'source_fields',
    status = 'queued',
    cancelled = false,
    checkpoint = {},
  ) =>
    query(
      'INSERT INTO research_jobs(id,input,status,cancelled,checkpoint) VALUES($1,$2,$3,$4,$5)',
      [id, { kind }, status, cancelled, checkpoint],
    );
  return { db, query, io, insert, leases, events };
}

test(
  'three distinct AI executions overlap while another process cannot claim the same batch',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let finish, started;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    const allStarted = new Promise((resolve) => {
      started = resolve;
    });
    let active = 0,
      maxActive = 0;
    const ids = [];
    try {
      for (let i = 0; i < 7; i++) await f.insert(`ai-${i}`);
      await f.insert('ordinary', 'ads');
      f.io.run = async (job) => {
        active++;
        maxActive = Math.max(active, maxActive);
        ids.push(job.id);
        if (ids.length === 3) started();
        await gate;
        active--;
        await f.query(
          "UPDATE research_jobs SET status='completed' WHERE id=$1",
          [job.id],
        );
      };
      const batch = runSourceAnalysisBatch(f.io);
      await allStarted;
      assert.equal(maxActive, 3);
      assert.equal(new Set(ids).size, 3);
      assert.ok(f.leases.has(SOURCE_ANALYSIS_LOCK));
      assert.equal((await runSourceAnalysisBatch(f.io)).acquired, false);
      // Ordinary collection is available even when a large AI backlog is older.
      const normal = await f.query(
        `SELECT id FROM research_jobs WHERE ${sourceAnalysisFilter(f.io.sql, false)} ORDER BY updated_at LIMIT 20`,
      );
      assert.deepEqual(
        normal.rows.map((row) => row.id),
        ['ordinary'],
      );
      finish();
      assert.equal((await batch).started, 3);
      assert.equal(f.leases.size, 0);
      assert.equal(
        (
          await f.query(
            "SELECT count(*)::integer AS n FROM research_jobs WHERE status='completed'",
          )
        ).rows[0].n,
        3,
      );
    } finally {
      finish?.();
      await f.db.close();
    }
  },
);

test(
  'failure does not release the deployment lease while other AI calls are still in flight',
  { timeout: 15000 },
  async () => {
    const f = await fixture();
    let finish, started;
    const gate = new Promise((resolve) => {
      finish = resolve;
    });
    const running = new Promise((resolve) => {
      started = resolve;
    });
    try {
      await f.insert('a');
      await f.insert('b');
      f.io.run = async (job) => {
        if (job.id === 'a') throw Error('synthetic provider failure');
        started();
        await gate;
      };
      const batch = runSourceAnalysisBatch(f.io);
      await running;
      assert.ok(f.leases.has(SOURCE_ANALYSIS_LOCK));
      assert.ok(!f.events.includes('unlocked'));
      finish();
      assert.equal((await batch).failed, 1);
      assert.ok(f.events.includes('synthetic provider failure'));
      assert.equal(f.leases.size, 0);
    } finally {
      finish?.();
      await f.db.close();
    }
  },
);

test('a cancellation between selection and claim prevents a new call; cooling down jobs stay pending', async () => {
  const f = await fixture();
  try {
    await f.insert('cancel-between');
    await f.insert('cancelled', 'source_fields', 'queued', true);
    await f.insert('cooldown', 'source_fields', 'queued', false, {
      nextRunAt: Date.now() + 60000,
    });
    const original = f.io.pool.query;
    f.io.pool.query = async (q, p) => {
      if (q.startsWith("UPDATE research_jobs SET status='running'"))
        await f.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [
          p[0],
        ]);
      return original(q, p);
    };
    let calls = 0;
    f.io.run = async () => {
      calls++;
    };
    const result = await runSourceAnalysisBatch(f.io);
    assert.equal(result.started, 0);
    assert.equal(calls, 0);
    assert.equal(
      (await f.query("SELECT status FROM research_jobs WHERE id='cooldown'"))
        .rows[0].status,
      'queued',
    );
  } finally {
    await f.db.close();
  }
});

test('an aborted queue starts no calls and releases its lease', async () => {
  const f = await fixture();
  try {
    await f.insert('a');
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    f.io.run = async () => {
      calls++;
    };
    assert.equal(
      (await runSourceAnalysisBatch(f.io, controller.signal)).started,
      0,
    );
    assert.equal(calls, 0);
    assert.equal(f.leases.size, 0);
  } finally {
    await f.db.close();
  }
});

test('parallelism is bounded to preserve provider and database capacity', () => {
  assert.equal(sourceAnalysisConcurrency(''), 3);
  assert.equal(sourceAnalysisConcurrency('garbage'), 3);
  assert.equal(sourceAnalysisConcurrency('99'), 3);
  assert.equal(sourceAnalysisConcurrency('2'), 2);
  assert.equal(sourceAnalysisConcurrency('-1'), 1);
});
