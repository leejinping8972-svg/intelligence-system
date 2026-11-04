import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoveryPlan,
  newProductEvidence,
} from './discovery-monitor-domain.mjs';
import { runDiscoveryMonitor } from './discovery-monitor-store.mjs';
import { requestSources, sourceCharge } from './source-usage-domain.mjs';
import {
  officialBoardUrl,
  defaultOfficialBoard,
} from './official-new-release-domain.mjs';
import {
  officialNewReleases,
  parseOfficialBoard,
  parseOfficialDetail,
  officialListingDate,
} from './official-new-releases.mjs';

const now = Date.parse('2026-11-05T01:00:00Z');
const request = {
  market: 'VN',
  sourceMarket: 'US',
  url: defaultOfficialBoard,
  now,
};
const plan = (patch = {}) =>
  discoveryPlan({
    kind: 'regular_new',
    market: 'VN',
    channels: ['amazon'],
    sourceMode: 'official_new_releases',
    sourceMarkets: { amazon: 'US' },
    ...patch,
  });
const asin = (i) => `B${String(i).padStart(9, '0')}`;
const board = (
  members = [1, 2],
  extra = '',
) => `<title>Amazon.com New Releases: Health</title>
  <div id="gridItemRoot"><span class="zg-bdg-text">#${members[0]}</span><div data-asin="${asin(members[0])}">
  <a href="/dp/${asin(members[0])}"><div class="p13n-sc-css-line-clamp-3">Synthetic dietary supplement</div></a>
  <span class="a-price"><span class="a-offscreen">JPY4,747</span></span></div></div>
  <div data-client-recs-list='${JSON.stringify(members.map((i) => ({ id: asin(i), metadataMap: { 'render.zg.rank': String(i) } })))}'></div>${extra}`;
const detail = (
  id,
  ships = '',
  sold = '',
) => `<input id="ASIN" value="${id}"><span id="productTitle">Synthetic dietary supplement</span>
 <div id="fulfillerInfoFeature_feature_div"><span class="offer-display-feature-text-message">${ships}</span></div>
 <div id="merchantInfoFeature_feature_div"><span class="offer-display-feature-text-message">${sold}</span></div>`;

test('new plans enforce official boards and separate 1000-product/5000-post limits', () => {
  assert.equal(plan({ maxProducts: 1000 }).maxProducts, 1000);
  assert.throws(() => plan({ maxProducts: 1001 }), /数量/);
  const ingredients = discoveryPlan({
    kind: 'ingredients',
    market: 'US',
    channels: ['reddit'],
    maxProducts: 5000,
    maxPages: 100,
  });
  assert.equal(ingredients.maxProducts, 5000);
  assert.equal(ingredients.sourceMode, 'sorftime');
  assert.throws(
    () => discoveryPlan({ ...ingredients, maxProducts: 5001 }),
    /数量/,
  );
  assert.equal(plan().sourceMode, 'official_new_releases');
  assert.deepEqual(plan().topics, []);
  assert.throws(() => plan({ channels: ['tiktok_shop'] }), /官方新品榜/);
  assert.throws(() => plan({ sourceMarkets: { amazon: 'MX' } }), /默认新品榜/);
  assert.equal(
    plan({
      sourceMarkets: { amazon: 'MX' },
      officialBoardUrls: ['https://www.amazon.com.mx/gp/new-releases/hpc/123'],
    }).sourceMarkets.amazon,
    'MX',
  );
  assert.throws(
    () => plan({ officialBoardUrls: Array(21).fill(defaultOfficialBoard) }),
    /20/,
  );
});

test('board URL guard rejects search, best sellers, other sites and cross-market pages', () => {
  for (const url of [
    'http://www.amazon.com/gp/new-releases/hpc',
    'https://www.amazon.com/gp/bestsellers/hpc',
    'https://www.amazon.com/s?k=supplements',
    'https://www.amazon.com.evil.test/gp/new-releases',
    'https://user@www.amazon.com/gp/new-releases',
    'https://www.amazon.com.mx/gp/new-releases',
    'https://www.amazon.com/gp/new-releases/hpc?pg=11',
  ])
    assert.throws(() => officialBoardUrl(url));
  assert.equal(
    officialBoardUrl(
      `${defaultOfficialBoard}/ref=zg_bsnr_pg_2_hpc?ie=UTF8&pg=2`,
    ),
    `${defaultOfficialBoard}?pg=2`,
  );
});

