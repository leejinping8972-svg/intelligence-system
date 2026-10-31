import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dayKey,
  due,
  extractLaunchTerms,
  mergeObserved,
  rankHotwords,
  validateHotwords,
  validateSchedule,
} from './competitor-monitor-domain.mjs';
import {
  executeHotwords,
  executeMonitor,
} from './competitor-monitor-engine.mjs';
import {
  fetchHotwordSeed,
  scanAdvertiser,
  scanSite,
} from './competitor-monitor-providers.mjs';

test('schedule uses Beijing day boundaries and does not rerun the same day', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(dayKey(now - 8 * 3600000 - 1), '2026-10-19');
  assert.equal(dayKey(now), '2026-10-20');
  assert.ok(due({ enabled: true, hour: 8 }, null, now));
  assert.ok(!due({ enabled: true, hour: 9 }, null, now));
  assert.ok(!due({ enabled: true, hour: 8 }, { day: '2026-10-20' }, now));
  assert.ok(!due({ enabled: false, hour: 8 }, null, now));
});
test('schedule validation retains page bounds and ignores legacy request caps', () => {
  assert.equal(validateSchedule({ maxRequests: 0 }).maxRequests, undefined);
  assert.throws(() => validateSchedule({ maxPages: 0 }));
  assert.throws(() => validateSchedule({ hour: 24 }));
  assert.throws(() => validateHotwords({ market: 'GB', seeds: ['collagen'] }));
  assert.throws(() => validateHotwords({ market: 'US', seeds: [] }));
  const v = validateHotwords({
    market: 'US',
    seeds: ['collagen', 'collagen', 'magnesium'],
    maxRequests: 100,
  });
  assert.equal(v.maxRequests, undefined);
  assert.equal(v.unitLimit, 0);
});
test('ranking deduplicates, preserves missing data and limits to top100', () => {
  const rows = Array.from({ length: 110 }, (_, i) => ({
    term: `word ${i}`,
    volume: i,
  }));
  rows.push(
    { term: 'WORD 109', volume: 200 },
    { term: 'unknown', volume: undefined },
  );
  const r = rankHotwords(rows, [{ term: 'WORD 109', rank: 4 }]);
  assert.equal(r.length, 100);
  assert.equal(r[0].volume, 200);
  assert.equal(r[0].change, 3);
  assert.equal(r[1].change, null);
  assert.equal(r.filter((s) => s.term.toLowerCase() === 'word 109').length, 1);
});
test('lexical extraction uses observable text, includes novel product titles', () => {
  const terms = extractLaunchTerms({
    title: 'BrandX Creatine Gummies 300 mg',
    brand: 'BrandX',
    copy: 'With magnesium glycinate',
  });
  assert.ok(terms.includes('creatine gummies'));
  assert.ok(terms.includes('magnesium glycinate'));
  assert.ok(!terms.some((s) => s.includes('300')));
  assert.ok(
    extractLaunchTerms({
      title: 'BrandX Urolithin A',
      brand: 'BrandX',
    }).includes('urolithin a'),
  );
  assert.deepEqual(extractLaunchTerms({}), []);
});
test('observations preserve manual decisions and original first seen', () => {
  const old = {
    favorite: true,
    reviewed: true,
    firstSeenAt: 'old',
    productIds: ['keep'],
  };
  const value = mergeObserved(
    old,
    { favorite: false, firstSeenAt: 'now', title: 'x' },
    'now',
  );
  assert.equal(value.favorite, true);
  assert.equal(value.firstSeenAt, 'old');
  assert.deepEqual(value.productIds, ['keep']);
});

