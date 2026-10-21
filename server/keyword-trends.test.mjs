/* eslint-disable vitest/no-import-node-test, unicorn/no-await-expression-member -- Standalone Node regression tests and async fixture assertions. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildTrendWork,
  defaultTrendPlan,
  socialWindows,
  summarizeSocial,
  trendDay,
  validateTrendPlan,
} from './keyword-trends-domain.mjs';
import {
  advanceTrendQueue,
  enqueueTrendWork,
  TREND_PREFIX as P,
  trendAction,
  trendSnapshotName,
} from './keyword-trends-engine.mjs';
import {
  fetchSocialTrend,
  parseSocialResult,
  socialRequest,
} from './keyword-trends-provider.mjs';

const now = Date.parse('2026-10-21T02:00:00Z');
const word = {
  id: 'one',
  term: 'creatine',
  market: 'US',
  reviewStatus: 'selected',
  dataNature: 'collected',
};
function fixture(overrides = {}) {
  const values = new Map();
  const db = {
    read: async (name) => structuredClone(values.get(name)),
    write: async (name, value) => {
      values.set(name, structuredClone(value));
    },
    list: async (prefix) =>
      [...values]
        .filter(([name]) => name.startsWith(prefix))
        .map(([name, value]) => ({ name, value: structuredClone(value) })),
    commitResult: async (fn) => {
      const old = structuredClone(values);
      try {
        await fn();
      } catch (error) {
        values.clear();
        for (const [k, v] of old) values.set(k, v);
        throw error;
      }
    },
  };
  let calls = 0;
  return {
    db,
    values,
    now,
    keywords: async () => [word],
    key: async () => 'synthetic',
    fetch: async () => {
      calls++;
      return {
        items: [],
        creditsCharged: 1,
        hasMore: false,
        coverage: '合成样本',
      };
    },
    submitGoogle: async () => ({ id: 'fake-google-job' }),
    calls: () => calls,
    ...overrides,
  };
}
const plan = (sources = ['tiktok'], extra = {}) => ({
  ...defaultTrendPlan,
  sources,
  ...extra,
});
test('plan defaults paused and rejects unacknowledged budgets, invalid sources and bounds', () => {
  assert.equal(defaultTrendPlan.enabled, false);
  assert.throws(() => validateTrendPlan({ enabled: true }), /确认/);
  for (const bad of [
    { maxPages: 6 },
    { maxRequests: 0 },
    { sources: ['bogus'] },
    { time: '24:00' },
    { markets: [] },
  ])
    assert.throws(() => validateTrendPlan(bad));
  assert.equal(
    validateTrendPlan({ enabled: true, budgetAcknowledged: true }).enabled,
    true,
  );
});
test('calendar windows use Monday, first of month and calendar month arithmetic in Beijing', () => {
  const w = socialWindows(now);
  assert.deepEqual(
    w.map((v) => v.start),
    ['2026-10-19', '2026-10-01', '2026-07-21', '2026-04-21'],
  );
  assert.equal(trendDay(Date.parse('2026-10-20T16:01:00Z')), '2026-10-21');
  assert.equal(
    socialWindows(Date.parse('2024-05-31T01:00:00Z'))[2].start,
    '2024-02-29',
  );
});
test('request plans cover four TK windows, three IG retrieval windows and one FB search', () => {
  const work = buildTrendWork([word], defaultTrendPlan);
  assert.equal(work.length, 9);
  const tk = work.find((w) => w.source === 'tiktok');
  assert.equal(socialRequest(tk).params.date_posted, 'this-week');
  assert.equal(
    socialRequest({ ...tk, source: 'facebook', window: 'public' }).params
      .date_posted,
    undefined,
  );
});
test('TK nested and flat API rows are normalized, deduplicated and zero metrics preserved', () => {
  const row = {
    aweme_id: '1234567890123',
    create_time: now / 1000,
    statistics: { play_count: 0, digg_count: 3 },
  };
  const r = parseSocialResult(
    { source: 'tiktok' },
    {
      search_item_list: [{ aweme_info: row }, row],
      cursor: 0,
      has_more: 0,
      credits_charged: 1,
    },
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].views, 0);
  assert.equal(r.items[0].comments, null);
  assert.equal(r.hasMore, false);
  assert.throws(() => parseSocialResult({ source: 'tiktok' }, {}), /结构异常/);
});
test('IG and FB keep missing metrics and dates unknown and reject external result URLs', () => {
  const r = parseSocialResult(
    { source: 'instagram' },
    {
      reels: [
        { id: 'a', url: 'https://www.instagram.com/reel/a/', like_count: 0 },
        { id: 'b', url: 'https://evil.test/' },
      ],
    },
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].views, null);
  assert.equal(r.items[0].publishedAt, '');
  assert.match(r.coverage, /索引窗口/);
  assert.equal(
    parseSocialResult({ source: 'facebook' }, { videos: [] }).items.length,
    0,
  );
});
test('first collection counts actual publication dates, never creates historical playback growth', () => {
  const s = summarizeSocial({
    ...word,
    keywordId: word.id,
    source: 'tiktok',
    at: new Date(now).toISOString(),
    completedWindows: ['all'],
    items: [
      { id: 'a', publishedAt: '2026-10-20T01:00:00Z', views: 1_000_000 },
      { id: 'b', publishedAt: '2026-06-01', views: null },
      { id: 'c', publishedAt: '', views: 5 },
    ],
  });
  assert.deepEqual(
    s.periods.map((w) => w.count),
    [1, 1, 1, 2],
  );
  assert.ok(s.periods.every((p) => p.change === null));
  assert.equal(s.undatedCount, 1);
});
test('growth uses the same real content IDs and dated baseline; missing and corrected counts stay unknown', () => {
  const base = {
    at: '2026-10-19T01:00:00Z',
    items: [
      { id: 'a', views: 100 },
      { id: 'old', views: 10_000 },
    ],
  };
  const snap = {
    keywordId: word.id,
    at: new Date(now).toISOString(),
    completedWindows: ['all'],
    items: [
      { id: 'a', views: 150, publishedAt: '2026-10-20' },
      { id: 'new', views: 90_000, publishedAt: '2026-10-20' },
    ],
  };
  assert.equal(
    summarizeSocial(snap, { '2026-10-19': base }).periods[0].change,
    50,
  );
  assert.equal(
    summarizeSocial(snap, { '2026-10-19': base }).periods[0].matchedCount,
    1,
  );
  snap.items[0].views = 90;
  assert.equal(
    summarizeSocial(snap, { '2026-10-19': base }).periods[0].change,
    null,
  );
});
test('readonly status permits researchers while writes require admin and complete ID selection', async () => {
  const io = fixture(),
    reader = { role: 'researcher' };
  assert.equal(
    (
      await trendAction(
        { action: 'server_keyword_trends_snapshot' },
        reader,
        io,
      )
    ).plan.enabled,
    false,
  );
  await assert.rejects(
    trendAction({ action: 'server_keyword_trends_collect' }, reader, io),
    /管理员/,
  );
  await assert.rejects(
    trendAction(
      {
        action: 'server_keyword_trends_collect',
        keywordIds: ['one', 'missing'],
        budgetAcknowledged: true,
      },
      { role: 'admin' },
      io,
    ),
    /未提交部分/,
  );
  assert.equal(io.values.size, 0);
});
test('manual and daily submissions are idempotent and share the same reserved request budget', async () => {
  const io = fixture();
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['tiktok'], { maxRequests: 1 }),
    now,
    'manual',
  );
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['tiktok'], { maxRequests: 1 }),
    now,
    'daily',
  );
  for (let n = 0; n < 6; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 1);
  const r = await io.db.read(`${P}run:${trendDay(now)}`);
  assert.equal(r.work.length, 4);
  assert.equal(r.work.filter((w) => w.status === 'skipped').length, 3);
});
test('running journal after restart is never replayed and blocks later paid calls that day', async () => {
  const io = fixture();
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  const r = await io.db.read(`${P}run:${trendDay(now)}`);
  await io.db.write(`${P}request:${trendDay(now)}:${r.work[0].key}`, {
    status: 'started',
  });
  for (let n = 0; n < 4; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 0);
  assert.ok(await io.db.read(`${P}gate:${trendDay(now)}`));
});
test('401,429 and unknown charges stop the shared paid channel without erasing successful data', async () => {
  for (const mode of ['401', '429', 'unknown']) {
    const io = fixture({
      fetch: async () => {
        if (mode !== 'unknown') {
          const e = new Error('private upstream text');
          e.status = Number(mode);
          throw e;
        }
        return { items: [], creditsCharged: null, hasMore: false };
      },
    });
    await enqueueTrendWork(
      io.db,
      [word],
      plan(['tiktok', 'facebook']),
      now,
      'manual',
    );
    await advanceTrendQueue(io);
    const gate = await io.db.read(`${P}gate:${trendDay(now)}`);
    assert.ok(gate);
    assert.ok(!JSON.stringify(gate).includes('private'));
  }
});
test('failed result transaction leaves started reservation; restarts never repeat the external request', async () => {
  const io = fixture();
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  io.db.commitResult = async () => {
    throw new Error('synthetic storage failure');
  };
  await advanceTrendQueue(io);
  await advanceTrendQueue(io);
  assert.equal(io.calls(), 1);
  assert.equal((await io.db.list(`${P}request:`))[0].value.status, 'started');
});
test('pagination is bounded, carries the actual cursor, and IG long windows wait for year search', async () => {
  const io = fixture({
    fetch: async () => ({
      items: [],
      creditsCharged: 1,
      hasMore: true,
      cursor: 'next',
    }),
  });
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['instagram'], { maxPages: 2 }),
    now,
    'manual',
  );
  await advanceTrendQueue(io);
  const r = await io.db.read(`${P}run:${trendDay(now)}`);
  assert.equal(r.work[1].page, 2);
  assert.equal(r.work[1].cursor, 'next');
  const s = await io.db.read(
    trendSnapshotName(word.id, 'instagram', trendDay(now)),
  );
  assert.deepEqual(s.completedWindows, ['week']);
});
test('paused plans create no automatic work and missing configuration consumes no reservation', async () => {
  const io = fixture({ key: async () => '' });
  await advanceTrendQueue(io);
  assert.equal(io.values.size, 0);
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  await advanceTrendQueue(io);
  assert.equal((await io.db.list(`${P}request:`)).length, 0);
});
test('daily schedule selects only current selected real keywords and never replays a prior day', async () => {
  const io = fixture({
    keywords: async () => [
      word,
      { ...word, id: 'excluded', reviewStatus: 'excluded' },
      { ...word, id: 'demo', dataNature: 'demo' },
    ],
  });
  await io.db.write(`${P}plan`, { ...plan(['google']), enabled: true });
  await advanceTrendQueue(io);
  await advanceTrendQueue(io);
  const r = await io.db.read(`${P}run:${trendDay(now)}`);
  assert.equal(r.work.length, 1);
  assert.equal(r.work[0].status, 'submitted');
  await advanceTrendQueue({ ...io, now: now + 86_400_000 });
  assert.equal((await io.db.list(`${P}run:`)).length, 2);
});
test('fetch uses only the fixed API origin, rejects redirects and handles HTTP failures without raw bodies', async () => {
  let observed;
  const work = { source: 'facebook', term: 'term', market: 'US', page: 1 };
  await assert.rejects(
    fetchSocialTrend(work, 'synthetic', async (url, options) => {
      observed = { url, options };
      return new Response('private error', { status: 429 });
    }),
    /HTTP 429/,
  );
  assert.equal(observed.url.origin, 'https://api.scrapecreators.com');
  assert.equal(observed.options.redirect, 'error');
});

test('next-day partial updates preserve last successful periods with their own dates', async () => {
  const io = fixture();
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  for (let n = 0; n < 4; n++) await advanceTrendQueue(io);
  const day2 = now + 86_400_000;
  await enqueueTrendWork(io.db, [word], plan(), day2, 'manual');
  await advanceTrendQueue({ ...io, now: day2 });
  const s = (await io.db.list(`${P}summary:`))[0].value;
  assert.equal(s.periods[0].stale, undefined);
  assert.equal(s.periods[1].stale, true);
  assert.equal(s.periods[1].count, 0);
  assert.equal(s.periods[1].collectedAt, new Date(now).toISOString());
});
