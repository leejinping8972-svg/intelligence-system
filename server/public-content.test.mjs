import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend tests intentionally run with node --test. */
import test from 'node:test';

import { contentAiInput, validateContentAi } from './public-content-ai.mjs';
import {
  contentPlan,
  mergeContent,
  normalizeContent,
  publicUrl,
  validateContentSearch,
} from './public-content-domain.mjs';
import { executeContentJob, newContentJob } from './public-content-engine.mjs';
import {
  ContentProviderError,
  fetchContentTranscript,
  parseMedline,
  searchContentSource,
} from './public-content-providers.mjs';

const input = (extra) =>
  validateContentSearch({
    query: 'creatine gummies',
    market: 'US',
    language: 'en',
    sources: ['youtube', 'reddit', 'medlineplus', 'europepmc'],
    limit: 30,
    ...extra,
  });
const item = (id = 'one', source = 'youtube') =>
  normalizeContent(
    {
      sourceId: id,
      title: 'Creatine gummies review',
      summary: 'Creatine gummies taste and routine.',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
      author: 'Sample',
      type: 'video',
    },
    source,
    input(),
    'creatine gummies',
  );
const fixture = (data) => async () => Response.json(data);
function memory(job, overrides = {}) {
  const caches = new Map();
  const items = new Map();
  const jobs = new Map([[job.id, structuredClone(job)]]);
  const clone = (value) => value && structuredClone(value);
  return {
    jobs,
    items,
    caches,
    getJob: async (id) => clone(jobs.get(id)),
    getItem: async (id) => clone(items.get(id)),
    saveJob: async (j) =>
      jobs.set(
        j.id,
        clone({
          ...j,
          ...(jobs.get(j.id)?.status === 'cancelled'
            ? { status: 'cancelled' }
            : {}),
        }),
      ),
    updateItem: async (id, fn) => {
      const value = fn(clone(items.get(id)));
      items.set(id, clone(value));
      return value;
    },
    search: async () => ({ items: [item()], rawCount: 1, creditsCharged: 1 }),
    readCache: async (s) => caches.get(`${s.source}:${s.query}`),
    writeCache: async (s, _i, r) => caches.set(`${s.source}:${s.query}`, r),
    ...overrides,
  };
}
test('validates bounded request and caps local expansion at three queries', () => {
  for (const extra of [
    { market: 'ALL' },
    { language: 'xx' },
    { sources: ['https://localhost/'] },
    { limit: 1000 },
    { query: 'a' },
  ])
    assert.throws(() => input(extra));
  const r = input({
    includeRelated: true,
    relatedTerms: ['creatine', 'creatine reviews', 'ignored'],
  });
  assert.deepEqual(r.queries, [
    'creatine gummies',
    'creatine',
    'creatine reviews',
  ]);
  assert.equal(contentPlan(r).length, 10); // Local: 3x2; global English: 2x2.
  assert.deepEqual(input({ relatedTerms: ['unrequested'] }).queries, [
    'creatine gummies',
  ]);
});
test('country is search context; stable identity and merges preserve favorites and links', () => {
  const a = item();
  a.favorite = true;
  a.productIds = ['product-a'];
  const b = normalizeContent(
    { ...a, sourceId: 'one' },
    'youtube',
    input({ market: 'MX', keywordIds: ['word-b'] }),
    'creatine',
  );
  assert.equal(a.id, b.id);
  assert.equal(b.authorCountry, 'unknown');
  const merged = mergeContent(a, b);
  assert.equal(merged.favorite, true);
  assert.deepEqual(merged.productIds, ['product-a']);
  assert.deepEqual(merged.keywordIds, ['word-b']);
  assert.deepEqual(merged.matchedQueries, ['creatine gummies', 'creatine']);
});
test('unrelated source hits and unsafe outbound links are rejected; missing dates stay unknown', () => {
  assert.equal(
    normalizeContent(
      { sourceId: 'a', title: 'Fish oil', url: 'https://example.com' },
      'youtube',
      input(),
      'creatine',
    ),
    null,
  );
  assert.equal(item().publishedAt, null);
  for (const url of [
    'javascript:alert(1)',
    'https://medlineplus.gov.evil.com/a',
    'https://user:pass@medlineplus.gov/a',
    'http://medlineplus.gov/a',
  ])
    assert.equal(publicUrl(url, ['medlineplus.gov']), '');
});
test('updated source text invalidates stale AI while preserving previously collected captions', () => {
  const old = {
    ...item(),
    ai: { summaryZh: '旧摘要' },
    transcript: { text: 'captions' },
  };
  const merged = mergeContent(old, {
    ...item(),
    summary: 'New creatine description',
  });
  assert.equal(merged.ai, undefined);
  assert.equal(merged.transcript.text, 'captions');
  assert.equal(merged.textAvailability, '已有字幕');
});
test('YouTube fixed endpoint uses configured search region/language and exposes no key', async () => {
  let call;
  const result = await searchContentSource(
    { source: 'youtube', query: 'creatine' },
    input(),
    {
      youtubeKey: async () => 'TEST_PRIVATE_KEY',
      fetcher: async (url, opts) => {
        call = { url: new URL(url), opts };
        return fixture({
          items: [
            {
              id: { videoId: 'abcdefghijk' },
              snippet: {
                title: 'Creatine &amp; health',
                description: 'Creatine video',
                channelTitle: 'Sample',
              },
            },
          ],
        })();
      },
    },
  );
  assert.equal(call.url.origin, 'https://www.googleapis.com');
  assert.equal(call.url.searchParams.get('regionCode'), 'US');
  assert.equal(call.url.searchParams.get('relevanceLanguage'), 'en');
  assert.equal(call.opts.redirect, 'error');
  assert.equal(result.items[0].type, 'video');
  assert.equal(result.items[0].authorCountry, 'unknown');
  assert.ok(!JSON.stringify(result).includes('TEST_PRIVATE_KEY'));
});
test('Reddit handles canonical post URL and selftext without fetching external landing pages', async () => {
  let called;
  const result = await searchContentSource(
    { source: 'reddit', query: 'creatine' },
    input(),
    {
      scrapeKey: async () => 'private',
      fetcher: async (url) => {
        called = new URL(url);
        return fixture({
          success: true,
          credits_charged: 1,
          posts: [
            {
              id: 'x',
              title: 'Creatine review',
              permalink: '/r/Fitness/comments/x/review/',
              url: 'https://untrusted.invalid',
              selftext: 'My creatine routine',
              score: 4,
            },
            { id: 'nsfw', title: 'creatine', nsfw: true },
          ],
        })();
      },
    },
  );
  assert.equal(called.pathname, '/v1/reddit/search');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].type, 'post');
  assert.match(result.items[0].url, /^https:\/\/www.reddit.com\/r\//);
  assert.equal(result.creditsCharged, 1);
});
test('TikTok uses documented schema and never calls a video URL', async () => {
  const result = await searchContentSource(
    { source: 'tiktok', query: 'creatine' },
    input(),
    {
      scrapeKey: async () => 'private',
      fetcher: fixture({
        success: true,
        search_item_list: [
          {
            aweme_id: '7268287584244124971',
            desc: 'Creatine routine',
            desc_language: 'vi',
            region: 'US',
            author: { unique_id: 'sample' },
            statistics: { play_count: 10 },
          },
        ],
      }),
    },
  );
  assert.equal(result.items[0].type, 'video');
  assert.equal(result.items[0].language, 'vi');
  assert.equal(result.items[0].authorCountry, 'unknown');
  assert.equal(result.creditsCharged, null);
});
test('MedlinePlus XML summaries are plain text, attributed, and unsafe URLs omitted', () => {
  const rows = parseMedline(
    '<nlmSearchResult><list><document url="https://medlineplus.gov/supplements.html"><content name="title">Dietary &lt;b&gt;creatine&lt;/b&gt;</content><content name="FullSummary">&lt;p&gt;Creatine evidence.&lt;/p&gt;</content></document><document url="https://evil.test/a"><content name="title">Creatine</content></document></list></nlmSearchResult>',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Dietary creatine');
  assert.equal(rows[0].summary, 'Creatine evidence.');
  assert.throws(() => parseMedline('<html>blocked</html>'));
});
test('unsupported MedlinePlus language and missing credentials make zero external calls', async () => {
  const io = {
    fetcher: () => {
      throw new Error('must not fetch');
    },
  };
  await assert.rejects(
    searchContentSource(
      { source: 'medlineplus', query: 'creatine' },
      input({ language: 'vi' }),
      io,
    ),
    (e) => e.state === 'unsupported',
  );
  await assert.rejects(
    searchContentSource({ source: 'youtube', query: 'creatine' }, input(), io),
    (e) => e.state === 'unconfigured',
  );
});
test('academic source records paper metadata and abstract availability without claiming full text', async () => {
  const result = await searchContentSource(
    { source: 'europepmc', query: 'creatine' },
    input(),
    {
      fetcher: fixture({
        resultList: {
          result: [
            {
              source: 'MED',
              id: '123',
              pmid: '123',
              title: 'Creatine trial',
              abstractText: '<p>Creatine study limitations.</p>',
              authorString: 'A et al.',
              language: 'eng',
            },
          ],
        },
      }),
    },
  );
  assert.equal(result.items[0].category, 'academic');
  assert.equal(result.items[0].type, 'paper');
  assert.equal(result.items[0].language, 'en');
  assert.equal(result.items[0].textAvailability, '研究摘要；全文请查看原文');
});
test('provider failures redact error bodies and never falsely report malformed payload as empty success', async () => {
  await assert.rejects(
    searchContentSource({ source: 'youtube', query: 'creatine' }, input(), {
      youtubeKey: async () => 'private',
      fetcher: async () =>
        new Response('{"error":"key=private"}', { status: 429 }),
    }),
    (e) => e.state === 'rate_limited' && !e.message.includes('private'),
  );
  await assert.rejects(
    searchContentSource({ source: 'reddit', query: 'creatine' }, input(), {
      scrapeKey: async () => 'private',
      fetcher: fixture({ success: true, changed_schema: [] }),
    }),
    /列表/,
  );
});
test('one unavailable source does not block other sources or replay that source for expansions', async () => {
  const job = newContentJob(
    input({ sources: ['reddit', 'youtube'], includeRelated: true }),
    randomUUID(),
    'qa',
  );
  const calls = [];
  const io = memory(job, {
    search: async (s) => {
      calls.push(s.source);
      if (s.source === 'reddit')
        throw new ContentProviderError('limited', 'rate_limited');
      return { items: [item()], rawCount: 1, creditsCharged: null };
    },
  });
  await executeContentJob(job, io);
  assert.deepEqual(calls, ['reddit', 'youtube', 'youtube']);
  assert.equal(job.itemIds.length, 1);
  assert.equal(job.status, 'partial');
  assert.equal(job.unknownChargeRequests, 1);
  assert.equal(job.steps[2].status, 'skipped');
});
test('result cap and duplicate identities preserve a single item per source record', async () => {
  const job = newContentJob(
    input({ sources: ['youtube'], limit: 5 }),
    randomUUID(),
    'qa',
  );
  const io = memory(job, {
    search: async () => ({
      items: Array.from({ length: 9 }, (_, i) => item(String(i % 7))),
      rawCount: 9,
      creditsCharged: null,
    }),
  });
  await executeContentJob(job, io);
  assert.equal(job.itemIds.length, 5);
  assert.equal(io.items.size, 5);
});
test('cached searches make no source calls and preserve new product associations', async () => {
  const job = newContentJob(
    input({ sources: ['reddit'], productIds: ['product-b'] }),
    randomUUID(),
    'qa',
  );
  const io = memory(job, {
    readCache: async () => ({
      items: [item('cached', 'reddit')],
      rawCount: 1,
      creditsCharged: 1,
    }),
    search: async () => {
      throw new Error('must not call');
    },
  });
  await executeContentJob(job, io);
  assert.equal(job.requests, 0);
  assert.equal(job.creditsCharged, 0);
  assert.deepEqual([...io.items.values()][0].productIds, ['product-b']);
});
test('process restart marks in-flight paid step unknown and continues pending work without replay', async () => {
  const job = newContentJob(
    input({ sources: ['reddit', 'youtube'] }),
    randomUUID(),
    'qa',
  );
  job.steps[0].status = 'running';
  let calls = 0;
  const io = memory(job, {
    search: async (s) => {
      assert.equal(s.source, 'youtube');
      calls++;
      return { items: [item()], rawCount: 1, creditsCharged: null };
    },
  });
  await executeContentJob(job, io);
  assert.equal(calls, 1);
  assert.equal(job.steps[0].status, 'unknown');
  assert.equal(job.unknownChargeRequests, 1);
  assert.equal(job.requests, 2);
});
test('cancel during a request saves returned content and prevents subsequent requests', async () => {
  const job = newContentJob(
    input({ sources: ['youtube', 'reddit'] }),
    randomUUID(),
    'qa',
  );
  const io = memory(job);
  let calls = 0;
  io.search = async () => {
    calls++;
    io.jobs.get(job.id).status = 'cancelled';
    return { items: [item()], rawCount: 1, creditsCharged: null };
  };
  await executeContentJob(job, io);
  assert.equal(calls, 1);
  assert.equal(io.jobs.get(job.id).status, 'cancelled');
  assert.equal(io.jobs.get(job.id).itemIds.length, 1);
});
test('AI rejects invented quotes and unknown references; original items remain available', async () => {
  const sample = contentAiInput([item()]);
  assert.throws(
    () =>
      validateContentAi(
        {
          items: [
            {
              id: sample[0].id,
              titleZh: '肌酸',
              summaryZh: '摘要',
              quote: 'invented medical claim',
            },
          ],
        },
        sample,
      ),
    /原文片段/,
  );
  const job = newContentJob(
    input({ sources: ['youtube'], organize: true }),
    randomUUID(),
    'qa',
  );
  const io = memory(job, {
    organize: async () => ({ parsed: { items: [{ id: 'invented' }] } }),
  });
  await executeContentJob(job, io);
  assert.equal(job.aiStatus, 'failed');
  assert.equal(io.items.size, 1);
  assert.equal(job.status, 'partial');
});
test('AI receives at most ten samples and reuses already organized content', async () => {
  const diverse = contentAiInput([
    ...Array.from({ length: 12 }, (_, i) => item(String(i))),
    { ...item('health'), category: 'health' },
    { ...item('paper'), category: 'academic' },
  ]);
  assert.equal(new Set(diverse.map((i) => i.category)).size, 3);
  assert.equal(
    contentAiInput(Array.from({ length: 20 }, (_, i) => item(String(i))))
      .length,
    10,
  );
  const job = newContentJob(
    input({ sources: ['youtube'], organize: true }),
    randomUUID(),
    'qa',
  );
  const a = item();
  a.ai = { summaryZh: '已整理' };
  const io = memory(job, {
    organize: () => {
      throw new Error('must not call');
    },
  });
  io.items.set(a.id, a);
  await executeContentJob(job, io);
  assert.equal(job.aiStatus, 'completed');
  assert.equal(job.aiModel, '复用已有整理');
});
test('restart does not repeat an in-flight model call', async () => {
  const job = newContentJob(
    input({ sources: ['youtube'], organize: true }),
    randomUUID(),
    'qa',
  );
  job.aiStatus = 'running';
  const io = memory(job, {
    organize: () => {
      throw new Error('must not call');
    },
  });
  await executeContentJob(job, io);
  assert.equal(job.aiStatus, 'unknown');
});
test('transcripts accept only stored YouTube video identity, preserve absence, and report known charges', async () => {
  let url;
  const a = { ...item(), videoId: 'abcdefghijk' };
  const result = await fetchContentTranscript(a, {
    scrapeKey: async () => 'private',
    fetcher: async (u) => {
      url = new URL(u);
      return fixture({ success: true, transcript: null, credits_charged: 0 })();
    },
  });
  assert.equal(url.searchParams.get('original_audio'), 'true');
  assert.equal(result.transcript.text, '');
  assert.equal(result.creditsCharged, 0);
  await assert.rejects(
    fetchContentTranscript({ ...a, videoId: 'https://127.0.0.1' }),
    /仅支持/,
  );
});
test('storage error after confirmed response cannot double count paid request', async () => {
  const job = newContentJob(input({ sources: ['reddit'] }), randomUUID(), 'qa');
  const io = memory(job, {
    updateItem: async () => {
      throw new Error('DB internal secret');
    },
  });
  await executeContentJob(job, io);
  assert.equal(job.requests, 1);
  assert.equal(job.creditsCharged, 1);
  assert.equal(job.unknownChargeRequests, 0);
  assert.ok(!job.steps[0].message.includes('secret'));
});