test('ranking cards and embedded memberships deduplicate; only the next page of the same board is followed', () => {
  const result = parseOfficialBoard(
    board(
      [1, 2],
      `<ul class="a-pagination"><a href="${defaultOfficialBoard}?pg=2">2</a><a href="https://evil.test/gp/new-releases?pg=2">Next</a></ul>`,
    ),
    request,
  );
  assert.equal(result.sourceRows, 2);
  assert.equal(result.items[0].product.sourceProvider, 'Amazon Official');
  assert.equal(result.items[0].product.sourceMarket, 'US');
  assert.equal(result.items[0].product.market, 'VN');
  assert.equal(result.items[0].product.price, 0);
  assert.equal(result.items[0].product.currency, '');
  assert.equal(result.items[1].product, undefined);
  assert.equal(result.nextUrl, `${defaultOfficialBoard}?pg=2`);
  const e = newProductEvidence(result.items[0].product, plan(), now);
  assert.equal(e.rank, 1);
  assert.equal(e.listingDate, undefined);
  assert.equal(e.days, undefined);
  assert.equal(e.evidenceUrl, defaultOfficialBoard);
});

test('blocked, non-ranking and empty pages produce a source failure instead of a successful zero result', () => {
  for (const html of [
    '<title>Robot Check</title>',
    '<title>Amazon.com</title>',
    '<title>Amazon.com New Releases</title><div data-client-recs-list="[]"></div>',
  ])
    assert.throws(() => parseOfficialBoard(html, request), /验证|新品榜|排名/);
});

test('FBM requires matching ships-from/seller evidence; seller alone and delivery restrictions stay unknown', () => {
  const ranking = parseOfficialBoard(board(), request).items[0].ranking;
  for (const [ships, sold, expected] of [
    ['', 'Synthetic Store', 'unknown'],
    ['Amazon.com', 'Synthetic Store', 'FBA'],
    ['Synthetic Store', 'Synthetic Store', 'FBM'],
    ['Unknown', 'Different Store', 'unknown'],
  ]) {
    const p = parseOfficialDetail(detail(asin(1), ships, sold), {
      ...request,
      asin: asin(1),
      ranking,
    }).product;
    assert.equal(p.resourceRaw.fulfillment, expected);
    assert.equal(
      Boolean(newProductEvidence(p, plan({ kind: 'fbm_new' }), now)),
      expected === 'FBM',
    );
  }
  assert.throws(
    () =>
      parseOfficialDetail(detail(asin(2)), {
        ...request,
        asin: asin(1),
        ranking,
      }),
    /不匹配/,
  );
});

test('public transport performs one guarded GET; redirects, HTTP errors and wrong response formats stop', async () => {
  const calls = [];
  const options = {
    schedule: (_key, cb) => cb(),
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(board(), {
        headers: { 'content-type': 'text/html' },
      });
    },
  };
  assert.equal((await officialNewReleases(request, options)).sourceRows, 2);
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(calls.length, 1);
  assert.deepEqual(
    requestSources('official-board:test', {
      requestUsage: { sources: ['official_new_releases'] },
    }),
    ['official_sites'],
  );
  assert.equal(
    sourceCharge('official_sites', { requests: 1 }, 'done').amount,
    1,
  );
  for (const response of [
    new Response('', {
      status: 302,
      headers: { location: 'https://evil.test/' },
    }),
    new Response('', { status: 429 }),
    Response.json({}),
  ])
    await assert.rejects(
      officialNewReleases(request, { ...options, fetch: async () => response }),
      /HTTP|HTML/,
    );
  await assert.rejects(
    officialNewReleases({ ...request, op: 'detail', asin: asin(1) }, options),
    /成员证据/,
  );
  await assert.rejects(
    officialNewReleases(request, {
      ...options,
      fetch: async () =>
        new Response('a'.repeat(4_000_001), {
          headers: { 'content-type': 'text/html' },
        }),
    }),
    /大小/,
  );
});

