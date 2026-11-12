/* oxlint-disable vitest/no-import-node-test -- Isolated PGlite and mocked providers. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { storeSamples } from './ingredient-trend-checkpoint.mjs';
import { DAY, ingredientTrendPlan, iso } from './ingredient-trend-domain.mjs';
import { commentStateKey } from './ingredient-trend-quantity-comments.mjs';
import { coverageKey, runIngredientTrend } from './ingredient-trend-runner.mjs';
import { createTrendArchive } from './ingredient-trend-store.mjs';
import { resumePartialTask } from './task-resume.mjs';

const id = '1fd767a0-3dfb-42d8-8299-2ab030cc4bbb';
const now = Date.parse('2026-11-12T01:00:00Z');
const post = {
  id: 'post1',
  type: 'post',
  postId: 'post1',
  platform: 'Reddit',
  community: 'Supplements',
  title: 'Discussion',
  text: 'Source opinion',
  publishedAt: iso(now - 1000),
  reportedComments: 2,
  url: 'https://www.reddit.com/r/Supplements/comments/post1/discussion/',
};
const sample = () => ({
  post,
  pending: [{ cursor: 'next-comment', parentId: null }],
  visited: [],
  ids: ['c1'],
  runIds: ['c1'],
  missingCursor: 0,
  reported: 2,
  lastVisitedAt: iso(now),
  blocked: null,
  pages: 1,
  bodyMissing: 0,
});

async function fixture(t, options = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,status text,cancelled boolean,checkpoint jsonb,updated_at timestamptz);
    CREATE TABLE research_requests(job_id text,step text,status text,response jsonb,PRIMARY KEY(job_id,step));
    CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb);`);
  const query = (statement, params = []) =>
    db.query(
      statement,
      params.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
  const pool = { query, connect: async () => ({ query, release() {} }) };
  const input = {
    kind: 'discovery_monitor',
    monitorId: 'monitor',
    trendOperation: 'collect',
    plan: ingredientTrendPlan({
      market: 'US',
      collectionLimitsVersion: 2,
      communities: ['Supplements'],
      ...options.plan,
    }),
  };
  const calls = [];
  const io = {
    pool,
    now: () => now,
    read: async (name) =>
      (
        await query('SELECT value FROM workspace_documents WHERE name=$1', [
          name,
        ])
      ).rows[0]?.value,
    putDocument: async (_table, name, value) =>
      query(
        'INSERT INTO workspace_documents VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',
        [name, value],
      ),
    saveCheckpoint: async (job, cp, status) => {
      await query(
        'UPDATE research_jobs SET checkpoint=$2,status=$3 WHERE id=$1',
        [job.id, cp, status],
      );
      job.checkpoint = structuredClone(cp);
      job.status = status;
    },
    collect: async (job, step, work) => {
      const previous = (
        await query(
          'SELECT response,status FROM research_requests WHERE job_id=$1 AND step=$2',
          [job.id, step],
        )
      ).rows[0];
      if (previous) {
        assert.equal(previous.status, 'done');
        return previous.response;
      }
      calls.push({ step, work });
      const result = options.respond
        ? await options.respond(work)
        : {
            raw: {
              comments: [
                { id: 'c2', body: 'Next opinion', created_utc: now / 1000 },
              ],
              post: { num_comments: 2 },
            },
          };
      await query("INSERT INTO research_requests VALUES($1,$2,'done',$3)", [
        job.id,
        step,
        result,
      ]);
      return result;
    },
  };
  const archive = createTrendArchive(io, 'US');
  const job = { id, input };
  const source = options.sample || sample();
  const summaries = await storeSamples(job, [source], archive);
  const checkpoint = {
    phase: 'done',
    operation: 'collect',
    asOf: now,
    startedAt: iso(now),
    finishedAt: iso(now),
    sourceRequests: 500,
    commentRequests: 492,
    calls: 500,
    posts: 1,
    newPosts: 0,
    communitySeen: { Supplements: ['post1'] },
    communityPages: { Supplements: 8 },
    postQueue: [],
    coverage: [],
    comments: 1,
    samples: options.keepReferences
      ? summaries
      : summaries.map(({ stateKey: _key, ...s }) => s),
    failures: ['post1评论部分覆盖：后台来源请求保护，本次1条，断点已保留'],
    logs: ['original history'],
  };
  await query(
    "INSERT INTO research_jobs VALUES($1,$2,'partial',false,$3,now())",
    [id, input, checkpoint],
  );
  await db.query(
    "INSERT INTO research_requests SELECT $1,'ingredient-trend:'||n,'done','{}'::jsonb FROM generate_series(0,499) AS n",
    [id],
  );
  const readJob = async () =>
    (await query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
  const update = async (patch) => {
    const job = await readJob();
    await query('UPDATE research_jobs SET checkpoint=$2 WHERE id=$1', [
      id,
      { ...job.checkpoint, ...patch },
    ]);
  };
  const run = async () => {
    const job = await readJob();
    for (let n = 0; n < 12; n++) {
      await runIngredientTrend(job, io);
      if (job.status !== 'running') return job;
    }
    throw Error('Synthetic continuation did not finish');
  };
  return {
    db,
    query,
    pool,
    io,
    archive,
    source,
    summaries,
    readJob,
    update,
    run,
    calls,
  };
}

test('legacy terminal checkpoint restores its exact cursor beyond 500 requests without resetting journals', async (t) => {
  const f = await fixture(t);
  await resumePartialTask(id, f.pool);
  const queued = await f.readJob();
  assert.equal(queued.checkpoint.phase, 'comments');
  assert.equal(queued.checkpoint.finishedAt, undefined);
  assert.equal(queued.checkpoint.sourceRequests, 500);
  assert.equal(queued.checkpoint.samples[0].stateKey, f.summaries[0].stateKey);
  assert.equal((await resumePartialTask(id, f.pool)).reused, true);
  const done = await f.run();
  assert.equal(done.status, 'completed');
  assert.deepEqual(
    f.calls.map((c) => [c.step, c.work.cursor]),
    [['ingredient-trend:500', 'next-comment']],
  );
  assert.equal(done.checkpoint.sourceRequests, 501);
  assert.equal(done.checkpoint.commentRequests, 493);
  assert.equal(done.checkpoint.comments, 2);
  assert.ok(done.checkpoint.samples[0].stateKey);
  assert.equal(
    (await f.query('SELECT count(*)::integer AS n FROM research_requests'))
      .rows[0].n,
    501,
  );
});

test('new checkpoints retain immutable references and resume paid buffered records without refetch', async (t) => {
  const s = sample();
  s.bufferedPage = {
    records: [
      { id: 'c1', type: 'comment', postId: 'post1', text: 'One' },
      { id: 'c2', type: 'comment', postId: 'post1', text: 'Two' },
    ],
    offset: 1,
    cursors: [],
    reported: 2,
    cursor: 'next-comment',
    at: iso(now),
    capture: 'saved-paid-page',
  };
  const f = await fixture(t, { sample: s, keepReferences: true });
  await resumePartialTask(id, f.pool);
  const done = await f.run();
  assert.equal(done.status, 'completed');
  assert.equal(f.calls.length, 0);
  assert.equal(done.checkpoint.sourceRequests, 500);
  assert.equal(done.checkpoint.comments, 2);
});

test('missing or ambiguous legacy archives never queue a fresh root request', async (t) => {
  for (const ambiguous of [false, true]) {
    await t.test(String(ambiguous), async (t) => {
      const f = await fixture(t);
      if (ambiguous)
        await storeSamples(
          { id },
          [
            {
              ...f.source,
              pending: [{ cursor: 'different-cursor', parentId: null }],
            },
          ],
          f.archive,
        );
      else await f.query('DELETE FROM workspace_documents');
      await assert.rejects(resumePartialTask(id, f.pool), /归档.*(歧义|缺失)/);
      assert.equal((await f.readJob()).status, 'partial');
      assert.equal(f.calls.length, 0);
    });
  }
});

test('unknown requests, manual cancellation and existing quantity limits stay protected', async (t) => {
  for (const mode of ['unknown', 'cancelled', 'quota', 'blocked']) {
    await t.test(mode, async (t) => {
      const f = await fixture(t);
      if (mode === 'unknown')
        await f.query(
          "UPDATE research_requests SET status='started' WHERE step='ingredient-trend:499'",
        );
      if (mode === 'cancelled')
        await f.query(
          "UPDATE research_jobs SET status='cancelled',cancelled=true",
        );
      if (mode === 'quota')
        await f.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
          id,
          {
            ...(await f.readJob()).input,
            plan: { ...(await f.readJob()).input.plan, maxCommentsPerPost: 1 },
          },
        ]);
      if (mode === 'blocked')
        await f.update({
          samples: [
            {
              ...(await f.readJob()).checkpoint.samples[0],
              blocked: { step: 'old-unknown' },
            },
          ],
        });
      await assert.rejects(
        resumePartialTask(id, f.pool),
        /未确认|没有可继续|已达到/,
      );
      assert.equal(f.calls.length, 0);
      assert.equal(
        (await f.readJob()).status,
        mode === 'cancelled' ? 'cancelled' : 'partial',
      );
    });
  }
});

test('newer monitor cursors prevent resuming an older paid traversal', async (t) => {
  const f = await fixture(t);
  await f.archive.write(commentStateKey('US', 'monitor', 'post1'), {
    lastJobId: 'newer-job',
    lastVisitedAt: iso(now + 1000),
  });
  await assert.rejects(resumePartialTask(id, f.pool), /更新的采集断点/);
  assert.equal((await f.readJob()).status, 'partial');
  assert.equal(f.calls.length, 0);
});

test('old post guard continuation keeps completed comment work and resumes unfinished posts', async (t) => {
  const f = await fixture(t, {
    respond: async (work) =>
      work.op === 'community'
        ? {
            raw: {
              posts: [
                {
                  id: 'post2',
                  subreddit: 'Supplements',
                  title: 'New post',
                  selftext: 'Source body',
                  created_utc: now / 1000,
                  num_comments: 1,
                },
              ],
            },
          }
        : {
            raw: {
              comments: [
                {
                  id: work.url.includes('/post1/') ? 'c2' : 'c3',
                  body: 'Next opinion',
                  created_utc: now / 1000,
                },
              ],
              post: { num_comments: work.url.includes('/post1/') ? 2 : 1 },
            },
          },
  });
  await f.archive.observe(post, 'previous-capture', iso(now));
  const scan = {
    asOf: now,
    cutoff: now - 7 * DAY,
    cursor: 'next-post-page',
    cursorHashes: [],
    fingerprints: [],
    orderIssues: 0,
    missingDates: 0,
  };
  const state = {
    community: 'Supplements',
    scan,
    partial: true,
    lastJobId: id,
    observedAt: iso(now),
  };
  await f.archive.write(coverageKey('US', 'monitor', 'Supplements'), state);
  await f.update({
    coverage: [state],
    failures: [
      '触发后台帖子请求保护，未完成的社区保留断点，剩余额度用于评论',
      ...(await f.readJob()).checkpoint.failures,
    ],
  });
  await resumePartialTask(id, f.pool);
  assert.equal((await f.readJob()).checkpoint.phase, 'posts');
  const done = await f.run();
  assert.equal(done.status, 'completed');
  assert.equal(done.checkpoint.posts, 2);
  assert.equal(done.checkpoint.comments, 3);
  assert.equal(f.calls.length, 3);
  assert.equal(
    f.calls.find((c) => c.work.op === 'community').work.cursor,
    'next-post-page',
  );
  assert.equal(
    f.calls.find((c) => c.work.url?.includes('/post1/')).work.cursor,
    'next-comment',
  );
  assert.equal(done.checkpoint.sourceRequests, 503);
});
