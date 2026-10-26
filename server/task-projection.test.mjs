import assert from 'node:assert/strict';
import test from 'node:test';

import { jobTasks } from './runner.mjs';
import { projectJobTasks } from './task-projection.mjs';
import { workspaceSnapshot } from './workspace-snapshot.mjs';

const keyword = () => ({
  id: 'keyword',
  status: 'running',
  created_at: '2026-10-26T00:00:00Z',
  input: { seeds: ['test'], markets: ['US', 'VN'], sources: ['semrush'] },
  checkpoint: {},
});
const bulk = () => ({
  id: 'bulk',
  status: 'bulk_running',
  created_at: '2026-10-26T00:00:00Z',
  input: {
    kind: 'bulk_semrush_enrichment',
    semrushKeyId: 'private-key-id',
    work: [
      { market: 'US', domain: 'private-domain' },
      { market: 'VN' },
      { market: 'US' },
    ],
  },
  checkpoint: {
    total: 3,
    executed: 0,
    reused: 1,
    applied: 1,
    remaining: 2,
    unknown: 0,
    reason: 'private-error',
    confirmedUnits: 12,
  },
});

test('persisted bulk tasks without seeds or markets project safe summaries, including real zero counters', () => {
  const job = bulk();
  const before = structuredClone(job);
  const tasks = jobTasks(job);
  assert.deepEqual(
    tasks.map((t) => t.market),
    ['US', 'VN'],
  );
  assert.equal(tasks[0].status, 'bulk_running');
  assert.equal(tasks[0].readOnly, true);
  assert.match(tasks[0].steps.at(-1), /对象总数 3；已请求 0/);
  assert.match(tasks[0].steps.join(''), /未自动恢复/);
  assert.doesNotMatch(
    JSON.stringify(tasks),
    /private-|semrushKeyId|confirmedUnits/,
  );
  assert.deepEqual(job, before);
  assert.deepEqual(
    jobTasks({ ...job, cancelled: true }).map((t) => t.status),
    ['cancelled', 'cancelled'],
  );
});

test('unknown and malformed jobs remain visible without inventing markets or leaking error details', () => {
  for (const job of [
    { id: 'unknown', input: { kind: 'future-private-kind' } },
    { ...keyword(), input: { kind: 'semrush_sites', markets: ['US'] } },
    { id: 'null', input: null, checkpoint: null, created_at: 'invalid' },
  ]) {
    const tasks = jobTasks(job);
    assert.ok(tasks.length);
    assert.equal(tasks[0].status, 'unavailable');
    assert.equal(tasks[0].readOnly, true);
    assert.doesNotMatch(
      JSON.stringify(tasks),
      /future-private-kind|undefined|length/,
    );
  }
  const task = jobTasks({ id: 'unknown', input: {} })[0];
  assert.equal(task.market, 'ALL');
  assert.equal(task.created, '');
  const unknown = jobTasks({
    id: 'bulk',
    input: { kind: 'bulk_semrush_enrichment' },
  })[0];
  assert.match(unknown.steps.at(-1), /对象总数 未记录；已请求 未记录/);
});

test('mixed snapshots preserve valid keyword progress and use the same summaries as task detail', async () => {
  const jobs = [keyword(), bulk(), { id: 'broken', input: {} }];
  const snapshot = await workspaceSnapshot(
    { channels: ['tasks'] },
    {
      pool: {
        async query() {
          return { rows: jobs };
        },
      },
      readVersions: async () => ({ tasks: '1' }),
      jobTasks,
    },
  );
  assert.equal(snapshot.tasks.length, 5);
  assert.ok(snapshot.tasks[0].progress);
  assert.deepEqual(
    snapshot.tasks.filter((t) => t.cloudJobId === 'bulk'),
    jobTasks(jobs[1]).map((t) => ({ ...t, steps: t.steps.slice(-1) })),
  );
  assert.equal(snapshot.tasks.at(-1).status, 'unavailable');
});

test('snapshot contains projector exceptions per record, while valid projections remain unchanged', async () => {
  const good = { id: 'good', steps: ['ok'] };
  assert.deepEqual(
    projectJobTasks(keyword(), () => [good]),
    [good],
  );
  const snapshot = await workspaceSnapshot(
    { channels: ['tasks'] },
    {
      pool: {
        async query() {
          return { rows: [{ id: 'bad' }, { id: 'good' }] };
        },
      },
      readVersions: async () => ({ tasks: '2' }),
      jobTasks(job) {
        if (job.id === 'bad') throw Error('private-error');
        return [good];
      },
    },
  );
  assert.equal(snapshot.tasks.length, 2);
  assert.equal(snapshot.tasks[0].status, 'unavailable');
  assert.deepEqual(snapshot.tasks[1], good);
  assert.doesNotMatch(JSON.stringify(snapshot), /private-error/);
});
