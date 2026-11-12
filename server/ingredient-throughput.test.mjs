/* oxlint-disable vitest/no-import-node-test -- Isolated Node/PGlite workflow tests. */
/* oxlint-disable unicorn/no-await-expression-member -- Test assertions read isolated database results directly. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createTrendDocuments } from './ingredient-trend-documents.mjs';
import { createTrendArchive } from './ingredient-trend-store.mjs';
import {
  compactAnalysis,
  compactSamples,
  loadSample,
  storeSamples,
} from './ingredient-trend-checkpoint.mjs';
import { runIngredientTrend } from './ingredient-trend-runner.mjs';
import { ingredientTrendPlan, iso } from './ingredient-trend-domain.mjs';
import {
  commentStateKey,
  prepareQuantityComments,
} from './ingredient-trend-quantity-comments.mjs';
import {
  beginTrendTiming,
  saveTrendCheckpoint,
} from './ingredient-trend-timing.mjs';
import {
  ingredientDependencyFilter,
  createQueueScheduling,
} from './queue-scheduling.mjs';
import { taskOverview } from './task-overview.mjs';
import { compactTask } from './workspace-snapshot.mjs';

const now = Date.parse('2026-11-11T01:00:00Z');
const sql = (pg) => pg;
const record = (id, type = 'comment') => ({
  id,
  type,
  postId: 'post1',
  community: 'Supplements',
  platform: 'Reddit',
  title: 'Original discussion',
  text: 'Complete original opinion',
  url: `https://www.reddit.com/r/Supplements/comments/post1/discussion/${id}/`,
  publishedAt: iso(now - 1000),
  author: `author${id}`,
  score: 1,
});
const sample = (id = 'post1') => ({
  post: {
    ...record(id, 'post'),
    reportedComments: 3,
    text: 'Evidence '.repeat(1000),
  },
  pending: [{ cursor: '', parentId: null }],
  visited: [],
  ids: [],
  missingCursor: 0,
  reported: 3,
  lastVisitedAt: '',
  blocked: null,
  pages: 0,
  bodyMissing: 0,
  runIds: [],
});
async function fixture(t, respond) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer NOT NULL DEFAULT 1);
    CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb NOT NULL,checkpoint jsonb NOT NULL DEFAULT '{}',status text DEFAULT 'running',cancelled boolean DEFAULT false);`);
  const statements = [],
    journal = new Map(),
    calls = [];
  let failWrite = false,
    sequence = 0;
  const pool = {
    query: async (statement, params = []) => {
      statements.push(statement);
      const result = await db.query(
        statement,
        params.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
      );
      if (failWrite && statement.startsWith('INSERT INTO workspace_documents'))
        throw new Error('Interrupted batch');
      return result;
    },
    connect: async () => ({
      query: (...args) => pool.query(...args),
      release() {},
    }),
  };
  const io = {
    pool,
    now: () => now,
    read: async (name) =>
      (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [name],
        )
      ).rows[0]?.value,
    putDocument: async (_table, name, value) =>
      pool.query(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,revision=workspace_documents.revision+1',
        [name, value],
      ),
    documents: createTrendDocuments({ pool, sql }),
    saveCheckpoint: async (job, cp, status) => {
      await pool.query(
        'UPDATE research_jobs SET checkpoint=$2,status=$3 WHERE id=$1',
        [job.id, cp, status],
      );
      job.checkpoint = structuredClone(cp);
      job.status = status;
    },
    collect: async (job, step, work) => {
      const key = `${job.id}:${step}`;
      if (journal.has(key)) return structuredClone(journal.get(key));
      calls.push({ step, work });
      let result;
      if (respond) result = await respond(job, step, work);
      else if (work.sources?.includes('ingredient_analysis'))
        result = { ingredients: [] };
      else if (work.op === 'community')
        result = {
          raw: {
            posts: [
              {
                id: 'post1',
                selftext: 'Complete post body',
                title: 'Supplement discussion',
                subreddit: 'Supplements',
                created_utc: (now - 1000) / 1000,
                num_comments: 3,
                permalink: '/r/Supplements/comments/post1/discussion/',
              },
            ],
            after: '',
          },
          creditsCharged: 1,
          requestLog: { startedAt: iso(now), durationMs: 3 },
        };
      else
        result = {
          raw: {
            comments: [1, 2, 3].map((n) => ({
              id: `c${n}`,
              body: `Opinion ${n}`,
              created_utc: now / 1000,
            })),
            post: { num_comments: 3 },
          },
          creditsCharged: 1,
          requestLog: { startedAt: iso(now), durationMs: 3 },
        };
      journal.set(key, structuredClone(result));
      return result;
    },
  };
  const archive = createTrendArchive(io, 'US');
  const createJob = async (checkpoint = {}, extra = {}) => {
    const job = {
      id: `job${sequence++}`,
      input: {
        kind: 'discovery_monitor',
        monitorId: 'monitor1',
        plan: ingredientTrendPlan({
          market: 'US',
          collectionLimitsVersion: 2,
          communities: ['Supplements'],
        }),
        ...extra,
      },
      status: 'running',
      checkpoint,
    };
    await pool.query(
      'INSERT INTO research_jobs(id,input,checkpoint) VALUES($1,$2,$3)',
      [job.id, job.input, checkpoint],
    );
    return job;
  };
  const get = async (id) =>
    (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
  const dump = async () =>
    (
      await pool.query(
        'SELECT name,value FROM workspace_documents ORDER BY name',
      )
    ).rows;
  return {
    io,
    pool,
    archive,
    statements,
    calls,
    createJob,
    get,
    dump,
    fail: (value) => {
      failWrite = value;
    },
  };
}

test('page batch preserves original bodies, first-seen and observation identities with five SQL calls', async (t) => {
  const f = await fixture(t),
    g = await fixture(t);
  const records = Array.from({ length: 25 }, (_, n) => record(`c${n}`));
  for (const a of [f.archive, g.archive])
    await a.observe(records[0], 'previous', iso(now - 10_000));
  records[0].text = '';
  f.statements.length = 0;
  await f.archive.observeMany(records, 'capture1', iso(now));
  assert.equal(
    f.statements.length,
    5,
    'BEGIN, two bounded reads, one upsert, COMMIT',
  );
  g.statements.length = 0;
  for (const r of records) await g.archive.observe(r, 'capture1', iso(now));
  assert.equal(g.statements.length, 125);
  assert.deepEqual(await f.dump(), await g.dump());
  const before = await f.dump();
  await f.archive.observeMany(records, 'capture1', iso(now));
  assert.deepEqual(
    await f.dump(),
    before,
    'replaying the saved response creates no duplicate observations',
  );
});

test('a database interruption rolls back the complete page before its retry', async (t) => {
  const f = await fixture(t),
    before = await f.dump();
  f.fail(true);
  await assert.rejects(
    f.archive.observeMany([record('c1'), record('c2')], 'capture1', iso(now)),
    /Interrupted batch/,
  );
  f.fail(false);
  assert.deepEqual(await f.dump(), before);
  await f.archive.observeMany(
    [record('c1'), record('c2')],
    'capture1',
    iso(now),
  );
  assert.equal((await f.dump()).length, 6);
});

test('542 heavy samples become small immutable references and only the selected sample changes', async (t) => {
  const f = await fixture(t),
    cp = {
      phase: 'comments',
      samples: Array.from({ length: 542 }, (_, n) => sample(`p${n}`)),
    };
  const oldBytes = Buffer.byteLength(JSON.stringify(cp));
  await compactSamples({ id: 'compact-job' }, cp, f.archive);
  const newBytes = Buffer.byteLength(JSON.stringify(cp));
  t.diagnostic(
    `Synthetic 542-sample checkpoint: ${oldBytes} -> ${newBytes} bytes`,
  );
  assert.ok(newBytes < oldBytes / 10, `${oldBytes} -> ${newBytes}`);
  assert.ok(cp.samples.every((s) => !s.post && !s.pending && s.stateKey));
  const original = structuredClone(cp.samples[12]),
    loaded = await loadSample(original, f.archive);
  loaded.runIds = ['c1'];
  loaded.ids = ['c1'];
  cp.samples[12] = (
    await storeSamples({ id: 'compact-job' }, [loaded], f.archive)
  )[0];
  assert.notEqual(cp.samples[12].stateKey, original.stateKey);
  assert.equal(
    (await loadSample(original, f.archive)).runIds.length,
    0,
    'old checkpoint references remain unchanged after a crash',
  );
});

test('old in-flight v2 checkpoint resumes a saved paid page after archive-before-checkpoint failure', async (t) => {
  const f = await fixture(t),
    job = await f.createJob({
      phase: 'comments',
      operation: 'collect',
      posts: 1,
      newPosts: 1,
      sourceRequests: 0,
      commentRequests: 0,
      calls: 0,
      samples: [sample()],
      sampleIndex: 0,
    });
  const save = f.io.saveCheckpoint;
  f.io.saveCheckpoint = async (j, cp, status) => {
    if (cp.samples?.[0]?.observed > 0)
      throw new Error('Process terminated before checkpoint commit');
    return save(j, cp, status);
  };
  await assert.rejects(runIngredientTrend(job, f.io), /Process terminated/);
  const saved = await f.get(job.id);
  assert.equal(saved.checkpoint.activeSourceStep, 'ingredient-trend:0');
  assert.equal(saved.checkpoint.samples[0].observed, 0);
  const before = (await f.dump()).filter((r) =>
    r.name.startsWith('ingredient-trend:observation:'),
  ).length;
  f.io.saveCheckpoint = save;
  await runIngredientTrend(saved, f.io);
  const resumed = await f.get(job.id);
  assert.equal(f.calls.length, 1);
  assert.equal(resumed.checkpoint.samples[0].observed, 3);
  assert.equal(resumed.checkpoint.sourceRequests, 1);
  assert.equal(resumed.checkpoint.credits, 1);
  assert.equal(
    (await f.dump()).filter((r) =>
      r.name.startsWith('ingredient-trend:observation:'),
    ).length,
    before,
  );
  await runIngredientTrend(resumed, f.io);
  assert.equal((await f.get(job.id)).status, 'completed');
});

test('analysis dependency leaves the runnable queue and wakes on terminal or cancelled collection', async (t) => {
  const f = await fixture(t),
    collector = await f.createJob(),
    analysis = await f.createJob({}, { trendOperation: 'analyze' });
  await runIngredientTrend(analysis, f.io);
  const parked = await f.get(analysis.id);
  assert.equal(parked.checkpoint.waitingForCollectionId, collector.id);
  assert.equal(parked.checkpoint.nextRunAt, 0);
  const runnable = async () =>
    (
      await f.pool.query(
        `SELECT id FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false AND ${ingredientDependencyFilter(sql)}`,
      )
    ).rows.map((r) => r.id);
  assert.deepEqual(await runnable(), [collector.id]);
  for (const status of ['completed', 'partial', 'failed', 'cancelled']) {
    await f.pool.query('UPDATE research_jobs SET status=$2 WHERE id=$1', [
      collector.id,
      status,
    ]);
    assert.ok((await runnable()).includes(analysis.id), status);
  }
  await f.pool.query(
    "UPDATE research_jobs SET status='running',cancelled=true WHERE id=$1",
    [collector.id],
  );
  assert.ok((await runnable()).includes(analysis.id));
  assert.equal(f.calls.length, 0);
  await runIngredientTrend(parked, f.io);
  assert.equal(parked.checkpoint.waitingForCollectionId, undefined);
  assert.equal(parked.checkpoint.analysisRecordCount, 0);
});

test('common plan scheduling runs once per interval while normal queue turns continue', async () => {
  let clock = 0;
  const calls = [];
  const schedule = createQueueScheduling(
    [
      async () => {
        calls.push('first');
        clock += 500;
      },
      async () => {
        calls.push('second');
        clock += 500;
      },
    ],
    { now: () => clock, intervalMs: 30_000 },
  );
  assert.equal(await schedule(), 1000);
  for (let i = 0; i < 15; i++) {
    clock += 1500;
    assert.equal(await schedule(), 0);
  }
  assert.deepEqual(calls, ['first', 'second']);
  clock = 31_000;
  assert.equal(await schedule(), 1000);
  assert.deepEqual(calls, ['first', 'second', 'first', 'second']);
});

test('compact and legacy checkpoints expose the same real progress; unknown scope and dependencies have no false percent', () => {
  const input = {
    kind: 'discovery_monitor',
    plan: { sourceMode: 'ingredient_trends', maxCommentsPerPost: 100 },
  };
  const legacy = { ...sample(), runIds: ['a', 'b'], ids: ['a', 'b'] };
  const cp = {
    phase: 'comments',
    posts: 5,
    newPosts: 2,
    samples: [legacy],
    sourceRequests: 7,
    timings: { lastArchiveMs: 25, lastSourceMs: 7 },
  };
  const overview = taskOverview(
    { input, status: 'running', checkpoint: cp },
    {},
  );
  assert.equal(overview.ingredientTrend.comments, 2);
  assert.equal(overview.ingredientTrend.pendingPosts, 1);
  assert.equal(overview.total, 1);
  assert.equal(overview.outcome, '评论回访中');
  const compact = taskOverview(
    {
      input,
      status: 'running',
      checkpoint: {
        ...cp,
        samples: [
          {
            postId: 'post1',
            stateKey: 'immutable',
            pendingCount: 1,
            observed: 2,
            unique: 2,
          },
        ],
      },
    },
    {},
  );
  assert.deepEqual(compact.ingredientTrend, overview.ingredientTrend);
  const waiting = taskOverview(
    {
      input: { ...input, trendOperation: 'analyze' },
      status: 'running',
      checkpoint: { waitingForCollectionId: 'collector' },
    },
    {},
  );
  assert.equal(waiting.percent, null);
  assert.equal(waiting.outcome, '等待当日采集');
  const task = compactTask({ overview: compact, steps: [], collections: [] });
  assert.deepEqual(task.overview.ingredientTrend, compact.ingredientTrend);
  assert.equal(
    taskOverview(
      { input, status: 'running', checkpoint: { phase: 'posts', posts: 25 } },
      {},
    ).percent,
    null,
  );
});

test('new v2 collection completes from an empty checkpoint through production batch IO', async (t) => {
  const f = await fixture(t),
    job = await f.createJob();
  for (let turn = 0; turn < 8 && job.status === 'running'; turn++)
    await runIngredientTrend(job, f.io);
  assert.equal(job.status, 'completed');
  assert.equal(job.checkpoint.posts, 1);
  assert.equal(job.checkpoint.comments, 3);
  assert.equal(job.checkpoint.sourceRequests, 2);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.calls.map((call) => call.work.op),
    ['community', 'comments'],
  );
  assert.ok(job.checkpoint.timings.lastArchiveMs >= 0);
  assert.ok(job.checkpoint.samples[0].stateKey);
  assert.equal((await loadSample(job.checkpoint.samples[0], f.archive)).post.id, 'post1');
  const state = await f.archive.read(
    commentStateKey('US', 'monitor1', 'post1'),
  );
  assert.equal(state.ids.length, 3);
  assert.equal(state.countsMatch, true);
});

test('unknown comment result is blocked across compact checkpoints and the next daily collection', async (t) => {
  const f = await fixture(t, async () => {
    throw new Error('Unknown paid request outcome');
  });
  const job = await f.createJob({ phase: 'comments', samples: [sample()] });
  await runIngredientTrend(job, f.io);
  assert.equal(f.calls.length, 1);
  assert.ok(job.checkpoint.samples[0].blocked);
  await runIngredientTrend(job, f.io);
  assert.equal(job.status, 'partial');
  assert.equal(f.calls.length, 1);
  const tomorrow = await prepareQuantityComments(
    [sample().post],
    job.input.plan,
    now + 86_400_000,
    'monitor1',
    f.archive,
  );
  assert.match(tomorrow[0].blocked.message, /Unknown paid/);
});

test('missing compact sample stops safely and blocks future paid replay instead of failing inside the error handler', async (t) => {
  const f = await fixture(t);
  const job = await f.createJob({
    phase: 'comments',
    activeSample: 0,
    activeSourceStep: 'ingredient-trend:7',
    samples: [
      {
        postId: 'post1',
        stateKey: 'ingredient-trend:missing',
        pendingCount: 1,
        observed: 0,
      },
    ],
  });
  await runIngredientTrend(job, f.io);
  assert.equal(job.status, 'partial');
  assert.equal(f.calls.length, 0);
  assert.ok(
    job.checkpoint.failures.some((message) => message.includes('断点归档缺失')),
  );
  const tomorrow = await prepareQuantityComments(
    [sample().post],
    job.input.plan,
    now,
    'monitor1',
    f.archive,
  );
  assert.equal(tomorrow[0].blocked.step, 'ingredient-trend:7');
});

test('legacy analysis migrates immutable records without changing offsets or paid request identities', async (t) => {
  const f = await fixture(t),
    records = [1, 2, 3].map((n) => record(`c${n}`));
  const job = await f.createJob(
    {
      operation: 'analyze',
      analysisRecords: records,
      analysisOffset: 1,
      findings: [],
      windowAsOf: now,
      window: { start: iso(now - 7 * 86_400_000), end: iso(now) },
      sourceCoverage: [],
      commentCoverage: [],
      postCoverageReady: true,
      comparisonReady: false,
      omittedRecords: 0,
    },
    { trendOperation: 'analyze' },
  );
  await runIngredientTrend(job, f.io);
  assert.equal(f.calls[0].step, 'ingredient-trend-analysis:1');
  assert.deepEqual(f.calls[0].work.records, records.slice(1));
  assert.equal(job.checkpoint.analysisOffset, 3);
  assert.equal(job.checkpoint.analysisRecords, undefined);
  assert.equal(job.checkpoint.analysisRecordCount, 3);
  assert.equal(job.checkpoint.findings, undefined);
  await runIngredientTrend(job, f.io);
  assert.equal(job.status, 'completed');
  assert.equal((await f.archive.reports())[0].recordCount, 3);
});

test('missing analysis records or findings never start another model request', async (t) => {
  for (const missing of ['records', 'findings']) {
    const f = await fixture(t),
      cp = {
        operation: 'analyze',
        analysisRecords: [record('c1')],
        analysisOffset: 0,
        findings: [],
      };
    await compactAnalysis({ id: 'seed' }, cp, f.archive);
    if (missing === 'records') cp.analysisRecordKeys = [];
    else
      await f.pool.query('DELETE FROM workspace_documents WHERE name=$1', [
        cp.findingsKey,
      ]);
    const job = await f.createJob(cp, { trendOperation: 'analyze' });
    await runIngredientTrend(job, f.io);
    assert.equal(job.status, 'partial');
    assert.equal(f.calls.length, 0);
    assert.ok(
      job.checkpoint.failures.some((message) => message.includes('归档')),
    );
  }
});

test('timing projection records continuation lateness and the previous completed checkpoint save', async () => {
  const saved = [],
    io = {
      now: () => now,
      schedulingMs: 125,
      saveCheckpoint: async (_job, cp) => {
        saved.push(structuredClone(cp));
      },
    };
  const cp = { nextRunAt: now - 750 },
    job = { id: 'timing' };
  beginTrendTiming(io, cp);
  assert.equal(cp.timings.lastQueueMs, 750);
  assert.equal(cp.timings.lastSchedulingMs, 125);
  await saveTrendCheckpoint(io, job, cp, 'running');
  assert.equal(saved[0].timings.lastCheckpointMs, undefined);
  await saveTrendCheckpoint(io, job, cp, 'running');
  assert.ok(saved[1].timings.lastCheckpointMs >= 0);
  assert.equal(saved[1].timings.checkpointMeasuredAt, iso(now));
});

test('MySQL archive upserts and dependency SQL use dialect-specific syntax with bounded batches', async () => {
  const statements = [],
    pool = {
      query: async (statement, params) => {
        statements.push({ statement, params });
        return { rows: [] };
      },
    };
  const mysql = (_pg, my) => my;
  const documents = createTrendDocuments({ pool, sql: mysql });
  await documents.writeMany(
    Array.from({ length: 151 }, (_, n) => [
      `ingredient-trend:test:${n}`,
      { n },
    ]),
  );
  assert.equal(statements.length, 2);
  assert.equal(statements[0].params.length, 300);
  assert.match(statements[0].statement, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(statements[0].statement, /ON CONFLICT/);
  assert.match(ingredientDependencyFilter(mysql), /JSON_UNQUOTE/);
  assert.doesNotMatch(ingredientDependencyFilter(mysql), /::text/);
  await assert.rejects(
    documents.writeMany([['config:secret', {}]]),
    /Invalid ingredient/,
  );
});
