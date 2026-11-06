import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { keywordMetricEvidence } from './keyword-metric-evidence.mjs';

test('saved metric evidence distinguishes a failed request from skipped keywords without modifying storage', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE TABLE research_jobs(id text PRIMARY KEY,checkpoint jsonb); CREATE TABLE research_requests(job_id text,step text,status text,error text)',
    );
    await db.query('INSERT INTO research_jobs VALUES($1,$2)', [
      'owner',
      {
        semBlocked: '报告异常',
        semBlockedError: 'Semrush报告未返回可识别的数据行',
        logs: ['403 ERROR 132 :: API UNITS BALANCE IS ZERO'],
        keywords: [{ id: 'attempted' }, { id: 'skipped' }],
      },
    ]);
    await db.exec(
      "INSERT INTO research_requests VALUES('owner','sem-metric:0','failed','Semrush报告未返回可识别的数据行')",
    );
    const rows = ['attempted', 'skipped', 'deleted-owner'].map((id) => ({
      id,
      semrushCollection: {
        jobId: id === 'deleted-owner' ? 'deleted' : 'owner',
        status: 'failed',
        message: '笼统错误',
      },
    }));
    const before = JSON.stringify(rows);
    const result = await keywordMetricEvidence(rows, db, (pg) => pg);
    assert.equal(result[0].semrushCollection.status, 'failed');
    assert.match(result[0].semrushCollection.message, /未返回可识别/);
    assert.equal(result[1].semrushCollection.status, 'not_started');
    assert.match(result[1].semrushCollection.message, /未执行.*未返回可识别/);
    assert.equal(result[1].semrushCollection.finishedAt, undefined);
    assert.equal(result[2], rows[2]);
    assert.equal(JSON.stringify(rows), before);
    assert.match(
      (await db.query('SELECT checkpoint FROM research_jobs')).rows[0]
        .checkpoint.semBlocked,
      /报告异常/,
    );
  } finally {
    await db.close();
  }
});
