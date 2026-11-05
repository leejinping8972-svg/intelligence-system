import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { decorateKeywordTasks } from './task-keyword-executions.mjs';

test('request evidence corrects legacy skipped metrics without counting another task’s failure', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE research_requests(job_id text,step text,status text)',
    );
    for (let i = 0; i < 10; i++)
      await db.query('INSERT INTO research_requests VALUES($1,$2,$3)', [
        'legacy',
        `sem-metric:${i}`,
        i === 9 ? 'failed' : 'done',
      ]);
    await db.exec(
      "INSERT INTO research_requests VALUES('legacy','sem-discover:0','done'),('legacy','sem-metric:10','started')",
    );
    const input = {
      expansionOnly: true,
      seeds: ['curcumin'],
      markets: ['US'],
      sources: ['semrush'],
      limit: 0,
    };
    const keywords = Array.from({ length: 709 }, (_, i) => ({
      id: `k${i}`,
      term: `curcumin ${i}`,
      market: 'US',
      semrushCollection: {
        jobId: 'legacy',
        status: i < 9 ? 'completed' : 'failed',
        message: 'legacy copied failure',
      },
    }));
    const jobs = [
      {
        id: 'legacy',
        status: 'awaiting_review',
        input,
        checkpoint: {
          keywords,
          discoveryComplete: true,
          metricIndex: 709,
          failures: 700,
          semBlocked: '报告异常',
          logs: ['403 ERROR 132 :: API UNITS BALANCE IS ZERO'],
        },
      },
      {
        id: 'current',
        status: 'queued',
        input: { ...input, seeds: Array(42).fill('seed') },
        checkpoint: {
          keywords,
          discoveryIndex: 31,
          metricIndex: 0,
          failures: 32,
        },
      },
    ];
    const result = await decorateKeywordTasks(
      jobs.map((j) => ({ cloudJobId: j.id })),
      jobs,
      db,
    );
    const old = result[0];
    assert.equal(old.progress.metricProcessed, 10);
    assert.equal(old.progress.succeeded, 9);
    assert.equal(old.progress.failed, 1);
    assert.equal(old.progress.discoveryFailed, 0);
    assert.equal(old.progress.metricPending, 698);
    assert.equal(old.progress.metricUnknown, 1);
    assert.equal(old.progress.rows[10].status, 'unknown');
    assert.equal(old.progress.rows[11].status, 'not_started');
    assert.match(old.progress.metricBlockReason, /额度为0/);
    assert.ok(old.overview.percent < 100);
    const current = result[1];
    assert.equal(current.progress.phase, 'queued');
    assert.equal(current.progress.metricProcessed, 0);
    assert.equal(current.progress.failed, 0);
    assert.equal(current.progress.discovered, 709);
    assert.equal(current.progress.percent, 4);
    assert.match(
      current.progress.rows[0].message,
      /关键词已获取；月搜索量尚未执行/,
    );
    assert.equal(current.overview.processed, 31);
    assert.equal(current.overview.total, 751);
    assert.equal(current.overview.failed, 32);
  } finally {
    await db.close();
  }
});
