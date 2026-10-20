import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Standalone Node server tests.
import test from 'node:test';

import { compactTask, workspaceSnapshot } from './workspace-snapshot.mjs';

function fixture() {
  const calls = [];
  const meta = {
    business: [{ name: 'business:products:p1', revision: 1 }],
    keywords: [{ natural_key: 'US|word', updated_at: '2026-10-20' }],
    tasks: [
      {
        id: 'job1',
        updated_at: '2026-10-20',
        status: 'running',
        cancelled: false,
      },
    ],
  };
  const task = {
    id: 't1',
    steps: ['first', 'last'],
    progress: { rows: ['large trend'], total: 100 },
    researchProgress: { rows: ['product'], requestLog: ['log'], done: 1 },
  };
  const deps = {
    pool: {
      async query(sql) {
        calls.push(sql);
        let rows;
        if (sql.startsWith('SELECT name,revision')) rows = meta.business;
        else if (sql.startsWith('SELECT natural_key')) rows = meta.keywords;
        else if (sql.startsWith('SELECT id,updated_at')) rows = meta.tasks;
        else if (sql.startsWith('SELECT name,value'))
          rows = [
            { name: 'business:products:p1', value: { id: 'p1' } },
            { name: 'business:bad', value: 'hidden' },
          ];
        else if (sql.startsWith('SELECT data')) rows = [{ data: { id: 'k1' } }];
        else if (sql.startsWith('SELECT *')) rows = [{ id: 'job1' }];
        else assert.fail(sql);
        return { rows };
      },
    },
    jobTasks: () => [task],
    scoreSite: (value) => value,
    isWorkspaceSyncKey: (key) => key.startsWith('products:'),
  };
  return { calls, meta, deps, task };
}
test('unchanged polling reads only metadata and omits all data channels', async () => {
  const f = fixture();
  const first = await workspaceSnapshot({}, f.deps);
  assert.equal(first.business.entries.length, 1);
  assert.equal(first.tasks[0].progress.total, 100);
  assert.deepEqual(first.tasks[0].progress.rows, []);
  f.calls.length = 0;
  const idle = await workspaceSnapshot({ revisions: first.revisions }, f.deps);
  assert.deepEqual(Object.keys(idle).toSorted(), ['generatedAt', 'revisions']);
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.task.steps, ['first', 'last']);
  assert.deepEqual(f.task.researchProgress.requestLog, ['log']);
});
test('a task update does not reload products or keywords', async () => {
  const f = fixture();
  const first = await workspaceSnapshot({}, f.deps);
  f.meta.tasks[0].status = 'completed';
  f.calls.length = 0;
  const next = await workspaceSnapshot({ revisions: first.revisions }, f.deps);
  assert.ok(next.tasks);
  assert.equal(next.business, undefined);
  assert.equal(next.keywords, undefined);
  assert.equal(f.calls.length, 4);
});
test('deletion and replacement with the same timestamp invalidate the appropriate revision', async () => {
  const f = fixture();
  const first = await workspaceSnapshot({}, f.deps);
  f.meta.business = [];
  f.meta.keywords[0].natural_key = 'US|replacement';
  const next = await workspaceSnapshot({ revisions: first.revisions }, f.deps);
  assert.ok(next.business);
  assert.ok(next.keywords);
  assert.equal(next.tasks, undefined);
});
test('database errors propagate rather than returning a revision for missing data', async () => {
  const f = fixture();
  f.deps.pool.query = async () => {
    throw new Error('offline');
  };
  await assert.rejects(workspaceSnapshot({}, f.deps), /offline/);
  assert.deepEqual(compactTask({ steps: [] }), { steps: [] });
});
test('same-timestamp content changes are detected and MySQL uses a compatible checksum expression', async () => {
  const f = fixture();
  f.deps.sql = (_postgres, mysql) => mysql;
  const first = await workspaceSnapshot({}, f.deps);
  f.meta.keywords[0].content_hash = 'changed-keyword';
  f.meta.tasks[0].content_hash = 'changed-progress';
  const next = await workspaceSnapshot({ revisions: first.revisions }, f.deps);
  assert.ok(next.keywords);
  assert.ok(next.tasks);
  assert.equal(next.business, undefined);
  assert.ok(
    f.calls.some((sql) =>
      sql.includes('CAST(data AS CHAR CHARACTER SET utf8mb4)'),
    ),
  );
});
