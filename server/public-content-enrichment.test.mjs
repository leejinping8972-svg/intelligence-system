import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend uses node --test. */
import test from 'node:test';

import { executeContentJob } from './public-content-engine.mjs';
import {
  enrichContentStep,
  fetchDetailMetadata,
  historyDetailsAction,
  planHistoryDetails,
} from './public-content-enrichment.mjs';
const video = {
  id: `pc-${'1'.repeat(24)}`,
  source: 'youtube',
  videoId: 'abcdefghijk',
  title: 'QA video',
  summary: 'Short index description',
  favorite: true,
  productIds: ['qa-product'],
  keywordIds: ['qa-word'],
  searchMarket: 'US',
  searchLanguage: 'en',
};
const paper = {
  ...video,
  id: `pc-${'2'.repeat(24)}`,
  source: 'europepmc',
  type: 'paper',
  sourceId: 'MED:123',
  summary: '',
};
const post = {
  ...video,
  id: `pc-${'3'.repeat(24)}`,
  source: 'reddit',
  type: 'post',
  url: 'https://www.reddit.com/r/Fitness/comments/abc123/qa/',
  summary: '',
};
const response = (value) => Response.json(value);
function memory(items = [video, paper, post]) {
  const records = new Map(items.map((i) => [i.id, structuredClone(i)]));
  const jobs = new Map();
  return {
    records,
    jobs,
    getItem: async (id) => records.get(id),
    updateItem: async (id, change) => {
      const result = change(records.get(id));
      records.set(id, result);
      return result;
    },
    getArticle: async () => null,
    listJobs: async () => [...jobs.values()],
    getJob: async (id) => jobs.get(id),
    saveJob: async (job) => jobs.set(job.id, structuredClone(job)),
    allItems: async () => [...records.values()],
    submitLease: async (fn) => fn(),
    youtubeKey: async () => 'qa-key',
    scrapeKey: async () => 'qa-key',
  };
}
const job = () => ({
  id: randomUUID(),
  mode: 'enrichment',
  status: 'queued',
  steps: [],
  itemIds: [video.id],
  requests: 0,
  creditsCharged: 0,
  unknownChargeRequests: 0,
  aiStatus: 'disabled',
});

