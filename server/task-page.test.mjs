import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listTaskPage,
  normalizeTaskPageInput,
} from './task-page.mjs';

test('normalizes page size status search and market', () => {
  assert.deepEqual(
    normalizeTaskPageInput({
      page: '2',
      pageSize: 50,
      statuses: ['running', 'waiting', 'nope'],
      search: '  Abc  ',
      market: 'vn',
    }),
    {
      page: 2,
      pageSize: 50,
      statuses: ['running', 'waiting'],
      search: 'abc',
      market: 'VN',
    },
  );
  assert.equal(normalizeTaskPageInput({ pageSize: 999 }).pageSize, 10);
});

test('pages jobs with active first and returns totals', async () => {
  const jobs = [
    {
      id: 'old-completed',
      status: 'completed',
      cancelled: false,
      created_at: '2026-11-01T00:00:00Z',
      input: { kind: 'products', markets: ['US'] },
      checkpoint: { submittedAt: '2026-11-01T00:00:00Z', logs: ['done'] },
    },
    {
      id: 'active-running',
      status: 'running',
      cancelled: false,
      created_at: '2026-11-03T00:00:00Z',
      updated_at: '2026-11-03T01:00:00Z',
      input: { kind: 'products', markets: ['US'] },
      checkpoint: { submittedAt: '2026-11-03T00:00:00Z', logs: ['go'] },
    },
    {
      id: 'mid-completed',
      status: 'completed',
      cancelled: false,
      created_at: '2026-11-02T00:00:00Z',
      input: { kind: 'products', markets: ['VN'] },
      checkpoint: { submittedAt: '2026-11-02T00:00:00Z', logs: ['done'] },
    },
  ];
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('COUNT(*)') && sql.includes('GROUP BY status'))
        return {
          rows: [
            { status: 'completed', n: 2 },
            { status: 'running', n: 1 },
          ],
        };
      if (sql.includes('COUNT(*)'))
        return { rows: [{ n: jobs.length }] };
      if (sql.includes('SELECT id, status, updated_at'))
        return {
          rows: [
            {
              id: 'active-running',
              status: 'running',
              updated_at: '2026-11-03T01:00:00Z',
            },
          ],
        };
      const offset = Number(params.at(-1)) || 0;
      const limit = Number(params.at(-2)) || jobs.length;
      const ordered = [
        jobs.find((job) => job.status === 'running'),
        ...jobs.filter((job) => job.status !== 'running'),
      ].filter(Boolean);
      return { rows: ordered.slice(offset, offset + limit) };
    },
  };
  const result = await listTaskPage(
    { page: 1, pageSize: 10 },
    {
      pool,
      sql: (postgres) => postgres,
      jobTasks: (job) => [
        {
          id: `${job.id}:US`,
          cloudJobId: job.id,
          market: 'US',
          title: `云端 · 测试 · 美国`,
          status: job.status,
          created: job.created_at,
          steps: job.checkpoint.logs,
        },
      ],
    },
  );
  assert.equal(result.total, 3);
  assert.equal(result.tasks[0].cloudJobId, 'active-running');
  assert.deepEqual(result.statusCounts, { completed: 2, running: 1 });
  assert.deepEqual(result.activeJobs, [
    {
      id: 'active-running',
      status: 'running',
      updatedAt: '2026-11-03T01:00:00Z',
    },
  ]);
  assert.ok(queries.some((item) => item.sql.includes('LIMIT')));
});

test('applies status search and market filters to SQL', async () => {
  const seen = [];
  const pool = {
    async query(sql, params = []) {
      seen.push({ sql, params });
      if (sql.includes('GROUP BY status')) return { rows: [] };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }] };
      if (sql.includes('SELECT id, status, updated_at')) return { rows: [] };
      return { rows: [] };
    },
  };
  await listTaskPage(
    {
      page: 2,
      pageSize: 20,
      statuses: ['running', 'waiting'],
      search: '99cb',
      market: 'US',
    },
    {
      pool,
      sql: (postgres) => postgres,
      jobTasks: () => [],
    },
  );
  const list = seen.find((item) => item.sql.includes('LIMIT'));
  assert.ok(list);
  assert.match(list.sql, /status IN \(\$1\)/);
  assert.equal(list.params[0], 'running');
  assert.match(list.sql, /LOWER\(id\) LIKE/);
  assert.equal(list.params[1], '%99cb%');
  assert.match(list.sql, /markets/);
  assert.equal(list.params[2], 'US');
  assert.equal(list.params.at(-2), 20);
  assert.equal(list.params.at(-1), 20);
});
