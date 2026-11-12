import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend uses node --test. */
import test from 'node:test';

import { collectArticleStep } from './public-article-details.mjs';
import { ArticleError, articleRetryAt } from './public-article-http.mjs';
import {
  contentAiRequest,
  decodeContentAi,
  parseContentAiResponse,
  validateContentAiItems,
} from './public-content-ai.mjs';
import {
  normalizeContent,
  validateContentSearch,
} from './public-content-domain.mjs';
import { executeContentJob, newContentJob } from './public-content-engine.mjs';
import {
  contentNextPage,
  contentPageParams,
} from './public-content-pagination.mjs';
import { searchContentSource } from './public-content-providers.mjs';

const input = (extra = {}) =>
  validateContentSearch({
    query: 'elahring',
    market: 'US',
    language: 'en',
    sources: ['youtube'],
    scopes: ['local'],
    limit: 1000,
    fetchDetails: false,
    ...extra,
  });
const video = (index, title = 'Elah Ring review') => ({
  id: { videoId: `test${String(index).padStart(7, '0')}` },
  snippet: { title, description: 'An Elah Ring review' },
});
function memory(job, extra = {}) {
  const items = new Map();
  let saved = structuredClone(job);
  return {
    items,
    getJob: async () => saved,
    getItem: async (id) => items.get(id),
    saveJob: async (j) => {
      saved = structuredClone(j);
    },
    updateItem: async (id, transform) =>
      items.set(id, transform(items.get(id))),
    ...extra,
  };
}

test('new searches accept 1000 and reject 1001; joined and spaced brand names match both ways', () => {
  assert.equal(input().limit, 1000);
  assert.deepEqual(input().queries, ['elahring', 'Elah Ring']);
  assert.deepEqual(input({ query: 'Elah Ring' }).queries, [
    'Elah Ring',
    'elahring',
  ]);
  assert.throws(() => input({ limit: 1001 }), /1000/);
  for (const [query, title] of [
    ['elahring', 'Elah Ring review'],
    ['Elah Ring', 'ElahRing review'],
    ['elahring', 'ELAH-RING review'],
  ]) {
    assert.ok(
      normalizeContent(
        {
          sourceId: 'x',
          title,
          url: 'https://youtube.com/watch?v=abcdefghijk',
        },
        'youtube',
        input({ query }),
        query,
      ),
    );
  }
  assert.equal(
    normalizeContent(
      {
        sourceId: 'x',
        title: 'Elah described a different smart ring',
        url: 'https://youtube.com/watch?v=abcdefghijk',
      },
      'youtube',
      input(),
      'elahring',
    ),
    null,
  );
});

test('1000 results are reachable through real provider pagination with no per-source 20 cap', async () => {
  const job = newContentJob(input(), randomUUID(), 'qa');
  const calls = [];
  const io = memory(job, {
    youtubeKey: async () => 'synthetic',
    fetcher: async (url) => {
      const u = new URL(url);
      const page = Number(u.searchParams.get('pageToken') || 0);
      const queryOffset = u.searchParams.get('q') === 'elahring' ? 0 : 500;
      calls.push(page);
      assert.equal(u.searchParams.get('maxResults'), '50');
      return Response.json({
        items: Array.from({ length: 50 }, (_, i) =>
          video(queryOffset + page * 50 + i),
        ),
        nextPageToken: String(page + 1),
      });
    },
  });
  await executeContentJob(job, io);
  assert.equal(job.itemIds.length, 1000);
  assert.equal(io.items.size, 1000);
  assert.equal(calls.length, 20);
  assert.equal(job.requests, 20);
  assert.equal(job.status, 'completed');
});

test('empty sources do not reserve quota; every source gets its first page before later pages', async () => {
  const job = newContentJob(
    input({ sources: ['reddit', 'youtube'], limit: 100 }),
    randomUUID(),
    'qa',
  );
  const calls = [];
  const io = memory(job, {
    scrapeKey: async () => 'synthetic',
    youtubeKey: async () => 'synthetic',
    fetcher: async (url) => {
      const u = new URL(url);
      calls.push(u.pathname);
      if (u.pathname.includes('reddit'))
        return Response.json({ posts: [], credits_charged: 1 });
      const page = Number(u.searchParams.get('pageToken') || 0);
      return Response.json({
        items: Array.from({ length: 50 }, (_, i) => video(page * 50 + i)),
        nextPageToken: page === 0 ? '1' : null,
      });
    },
  });
  await executeContentJob(job, io);
  assert.deepEqual(calls, [
    '/v1/reddit/search',
    '/youtube/v3/search',
    '/v1/reddit/search',
    '/youtube/v3/search',
    '/youtube/v3/search',
  ]);
  assert.equal(job.itemIds.length, 100);
});