function runner(job, provider) {
  let status;
  const writes = [];
  const steps = [];
  let cancelled = false;
  const io = {
    now: () => now,
    pool: { query: async () => ({ rows: [{ cancelled }] }) },
    collect: async (j, step, r) => {
      steps.push({ step, r });
      return provider(j, step, r);
    },
    upsertProduct: async (p) => writes.push(p),
    saveCheckpoint: async (_j, cp, value) => {
      job.checkpoint = structuredClone(cp);
      status = value;
    },
  };
  return {
    writes,
    steps,
    io,
    cancel: () => {
      cancelled = true;
    },
    status: () => status,
    async finish() {
      for (
        let i = 0;
        i < 1500 && !['completed', 'partial', 'cancelled'].includes(status);
        i++
      )
        await runDiscoveryMonitor(job, io);
      return status;
    },
  };
}

test('official runner recovers embedded details, classifies supplements and never calls search/Sorftime', async () => {
  const job = { id: 'synthetic', input: { plan: plan() }, checkpoint: {} };
  const r = runner(job, async (_j, _step, req) => {
    if (req.sources[0] === 'field_analysis')
      return {
        analysis: { supplement: req.sample.title !== 'Never' },
        patch: {},
        model: 'synthetic',
      };
    assert.deepEqual(req.sources, ['official_new_releases']);
    assert.equal(req.topic, undefined);
    return req.op === 'detail'
      ? parseOfficialDetail(detail(req.asin), req)
      : parseOfficialBoard(board(), req);
  });
  assert.equal(await r.finish(), 'completed');
  assert.equal(r.writes.length, 2);
  assert.equal(r.steps.filter((v) => v.r.op === 'detail').length, 1);
  assert.equal(job.checkpoint.products, 2);
  assert.equal(r.writes[0].newProductClassifications[0].listingDate, undefined);
});

test('official runner stops at the candidate limit and honors cancellation before any request', async () => {
  const job = {
    id: 'synthetic',
    input: { plan: plan({ maxProducts: 1 }) },
    checkpoint: {},
  };
  const r = runner(job, async (_j, _s, req) =>
    req.sources[0] === 'field_analysis'
      ? { analysis: { supplement: true }, patch: {} }
      : parseOfficialBoard(
          board(
            [1, 2],
            `<div class="a-pagination"><a href="${defaultOfficialBoard}?pg=2">2</a></div>`,
          ),
          req,
        ),
  );
  assert.equal(await r.finish(), 'completed');
  assert.equal(r.writes.length, 1);
  assert.equal(r.steps.length, 2);
  const stopped = runner({ ...job, checkpoint: {} }, async () => {
    throw Error('must not run');
  });
  stopped.cancel();
  assert.equal(await stopped.finish(), 'cancelled');
  assert.equal(stopped.steps.length, 0);
});

test('unknown FBM fulfillment is retained as an explicit partial result and never classified or stored', async () => {
  const job = {
    id: 'synthetic',
    input: { plan: plan({ kind: 'fbm_new' }) },
    checkpoint: {},
  };
  const r = runner(job, async (_j, _s, req) =>
    req.op === 'detail'
      ? parseOfficialDetail(detail(req.asin), req)
      : parseOfficialBoard(board(), req),
  );
  assert.equal(await r.finish(), 'partial');
  assert.equal(r.writes.length, 0);
  assert.equal(job.checkpoint.skipped.fulfillmentUnknown, 2);
});

test('5000 ingredient posts are analyzed in bounded checkpointed batches without more source requests', async () => {
  const p = discoveryPlan({
    kind: 'ingredients',
    market: 'US',
    channels: ['reddit'],
    maxProducts: 5000,
  });
  const job = {
    id: 'synthetic',
    input: { plan: p },
    checkpoint: {
      products: 0,
      calls: 0,
      records: Array.from({ length: 5000 }, (_, i) => ({
        id: String(i),
        title: 'Synthetic',
        text: 'a'.repeat(3500),
      })),
    },
  };
  const offsets = [];
  const r = runner(job, async (_j, step, req) => {
    assert.deepEqual(req.sources, ['ingredient_analysis']);
    assert.ok(req.records.length <= 40);
    assert.ok(
      req.records.reduce((n, v) => n + v.title.length + v.text.length, 0) <=
        40000,
    );
    offsets.push(req.records[0].id);
    return { ingredients: [], model: 'synthetic' };
  });
  assert.equal(await r.finish(), 'completed');
  assert.equal(job.checkpoint.analysisOffset, 5000);
  assert.equal(new Set(offsets).size, offsets.length);
  assert.ok(offsets.length > 100);
});