test('history preview includes every saved item but excludes paid steps until opted in', async () => {
  const io = memory();
  const free = await planHistoryDetails(await io.allItems(), io);
  assert.equal(free.total, 3);
  assert.equal(free.paidRequests, 0);
  assert.equal(free.steps.length, 3);
  const all = await planHistoryDetails(await io.allItems(), io, {
    includePaid: true,
  });
  assert.equal(all.paidRequests, 2);
  assert.equal(all.steps.length, 5);
  assert.deepEqual(all.itemIds, [video.id, paper.id, post.id]);
});
test('saved, previously checked and active steps are reused, never silently retried', async () => {
  const io = memory([
    {
      ...video,
      transcript: { text: '' },
      detailEnrichment: { detail_metadata: { status: 'failed' } },
    },
    paper,
  ]);
  io.getArticle = async () => ({ status: 'unavailable' });
  io.jobs.set('qa', {
    status: 'running',
    mode: 'enrichment',
    steps: [{ itemId: paper.id, kind: 'detail_metadata', status: 'pending' }],
  });
  const plan = await planHistoryDetails(await io.allItems(), io, {
    includePaid: true,
  });
  assert.equal(plan.steps.length, 0);
  assert.equal(plan.inProgress, 1);
  assert.equal(plan.retained, 3);
});
test('paper metadata is exact-match only and preserves source paragraph structure', async () => {
  const io = {
    fetcher: async (url) => {
      assert.match(String(url), /resultType=core/);
      return response({
        resultList: {
          result: [
            {
              id: '123',
              source: 'MED',
              abstractText:
                '<p>Methods: observed data.</p><p>Conclusions: uncertainty.</p>',
              pmcid: 'PMC123',
            },
          ],
        },
      });
    },
  };
  const value = await fetchDetailMetadata(paper, io);
  assert.equal(value.patch.pmcid, 'PMC123');
  assert.match(value.patch.summary, /observed data.\n/);
  assert.equal(value.creditsCharged, 0);
  await assert.rejects(
    fetchDetailMetadata(paper, {
      fetcher: async () =>
        response({
          resultList: {
            result: [{ id: '124', source: 'MED', abstractText: 'wrong' }],
          },
        }),
    }),
    /匹配/,
  );
});
test('YouTube details retrieves the complete saved video description and never searches again', async () => {
  const value = await fetchDetailMetadata(video, {
    youtubeKey: async () => 'qa',
    fetcher: async (url) => {
      assert.equal(url.pathname, '/youtube/v3/videos');
      assert.equal(url.searchParams.get('id'), video.videoId);
      return response({
        items: [
          {
            id: video.videoId,
            snippet: { description: 'First paragraph.\n\nSecond paragraph.' },
          },
        ],
      });
    },
  });
  assert.match(value.patch.summary, /\n\n/);
  assert.equal(value.empty, false);
});
test('Reddit raw body is checked against the original post, empty media posts are not fabricated', async () => {
  const io = {
    scrapeKey: async () => 'qa',
    fetcher: async () =>
      response({ id: 'abc123', selftext: '', credits_charged: 1 }),
  };
  const value = await fetchDetailMetadata(post, io);
  assert.equal(value.empty, true);
  assert.deepEqual(value.patch, {});
  assert.equal(value.creditsCharged, 1);
  await assert.rejects(
    fetchDetailMetadata(post, {
      ...io,
      fetcher: async () => response({ id: 'wrong', selftext: 'unrelated' }),
    }),
    /匹配/,
  );
});
test('metadata refresh preserves concurrent associations/favorites and clears stale AI', async () => {
  const io = memory([{ ...video, ai: { summaryZh: 'old snapshot' } }]);
  io.fetcher = async () => {
    io.records.get(video.id).productIds.push('concurrent-product');
    return response({
      items: [
        { id: video.videoId, snippet: { description: 'Complete description' } },
      ],
    });
  };
  const current = job();
  const step = {
    kind: 'detail_metadata',
    source: 'youtube_metadata',
    itemId: video.id,
    status: 'running',
  };
  await enrichContentStep(current, step, io);
  const saved = await io.getItem(video.id);
  assert.equal(saved.summary, 'Complete description');
  assert.equal(saved.favorite, true);
  assert.deepEqual(saved.productIds, ['qa-product', 'concurrent-product']);
  assert.equal(saved.ai, undefined);
  assert.equal(current.requests, 1);
  assert.equal(step.status, 'success');
});
test('a paid timeout stops remaining paid reads while public metadata continues', async () => {
  const io = memory();
  io.fetcher = async (url) => {
    if (String(url).includes('scrapecreators')) throw new Error('timeout');
    return response({
      items: [
        {
          id: video.videoId,
          snippet: { description: 'Description after source failure' },
        },
      ],
    });
  };
  const current = job();
  current.steps = [
    {
      kind: 'detail_transcript',
      source: 'youtube_transcript',
      itemId: video.id,
      paid: true,
      status: 'pending',
    },
    {
      kind: 'detail_metadata',
      source: 'reddit_details',
      itemId: post.id,
      paid: true,
      status: 'pending',
    },
    {
      kind: 'detail_metadata',
      source: 'youtube_metadata',
      itemId: video.id,
      status: 'pending',
    },
  ];
  io.jobs.set(current.id, current);
  await executeContentJob(current, io);
  assert.equal(current.steps[0].status, 'failed');
  assert.equal(current.steps[1].status, 'skipped');
  assert.equal(current.steps[2].status, 'success');
  assert.equal(current.requests, 2);
  assert.equal(current.unknownChargeRequests, 1);
  assert.equal(current.status, 'partial');
});
test('missing credentials do not consume a request or unknown charge', async () => {
  const io = memory();
  io.scrapeKey = async () => '';
  const current = job();
  const step = {
    kind: 'detail_transcript',
    source: 'youtube_transcript',
    itemId: video.id,
    paid: true,
    status: 'running',
  };
  current.steps = [step];
  await enrichContentStep(current, step, io);
  assert.equal(current.requests, 0);
  assert.equal(current.unknownChargeRequests, 0);
  assert.equal(step.status, 'unconfigured');
});
test('submission is idempotent and binds the same UUID to scope and paid intent', async () => {
  const io = memory();
  const request = {
    action: 'server_content_history_submit',
    requestId: randomUUID(),
    includePaid: true,
  };
  const first = await historyDetailsAction(request, { id: 'qa' }, io);
  const second = await historyDetailsAction(request, { id: 'qa' }, io);
  assert.equal(first.job.id, second.job.id);
  assert.equal(first.job.itemIds.length, 3);
  await assert.rejects(
    historyDetailsAction({ ...request, includePaid: false }, { id: 'qa' }, io),
    /其他补全范围/,
  );
});
test('one batch cannot exceed 100 paid reads and invalid item IDs are rejected', async () => {
  const io = memory(
    Array.from({ length: 101 }, (_, i) => ({
      ...video,
      id: `pc-${String(i).padStart(24, '0')}`,
    })),
  );
  await assert.rejects(
    historyDetailsAction(
      {
        action: 'server_content_history_submit',
        requestId: randomUUID(),
        includePaid: true,
      },
      { id: 'qa' },
      io,
    ),
    /100次/,
  );
  await assert.rejects(
    historyDetailsAction(
      { action: 'server_content_history_preview', itemIds: ['bad/path'] },
      { id: 'qa' },
      io,
    ),
    /编号/,
  );
});
test('restart never repeats an in-flight paid detail request and records unknown billing', async () => {
  const io = memory([video]);
  io.fetcher = async () => assert.fail('must not replay');
  const current = job();
  current.status = 'running';
  current.steps = [
    {
      kind: 'detail_metadata',
      source: 'reddit_details',
      itemId: video.id,
      paid: true,
      status: 'running',
    },
  ];
  io.jobs.set(current.id, current);
  await executeContentJob(current, io);
  assert.equal(current.steps[0].status, 'unknown');
  assert.equal(current.requests, 1);
  assert.equal(current.unknownChargeRequests, 1);
});
