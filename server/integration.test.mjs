import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import pg from 'pg';

// Runs only inside the server container. All data and mock observations use a fresh QA database.
const database = `migration_qa_${randomUUID().replaceAll('-', '')}`;
const originalUrl = process.env.DATABASE_URL;
if (!originalUrl)
  throw new Error('Run inside the API container with DATABASE_URL configured');
const admin = new pg.Pool({ connectionString: originalUrl });
await admin.query(`CREATE DATABASE ${database}`);
const url = new URL(originalUrl);
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
process.env.SERVER_BRIDGE_KEY = 'integration-test-only-not-production';
const calls = [];
const mock = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const input = JSON.parse(Buffer.concat(chunks));
  calls.push(input);
  const generatedAt = new Date().toISOString();
  const result = input.sources.includes('google_trends')
    ? {
        trends: input.keywords.map((keyword) => ({
          keyword,
          market: 'US',
          series: [30, 50],
          points: [
            { date: '2026-09-01', value: 30 },
            { date: '2026-10-01', value: 50 },
          ],
          source: 'QA mock only',
          status: 'success',
          message: 'QA mock only',
        })),
      }
    : {
        suggestions: [
          {
            market: 'US',
            items: [{ term: 'magnesium gummies', source: 'Sorftime · Amazon' }],
            sources: [
              {
                source: 'Sorftime · Amazon',
                count: 1,
                status: 'success',
                message: 'QA mock only',
              },
            ],
          },
        ],
        usage: { sorftimeCalls: 1 },
      };
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ generatedAt, ...result }));
});
await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
process.env.COLLECTOR_URL = `http://127.0.0.1:${mock.address().port}`;
const { migrate, pool, saveKeyword, usage } = await import('./store.mjs');
const { runJob } = await import('./runner.mjs');
try {
  await migrate();
  const input = {
    seeds: ['magnesium'],
    markets: ['US'],
    sources: ['sorftime'],
    limit: 2,
    depth: 1,
    sorftimeRequestLimit: 1,
  };
  const { rows } = await pool.query(
    'INSERT INTO research_jobs(id,request_id,input) VALUES($1,$2,$3) RETURNING *',
    [randomUUID(), randomUUID(), input],
  );
  const job = rows[0];
  await runJob(job);
  assert.equal(calls.length, 3);
  const completedResult = await pool.query(
    'SELECT * FROM research_jobs WHERE id=$1',
    [job.id],
  );
  const completed = completedResult.rows[0];
  assert.equal(completed.status, 'awaiting_review');
  const countResult = await pool.query(
    'SELECT count(*)::int AS n FROM research_keywords',
  );
  assert.equal(countResult.rows[0].n, 2);
  await pool.query(
    'UPDATE research_keywords SET data=data || \'{"favorite":true,"reviewStatus":"selected"}\'::jsonb WHERE natural_key=\'US|magnesium\'',
  );
  await saveKeyword({
    ...completed.checkpoint.keywords[0],
    favorite: false,
    reviewStatus: 'pending',
  });
  const selectedResult = await pool.query(
    "SELECT data FROM research_keywords WHERE natural_key='US|magnesium'",
  );
  const selected = selectedResult.rows[0].data;
  assert.equal(selected.favorite, true);
  assert.equal(selected.reviewStatus, 'selected');
  // Replay after a crash before the checkpoint commit uses the completed request journal.
  await runJob({ ...job, checkpoint: {} });
  assert.equal(
    calls.length,
    3,
    'completed requests must not repeat after restart',
  );
  assert.deepEqual(await usage(job.id), { confirmed: 1, reserved: 0 });
  // An uncertain paid request is never retried, but its quota remains reserved.
  const nextResult = await pool.query(
    'INSERT INTO research_jobs(id,request_id,input) VALUES($1,$2,$3) RETURNING *',
    [randomUUID(), randomUUID(), input],
  );
  const next = nextResult.rows[0];
  await pool.query(
    "INSERT INTO research_requests(job_id,step,paid_allowance,status) VALUES($1,'discover:0',1,'started')",
    [next.id],
  );
  await runJob(next);
  assert.equal(
    calls.filter((call) => call.sources.includes('sorftime')).length,
    1,
  );
  assert.deepEqual(await usage(next.id), { confirmed: 0, reserved: 1 });
  const finishedResult = await pool.query(
    'SELECT * FROM research_jobs WHERE id=$1',
    [next.id],
  );
  const finished = finishedResult.rows[0];
  assert.equal(finished.status, 'partial');
  assert.ok(finished.checkpoint.logs.some((line) => line.includes('结果未知')));
  console.warn(
    'PASS: durable research, result storage, manual edits, restart replay, paid quota protection (isolated QA database)',
  );
} finally {
  await pool.end();
  await new Promise((resolve) => mock.close(resolve));
  await admin.query(`DROP DATABASE ${database}`);
  await admin.end();
}