test('ingredient batches merge repeated ingredients and count distinct findings', async () => {
  const p = discoveryPlan({
    kind: 'ingredients',
    market: 'US',
    channels: ['reddit'],
  });
  const job = {
    id: 'synthetic',
    input: { plan: p },
    checkpoint: {
      products: 0,
      calls: 0,
      work: [],
      records: Array.from({ length: 81 }, (_, i) => ({
        id: String(i),
        title: 'Synthetic',
        text: 'Synthetic inulin',
      })),
    },
  };
  const documents = new Map();
  const r = runner(job, async (_j, _step, req) => ({
    ingredients: [
      {
        key: 'inulin',
        name: 'inulin',
        mentions: req.records.map((v) => ({
          id: v.id,
          quote: 'Synthetic inulin',
          platform: 'reddit',
          url: 'https://www.reddit.com/synthetic',
          publishedAt: '2026-11-05',
        })),
      },
    ],
    model: 'synthetic',
  }));
  r.io.read = async (key) => documents.get(key);
  r.io.putDocument = async (_table, key, value) => documents.set(key, value);
  assert.equal(await r.finish(), 'completed');
  assert.equal(job.checkpoint.ingredients, 1);
  assert.equal(documents.size, 1);
  assert.equal([...documents.values()][0].mentionCount, 81);
});

test('30-day listing parser reads only explicit official date fields and rejects invalid dates', () => {
  assert.equal(officialListingDate('October 7, 2026'), '2026-10-07');
  assert.equal(officialListingDate('7 de octubre de 2026'), '2026-10-07');
  assert.equal(officialListingDate('February 30, 2026'), '');
  assert.equal(officialListingDate('yesterday'), '');
  const ranking = parseOfficialBoard(board(), request).items[0].ranking;
  const p = parseOfficialDetail(
    `${detail(asin(1))}<div id="detailBullets_feature_div"><li>Date First Available ‏ : ‎ October 7, 2026</li></div>`,
    { ...request, asin: asin(1), ranking },
  ).product;
  const strict = plan({ days: 30, requireListingDate: true });
  assert.equal(strict.requireListingDate, true);
  assert.equal(newProductEvidence(p, strict, now).listingDate, '2026-10-07');
  for (const date of ['2026-10-06', '2026-11-06', undefined]) {
    assert.equal(
      newProductEvidence(
        { ...p, decisionData: { listing: { date } } },
        strict,
        now,
      ),
      undefined,
    );
  }
});

test('30-day product runs read every official detail and filter old/missing dates before AI', async () => {
  for (const kind of ['regular_new', 'fbm_new']) {
    const job = {
      id: 'synthetic',
      input: { plan: plan({ kind, days: 30, requireListingDate: true }) },
      checkpoint: {},
    };
    const r = runner(job, async (_j, _s, req) => {
      if (req.sources[0] === 'field_analysis')
        return { patch: {}, analysis: { supplement: true } };
      if (req.op !== 'detail') return parseOfficialBoard(board([1, 2, 3]), req);
      const date =
        req.asin === asin(1)
          ? 'October 20, 2026'
          : req.asin === asin(2)
            ? 'August 16, 2026'
            : '';
      return parseOfficialDetail(
        `${detail(req.asin, 'Synthetic Store', 'Synthetic Store')}<div id="detailBullets_feature_div"><li>Date First Available: ${date}</li></div>`,
        req,
      );
    });
    assert.equal(await r.finish(), 'partial');
    assert.equal(r.writes.length, 1);
    assert.equal(r.steps.filter((v) => v.r.op === 'detail').length, 3);
    assert.equal(
      r.steps.filter((v) => v.r.sources[0] === 'field_analysis').length,
      1,
    );
    assert.equal(job.checkpoint.skipped.listingUnknown, 1);
    assert.equal(job.checkpoint.skipped.outsideWindow, 1);
    assert.equal(r.writes[0].newProductClassifications[0].days, 30);
  }
});