function monitorFixture({
  baseline = false,
  complete = true,
  seen = [],
  failure = false,
} = {}) {
  const events = [],
    saved = [],
    baselines = [],
    requests = [];
  const io = {
    at: '2026-10-20T00:00:00Z',
    day: '2026-10-20',
    saveRun: async (r) => saved.push(structuredClone(r)),
    baseline: async () => baseline,
    setBaseline: async (k) => baselines.push(k),
    seen: async (_k, id) => seen.includes(id),
    persist: async (kind, item, event) => events.push({ kind, item, event }),
    request: async (key, call) => {
      requests.push(key);
      return call();
    },
    scan: async (kind, request) => {
      await request(kind, async () => {
        if (failure) throw new Error('HTTP 429');
      });
      return {
        items: [
          {
            id: kind,
            title: 'Creatine gummies',
            evidenceUrl: 'https://example.com/products/x',
          },
        ],
        complete,
        errors: [],
      };
    },
  };
  return { io, events, saved, baselines, requests };
}
test('first full scan stores baseline observations without launch keywords', async () => {
  const f = monitorFixture();
  const run = await executeMonitor(
    { id: 'one', siteId: 's', pageId: '1', maxRequests: 2 },
    f.io,
  );
  assert.equal(run.added, 0);
  assert.equal(f.events.length, 2);
  assert.ok(f.events.every((e) => e.event === null));
  assert.deepEqual(f.baselines, ['products', 'ads']);
});
test('partial initial scan never establishes an alleged complete baseline', async () => {
  const f = monitorFixture({ complete: false });
  const run = await executeMonitor(
    { id: 'one', siteId: 's', maxRequests: 2 },
    f.io,
  );
  assert.equal(run.status, 'partial');
  assert.deepEqual(f.baselines, []);
  assert.equal(run.added, 0);
});
test('incremental scan creates evidence and keywords for unseen items only', async () => {
  const f = monitorFixture({ baseline: true, seen: ['ads'] });
  const run = await executeMonitor(
    { id: 'one', market: 'US', siteId: 's', pageId: '1', maxRequests: 2 },
    f.io,
  );
  assert.equal(run.added, 1);
  assert.equal(f.events[0].event.label, '竞品上新');
  assert.ok(f.events[0].event.terms.includes('creatine gummies'));
  assert.equal(f.events[1].event, null);
});
test('site and advertiser scans both run beyond a legacy shared request cap', async () => {
  const f = monitorFixture({ baseline: true });
  const run = await executeMonitor(
    { id: 'one', siteId: 's', pageId: '1', maxRequests: 1 },
    f.io,
  );
  assert.equal(run.requests, 2);
  assert.equal(run.status, 'completed');
  assert.equal(f.requests.length, 2);
});
test('upstream errors cannot become successful empty scans', async () => {
  const f = monitorFixture({ failure: true });
  const run = await executeMonitor(
    { id: 'one', pageId: '1', maxRequests: 1 },
    f.io,
  );
  assert.equal(run.status, 'failed');
  assert.deepEqual(f.baselines, []);
});
test('crash before request journal save never starts paid call', async () => {
  const f = monitorFixture();
  f.io.request = async () => {
    throw new Error('journal disk failure');
  };
  const run = await executeMonitor(
    { id: 'one', pageId: '1', maxRequests: 1 },
    f.io,
  );
  assert.equal(run.status, 'failed');
  assert.equal(f.events.length, 0);
});

