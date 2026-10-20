import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Standalone Node server tests.
import test from 'node:test';

import { researchSignature, submitKeywordJob } from './keyword-submit.mjs';
const input = {
  seeds: ['creatine gummies', 'fish oil'],
  markets: ['US', 'VN'],
  sources: ['google'],
  depth: 2,
  limit: 100,
  sorftimeRequestLimit: 0,
};
function fixture() {
  const jobs = [];
  let insertions = 0;
  let locked = false;
  let released = 0;
  const deps = {
    pool: {
      async connect() {
        return {
          release() {
            released++;
          },
          async query(sql, args = []) {
            if (sql.startsWith('INSERT')) {
              insertions++;
              jobs.push({
                id: args[0],
                request_id: args[1],
                input: args[2],
                checkpoint: args[3],
                status: 'queued',
                cancelled: false,
              });
              return { rows: [] };
            }
            if (sql.includes('request_id='))
              return { rows: jobs.filter((j) => j.request_id === args[0]) };
            if (sql.includes('WHERE id='))
              return { rows: jobs.filter((j) => j.id === args[0]) };
            return {
              rows: jobs.filter(
                (j) => ['queued', 'running'].includes(j.status) && !j.cancelled,
              ),
            };
          },
        };
      },
    },
    async lock() {
      if (locked) return false;
      locked = true;
      return true;
    },
    async unlock() {
      locked = false;
    },
  };
  return {
    jobs,
    deps,
    get released() {
      return released;
    },
    get insertions() {
      return insertions;
    },
    get locked() {
      return locked;
    },
  };
}
test('normalization matches order, whitespace and case, but preserves market and budget differences', () => {
  assert.equal(
    researchSignature(input),
    researchSignature({
      ...input,
      markets: ['VN', 'US'],
      seeds: [' FISH  OIL ', 'CREATINE GUMMIES'],
    }),
  );
  assert.notEqual(
    researchSignature(input),
    researchSignature({ ...input, limit: 99 }),
  );
  assert.notEqual(
    researchSignature(input),
    researchSignature({ ...input, markets: ['US'] }),
  );
});
test('concurrent equivalent submissions create one job and release both connections', async () => {
  const f = fixture();
  const result = await Promise.all([
    submitKeywordJob(input, 'r1', f.deps),
    submitKeywordJob(input, 'r2', f.deps),
  ]);
  assert.equal(result[0].job.id, result[1].job.id);
  assert.deepEqual(
    result.map((r) => r.reused).toSorted((a, b) => Number(a) - Number(b)),
    [false, true],
  );
  assert.equal(f.insertions, 1);
  assert.equal(f.released, 2);
  assert.equal(f.locked, false);
});
test('idempotent replay works after completion; a new request can deliberately run again', async () => {
  const f = fixture();
  const first = await submitKeywordJob(input, 'r1', f.deps);
  f.jobs[0].status = 'completed';
  const replay = await submitKeywordJob(input, 'r1', f.deps);
  const rerun = await submitKeywordJob(input, 'r2', f.deps);
  assert.equal(replay.job.id, first.job.id);
  assert.notEqual(rerun.job.id, first.job.id);
  assert.equal(f.jobs.length, 2);
});
test('active duplicates are reused even at the queue cap, different inputs are refused', async () => {
  const f = fixture();
  await submitKeywordJob(input, 'r1', f.deps);
  for (let i = 1; i < 20; i++)
    f.jobs.push({
      id: `other-${i}`,
      status: 'running',
      input: { kind: 'products' },
      cancelled: false,
    });
  const duplicate = await submitKeywordJob(input, 'r2', f.deps);
  assert.equal(duplicate.reused, true);
  await assert.rejects(
    submitKeywordJob({ ...input, limit: 50 }, 'r3', f.deps),
    /20/,
  );
  assert.equal(f.jobs.length, 20);
  assert.equal(f.locked, false);
});
test('connection is released even when unlocking fails', async () => {
  const f = fixture();
  f.deps.unlock = async () => {
    throw new Error('unlock failed');
  };
  await assert.rejects(submitKeywordJob(input, 'r1', f.deps), /unlock failed/);
  assert.equal(f.released, 1);
});
