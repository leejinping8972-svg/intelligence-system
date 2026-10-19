import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend uses node --test. */
import test from 'node:test';

import { articleUrl, discoveryRequest } from './public-content-discovery.mjs';
import {
  contentPlan,
  mergeContent,
  normalizeContent,
  validateContentSearch,
} from './public-content-domain.mjs';
import { executeContentJob, newContentJob } from './public-content-engine.mjs';
import {
  fetchContentComments,
  searchContentSource,
} from './public-content-providers.mjs';

const input = (extra = {}) =>
  validateContentSearch({
    query: 'creatine',
    market: 'VN',
    language: 'vi',
    sources: ['youtube', 'local_health', 'medlineplus', 'europepmc'],
    scopes: ['local', 'global'],
    referenceQuery: 'creatine safety',
    limit: 30,
    ...extra,
  });
const fixture = (data) => async () => Response.json(data);
test('scopes validate compatible sources, de-duplicate choices and separate reference queries from Vietnam context', () => {
  for (const extra of [
    { scopes: [] },
    { scopes: ['fake'] },
    { scopes: ['global'], sources: ['youtube'] },
    { scopes: ['local'], sources: ['medlineplus'] },
    { sources: 'youtube' },
    { sources: ['__proto__'] },
    { referenceLanguage: 'vi' },
    { referenceQuery: 'c' },
  ])
    assert.throws(() => input(extra));
  const value = input({
    scopes: ['global', 'global'],
    sources: ['youtube', 'medlineplus'],
  });
  assert.deepEqual(value.scopes, ['global']);
  assert.deepEqual(value.sources, ['medlineplus']);
  const plan = contentPlan(value);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].language, 'en');
  assert.equal(plan[0].market, 'ALL');
  assert.equal(plan[0].query, 'creatine safety');
});
test('Vietnam local and global references actually send independent provider languages and regions', async () => {
  const request = input();
  const steps = contentPlan(request);
  const calls = [];
  const io = {
    youtubeKey: async () => 'test-only',
    fetcher: async (value) => {
      const url = new URL(value);
      calls.push(url);
      if (url.hostname === 'www.googleapis.com')
        return Response.json({ items: [] });
      return new Response(
        '<nlmSearchResult><document url="https://medlineplus.gov/creatine.html"><content name="title">Creatine safety</content></document></nlmSearchResult>',
      );
    },
  };
  await searchContentSource(
    steps.find((step) => step.source === 'youtube'),
    request,
    io,
  );
  const result = await searchContentSource(
    steps.find((step) => step.source === 'medlineplus'),
    request,
    io,
  );
  assert.equal(calls[0].searchParams.get('regionCode'), 'VN');
  assert.equal(calls[0].searchParams.get('relevanceLanguage'), 'vi');
  assert.equal(calls[1].searchParams.get('db'), 'healthTopics');
  assert.equal(calls[1].searchParams.get('term'), 'creatine safety');
  assert.equal(result.items[0].searchScope, 'global');
  assert.equal(result.items[0].language, 'en');
  assert.equal(result.items[0].authorCountry, 'unknown');
});
test('new video connectors use documented response schemas; country hints do not become author nationality', async () => {
  for (const [source, payload, path] of [
    [
      'facebook',
      {
        videos: [
          {
            id: '123',
            title: 'Creatine video',
            description: 'creatine routine',
            url: 'https://www.facebook.com/reel/123/',
          },
        ],
      },
      '/v1/facebook/search/videos',
    ],
    [
      'instagram',
      {
        reels: [
          {
            id: '456',
            caption: 'Creatine routine',
            url: 'https://www.instagram.com/reel/abc/',
            owner: { username: 'sample' },
          },
        ],
      },
      '/v2/instagram/reels/search',
    ],
  ]) {
    let called;
    const result = await searchContentSource(
      { source, scope: 'local', query: 'creatine' },
      input({ sources: [source], scopes: ['local'] }),
      {
        scrapeKey: async () => 'private-test',
        fetcher: async (value) => {
          called = new URL(value);
          return Response.json({ ...payload, credits_charged: 2 });
        },
      },
    );
    assert.equal(called.pathname, path);
    assert.match(called.searchParams.get('query'), /Việt Nam/);
    assert.equal(result.items[0].type, 'video');
    assert.equal(result.items[0].authorCountry, 'unknown');
    assert.equal(result.items[0].language, 'unknown');
    assert.equal(result.creditsCharged, 2);
    assert.ok(!JSON.stringify(result).includes('private-test'));
  }
});
test('local health searches enforce actual market host allowlists and save index snippets, never fetched full text', async () => {
  let called;
  const result = await searchContentSource(
    { source: 'local_health', query: 'creatine', scope: 'local' },
    input({ sources: ['local_health'], scopes: ['local'], limit: 100 }),
    {
      scrapeKey: async () => 'test',
      fetcher: async (value) => {
        called = new URL(value);
        return Response.json({
          results: [
            {
              title: 'Creatine health',
              url: 'https://www.vinmec.com/vie/creatine/',
              description: 'creatine information',
            },
            {
              title: 'Creatine advert',
              url: 'https://vinmec.com.evil.example/creatine',
            },
          ],
        });
      },
    },
  );
  assert.equal(called.searchParams.get('region'), 'VN');
  assert.match(called.searchParams.get('query'), /site:moh.gov.vn/);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].publisherCountry, 'VN');
  assert.equal(result.items[0].authorCountry, 'unknown');
  assert.match(result.items[0].textAvailability, /索引摘要/);
});
test('Facebook indexed posts filter profile/foreign URLs; generic articles stay separate from authoritative health category', async () => {
  const payload = {
    results: [
      {
        title: 'creatine review',
        url: 'https://www.facebook.com/sample/posts/123',
        description: 'creatine',
      },
      { title: 'creatine profile', url: 'https://www.facebook.com/sample' },
      {
        title: 'creatine blog',
        url: 'https://example.org/creatine',
        description: 'creatine',
      },
      { title: 'creatine intranet', url: 'https://127.0.0.1/a' },
    ],
  };
  const facebook = await searchContentSource(
    { source: 'facebook_posts', query: 'creatine' },
    input({ sources: ['facebook_posts'], scopes: ['local'], limit: 100 }),
    { scrapeKey: async () => 'test', fetcher: fixture(payload) },
  );
  assert.equal(facebook.items.length, 1);
  assert.equal(facebook.items[0].type, 'post');
  const articles = await searchContentSource(
    { source: 'web_articles', query: 'creatine', scope: 'global' },
    input({ sources: ['web_articles'], scopes: ['global'], limit: 100 }),
    { scrapeKey: async () => 'test', fetcher: fixture(payload) },
  );
  assert.ok(
    articles.items.some((item) => item.url === 'https://example.org/creatine'),
  );
  assert.ok(
    articles.items.every(
      (item) => item.category === 'web' && item.searchScope === 'global',
    ),
  );
  assert.ok(
    !Object.hasOwn(
      discoveryRequest('web_articles', 'creatine', { searchScope: 'global' })
        .params,
      'region',
    ),
  );
  for (const value of [
    'http://example.com/a',
    'https://example.local/a',
    'https://127.0.0.1/a',
    'https://u:p@example.com/a',
    'javascript:alert(1)',
  ])
    assert.equal(articleUrl(value), '');
});
test('unknown new provider schemas are errors rather than falsely successful empty results', async () => {
  for (const source of [
    'facebook',
    'instagram',
    'facebook_posts',
    'local_health',
    'web_articles',
  ])
    await assert.rejects(
      searchContentSource(
        { source, query: 'creatine' },
        input({ sources: [source], scopes: ['local'] }),
        { scrapeKey: async () => 'test', fetcher: fixture({ success: true }) },
      ),
      /列表/,
    );
});
test('international health article search restricts actual hosts and has no country bias', async () => {
  let called;
  const result = await searchContentSource(
    {
      source: 'global_health',
      scope: 'global',
      language: 'en',
      market: 'ALL',
      query: 'creatine',
    },
    input({ sources: ['global_health'], scopes: ['global'], limit: 100 }),
    {
      scrapeKey: async () => 'test',
      fetcher: async (value) => {
        called = new URL(value);
        return Response.json({
          results: [
            {
              title: 'Creatine performance',
              description: 'creatine fact sheet',
              url: 'https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/',
            },
            { title: 'creatine unrelated', url: 'https://example.com/article' },
          ],
        });
      },
    },
  );
  assert.match(called.searchParams.get('query'), /site:ods.od.nih.gov/);
  assert.equal(called.searchParams.has('region'), false);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].category, 'health');
  assert.equal(result.items[0].searchScope, 'global');
});
test('diagnostics distinguish actual empty pages, filtered hits, and processing allocation', async () => {
  const searchInput = input({
    sources: ['tiktok'],
    scopes: ['local'],
    limit: 5,
  });
  const empty = await searchContentSource(
    { source: 'tiktok', query: 'creatine' },
    searchInput,
    {
      scrapeKey: async () => 'test',
      fetcher: fixture({ search_item_list: [] }),
    },
  );
  assert.equal(empty.rawCount, 0);
  assert.equal(empty.pageLimit, 5);
  const youtube = await searchContentSource(
    { source: 'youtube', query: 'creatine' },
    input({ sources: ['youtube'], scopes: ['local'], limit: 5 }),
    {
      youtubeKey: async () => 'test',
      fetcher: fixture({
        items: Array.from({ length: 12 }, (_, i) => ({
          id: { videoId: `qaVideo${String(i).padStart(4, '0')}` },
          snippet: { title: 'unrelated fish oil' },
        })),
      }),
    },
  );
  assert.equal(youtube.rawCount, 12);
  assert.equal(youtube.candidateCount, 5);
  assert.equal(youtube.items.length, 0);
  assert.equal(youtube.pageLimit, 5);
});
test('comment job saves the sample and accounting independently of search and subtitle jobs', async () => {
  const request = newContentJob(
    input({ sources: ['reddit'], scopes: ['local'] }),
    randomUUID(),
    'qa',
  );
  const record = {
    id: 'pc-111111111111111111111111',
    source: 'reddit',
    favorite: true,
    productIds: ['qa-product'],
  };
  Object.assign(request, {
    mode: 'comments',
    itemId: record.id,
    itemIds: [record.id],
    steps: [{ source: 'reddit_comments', status: 'pending' }],
  });
  let saved;
  await executeContentJob(request, {
    getJob: async () => request,
    saveJob: async () => {},
    getItem: async () => record,
    updateItem: async (_id, change) => {
      saved = change(record);
    },
    comments: async () => ({
      comments: { items: [{ text: 'sample' }], completeness: '取样' },
      creditsCharged: 1,
    }),
  });
  assert.equal(saved.comments.items.length, 1);
  assert.equal(saved.favorite, true);
  assert.equal(request.creditsCharged, 1);
  assert.equal(request.status, 'completed');
});
test('new paid sources recover without replaying uncertain requests and other sources continue', async () => {
  const job = newContentJob(
    input({ sources: ['instagram', 'europepmc'] }),
    randomUUID(),
    'qa',
  );
  job.steps[0].status = 'running';
  let calls = 0;
  await executeContentJob(job, {
    getJob: async () => job,
    saveJob: async () => {},
    updateItem: async () => {},
    search: async () => {
      calls++;
      return { items: [], rawCount: 0 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(job.unknownChargeRequests, 1);
  assert.equal(job.steps[0].status, 'unknown');
  assert.equal(job.steps[1].status, 'success');
});
test('Reddit comments are a bounded explicit request; unsafe inputs are rejected before paid fetch', async () => {
  let calls = 0;
  const io = {
    scrapeKey: async () => 'test',
    fetcher: async (value) => {
      calls++;
      assert.equal(new URL(value).pathname, '/v1/reddit/post/comments');
      return Response.json({
        credits_charged: 1,
        comments: Array.from({ length: 25 }, (_, i) => ({
          id: `c${i}`,
          body: `creatine experience ${i}`,
          url: `https://www.reddit.com/r/test/comments/abc/thread/c${i}/`,
          author: 'qa',
        })),
        more: { has_more: true },
      });
    },
  };
  await assert.rejects(
    fetchContentComments(
      { source: 'reddit', url: 'https://evil.example/comments/abc/' },
      io,
    ),
  );
  assert.equal(calls, 0);
  const result = await fetchContentComments(
    {
      source: 'reddit',
      url: 'https://www.reddit.com/r/test/comments/abc/thread/',
    },
    io,
  );
  assert.equal(calls, 1);
  assert.equal(result.comments.items.length, 20);
  assert.match(result.comments.completeness, /非完整/);
  assert.equal(result.creditsCharged, 1);
});
test('merge keeps distinct local/global provenance, favorite state and saved comment sample', () => {
  const raw = {
    sourceId: 'same',
    title: 'creatine',
    url: 'https://example.org/creatine',
    type: 'article',
  };
  const a = normalizeContent(
    raw,
    'web_articles',
    { ...input(), searchScope: 'local' },
    'creatine',
  );
  a.favorite = true;
  a.comments = { items: [] };
  const b = normalizeContent(
    raw,
    'web_articles',
    { ...input(), market: 'ALL', language: 'en', searchScope: 'global' },
    'creatine',
  );
  const merged = mergeContent(a, b);
  assert.equal(a.id, b.id);
  assert.equal(merged.searchContexts.length, 2);
  assert.equal(merged.favorite, true);
  assert.deepEqual(merged.comments, { items: [] });
});