function hotFixture({ failureAt = -1, unknown = false, empty = false } = {}) {
  const saved = [],
    rankings = [];
  let calls = 0;
  const io = {
    at: 'now',
    day: '2026-10-20',
    saveRun: async (r) => saved.push(structuredClone(r)),
    previous: async () => ({ rows: [{ term: 'collagen', rank: 3 }] }),
    saveRanking: async (r) => rankings.push(r),
    request: async (_key, call) => call(),
    fetchSeed: async (seed, request) =>
      request(seed, async () => {
        if (calls++ === failureAt) throw new Error('HTTP 403');
        return {
          rows: empty ? [] : [{ term: seed, volume: 100 }],
          apiUnits: unknown ? null : 20,
        };
      }),
  };
  return { io, saved, rankings, calls: () => calls };
}
test('hotwords reserve known worst-case units before every request', async () => {
  const f = hotFixture();
  const run = await executeHotwords(
    { seeds: ['collagen', 'magnesium'], unitLimit: 1, maxRequests: 2 },
    f.io,
  );
  assert.equal(run.status, 'completed');
  assert.equal(run.reservedUnits, 4000);
  assert.equal(run.confirmedUnits, 40);
  assert.equal(f.rankings[0].rows[0].change, 2);
  assert.equal(f.saved[1].requests, 1);
});
test('hotwords process all configured seeds despite old request and unit caps', async () => {
  const f = hotFixture();
  const run = await executeHotwords(
    { seeds: ['collagen', 'magnesium'], unitLimit: 2000, maxRequests: 1 },
    f.io,
  );
  assert.equal(f.calls(), 2);
  assert.equal(run.status, 'completed');
});
test('unknown billing stops subsequent Semrush calls', async () => {
  const f = hotFixture({ unknown: true });
  const run = await executeHotwords(
    { seeds: ['a', 'b'], unitLimit: 4000, maxRequests: 2 },
    f.io,
  );
  assert.equal(f.calls(), 1);
  assert.equal(run.unknownCharges, 1);
  assert.equal(run.status, 'partial');
});
test('failed hotwords retain previous ranking instead of replacing with empty', async () => {
  const f = hotFixture({ failureAt: 0 });
  const run = await executeHotwords(
    { seeds: ['a', 'b'], unitLimit: 4000, maxRequests: 2 },
    f.io,
  );
  assert.equal(run.status, 'failed');
  assert.equal(f.calls(), 1);
  assert.equal(f.rankings.length, 0);
});
test('empty reports do not fabricate 100 keywords', async () => {
  const f = hotFixture({ empty: true });
  const run = await executeHotwords(
    { seeds: ['a'], unitLimit: 2000, maxRequests: 1 },
    f.io,
  );
  assert.equal(run.status, 'empty');
  assert.equal(run.count, 0);
  assert.equal(f.rankings.length, 0);
});
test('advertiser scan uses exact Page ID and retains cursor truncation', async () => {
  const result = await scanAdvertiser(
    { pageId: '123', market: 'US' },
    async (_k, f) => f(),
    1,
    async (input) => {
      assert.equal(input.pageId, '123');
      assert.equal(input.adStatus, 'ALL');
      return {
        ads: [
          { id: 'a', pageId: '123' },
          { id: 'wrong', pageId: '456' },
        ],
        cursor: 'next',
      };
    },
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.complete, false);
});
test('advertiser repeated cursors fail instead of infinite paging', async () => {
  const result = await scanAdvertiser(
    { pageId: '123' },
    async (_k, f) => f(),
    4,
    async () => ({ ads: [], cursor: 'repeat' }),
  );
  assert.equal(result.complete, false);
  assert.match(result.errors[0], /重复游标/);
});
test('large site catalogs resume remaining pages on later days', async () => {
  const site = { id: 's', domain: 'example.com', market: 'US' };
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(url);
    return { url, html: '<html></html>' };
  };
  const first = await scanSite(site, async (_k, f) => f(), 1, fetchPage);
  assert.equal(first.complete, false);
  const second = await scanSite(
    site,
    async (_k, f) => f(),
    1,
    fetchPage,
    first.progress,
  );
  assert.equal(second.complete, true);
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0], calls[1]);
});
test('advertiser pagination resumes and preserves successful pages on later failure', async () => {
  const collect = async (input) => {
    if (input.cursor === 'next') throw new Error('HTTP 429');
    return { ads: [{ id: 'one', pageId: '123' }], cursor: 'next' };
  };
  const partial = await scanAdvertiser(
    { pageId: '123' },
    async (_k, f) => f(),
    2,
    collect,
  );
  assert.equal(partial.items.length, 1);
  assert.equal(partial.complete, false);
  assert.equal(partial.progress.cursor, 'next');
  const final = await scanAdvertiser(
    { pageId: '123' },
    async (_k, f) => f(),
    1,
    async (input) => {
      assert.equal(input.cursor, 'next');
      return { ads: [{ id: 'two', pageId: '123' }], cursor: '' };
    },
    partial.progress,
  );
  assert.equal(final.complete, true);
  assert.equal(final.items[0].id, 'two');
});
test('crawl checkpoint is not advanced before observations commit', async () => {
  const fixture = monitorFixture();
  let advanced = false;
  fixture.io.persist = async () => {
    throw new Error('synthetic transaction error');
  };
  fixture.io.saveProgress = async () => {
    advanced = true;
  };
  const run = await executeMonitor(
    { id: 'one', siteId: 's', maxRequests: 1 },
    fixture.io,
  );
  assert.equal(run.status, 'failed');
  assert.equal(advanced, false);
});
test('site crawler only stores verified same-site products', async () => {
  const site = {
    id: 's',
    domain: 'example.com',
    platform: 'Shopify',
    market: 'US',
  };
  const r = await scanSite(
    site,
    async (_k, f) => f(),
    1,
    async (url) => ({
      url,
      html: JSON.stringify({
        products: [
          {
            handle: 'collagen',
            title: 'Collagen',
            variants: [{ price: '20' }],
          },
        ],
      }),
    }),
  );
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].siteId, 's');
  assert.equal(r.complete, false);
  const redirect = await scanSite(
    site,
    async (_k, f) => f(),
    1,
    async () => ({ url: 'https://other.example/products/a', html: '' }),
  );
  assert.equal(redirect.items.length, 0);
  assert.ok(redirect.errors[0].includes('其他站点'));
});
test('Semrush schema checks precede paid execution and request top100 volume sort', async () => {
  const calls = [];
  const connect = async () => ({
    key: 'fake-qa-only',
    c: {
      rpc: async (_method, input) => {
        calls.push(input);
        return {
          structuredContent:
            input.name === 'get_report_schema'
              ? {
                  report: 'phrase_fullsearch',
                  parameters: {
                    database: { enum: ['us'] },
                    export_columns: { items: { enum: ['keyword', 'volume'] } },
                    display_sort: { enum: ['nq_desc'] },
                  },
                }
              : {
                  data: [{ Keyword: 'collagen', 'Search Volume': '200' }],
                  metadata: { usage: { api_units: 20 } },
                },
        };
      },
    },
  });
  const result = await fetchHotwordSeed(
    { market: 'US' },
    'collagen',
    async (_k, f) => f(),
    connect,
  );
  assert.equal(result.rows[0].volume, 200);
  assert.equal(calls[1].arguments.params.display_limit, 100);
  assert.equal(calls[1].arguments.params.display_sort, 'nq_desc');
  assert.equal(calls[1].arguments.params.phrase, 'collagen');
  await assert.rejects(
    () =>
      fetchHotwordSeed(
        { market: 'VN' },
        'collagen',
        async (_k, f) => f(),
        connect,
      ),
    /不支持/,
  );
  assert.equal(calls.length, 3);
});