test('the entire page is filtered before the total cap, keeping relevant hits beyond position 13', async () => {
  const result = await searchContentSource(
    { source: 'youtube', query: 'elahring' },
    input({ limit: 5 }),
    {
      youtubeKey: async () => 'synthetic',
      fetcher: async () =>
        Response.json({
          items: [
            ...Array.from({ length: 20 }, (_, i) => ({
              ...video(i),
              snippet: { title: 'unrelated' },
            })),
            video(20),
          ],
        }),
    },
  );
  assert.equal(result.rawCount, 21);
  assert.equal(result.items.length, 1);
});

test('TikTok supports direct and wrapped videos and emits an actionable schema warning', async () => {
  const record = {
    aweme_id: '7268287584244124971',
    desc: 'Elah Ring review',
    author: { unique_id: 'qa' },
  };
  for (const entry of [record, { aweme_info: record }, { aweme: record }]) {
    const r = await searchContentSource(
      { source: 'tiktok', query: 'elahring' },
      input({ sources: ['tiktok'] }),
      {
        scrapeKey: async () => 'synthetic',
        fetcher: async () =>
          Response.json({ data: { search_item_list: [entry], cursor: 30 } }),
      },
    );
    assert.equal(r.items.length, 1);
    assert.equal(r.nextPage.cursor, '30');
  }
  const r = await searchContentSource(
    { source: 'tiktok', query: 'elahring' },
    input({ sources: ['tiktok'] }),
    {
      scrapeKey: async () => 'synthetic',
      fetcher: async () =>
        Response.json({ search_item_list: [{ changed_shape: {} }] }),
    },
  );
  assert.match(r.parseWarning, /编号结构未识别/);
  assert.deepEqual(r.schemaKeys, ['changed_shape']);
});

test('provider page parameters and documented end conditions are respected', () => {
  const i = input();
  assert.deepEqual(contentPageParams('reddit', { cursor: 't3_next' }, i), {
    after: 't3_next',
  });
  assert.deepEqual(contentPageParams('tiktok', { cursor: '30' }, i), {
    cursor: '30',
  });
  assert.deepEqual(contentPageParams('europepmc', {}, i), { cursorMark: '*' });
  assert.equal(
    contentNextPage(
      'facebook',
      { cursor: 'next', has_more: false },
      {},
      i,
      10,
      100,
    ),
    null,
  );
  assert.equal(
    contentNextPage('tiktok', { cursor: 30 }, { cursor: '30' }, i, 30, 100),
    null,
  );
  assert.equal(
    contentNextPage('instagram', {}, { page: 11 }, i, 10, 100),
    null,
  );
  assert.equal(
    contentNextPage('youtube', { nextPageToken: 'next' }, {}, i, 0, 50),
    null,
  );
});

test('repeated page identities stop pagination even when metrics and cursor change', async () => {
  const job = newContentJob(input(), randomUUID(), 'qa');
  job.steps = job.steps.slice(0, 1);
  let calls = 0;
  const io = memory(job, {
    youtubeKey: async () => 'synthetic',
    fetcher: async () => {
      calls++;
      return Response.json({ items: [video(0)], nextPageToken: String(calls) });
    },
  });
  await executeContentJob(job, io);
  assert.equal(calls, 2);
  assert.equal(job.itemIds.length, 1);
  assert.match(job.steps[1].message, /重复返回同一页/);
});

test('old frozen jobs keep their first-page allocation and never auto-expand', async () => {
  const job = newContentJob(input(), randomUUID(), 'qa');
  job.steps = job.steps.slice(0, 1);
  delete job.input.searchVersion;
  let calls = 0;
  const io = memory(job, {
    youtubeKey: async () => 'synthetic',
    fetcher: async (url) => {
      calls++;
      assert.equal(new URL(url).searchParams.get('maxResults'), '20');
      return Response.json({ items: [video(0)], nextPageToken: 'next' });
    },
  });
  await executeContentJob(job, io);
  assert.equal(calls, 1);
  assert.equal(job.steps.length, 1);
});

