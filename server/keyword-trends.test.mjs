/* eslint-disable vitest/no-import-node-test, unicorn/no-await-expression-member -- Standalone Node regressions and async fixture assertions. */
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
const plan = (sources = ['tiktok'], extra = {}) => ({
  ...defaultTrendPlan,
  sources,
  ...extra,
});
const response = (items = [], extra = {}) => ({
  items,
  creditsCharged: 1,
  hasMore: false,
  exhausted: true,
  discardedCount: 0,
  coverage: '合成公开样本',
  ...extra,
});
const item = (id, date) => ({ id, publishedAt: date, views: 999_999 });
const snap = (items, history) => ({
  keywordId: word.id,
  term: word.term,
  market: word.market,
  source: 'tiktok',
  comparisonVersion: 2,
  at: new Date(now).toISOString(),
  anchorAt: new Date(now).toISOString(),
  items,
  history: history ?? { exhausted: true },
});
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
      const previous = structuredClone(values);
      try {
        await fn();
      } catch (error) {
        values.clear();
        for (const [k, v] of previous) values.set(k, v);
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
    submitGoogle: async () => ({ id: 'fake-google-job' }),
    ...overrides,
    fetch: async (...args) => {
      calls++;
      return overrides.fetch ? overrides.fetch(...args) : response();
    },
    calls: () => calls,
  };
}
function archive() {
  const rows = [],
    end = Date.parse('2026-10-20T16:00:00Z');
  for (let at = Date.parse('2025-10-20T16:00:00Z'); at < end; at += 86_400_000)
    for (let n = 0; n < (at >= Date.parse('2026-07-20T16:00:00Z') ? 2 : 1); n++)
      rows.push(item(`${at}-${n}`, new Date(at + 3_600_000).toISOString()));
  return rows.toReversed();
}
test('plans default paused, use v2, and require explicit valid daily budgets', () => {
  assert.equal(defaultTrendPlan.enabled, false);
  assert.equal(defaultTrendPlan.comparisonVersion, 2);
  assert.throws(() => validateTrendPlan({ enabled: true }), /确认/);
  for (const bad of [
    { maxPages: 101 },
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
test('calendar periods include the requested two-month, six-month and year comparison history', () => {
  const w = socialWindows(now);
  assert.deepEqual(
    w.map((p) => p.start),
    ['2026-10-19', '2026-10-01', '2026-07-21', '2026-04-21'],
  );
  assert.deepEqual(
    w.map((p) => p.previousStart),
    ['2026-10-12', '2026-09-01', '2026-04-21', '2025-10-21'],
  );
  assert.equal(w[1].previousEnd, '2026-09-20');
  assert.equal(w[1].end, '2026-10-20');
  assert.equal(trendDay(Date.parse('2026-10-20T16:01:00Z')), '2026-10-21');
  assert.equal(
    socialWindows(Date.parse('2024-05-31T01:00:00Z'))[2].start,
    '2024-02-29',
  );
});
test('one versioned annual retrieval per social source supplies all four comparisons', () => {
  const work = buildTrendWork([word], defaultTrendPlan, now);
  assert.equal(work.length, 4);
  assert.ok(work.every((w) => w.historyStart === '2025-10-21'));
  assert.equal(
    socialRequest(work.find((w) => w.source === 'tiktok')).params.date_posted,
    'all-time',
  );
  assert.equal(
    socialRequest(work.find((w) => w.source === 'instagram')).params
      .date_posted,
    'last-year',
  );
  assert.equal(
    socialRequest(work.find((w) => w.source === 'facebook')).params.date_posted,
    undefined,
  );
});
test('first historical backfill immediately computes quarter and half-year changes without old snapshots', () => {
  const s = summarizeSocial(snap(archive()));
  assert.deepEqual(
    s.periods.map((p) => p.change),
    [0, 0, 100, 50.3],
  );
  assert.ok(s.periods.every((p) => p.previousComplete));
  assert.equal(s.periods[2].previousCount, 91);
  assert.equal(s.periods[2].count, 184);
  const altered = archive().map((i) => ({ ...i, views: 0 }));
  assert.deepEqual(summarizeSocial(snap(altered)).periods, s.periods);
});
test('actual publication timestamps, midnight boundaries and missing dates control comparisons', () => {
  const s = summarizeSocial(
    snap([
      item('start', '2026-10-18T16:00:00Z'),
      item('today', '2026-10-20T16:00:00Z'),
      item('old', '2026-09-01T01:00:00Z'),
    ]),
  );
  assert.equal(s.periods[0].count, 1);
  assert.equal(s.periods[1].count, 1);
  assert.equal(s.periods[1].change, 0);
  const missing = summarizeSocial(snap([item('missing', '')]));
  assert.equal(missing.undatedCount, 1);
  assert.ok(missing.periods.every((p) => p.change === null));
});
test('zero baselines never produce infinity or a fabricated 0 percent', () => {
  const s = summarizeSocial(snap([item('recent', '2026-10-20T01:00:00Z')]));
  assert.equal(s.periods[0].change, null);
  assert.equal(s.periods[0].state, 'zero_base');
  assert.ok(summarizeSocial(snap([])).periods.every((p) => p.change === null));
});
test('truncated and unsorted discovery cannot create false equal capped counts or historical completion', () => {
  const rows = [item('recent', '2026-10-20'), item('old', '2025-01-01')];
  assert.ok(
    summarizeSocial(
      snap(rows, { chronological: false, oldestAt: Date.parse('2025-01-01') }),
    ).periods.every((p) => p.change === null),
  );
  assert.equal(
    summarizeSocial(
      snap(rows, { chronological: true, oldestAt: Date.parse('2026-08-01') }),
    ).periods[2].state,
    'coverage_insufficient',
  );
});
test('TK flat/nested rows deduplicate and preserve known zero while detecting actual end-of-feed', () => {
  const r = {
    aweme_id: '1234567890123',
    create_time: now / 1000,
    statistics: { play_count: 0 },
  };
  const parsed = parseSocialResult(
    { source: 'tiktok' },
    {
      search_item_list: [{ aweme_info: r }, r],
      cursor: 0,
      has_more: 0,
      credits_charged: 1,
    },
  );
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].views, 0);
  assert.equal(parsed.items[0].comments, null);
  assert.equal(parsed.exhausted, true);
  assert.throws(() => parseSocialResult({ source: 'tiktok' }, {}), /结构异常/);
});
test('repeated/missing cursors are coverage errors rather than proof of complete history', () => {
  const videos = [
    {
      id: 'v',
      url: 'https://www.facebook.com/reel/123',
      creation_time: now / 1000,
    },
  ];
  assert.equal(
    parseSocialResult(
      { source: 'facebook', cursor: 'same' },
      { videos, cursor: 'same' },
    ).exhausted,
    false,
  );
  assert.match(
    parseSocialResult({ source: 'facebook' }, { videos, has_more: true })
      .paginationIssue,
    /游标/,
  );
  assert.equal(
    parseSocialResult({ source: 'facebook' }, { videos, cursor: null })
      .exhausted,
    true,
  );
  const ig = parseSocialResult(
    { source: 'instagram' },
    { reels: [{ id: 'a', url: 'https://evil.test/' }] },
  );
  assert.equal(ig.discardedCount, 1);
  assert.match(ig.coverage, /索引窗口/);
});
test('readers can inspect; writes require admin, confirmed budget and a complete valid keyword selection', async () => {
  const io = fixture();
  assert.equal(
    (
      await trendAction(
        { action: 'server_keyword_trends_snapshot' },
        { role: 'researcher' },
        io,
      )
    ).plan.enabled,
    false,
  );
  await assert.rejects(
    trendAction(
      { action: 'server_keyword_trends_collect' },
      { role: 'researcher' },
      io,
    ),
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
test('manual/daily work deduplicates and shares a hard daily budget across platforms', async () => {
  const io = fixture();
  for (const trigger of ['manual', 'daily'])
    await enqueueTrendWork(
      io.db,
      [word],
      plan(['tiktok', 'facebook'], { maxRequests: 1 }),
      now,
      trigger,
    );
  for (let n = 0; n < 4; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 1);
  const run = await io.db.read(`${P}run:${trendDay(now)}`);
  assert.equal(run.work.length, 2);
  assert.equal(run.work[1].status, 'skipped');
});
test('started requests and unknown fees from either version stop subsequent paid requests', async () => {
  for (const log of [
    { status: 'started' },
    { status: 'completed', creditsCharged: null },
  ]) {
    const io = fixture();
    await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
    await io.db.write(`${P}request:${trendDay(now)}:legacy-step`, log);
    await advanceTrendQueue(io);
    assert.equal(io.calls(), 0);
    assert.ok(await io.db.read(`${P}gate:${trendDay(now)}`));
  }
});
test('401,429 and missing charged credits stop the channel without exposing upstream raw messages', async () => {
  for (const mode of ['401', '429', 'unknown']) {
    const io = fixture({
      fetch: async () => {
        if (mode === 'unknown') return response([], { creditsCharged: null });
        const error = new Error('private text');
        error.status = Number(mode);
        throw error;
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
    await advanceTrendQueue(io);
    assert.equal(io.calls(), 1);
    assert.ok(
      !JSON.stringify(await io.db.read(`${P}gate:${trendDay(now)}`)).includes(
        'private',
      ),
    );
  }
});
test('transaction failure keeps a started reservation and restart never repeats its external call', async () => {
  const io = fixture();
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  io.db.commitResult = async () => {
    throw new Error('synthetic storage error');
  };
  await advanceTrendQueue(io);
  await advanceTrendQueue(io);
  assert.equal(io.calls(), 1);
  assert.equal((await io.db.list(`${P}request:`))[0].value.status, 'started');
});
test('one initial multi-page backfill immediately yields historical quarter and half-year comparisons', async () => {
  const rows = archive();
  const io = fixture({
    fetch: async (w) =>
      response(rows.slice((w.page - 1) * 250, w.page * 250), {
        hasMore: w.page * 250 < rows.length,
        exhausted: w.page * 250 >= rows.length,
        cursor: w.page + 1,
      }),
  });
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  for (let n = 0; n < 5; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 2);
  const s = (await io.db.list(`${P}summary:`))[0].value;
  assert.deepEqual(
    s.periods.map((p) => p.change),
    [0, 0, 100, 50.3],
  );
  assert.equal((await io.db.list(`${P}snapshot:`)).length, 1);
});
test('raising the cap explicitly resumes a new page without repeating the completed first request', async () => {
  const visited = [];
  const io = fixture({
    fetch: async (w) => {
      visited.push(w.page);
      return response(
        [item(String(w.page), w.page === 1 ? '2026-10-20' : '2025-01-01')],
        { hasMore: true, exhausted: false, cursor: w.page + 1 },
      );
    },
  });
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['tiktok'], { maxPages: 1 }),
    now,
    'manual',
  );
  await advanceTrendQueue(io);
  assert.equal(
    (await io.db.list(`${P}summary:`))[0].value.periods[3].state,
    'coverage_insufficient',
  );
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['tiktok'], { maxPages: 3 }),
    now,
    'manual',
  );
  await advanceTrendQueue(io);
  await advanceTrendQueue(io);
  assert.deepEqual(visited, [1, 2]);
});
test('a later incomplete backfill preserves prior successful percentages but keeps its task marked partial', async () => {
  const io = fixture({
    fetch: async () => response(archive()),
  });
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  await advanceTrendQueue(io);
  const nextDay = now + 86_400_000;
  io.now = nextDay;
  io.fetch = async () =>
    response([item('new-day', '2026-10-21')], {
      hasMore: true,
      exhausted: false,
      cursor: 2,
    });
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['tiktok'], { maxPages: 1 }),
    nextDay,
    'manual',
  );
  await advanceTrendQueue(io);
  const summary = (await io.db.list(`${P}summary:`))[0].value;
  assert.equal(summary.periods[2].change, 100);
  assert.equal(summary.periods[2].stale, true);
  assert.equal(summary.periods[2].collectedAt, new Date(now).toISOString());
  const run = await io.db.read(`${P}run:${trendDay(nextDay)}`);
  assert.equal(run.work[0].status, 'partial');
  assert.equal(run.work[0].nextCursor, 2);
});
test('cross-page duplicate IDs do not invalidate chronological history or inflate publication counts', async () => {
  const recent = item('recent', '2026-10-20'),
    middle = item('middle', '2026-07-01'),
    old = item('old', '2025-10-20');
  const io = fixture({
    fetch: async (w) =>
      response(w.page === 1 ? [recent, middle] : [recent, old], {
        hasMore: true,
        exhausted: false,
        cursor: w.page + 1,
      }),
  });
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  for (let n = 0; n < 4; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 2);
  const summary = (await io.db.list(`${P}summary:`))[0].value;
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.periods[3].previousComplete, true);
});
test('INS cannot request page12 even when the user cap is larger and FB cannot assume chronological order', async () => {
  const io = fixture({
    fetch: async (w) =>
      response([item(String(w.page), '2025-01-01')], {
        hasMore: true,
        exhausted: false,
        cursor: w.page + 1,
      }),
  });
  await enqueueTrendWork(
    io.db,
    [word],
    plan(['instagram'], { maxPages: 100 }),
    now,
    'manual',
  );
  for (let n = 0; n < 13; n++) await advanceTrendQueue(io);
  assert.equal(io.calls(), 11);
  assert.match(
    (await io.db.list(`${P}summary:`))[0].value.history.stopReason,
    /最多11页/,
  );
});
test('old playback percentages are hidden, old enabled plans are not auto-upgraded, and legacy jobs are not replayed', async () => {
  const io = fixture();
  await io.db.write(`${P}plan`, {
    ...plan(),
    enabled: true,
    comparisonVersion: 1,
  });
  await io.db.write(`${P}summary:legacy`, {
    keywordId: word.id,
    term: word.term,
    market: word.market,
    source: 'tiktok',
    periods: [{ count: 12, change: 999 }],
  });
  const before = await trendAction(
    { action: 'server_keyword_trends_snapshot' },
    { role: 'researcher' },
    io,
  );
  assert.equal(before.plan.enabled, false);
  assert.equal(before.requiresPlanReview, true);
  assert.equal(before.summaries[0].periods[0].change, null);
  await advanceTrendQueue(io);
  assert.equal(io.calls(), 0);
  assert.equal((await io.db.list(`${P}run:`)).length, 0);
});
test('paused plans make no calls, missing credentials spend no reservation, new plans schedule only selected real words', async () => {
  const io = fixture({ key: async () => '' });
  await advanceTrendQueue(io);
  assert.equal(io.values.size, 0);
  await enqueueTrendWork(io.db, [word], plan(), now, 'manual');
  await advanceTrendQueue(io);
  assert.equal((await io.db.list(`${P}request:`)).length, 0);
  const daily = fixture({
    keywords: async () => [
      word,
      { ...word, id: 'demo', dataNature: 'demo' },
      { ...word, id: 'excluded', reviewStatus: 'excluded' },
    ],
  });
  await daily.db.write(`${P}plan`, { ...plan(['google']), enabled: true });
  await advanceTrendQueue(daily);
  await advanceTrendQueue(daily);
  assert.equal(
    (await daily.db.read(`${P}run:${trendDay(now)}`)).work.length,
    1,
  );
  await advanceTrendQueue({ ...daily, now: now + 86_400_000 });
  assert.equal((await daily.db.list(`${P}run:`)).length, 2);
});
test('fetch stays on the fixed API host, refuses redirects and never exposes raw error bodies', async () => {
  let observed;
  await assert.rejects(
    fetchSocialTrend(
      { source: 'facebook', term: 'word', market: 'US', page: 1 },
      'synthetic',
      async (url, options) => {
        observed = { url, options };
        return new Response('private text', { status: 429 });
      },
    ),
    /HTTP 429/,
  );
  assert.equal(observed.url.origin, 'https://api.scrapecreators.com');
  assert.equal(observed.options.redirect, 'error');
});
