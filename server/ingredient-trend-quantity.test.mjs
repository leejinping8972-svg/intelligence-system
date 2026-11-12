/* oxlint-disable vitest/no-import-node-test -- Node runner with synthetic IO only. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ingredientTrendPlan,
  effectiveDiscoveryPlan,
  DAY,
  iso,
} from './ingredient-trend-domain.mjs';
import { runIngredientTrend, coverageKey } from './ingredient-trend-runner.mjs';
import { createTrendArchive } from './ingredient-trend-store.mjs';
import { commentStateKey } from './ingredient-trend-quantity-comments.mjs';

const now = Date.parse('2026-11-10T01:00:00Z');
const plan = (extra = {}) =>
  ingredientTrendPlan({
    market: 'US',
    collectionLimitsVersion: 2,
    communities: ['nutrition'],
    ...extra,
  });
const rawPost = (id, community = 'nutrition', comments = 0) => ({
  id,
  subreddit: community,
  title: 'An unfamiliar ingredient',
  selftext: 'Full experience, including adverse effects',
  created_utc: (now - 1000) / 1000,
  num_comments: comments,
});
const rawComment = (id) => ({
  id,
  body: `Original opinion ${id}`,
  created_utc: (now - 500) / 1000,
});

function fixture(handler) {
  const docs = new Map(),
    journal = new Map(),
    calls = [];
  let cancelled = false;
  const io = {
    now: () => now,
    read: async (name) => structuredClone(docs.get(name)),
    putDocument: async (_table, name, value) =>
      docs.set(name, structuredClone(value)),
    pool: {
      query: async (sql, params = []) => {
        if (sql.startsWith('SELECT cancelled'))
          return { rows: [{ cancelled }] };
        if (sql.startsWith('SELECT id,input')) return { rows: [] };
        assert.match(sql, /FROM workspace_documents WHERE name LIKE/);
        const prefix = params[0].slice(0, -1),
          after = params[1] || '';
        return {
          rows: [...docs]
            .filter(([name]) => name.startsWith(prefix) && name > after)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .slice(0, 250)
            .map(([name, value]) => ({ name, value: structuredClone(value) })),
        };
      },
    },
    saveCheckpoint: async (job, cp, status) => {
      job.checkpoint = structuredClone(cp);
      job.status = status;
      return job;
    },
    collect: async (job, step, work) => {
      const key = `${job.id}:${step}`;
      if (journal.has(key)) return structuredClone(journal.get(key));
      calls.push({ key, work });
      const result = await handler(work, calls);
      journal.set(key, structuredClone(result));
      return result;
    },
  };
  let next = 0;
  const job = (p, extra = {}) => ({
    id: `job${next++}`,
    input: { plan: p, monitorId: 'monitor', ...extra },
    checkpoint: {},
    status: 'queued',
  });
  const finish = async (j) => {
    for (let i = 0; i < 2000; i++) {
      await runIngredientTrend(j, io);
      if (j.status !== 'running') return j;
    }
    throw new Error('synthetic run did not terminate');
  };
  return {
    io,
    docs,
    calls,
    job,
    finish,
    archive: createTrendArchive(io, 'US'),
    cancel: () => {
      cancelled = true;
    },
  };
}

test('v2 removes hidden caps, validates quantities; frozen v1 normalization remains unchanged', () => {
  const p = plan({ maxRequests: 0, maxDetails: -1, analysisMaxRecords: 1 });
  assert.equal(p.maxPostsPerCommunity, 1000);
  assert.equal(p.maxCommentsPerPost, 100);
  for (const key of [
    'maxProducts',
    'maxPages',
    'maxDetails',
    'maxRequests',
    'maxCommentRequests',
    'analysisMaxRecords',
  ])
    assert.equal(p[key], undefined);
  assert.throws(() => plan({ maxPostsPerCommunity: 0 }), /帖子/);
  assert.throws(() => plan({ maxCommentsPerPost: 1001 }), /评论/);
  assert.equal(plan({ maxCommentsPerPost: 0 }).maxCommentsPerPost, 0);
  const legacy = ingredientTrendPlan({
    market: 'US',
    maxProducts: 3,
    maxDetails: 1,
    maxRequests: 2,
  });
  assert.equal(legacy.collectionLimitsVersion, undefined);
  assert.equal(legacy.maxRequests, 2);
  const upgraded = effectiveDiscoveryPlan({
    ...legacy,
    id: 'kept',
    enabled: true,
    time: '11:45',
  });
  assert.equal(upgraded.id, 'kept');
  assert.equal(upgraded.enabled, true);
  assert.equal(upgraded.time, '11:45');
  assert.equal(upgraded.maxRequests, undefined);
  assert.equal(legacy.maxRequests, 2);
});

test('ten communities receive individual quotas and paid page remainders continue without refetch', async () => {
  const communities = Array.from({ length: 10 }, (_, n) => `community${n}`);
  const f = fixture(async (w) => ({
    raw: {
      posts: [
        rawPost(`${w.community}a`, w.community),
        rawPost(`${w.community}b`, w.community),
      ],
    },
  }));
  const p = plan({
    communities,
    maxPostsPerCommunity: 1,
    maxCommentsPerPost: 0,
  });
  const first = await f.finish(f.job(p));
  assert.equal(first.status, 'partial');
  assert.equal(first.checkpoint.posts, 10);
  assert.equal(f.calls.length, 10);
  for (const c of communities)
    assert.equal(first.checkpoint.communitySeen[c].length, 1);
  const second = await f.finish(f.job(p));
  assert.equal(second.checkpoint.posts, 10);
  assert.equal(f.calls.length, 10);
  assert.equal((await f.archive.recent('post', now)).length, 20);
  assert.equal(second.status, 'completed');
});

test('comments cover more than six posts without keyword gating; nested replies count and overflow is free to resume', async () => {
  const f = fixture(async (w) => {
    if (w.op === 'community')
      return {
        raw: {
          posts: Array.from({ length: 8 }, (_, n) =>
            rawPost(`p${n}`, 'nutrition', 3),
          ),
        },
      };
    assert.equal(w.op, 'comments');
    return {
      raw: {
        comments: [
          {
            ...rawComment('c' + w.url.split('/')[6]),
            replies: [rawComment('r' + w.url.split('/')[6])],
          },
          rawComment('z' + w.url.split('/')[6]),
        ],
        post: { num_comments: 3 },
      },
    };
  });
  const p = plan({ maxCommentsPerPost: 2 });
  const first = await f.finish(f.job(p));
  assert.equal(first.checkpoint.comments, 16);
  assert.equal(first.checkpoint.samples.length, 8);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 8);
  assert.equal(first.status, 'partial');
  const second = await f.finish(f.job(p));
  assert.equal(second.checkpoint.comments, 8);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 8);
  assert.equal((await f.archive.recent('comment', now)).length, 24);
  assert.equal(second.status, 'completed');
  const state = f.docs.get(commentStateKey('US', 'monitor', 'p0'));
  assert.equal(state.countsMatch, true);
  assert.equal(state.bufferedPage, undefined);
});

test('new comments after an exhausted pass are revisited even if counts do not change', async () => {
  let version = 0;
  const f = fixture(async (w) =>
    w.op === 'community'
      ? { raw: { posts: [rawPost('p1', 'nutrition', 1)] } }
      : {
          raw: {
            comments: [rawComment(`c${version++}`)],
            post: { num_comments: 1 },
          },
        },
  );
  await f.finish(f.job(plan()));
  const second = await f.finish(f.job(plan()));
  assert.equal(second.status, 'completed');
  assert.equal((await f.archive.recent('comment', now)).length, 2);
});

test('quantity limits allow more than 250 post requests and 500 total requests', async () => {
  let page = 0;
  const f = fixture(async (w) =>
    w.op === 'community'
      ? {
          raw: {
            posts: [rawPost(`p${page++}`, w.community, 1)],
            after: `t3_next${page}`,
          },
        }
      : {
          raw: {
            comments: [rawComment(`c${w.url.split('/')[6]}`)],
            post: { num_comments: 1 },
          },
        },
  );
  const j = await f.finish(
    f.job(
      plan({ communities: ['nutrition', 'Fitness'], maxPostsPerCommunity: 150, maxCommentsPerPost: 1 }),
    ),
  );
  assert.equal(f.calls.filter((c) => c.work.op === 'community').length, 300);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 300);
  assert.equal(j.checkpoint.sourceRequests, 600);
  assert.equal(j.status, 'partial');
  assert.match(j.checkpoint.failures.join('\n'), /每社区帖子上限/);
  assert.doesNotMatch(j.checkpoint.failures.join('\n'), /后台.*请求保护/);
  assert.ok(j.checkpoint.samples.every(s => s.stateKey));
  assert.equal(j.checkpoint.coverage.length, 2);
  assert.ok(j.checkpoint.coverage.every((c) => c.scan.cursor && c.partial));
});

test('unknown comment request stays blocked across jobs and zero mode makes no comment requests', async () => {
  const f = fixture(async (w) => {
    if (w.op === 'community')
      return { raw: { posts: [rawPost('p1', 'nutrition', 2)] } };
    throw new Error('unknown result');
  });
  await f.finish(f.job(plan()));
  await f.finish(f.job(plan()));
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 1);
  const off = await f.finish(f.job(plan({ maxCommentsPerPost: 0 })));
  assert.equal(off.checkpoint.comments, 0);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 1);
});

test('independent monitor scopes do not consume another monitor comment quota or cursor', async () => {
  const f = fixture(async (w) =>
    w.op === 'community'
      ? { raw: { posts: [rawPost('p1', 'nutrition', 2)] } }
      : {
          raw: {
            comments: [rawComment('c1'), rawComment('c2')],
            post: { num_comments: 2 },
          },
        },
  );
  await f.finish(f.job(plan({ maxCommentsPerPost: 1 })));
  const other = await f.finish(
    f.job(plan({ maxCommentsPerPost: 1 }), { monitorId: 'other' }),
  );
  assert.equal(other.checkpoint.comments, 1);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 2);
  assert.equal(
    f.docs.get(commentStateKey('US', 'monitor', 'p1')).bufferedPage.offset,
    1,
  );
  assert.equal(
    f.docs.get(commentStateKey('US', 'other', 'p1')).bufferedPage.offset,
    1,
  );
});

test('all 2105 archived segments enter bounded weekly batches and negative evidence survives', async () => {
  const processed = [];
  const f = fixture(async (w) => {
    assert.deepEqual(w.sources, ['ingredient_analysis']);
    assert.ok(w.records.length <= 40);
    assert.ok(
      w.records.reduce((n, r) => n + r.text.length + r.title.length, 0) <=
        40000,
    );
    processed.push(...w.records.map((r) => r.id));
    const first = w.records.find((r) => r.id === 'post:p0:0');
    return {
      ingredients: first
        ? [
            {
              key: 'creatine',
              summary: 'Adverse effects reported',
              mentions: [
                {
                  id: first.id,
                  quote: 'adverse effects',
                  publishedAt: first.publishedAt,
                  url: first.url,
                },
              ],
            },
          ]
        : [],
    };
  });
  for (let n = 0; n < 2105; n++)
    await f.archive.observe(
      {
        id: `p${n}`,
        postId: `p${n}`,
        type: 'post',
        community: 'nutrition',
        platform: 'Reddit',
        title: 'Creatine',
        text: 'adverse effects',
        reportedComments: 1,
        publishedAt: iso(now - 1000),
        url: `https://www.reddit.com/r/nutrition/comments/p${n}/post/`,
      },
      'fixture',
      iso(now),
    );
  await f.archive.write(coverageKey('US', 'monitor', 'nutrition'), {
    community: 'nutrition',
    partial: false,
    coveredFrom: iso(now - 15 * DAY),
    coveredThrough: iso(now),
  });
  const j = await f.finish(f.job(plan(), { trendOperation: 'analyze' }));
  assert.equal(j.status, 'completed');
  assert.equal(processed.length, 2105);
  assert.equal(new Set(processed).size, 2105);
  const report = [...f.docs].find(([key]) =>
    key.startsWith('ingredient-trend:report:'),
  )[1];
  assert.equal(report.omittedRecords, 0);
  assert.equal(report.recordCount, 2105);
  assert.equal(report.findings[0].mentions[0].quote, 'adverse effects');
  assert.ok(report.commentCoverage.every((c) => c.countsMatch === false));
});

test('cancelled jobs do not request sources', async () => {
  const f = fixture(() => {
    throw new Error('unexpected request');
  });
  f.cancel();
  const j = await f.finish(f.job(plan()));
  assert.equal(j.status, 'cancelled');
  assert.equal(f.calls.length, 0);
});

test('archive interruption resumes the same paid response without double accounting or mixing posts', async () => {
  const f = fixture(async (w) =>
    w.op === 'community'
      ? {
          raw: {
            posts: [
              rawPost('p1', 'nutrition', 2),
              rawPost('p2', 'nutrition', 2),
            ],
          },
        }
      : {
          raw: {
            comments: [
              rawComment(`c${w.url.split('/')[6]}`),
              rawComment(`d${w.url.split('/')[6]}`),
            ],
            post: { num_comments: 2 },
          },
          creditsCharged: 1,
        },
  );
  const original = f.io.putDocument;
  let interrupted = false;
  f.io.putDocument = async (table, name, value) => {
    if (!interrupted && name.startsWith('ingredient-trend:comment-state:')) {
      interrupted = true;
      throw new Error('synthetic archive interruption');
    }
    return original(table, name, value);
  };
  const j = await f.finish(f.job(plan({ maxCommentsPerPost: 1 })));
  assert.equal(j.status, 'partial');
  assert.ok(j.checkpoint.activeSourceStep);
  // Explicit same-job recovery uses its journaled response.
  await f.finish(j);
  assert.equal(f.calls.filter((c) => c.work.op === 'comments').length, 2);
  assert.equal(j.checkpoint.commentRequests, 2);
  assert.equal(j.checkpoint.comments, 2);
  assert.equal(j.checkpoint.credits, 2);
  assert.equal(
    f.docs.get(commentStateKey('US', 'monitor', 'p1')).bufferedPage.offset,
    1,
  );
  assert.equal(
    f.docs.get(commentStateKey('US', 'monitor', 'p2')).bufferedPage.offset,
    1,
  );
});