test('AI uses short IDs and source quote options without fuzzy ID repair or invented evidence', () => {
  const sample = [
    { id: 'pc-long-opaque-one', title: 'Title only', text: '' },
    {
      id: 'pc-long-opaque-two',
      title: 'Second title',
      text: 'Original evidence',
    },
  ];
  const request = contentAiRequest(sample);
  assert.deepEqual(
    request.map((s) => s.id),
    ['1', '2'],
  );
  const parsed = decodeContentAi(
    {
      items: [
        { id: '1', titleZh: '标题', summaryZh: '仅有标题', quoteId: 'title' },
        {
          id: '2',
          titleZh: '另一标题',
          summaryZh: '资料摘要',
          quoteId: 'text',
          duplicateOf: '1',
        },
      ],
    },
    sample,
  );
  const valid = validateContentAiItems(parsed, sample);
  assert.equal(valid.updates.size, 2);
  assert.equal(valid.updates.get(sample[1].id).quote, 'Original evidence');
  assert.equal(valid.updates.get(sample[1].id).duplicateOf, sample[0].id);
  parsed.items[0].quote = 'invented';
  const partial = validateContentAiItems(parsed, sample);
  assert.equal(partial.updates.size, 1);
  assert.match(partial.issues[0].message, /原文片段/);
  parsed.items[0].id = 'pc-long-opaque-onx';
  assert.equal(
    validateContentAiItems(parsed, sample).updates.has(sample[0].id),
    false,
  );
});

test('duplicate IDs reject only ambiguous rows and malformed JSON has a precise reason', () => {
  const sample = [
    { id: 'one', title: 'First', text: '' },
    { id: 'two', title: 'Second', text: '' },
  ];
  const row = (id) => ({
    id,
    titleZh: '标题',
    summaryZh: '摘要',
    quoteId: 'title',
  });
  const result = validateContentAiItems(
    { items: [row('one'), row('one'), row('two')] },
    sample,
  );
  assert.equal(result.updates.size, 1);
  assert.ok(result.updates.has('two'));
  assert.match(result.issues[0].message, /重复编号/);
  assert.match(
    parseContentAiResponse('{"items":[', sample).parseError,
    /不是JSON/,
  );
});

test('429 cools down the same host, preserves the index, and does not block another host', async () => {
  const records = new Map(
    ['a', 'b', 'c'].map((id, index) => [
      id,
      {
        id,
        type: 'article',
        source: 'web_articles',
        url: `https://${index === 2 ? 'another.example.com' : 'example.com'}/${id}`,
      },
    ]),
  );
  const articles = new Map();
  const calls = [];
  const job = { id: 'qa', requests: 0 };
  const io = {
    getItem: async (id) => records.get(id),
    getArticle: async (id) => articles.get(id),
    updateItem: async (id, transform) =>
      records.set(id, transform(records.get(id))),
    writeArticle: async (id, value) => articles.set(id, value),
    articleFetch: async (url) => {
      calls.push(url);
      throw new ArticleError('原文 HTTP 429', 'rate_limited');
    },
  };
  const steps = ['a', 'b', 'c'].map((itemId) => ({ itemId }));
  for (const step of steps) await collectArticleStep(job, step, io);
  assert.equal(calls.length, 2);
  assert.equal(job.requests, 2);
  assert.equal(steps[1].status, 'rate_limited');
  assert.match(steps[1].message, /同域/);
  assert.ok(records.get('b'));
  articles.set('b', { document: { characters: 100 } });
  const cached = { itemId: 'b' };
  await collectArticleStep(job, cached, io);
  assert.equal(cached.status, 'success');
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 2);
  const now = Date.parse('2026-11-12T00:00:00Z');
  assert.equal(articleRetryAt('120', now), '2026-11-12T00:02:00.000Z');
  assert.equal(
    articleRetryAt('Thu, 12 Nov 2026 00:03:00 GMT', now),
    '2026-11-12T00:03:00.000Z',
  );
});
