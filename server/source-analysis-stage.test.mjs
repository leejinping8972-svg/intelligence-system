import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import {
  attachAnalysisMonitor,
  attachAnalysisParent,
  cancelAnalysisChildren,
  decorateAnalysisTasks,
  decorateMonitorAnalysis,
  syncAnalysisStage,
} from './source-analysis-stage.mjs';
import { listTaskPage } from './task-page.mjs';
import { taskOverview } from './task-overview.mjs';
import { workspaceSnapshot } from './workspace-snapshot.mjs';
import { runSourceFields } from './source-field-store.mjs';
import { saveCheckpoint } from './store.mjs';

test('SQL pages, counts and detail fold AI executions into their parent and preserve shared work', async () => {
  const db = new PGlite();
  const query = (q, p = []) =>
    db.query(
      q,
      p.map((v) =>
        v && typeof v === 'object' && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      ),
    );
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const sql = (pg) => pg;
  const project = (job) => [
    {
      id: job.id,
      cloudJobId: job.id,
      market: 'US',
      title: '采集',
      status: job.status,
      steps: [],
      overview: taskOverview(job, {}),
    },
  ];
  const read = async (id) =>
    (await query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
  await db.exec(
    `CREATE TABLE research_jobs(id text PRIMARY KEY, request_id text UNIQUE,input jsonb NOT NULL,checkpoint jsonb NOT NULL DEFAULT '{}',status text DEFAULT 'queued',cancelled boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1);`,
  );
  const insert = (id, input, status = 'queued') =>
    query(
      'INSERT INTO research_jobs(id,request_id,input,status) VALUES($1,$1,$2,$3)',
      [id, input, status],
    );
  try {
    await insert(
      'parent',
      { kind: 'products', markets: ['US'], records: [{}] },
      'completed',
    );
    await insert(
      'second',
      { kind: 'products', markets: ['US'], records: [{}] },
      'completed',
    );
    await insert('child', {
      kind: 'source_fields',
      market: 'US',
      targetId: 'product-1',
      sample: { sources: [{ id: 'title', text: 'Vitamin C' }] },
    });
    await insert('legacy', { kind: 'source_fields', market: 'US' });
    const child = await read('child');
    await attachAnalysisParent(pool, child, 'parent');
    await attachAnalysisParent(pool, child, 'parent');
    assert.equal((await read('parent')).input.sourceAnalysis.total, 1);
    let result = await listTaskPage(
      { statuses: ['running'] },
      { pool, sql, jobTasks: project },
    );
    assert.equal(result.total, 1);
    assert.equal(result.tasks[0].cloudJobId, 'parent');
    assert.equal(result.tasks[0].sourceAnalysis.pending, 1);
    assert.equal(result.statusCounts.running, 1);
    assert.equal(result.statusCounts.completed, 1);
    const detail = await decorateAnalysisTasks(
      project(await read('parent')),
      [await read('parent')],
      pool,
      sql,
      true,
    );
    assert.equal(detail[0].collections.length, 1);
    assert.match(detail[0].collections[0].title, /Vitamin C/);
    assert.equal(detail[0].overview.percent, 50);
    await query("UPDATE research_jobs SET status='running' WHERE id='child'");
    // Attaching a second owner while execution starts updates the first owner's
    // pending phase before registering the second owner; neither count is lost.
    await attachAnalysisParent(pool, await read('child'), 'second');
    await attachAnalysisMonitor(pool, await read('child'), {
      monitorId: 'm1',
      day: '2026-11-05',
    });
    await syncAnalysisStage(await read('child'), pool);
    await syncAnalysisStage(await read('child'), pool);
    for (const id of ['parent', 'second']) {
      const stats = (await read(id)).input.sourceAnalysis;
      assert.equal(stats.total, 1);
      assert.equal(stats.running, 1);
      assert.equal(stats.queued || 0, 0);
    }
    const monitors = await decorateMonitorAnalysis(
      [{ id: 'm1', day: '2026-11-05' }],
      pool,
    );
    assert.equal(monitors[0].sourceAnalysis.running, 1);
    await query(
      "UPDATE research_jobs SET status='partial',checkpoint=$1 WHERE id='child'",
      [{ logs: ['来源额度不足'] }],
    );
    await syncAnalysisStage(await read('child'), pool);
    result = await listTaskPage(
      { statuses: ['partial'] },
      { pool, sql, jobTasks: project },
    );
    assert.equal(result.total, 2);
    assert.equal(result.tasks[0].sourceAnalysis.failed, 1);
    assert.match(result.tasks[0].overview.outcome, /部分完成/);
    const snapshot = await workspaceSnapshot(
      { channels: ['tasks'] },
      {
        pool,
        sql,
        jobTasks: project,
        readVersions: async () => ({ tasks: '1' }),
      },
    );
    assert.equal(snapshot.tasks.length, 2);
    assert.ok(
      snapshot.tasks.every(
        (t) => t.cloudJobId !== 'child' && t.cloudJobId !== 'legacy',
      ),
    );
    await query(
      "UPDATE research_jobs SET cancelled=true,status='cancelled' WHERE id='parent'",
    );
    await cancelAnalysisChildren('parent', pool, sql);
    assert.equal((await read('child')).cancelled, false);
    await query(
      "UPDATE research_jobs SET cancelled=true,status='cancelled' WHERE id='second'",
    );
    await cancelAnalysisChildren('second', pool, sql);
    // The monitor also owns this execution; parent task cancellation must not
    // cancel a monitor's paid work.
    assert.equal((await read('child')).cancelled, false);
  } finally {
    await db.close();
  }
});

test('worker completion and failure update their parent atomically, including owners attached after dispatch', async () => {
  const db = new PGlite();
  const query = (q, p = []) =>
    db.query(
      q,
      p.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
  const pool = { query, connect: async () => ({ query, release() {} }) };
  await db.exec(
    `CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,status text,cancelled boolean DEFAULT false,checkpoint jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1);`,
  );
  const read = async (id) =>
    (await query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
  try {
    for (const failed of [false, true]) {
      const id = failed ? 'failure' : 'success';
      const input = {
        kind: 'source_fields',
        targetKind: 'sites',
        targetId: id,
        sample: { fingerprint: id, sources: [] },
      };
      await query(
        "INSERT INTO research_jobs(id,input,status) VALUES($1,$2,'completed')",
        [`parent-${id}`, { kind: 'sites' }],
      );
      await query(
        "INSERT INTO research_jobs(id,input,status) VALUES($1,$2,'running')",
        [id, input],
      );
      const dispatched = await read(id);
      await attachAnalysisParent(pool, await read(id), `parent-${id}`);
      await query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)', [
        `business:sites:${id}`,
        { fieldAnalysis: { fingerprint: id, status: 'pending' } },
      ]);
      await runSourceFields(dispatched, {
        pool,
        saveCheckpoint,
        collect: async () => {
          if (failed) throw Error('synthetic provider failure');
          return {
            patch: { title: 'Analyzed' },
            analysis: { fingerprint: id, status: 'analyzed' },
            model: 'synthetic',
          };
        },
        putDocument: async (_table, name, value, _importOnly, c) =>
          c.query('UPDATE workspace_documents SET value=$2 WHERE name=$1', [
            name,
            value,
          ]),
      });
      assert.equal((await read(id)).status, failed ? 'partial' : 'completed');
      const stats = (await read(`parent-${id}`)).input.sourceAnalysis;
      assert.equal(stats.running, 0);
      assert.equal(stats[failed ? 'failed' : 'completed'], 1);
    }
    // Rolling back a checkpoint also rolls back the parent's phase counters.
    const child = await read('success');
    await query('BEGIN');
    await saveCheckpoint(child, { logs: ['rollback'] }, 'partial', pool);
    await syncAnalysisStage(child, pool, pool);
    assert.equal((await read('parent-success')).input.sourceAnalysis.failed, 1);
    await query('ROLLBACK');
    assert.equal((await read('success')).status, 'completed');
    assert.equal(
      (await read('parent-success')).input.sourceAnalysis.completed,
      1,
    );
    assert.equal(
      (await read('parent-success')).input.sourceAnalysis.failed || 0,
      0,
    );
  } finally {
    await db.close();
  }
});
