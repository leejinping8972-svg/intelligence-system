/* eslint-disable unicorn/no-await-expression-member, no-console -- Disposable SQL fixture assertions and test result output. */
import assert from 'node:assert/strict';
import { socialWindows } from './keyword-trends-domain.mjs';

import {
  keywordTrendsAction,
  keywordTrendIO,
} from './keyword-trends-store.mjs';
import {
  advanceTrendQueue,
  TREND_PREFIX as P,
} from './keyword-trends-engine.mjs';

// Called exclusively by the existing disposable PostgreSQL/MySQL fixture.
export async function verifyKeywordTrends(c) {
  const admin = { role: 'admin' },
    reader = { role: 'researcher' };
  const k = {
    id: 'synthetic-multitrend-keyword',
    term: 'synthetic creatine',
    market: 'US',
    reviewStatus: 'selected',
    dataNature: 'collected',
  };
  await c.query(
    'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
    ['synthetic-multitrend-key', k],
  );
  await assert.rejects(
    keywordTrendsAction({ action: 'server_keyword_trends_save' }, reader),
    /管理员/,
  );
  assert.equal(
    (
      await keywordTrendsAction(
        { action: 'server_keyword_trends_snapshot' },
        reader,
      )
    ).plan.enabled,
    false,
  );
  await assert.rejects(
    keywordTrendsAction(
      {
        action: 'server_keyword_trends_collect',
        keywordIds: [k.id, 'missing'],
        budgetAcknowledged: true,
      },
      admin,
    ),
    /未提交部分/,
  );
  await keywordTrendsAction(
    {
      action: 'server_keyword_trends_collect',
      keywordIds: [k.id],
      plan: { sources: ['tiktok'], maxRequests: 2, maxPages: 2 },
      budgetAcknowledged: true,
    },
    admin,
  );
  let calls = 0;
  const quarter = socialWindows(Date.now())[2];
  const io = keywordTrendIO(c, {
    key: async () => 'synthetic-only-not-a-real-key',
    fetch: async (work) => {
      calls++;
      return {
        items: Array.from({ length: work.page === 1 ? 4 : 2 }, (_, i) => ({
          id: `${work.page}-${i}`,
          url: 'https://www.tiktok.com/@qa/video/1234567890123',
          publishedAt: new Date(
            (work.page === 1 ? quarter.startAt : quarter.previousStartAt) +
              86_400_000,
          ).toISOString(),
          views: 100,
          likes: 0,
          comments: null,
        })),
        hasMore: work.page === 1,
        cursor: 2,
        exhausted: work.page === 2,
        creditsCharged: 1,
        coverage: '合成隔离样本',
      };
    },
  });
  for (let n = 0; n < 5; n++) await advanceTrendQueue(io);
  assert.equal(calls, 2);
  let value = await keywordTrendsAction(
    { action: 'server_keyword_trends_snapshot' },
    reader,
  );
  assert.equal(value.run.usedRequests, 2);
  assert.equal(value.summaries.length, 1);
  assert.equal(value.summaries[0].sampleCount, 6);
  assert.equal(value.summaries[0].periods[0].change, null);
  assert.equal(value.summaries[0].periods[2].count, 4);
  assert.equal(value.summaries[0].periods[2].previousCount, 2);
  assert.equal(
    value.summaries[0].periods[2].change,
    Math.round(
      ((2 * (quarter.previousEndAt - quarter.previousStartAt)) /
        (quarter.endAt - quarter.startAt) -
        1) *
        1000,
    ) / 10,
  );
  await keywordTrendsAction(
    {
      action: 'server_keyword_trends_collect',
      keywordIds: [k.id],
      plan: { sources: ['tiktok'], maxRequests: 2 },
      budgetAcknowledged: true,
    },
    admin,
  );
  await advanceTrendQueue(io);
  assert.equal(calls, 2);
  // A manually selected Google-only task uses the real existing submission
  // adapter and persists a normal research job; no Google HTTP request is made.
  await keywordTrendsAction(
    {
      action: 'server_keyword_trends_collect',
      keywordIds: [k.id],
      plan: { sources: ['google'], maxRequests: 2 },
      budgetAcknowledged: true,
    },
    admin,
  );
  await advanceTrendQueue(io);
  value = await keywordTrendsAction(
    { action: 'server_keyword_trends_snapshot' },
    reader,
  );
  const google = value.run.work.find((w) => w.source === 'google');
  assert.equal(google.status, 'submitted');
  const job = (
    await c.query('SELECT input FROM research_jobs WHERE id=$1', [google.jobId])
  ).rows[0];
  assert.equal(job.input.existingRecords[0].id, k.id);
  assert.equal(job.input.trendComparisonVersion, 2);
  assert.deepEqual(job.input.sources, []);
  const before = await io.db.list(`${P}request:`);
  await keywordTrendsAction(
    { action: 'server_keyword_trends_snapshot' },
    reader,
  );
  assert.deepEqual(await io.db.list(`${P}request:`), before);
  console.log(
    'Four-source trends SQL integration passed: complete selection, permissions, snapshots, atomic reservations, day budget, idempotence and existing Google queue; no external calls.',
  );
}
