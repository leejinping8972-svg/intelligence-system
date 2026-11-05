import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { resumePartialTask } from './task-resume.mjs';

const id = '1fd767a0-3dfb-42d8-8299-2ab030cc4bbb';
test('blocked finished keyword task continues only untouched metrics and keeps journals', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE research_jobs(id text primary key,status text,cancelled boolean,checkpoint jsonb,updated_at timestamptz); CREATE TABLE research_requests(job_id text,step text,status text,response jsonb);');
    await db.query('INSERT INTO research_jobs VALUES($1,$2,false,$3,now())', [id, 'awaiting_review', { semBlocked: 'quota exhausted', semBlockedError: 'ERROR 132', metricIndex: 999, keywords: [{id:'a'},{id:'b'},{id:'c'}], logs:['history'], discoveryIndex:42 }]);
    await db.query('INSERT INTO research_requests VALUES($1,$2,$3,$4),($1,$5,$6,$7)', [id, 'sem-metric:0', 'done', {metrics:1}, 'sem-metric:1', 'failed', {error:'quota'}]);
    const pool = { connect: async () => ({query: db.query.bind(db), release() {}}) };
    const first = await resumePartialTask(id, pool);
    assert.equal(first.status, 'queued');
    const saved = (await db.query('SELECT * FROM research_jobs')).rows[0];
    assert.equal(saved.checkpoint.metricIndex, 2);
    assert.equal(saved.checkpoint.discoveryIndex, 42);
    assert.equal(saved.checkpoint.semBlocked, undefined);
    assert.equal(saved.checkpoint.logs[0], 'history');
    assert.equal((await db.query('SELECT * FROM research_requests')).rows.length, 2);
    const again = await resumePartialTask(id, pool);
    assert.equal(again.reused, true);
    assert.deepEqual((await db.query('SELECT checkpoint FROM research_jobs')).rows[0].checkpoint, saved.checkpoint);
    await db.query("UPDATE research_jobs SET status='partial'");
    await db.query("INSERT INTO research_requests VALUES($1,'sem-metric:2','started',null)", [id]);
    await assert.rejects(resumePartialTask(id, pool), /结果未确认/);
    assert.equal((await db.query('SELECT status FROM research_jobs')).rows[0].status, 'partial');
    await db.query("DELETE FROM research_requests WHERE status='started'");
    await db.query("UPDATE research_jobs SET status='cancelled',cancelled=true");
    await assert.rejects(resumePartialTask(id, pool), /没有可继续/);
  } finally { await db.close(); }
});
