/* oxlint-disable unicorn/no-await-expression-member -- Keep SQL assertions adjacent to their awaited reads. */
/* oxlint-disable vitest/no-import-node-test -- Server tests use Node's test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import {
  analysisRecords,
  commentPage,
  contentHash,
  DAY,
  effectiveDiscoveryPlan,
  ingredientTrendPlan,
  mentionMetrics,
  redditUrl,
  trendSlots,
} from './ingredient-trend-domain.mjs';
import { createTrendArchive } from './ingredient-trend-store.mjs';

const now = Date.parse('2026-11-10T01:00:00Z');
test('new ingredient settings, safe source scope and daily / weekly clocks', () => {
  const plan = ingredientTrendPlan(
    {
      market: 'US',
      communities: 'r/Supplements\nsupplements\nBiohackers',
      enabled: true,
    },
    true,
  );
  assert.deepEqual(plan.communities, ['supplements', 'Biohackers']);
  assert.equal(plan.sourceMode, 'ingredient_trends');
  assert.deepEqual(plan.channels, ['reddit']);
  assert.deepEqual(
    trendSlots(plan, now).map((x) => x.operation),
    ['collect'],
  );
  assert.deepEqual(
    trendSlots({ ...plan, analysisWeekday: 2 }, now + 3_600_000).map(
      (x) => x.operation,
    ),
    ['collect', 'analyze'],
  );
  assert.deepEqual(trendSlots({ ...plan, enabled: false }, now), []);
  assert.throws(() => ingredientTrendPlan({ communities: ['a%'] }), /社区/);
  assert.throws(() => ingredientTrendPlan({ maxRequests: 0 }), /请求/);
  assert.throws(() =>
    redditUrl('https://evil.example/r/Supplements/comments/abc/post/'),
  );
  const legacy = effectiveDiscoveryPlan({
    kind: 'ingredients',
    market: 'US',
    sourceMode: 'sorftime',
    maxPages: 3,
    maxProducts: 100,
    channels: ['quora'],
    enabled: true,
  });
  assert.equal(legacy.maxPages, 20);
  assert.equal(legacy.frequency, 'daily');
  assert.equal(legacy.enabled, true);
});
test('nested comments, missing cursors and distinct source metrics remain explicit', () => {
  const post = {
    id: 'abc',
    community: 'Supplements',
    title: 'Creatine',
    url: 'https://www.reddit.com/r/Supplements/comments/abc/post/',
    reportedComments: 4,
  };
  const page = commentPage(
    {
      comments: [
        {
          id: 'c1',
          body: 'creatine',
          created_utc: now / 1000,
          replies: {
            items: [{ id: 'c2', body: 'reply', parent_id: 't1_c1' }],
            more: { has_more: true, cursor: 'nested' },
          },
        },
      ],
      more: { has_more: true },
    },
    post,
  );
  assert.equal(page.records.length, 2);
  assert.equal(page.records[1].parentId, 't1_c1');
  assert.equal(page.cursors.length, 1);
  assert.equal(page.missingCursor, 1);
  assert.equal(contentHash({ text: 'a\n\nb' }), contentHash({ text: 'a b' }));
  const records = analysisRecords(
    [
      {
        ...post,
        type: 'post',
        postId: 'abc',
        publishedAt: new Date(now - 1000).toISOString(),
        text: `creatine ${'.'.repeat(7000)}`,
      },
    ],
    [],
    now,
    ['Supplements'],
  );
  assert.equal(records.length, 3);
  assert.equal(records.map((r) => r.text).join('').length, 7009);
  const m = records.map((r) => ({ ...r, quote: 'creatine' }));
  assert.equal(mentionMetrics(m, now - DAY, now).postCount, 1);
});

test('isolated SQL workflow: source journal, multi-community archive, resume and weekly evidence', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/no-ingredient-test-db.json',
  );
  process.env.DATABASE_URL =
    'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
  const db = new PGlite(),
    originalFetch = globalThis.fetch;
  let handler,
    networkCalls = 0,
    modelCalls = 0;
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === './collection-translation.mjs')
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const translateCollectionRecords=async(_kind,records)=>records;export const translateCollectedResult=async r=>r;')}`,
        };
      if (
        context.parentURL?.endsWith('/store.mjs') &&
        specifier === './discovery-ai.mjs'
      )
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const ingredientAnalysisRequest=r=>globalThis.__ingredientTrendModel(r);')}`,
        };
      return next(specifier, context);
    },
  });
  const { pool, putDocument } = await import('./database.mjs');
  const oldQuery = pool.query,
    oldConnect = pool.connect;
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (
      params.length === 0 &&
      statement
        .trim()
        .split(';')
        .filter((s) => s.trim()).length > 1
    )
      return (await db.exec(statement)).at(-1);
    return db.query(
      statement,
      params.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  globalThis.fetch = async (url, init) => {
    assert.equal(
      new URL(url).hostname,
      'api.scrapecreators.com',
      'No real/external calls allowed',
    );
    networkCalls++;
    return handler(new URL(url), init);
  };
  try {
    const { migrate, saveCheckpoint } = await import('./store.mjs');
    const {
      discoveryAction,
      runDiscoveryMonitor,
      submitDiscovery,
      tickDiscoveryMonitors,
    } = await import('./discovery-monitor-store.mjs');
    const { sealAdsKey } = await import('./ads-provider.mjs');
    const { validateIngredientResearch } = await import('./discovery-ai.mjs');
    const { coverageKey, trendScope } =
      await import('./ingredient-trend-runner.mjs');
    await migrate();
    await putDocument(
      'provider_configs',
      'provider:scrapecreators:v1',
      sealAdsKey('synthetic-only-test-key'),
    );
    const read = async (name) =>
      (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [name],
        )
      ).rows[0]?.value;
    const archive = createTrendArchive({ pool, putDocument, read }, 'US');
    const get = async (id) =>
      (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
        .rows[0];
    const make = (patch = {}, extra = {}) =>
      submitDiscovery({
        requestId: randomUUID(),
        plan: {
          kind: 'ingredients',
          market: 'US',
          communities: ['Supplements', 'Nootropics', 'Biohackers'],
          maxCommentRequests: 20,
          maxRequests: 40,
          maxDetails: 3,
          ...patch,
        },
        asOf: now,
        ...extra,
      });
    const drain = async (id, at = now) => {
      for (let n = 0; n < 120; n++) {
        const job = await get(id);
        if (['completed', 'partial', 'cancelled'].includes(job.status))
          return job;
        await runDiscoveryMonitor(job, { now: () => at });
      }
      throw new Error('Runner did not terminate');
    };
    const post = (id, community, stamp = now - 1000, count = 3) => ({
      id,
      subreddit: community,
      title: 'Creatine supplement experience',
      selftext: 'creatine made me feel unwell',
      created_utc: stamp / 1000,
      author: 'synthetic-author',
      num_comments: count,
      permalink: `/r/${community}/comments/${id}/post/`,
    });
    const comment = (id, body = 'creatine helped my routine') => ({
      id,
      body,
      created_utc: (now - 500) / 1000,
      author: 'synthetic-commenter',
      parent_id: 't3_s11',
    });
    let version = 0;
    handler = async (url) => {
      if (url.pathname.endsWith('/subreddit')) {
        const community = url.searchParams.get('subreddit'),
          id = { Supplements: 's11', Nootropics: 'n11', Biohackers: 'b11' }[
            community
          ];
        if (community === 'Supplements' && !url.searchParams.has('after'))
          return Response.json({
            posts: [post(id, community)],
            after: 't3_old',
            credits_charged: 1,
          });
        return Response.json({
          posts: [
            post(id, community, now - 1000, version ? 4 : 3),
            post(`old${id}`, community, now - 8 * DAY),
          ],
          credits_charged: 1,
        });
      }
      const id = url.searchParams
        .get('url')
        .split('/comments/')[1]
        .split('/')[0];
      if (!url.searchParams.has('cursor'))
        return Response.json({
          post: { num_comments: version ? 4 : 3 },
          comments: [
            {
              ...comment(`${id}c1`),
              replies: {
                items: [],
                more: { has_more: true, cursor: `branch-${id}` },
              },
            },
          ],
          credits_charged: 1,
        });
      return Response.json({
        comments: [
          comment(`${id}c2`),
          comment(`${id}c3`),
          ...(version ? [comment(`${id}c4`)] : []),
        ],
        more: { has_more: false },
        credits_charged: 1,
      });
    };
    globalThis.__ingredientTrendModel = async (request) => {
      modelCalls++;
      const mentions = request.records
        .filter((r) => r.text.includes('creatine'))
        .map((r) => ({ id: r.id, quote: r.text }));
      return {
        ingredients: validateIngredientResearch(
          {
            ingredients: [
              {
                name: 'creatine',
                summary: '合成测试：保留负面体验与不确定性',
                mentions,
              },
            ],
          },
          request.records,
        ),
        usage: { modelCalls: 1, modelTokens: 10 },
        model: 'synthetic',
      };
    };
    await t.test(
      'daily collection reaches three boundaries, follows nested branches and never calls AI',
      async () => {
        const job = await make(),
          done = await drain(job.id);
        assert.equal(done.status, 'completed');
        assert.equal(modelCalls, 0);
        assert.equal(networkCalls, 10);
        assert.equal((await archive.recent('post', now)).length, 3);
        assert.equal((await archive.recent('comment', now)).length, 9);
        assert.equal(done.checkpoint.coverage.length, 3);
        assert.ok(
          done.checkpoint.samples.every(
            (s) => s.countsMatch && s.paginationExhausted,
          ),
        );
        const journal = (
          await pool.query(
            'SELECT status,response FROM research_requests WHERE job_id=$1',
            [job.id],
          )
        ).rows;
        assert.equal(journal.length, 10);
        assert.ok(
          journal.every(
            (r) =>
              r.status === 'done' &&
              r.response.raw &&
              r.response.creditsCharged === 1,
          ),
        );
      },
    );
    await t.test(
      'real second snapshot adds comments, preserves first seen, deduplicates posts',
      async () => {
        version = 1;
        const first = (await archive.recent('post', now))[0].firstSeenAt;
        const job = await make(),
          done = await drain(job.id, now + DAY);
        assert.equal(done.status, 'completed');
        assert.equal((await archive.recent('post', now)).length, 3);
        assert.equal((await archive.recent('comment', now)).length, 12);
        assert.equal((await archive.recent('post', now))[0].firstSeenAt, first);
        assert.equal(modelCalls, 0);
      },
    );
    await t.test(
      'weekly analysis uses archive only, validates evidence and withholds incomplete week comparison',
      async () => {
        const before = networkCalls;
        const job = await make({}, { trendOperation: 'analyze' }),
          done = await drain(job.id);
        assert.equal(done.status, 'completed');
        assert.equal(networkCalls, before);
        assert.ok(modelCalls > 0);
        const reports = await archive.reports();
        assert.equal(reports.length, 1);
        assert.equal(reports[0].comparisonReady, false);
        assert.equal(reports[0].findings.length, 1);
        assert.equal(reports[0].findings[0].current.postCount, 3);
        assert.equal(reports[0].findings[0].current.commentCount, 12);
        assert.equal(reports[0].findings[0].observedChange, null);
      },
    );
    await t.test(
      'crash after archive writes reuses paid response and archive observation IDs',
      async () => {
        const job = await make({ communities: ['Supplements'], maxDetails: 0 });
        let fail = false;
        const save = async (j, cp, status) => {
          if (cp.sourceRequests > 0) {
            fail = true;
            throw new Error('synthetic process termination');
          }
          return saveCheckpoint(j, cp, status);
        };
        await assert.rejects(
          runDiscoveryMonitor(job, { now: () => now, saveCheckpoint: save }),
          /termination/,
        );
        assert.ok(fail);
        const calls = networkCalls;
        const docsBefore = (
          await pool.query(
            'SELECT COUNT(*) AS n FROM workspace_documents WHERE name LIKE $1',
            ['ingredient-trend:observation:%'],
          )
        ).rows[0].n;
        // Replay the exact same first work item; no source request and no duplicate observation.
        await runDiscoveryMonitor(await get(job.id), { now: () => now });
        assert.equal(networkCalls, calls);
        const docsAfter = (
          await pool.query(
            'SELECT COUNT(*) AS n FROM workspace_documents WHERE name LIKE $1',
            ['ingredient-trend:observation:%'],
          )
        ).rows[0].n;
        assert.equal(docsAfter, docsBefore);
        await drain(job.id);
      },
    );
    await t.test(
      'bounded listing resumes saved cursor on next run without claiming complete coverage',
      async () => {
        const job = await make({
            communities: ['Supplements'],
            maxPages: 1,
            maxDetails: 0,
          }),
          done = await drain(job.id);
        assert.equal(done.status, 'partial');
        const state = await read(
          coverageKey('US', trendScope(job), 'Supplements'),
        );
        assert.equal(state.scan.cursor, 't3_old');
        const next = await make({
          communities: ['Supplements'],
          maxPages: 1,
          maxDetails: 0,
        });
        const finished = await drain(next.id);
        assert.equal(finished.status, 'completed');
        assert.equal(
          (await read(coverageKey('US', trendScope(job), 'Supplements'))).scan,
          null,
        );
      },
    );
    await t.test(
      'unknown failure is journaled and blocks automatic replay on the next day',
      async () => {
        handler = async () => {
          throw new Error('synthetic timeout with unknown upstream outcome');
        };
        const job = await make({
            communities: ['UnknownCommunity'],
            maxDetails: 0,
          }),
          done = await drain(job.id);
        assert.equal(done.status, 'partial');
        const before = networkCalls;
        const next = await make({
          communities: ['UnknownCommunity'],
          maxDetails: 0,
        });
        await drain(next.id, now + DAY);
        assert.equal(networkCalls, before);
        const rows = (
          await pool.query(
            'SELECT status FROM research_requests WHERE job_id=$1',
            [job.id],
          )
        ).rows;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].status, 'failed');
      },
    );
    await t.test(
      'post cap buffers a paid page; next job drains its remainder without requesting it again',
      async () => {
        handler = async () =>
          Response.json({
            posts: [post('limit1', 'LowLimit'), post('limit2', 'LowLimit')],
            credits_charged: 1,
          });
        const first = await make({
            communities: ['LowLimit'],
            maxProducts: 1,
            maxDetails: 0,
          }),
          partial = await drain(first.id);
        assert.equal(partial.status, 'partial');
        assert.equal(partial.checkpoint.posts, 1);
        const before = networkCalls;
        const second = await make({
            communities: ['LowLimit'],
            maxProducts: 1,
            maxDetails: 0,
          }),
          done = await drain(second.id);
        assert.equal(done.status, 'completed');
        assert.equal(networkCalls, before);
        assert.equal(
          (await archive.recent('post', now)).filter(
            (p) => p.community === 'LowLimit',
          ).length,
          2,
        );
      },
    );
    await t.test(
      'comment request cap persists nested work; later collection finishes it',
      async () => {
        handler = async (url) => {
          if (url.pathname.endsWith('/subreddit'))
            return Response.json({
              posts: [post('resume1', 'ResumeCommunity', now - 1000, 3)],
              credits_charged: 1,
            });
          return Response.json(
            url.searchParams.has('cursor')
              ? {
                  comments: [comment('resume2'), comment('resume3')],
                  credits_charged: 1,
                }
              : {
                  comments: [
                    {
                      ...comment('resume1'),
                      replies: {
                        items: [],
                        more: { has_more: true, cursor: 'pending' },
                      },
                    },
                  ],
                  credits_charged: 1,
                },
          );
        };
        const first = await make({
            communities: ['ResumeCommunity'],
            maxCommentRequests: 1,
            maxDetails: 1,
          }),
          partial = await drain(first.id);
        assert.equal(partial.status, 'partial');
        assert.equal(partial.checkpoint.samples[0].pendingCount, 1);
        const before = networkCalls;
        const second = await make({
            communities: ['ResumeCommunity'],
            maxCommentRequests: 1,
            maxDetails: 1,
          }),
          done = await drain(second.id);
        assert.equal(done.status, 'completed');
        assert.equal(done.checkpoint.samples[0].unique, 3);
        assert.equal(networkCalls - before, 2);
      },
    );
    await t.test(
      'exhausted comment cursors with count gap remain partial, not complete',
      async () => {
        handler = async (url) =>
          Response.json(
            url.pathname.endsWith('/subreddit')
              ? {
                  posts: [post('gap1', 'GapCommunity', now - 1000, 3)],
                  credits_charged: 1,
                }
              : {
                  comments: [comment('gapc1')],
                  more: { has_more: false },
                  credits_charged: 1,
                },
          );
        const job = await make({
            communities: ['GapCommunity'],
            maxDetails: 1,
          }),
          done = await drain(job.id);
        assert.equal(done.status, 'partial');
        assert.equal(done.checkpoint.samples[0].paginationExhausted, true);
        assert.equal(done.checkpoint.samples[0].countsMatch, false);
        assert.equal(done.checkpoint.samples[0].countGap, 2);
      },
    );
    await t.test(
      'saved raw response survives a parse failure and prevents next-day paid repetition',
      async () => {
        handler = async () =>
          Response.json({ unrecognized_payload: [], credits_charged: 1 });
        const first = await make({
            communities: ['BadPayload'],
            maxDetails: 0,
          }),
          partial = await drain(first.id);
        assert.equal(partial.status, 'partial');
        const before = networkCalls;
        const state = await read(
          coverageKey('US', trendScope(first), 'BadPayload'),
        );
        assert.equal(state.blocked.step, 'ingredient-trend:0');
        assert.equal(
          (
            await pool.query(
              'SELECT status FROM research_requests WHERE job_id=$1',
              [first.id],
            )
          ).rows[0].status,
          'done',
        );
        const next = await make({ communities: ['BadPayload'], maxDetails: 0 });
        await drain(next.id);
        assert.equal(networkCalls, before);
      },
    );
    await t.test(
      'long comment cursors use POST and credits are attributed to the existing provider',
      async () => {
        const { ingredientTrendSource, trendSourceSpec } =
          await import('./ingredient-trend-provider.mjs');
        const { requestSources, sourceCharge } =
          await import('./source-usage-domain.mjs');
        const input = {
          op: 'comments',
          url: 'https://www.reddit.com/r/Supplements/comments/abc/post/',
          cursor: 'x'.repeat(2000),
        };
        assert.equal(trendSourceSpec(input).method, 'POST');
        handler = async (url, init) => {
          assert.equal(init.method, 'POST');
          assert.equal(JSON.parse(init.body).cursor.length, 2000);
          return Response.json({ comments: [], credits_charged: 1 });
        };
        const response = await ingredientTrendSource(input);
        assert.equal(response.creditsCharged, 1);
        assert.equal(response.requestLog.httpStatus, 200);
        assert.equal(response.requestLog.url.includes('cursor'), false);
        assert.deepEqual(
          requestSources('ingredient-trend:0', { provider: 'scrapecreators' }),
          ['scrapecreators'],
        );
        assert.equal(
          sourceCharge('scrapecreators', response, 'done').amount,
          1,
        );
      },
    );
    await t.test(
      'daily / weekly scheduling is idempotent and does not duplicate active jobs',
      async () => {
        await pool.query("UPDATE research_jobs SET status='completed'");
        const saved = (
          await discoveryAction(
            {
              action: 'server_discovery_save',
              plan: {
                kind: 'ingredients',
                market: 'US',
                enabled: true,
                analysisWeekday: 2,
              },
            },
            { role: 'admin' },
          )
        ).plan;
        await tickDiscoveryMonitors(now + 3_600_000);
        await tickDiscoveryMonitors(now + 3_600_000);
        let jobs = (
          await pool.query('SELECT input FROM research_jobs')
        ).rows.filter((r) => r.input.monitorId === saved.id);
        assert.equal(jobs.length, 2);
        assert.deepEqual(jobs.map((r) => r.input.trendOperation).toSorted(), [
          'analyze',
          'collect',
        ]);
        await tickDiscoveryMonitors(now + DAY + 3_600_000);
        jobs = (
          await pool.query('SELECT input FROM research_jobs')
        ).rows.filter((r) => r.input.monitorId === saved.id);
        assert.equal(jobs.length, 2);
        const caps = await discoveryAction({
          action: 'server_discovery_capabilities',
          kind: 'ingredients',
        });
        assert.equal(caps.provider, 'scrapecreators');
      },
    );
    await t.test(
      'weekly batches retain distinct discussion summaries instead of overwriting earlier opinions',
      async () => {
        for (let n = 0; n < 55; n++)
          await archive.observe(
            {
              id: `batch${n}`,
              postId: `batch${n}`,
              type: 'post',
              community: 'Supplements',
              platform: 'Reddit',
              title: 'Creatine',
              text: 'creatine discussion',
              publishedAt: new Date(now - DAY).toISOString(),
              author: `author${n}`,
              url: `https://www.reddit.com/r/Supplements/comments/batch${n}/post/`,
            },
            `batch-source${n}`,
            new Date(now).toISOString(),
          );
        const before = modelCalls;
        globalThis.__ingredientTrendModel = async (request) => {
          modelCalls++;
          return {
            ingredients: validateIngredientResearch(
              {
                ingredients: [
                  {
                    name: 'creatine',
                    summary: `Opinion ${modelCalls}`,
                    mentions: request.records
                      .filter((r) => r.text.includes('creatine'))
                      .map((r) => ({ id: r.id, quote: r.text })),
                  },
                ],
              },
              request.records,
            ),
            usage: { modelCalls: 1 },
            model: 'synthetic',
          };
        };
        const job = await make({}, { trendOperation: 'analyze' }),
          done = await drain(job.id);
        assert.ok(modelCalls - before >= 2);
        const report = (await archive.reports()).find(
          (r) => r.id === done.checkpoint.reportId,
        );
        assert.ok(report.findings[0].summary.includes(`Opinion ${before + 1}`));
        assert.ok(report.findings[0].summary.includes(`Opinion ${modelCalls}`));
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__ingredientTrendModel;
    pool.query = oldQuery;
    pool.connect = oldConnect;
    hook.deregister();
    await pool.end();
    await db.close();
  }
});
