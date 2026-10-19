/* eslint-disable vitest/no-import-node-test -- Backend suite uses node --test. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { runMarketJob, validateMarketJob } from './market-jobs.mjs';
import { jobTasks } from './runner.mjs';

const searchSite = (market = 'US', domain = 'brand.example') => ({
  id: `${market}-${domain}`,
  market,
  domain,
  brand: 'Brand',
  evidenceUrl: `https://www.${domain}/shop`,
  confidence: 90,
  lastCollectedAt: new Date().toISOString(),
  products: [{ title: 'not saved here' }],
});
function fixture(
  records = [{ id: 'k', term: 'gummy creatine', market: 'US' }],
) {
  const job = {
    id: 'combined',
    status: 'running',
    created_at: new Date().toISOString(),
    input: {
      ...validateMarketJob({
        kind: 'ads',
        keywordIds: records.map((r) => r.id),
        includeSearchSites: true,
        maxPages: 2,
        maxRequests: 2,
      }),
      records,
      markets: [...new Set(records.map((r) => r.market))],
    },
    checkpoint: {},
  };
  const keywords = new Map(
    records.map((r) => [
      r.id,
      {
        ...r,
        reviewStatus: 'selected',
        siteIds: [],
        siteCollection: { jobId: job.id, status: 'queued' },
        adCollection: { jobId: job.id, status: 'queued' },
      },
    ]),
  );
  const docs = new Map(),
    calls = [],
    saved = [],
    verified = [];
  const io = {
    isCancelled: async () => false,
    readKeyword: async (id) => structuredClone(keywords.get(id)),
    readDoc: async (key) => structuredClone(docs.get(key)),
    patchCollection: async (id, field, patch, extra) => {
      const k = keywords.get(id);
      if (k[field]?.jobId && k[field].jobId !== patch.jobId) return;
      k[field] = structuredClone(patch);
      k.siteIds = [...new Set([...k.siteIds, ...(extra?.siteIds || [])])];
    },
    mergeBusiness: async (key, patch) => {
      const old = docs.get(key) || {},
        value = { ...old, ...structuredClone(patch) };
      for (const field of [
        'sources',
        'sourceEvidence',
        'keywordIds',
        'siteIds',
      ]) {
        if (old[field] || patch[field])
          value[field] = [
            ...new Map(
              [...(old[field] || []), ...(patch[field] || [])].map((v) => [
                JSON.stringify(v),
                v,
              ]),
            ).values(),
          ];
      }
      docs.set(key, value);
    },
    collect: async (_job, step, request) => {
      calls.push({ step, request });
      if (request.sources[0] === 'site_discovery')
        return {
          groups: [
            {
              keyword: request.keywords[0],
              market: request.markets[0],
              sites: [searchSite(request.markets[0])],
              coverage: { searchResults: 1 },
            },
          ],
        };
      if (request.sources[0] === 'site_metrics')
        return { metrics: { organicTraffic: 123 }, message: 'fixture only' };
      return {
        ads: [
          {
            id: `${request.record.id}-ad`,
            archiveId: '123',
            landingUrls: ['https://brand.example/products/1'],
            evidenceUrl: 'https://www.facebook.com/ads/library/?id=123',
          },
        ],
        creditsCharged: 1,
      };
    },
    verifyAdSite: async (url, r) => {
      verified.push(url);
      return {
        ...searchSite(r.market),
        keywordIds: [r.id],
        sources: ['Meta 广告库 / ScrapeCreators'],
      };
    },
    saveCheckpoint: async (_job, checkpoint, status) =>
      saved.push({ checkpoint: structuredClone(checkpoint), status }),
  };
  return { job, io, keywords, docs, calls, saved, verified };
}

test('one submission runs both channels, merges domain and both evidence links, and reuses site validation/metrics', async () => {
  const h = fixture();
  await runMarketJob(h.job, h.io);
  assert.equal(h.saved.at(-1).status, 'completed');
  const site = h.docs.get('sites:US-brand.example');
  assert.deepEqual(site.sources, [
    'Brave Search',
    'Meta 广告库 / ScrapeCreators',
  ]);
  assert.equal(site.sourceEvidence.length, 2);
  assert.deepEqual(site.keywordIds, ['k']);
  assert.equal(site.products, undefined);
  assert.equal(h.docs.size, 2); // one site, one ad
  assert.equal(h.verified.length, 0);
  assert.equal(
    h.calls.filter((c) => c.request.sources[0] === 'site_metrics').length,
    1,
  );
  assert.deepEqual(h.keywords.get('k').siteIds, ['US-brand.example']);
  assert.equal(h.keywords.get('k').siteCollection.count, 1);
  assert.equal(h.keywords.get('k').siteCollection.status, 'completed');
  assert.equal(h.saved.at(-1).checkpoint.sites, 1);
  const task = jobTasks({ ...h.job, checkpoint: h.saved.at(-1).checkpoint })[0];
  assert.match(task.title, /双渠道/);
  assert.equal(task.collectionProgress.channels.length, 2);
});

test('a Brave failure still runs ads and preserves successful ad sites with partial task status', async () => {
  const h = fixture(),
    collect = h.io.collect;
  h.io.collect = async (job, step, req) => {
    if (req.sources[0] === 'site_discovery') throw new Error('HTTP 429');
    return collect(job, step, req);
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.saved.at(-1).status, 'partial');
  assert.ok(h.docs.has('ads:k-ad'));
  assert.deepEqual(h.keywords.get('k').siteIds, ['US-brand.example']);
  assert.equal(h.keywords.get('k').adCollection.status, 'completed');
  assert.match(h.saved.at(-1).checkpoint.logs.join(' '), /Brave Search 失败/);
});

test('an ads failure does not discard Brave results or leave queued states', async () => {
  const h = fixture(),
    collect = h.io.collect;
  h.io.collect = async (job, step, req) => {
    if (req.sources[0] === 'ads') throw new Error('ScrapeCreators HTTP 400');
    return collect(job, step, req);
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.saved.at(-1).status, 'partial');
  assert.ok(h.docs.has('sites:US-brand.example'));
  assert.equal(h.keywords.get('k').siteCollection.status, 'partial');
  assert.equal(h.keywords.get('k').adCollection.status, 'partial');
  assert.match(
    h.saved.at(-1).checkpoint.logs.join(' '),
    /ScrapeCreators HTTP 400/,
  );
});

test('same domain stays separated by market and retains each keyword link', async () => {
  const h = fixture([
    { id: 'us', term: 'creatine', market: 'US' },
    { id: 'mx', term: 'creatina', market: 'MX' },
  ]);
  await runMarketJob(h.job, h.io);
  assert.ok(h.docs.has('sites:US-brand.example'));
  assert.ok(h.docs.has('sites:MX-brand.example'));
  assert.deepEqual(h.docs.get('sites:MX-brand.example').keywordIds, ['mx']);
  assert.equal(h.saved.at(-1).checkpoint.sites, 2);
});

test('ads request budget is independent: exhausting it preserves search for every selected keyword', async () => {
  const h = fixture([
    { id: 'a', term: 'a', market: 'US' },
    { id: 'b', term: 'b', market: 'US' },
  ]);
  h.job.input.maxRequests = 1;
  await runMarketJob(h.job, h.io);
  assert.equal(
    h.calls.filter((c) => c.request.sources[0] === 'site_discovery').length,
    2,
  );
  assert.equal(h.calls.filter((c) => c.request.sources[0] === 'ads').length, 1);
  assert.equal(h.saved.at(-1).status, 'partial');
  assert.deepEqual(h.docs.get('sites:US-brand.example').keywordIds, ['a', 'b']);
  assert.equal(h.saved.at(-1).checkpoint.sites, 1);
});

test('resume between channels does not rerun completed searches or metrics', async () => {
  const h = fixture();
  await runMarketJob(h.job, h.io);
  const boundary = h.saved.find(
    (s) => s.checkpoint.search.status === 'completed' && !s.checkpoint.adStatus,
  );
  h.calls.length = 0;
  await runMarketJob({ ...h.job, checkpoint: boundary.checkpoint }, h.io);
  assert.deepEqual(
    h.calls.map((c) => c.request.sources[0]),
    ['ads'],
  );
  assert.equal(h.docs.get('sites:US-brand.example').sourceEvidence.length, 2);
});

test('resume after an ad page retains its cursor, request count and verified sites', async () => {
  const h = fixture(),
    collect = h.io.collect;
  h.io.collect = async (job, step, req) => {
    const result = await collect(job, step, req);
    if (req.sources[0] === 'ads' && !req.cursor) result.cursor = 'page-2';
    return result;
  };
  await runMarketJob(h.job, h.io);
  const boundary = h.saved.find(
    (s) =>
      s.checkpoint.advertising.page === 1 &&
      s.checkpoint.adStatus === 'running',
  );
  assert.ok(boundary);
  h.calls.length = 0;
  await runMarketJob({ ...h.job, checkpoint: boundary.checkpoint }, h.io);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].request.cursor, 'page-2');
  assert.equal(h.saved.at(-1).checkpoint.requests, 2);
  assert.equal(h.saved.at(-1).checkpoint.ads, 1);
  assert.equal(h.keywords.get('k').siteCollection.count, 1);
});

test('cancel before execution clears both states without requests; newer job ownership survives', async () => {
  const h = fixture();
  h.io.isCancelled = async () => true;
  h.keywords.get('k').adCollection = { jobId: 'newer', status: 'queued' };
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls.length, 0);
  assert.equal(h.saved.at(-1).status, 'cancelled');
  assert.equal(h.keywords.get('k').siteCollection.status, 'cancelled');
  assert.equal(h.keywords.get('k').adCollection.status, 'queued');
  assert.equal(h.saved.at(-1).checkpoint.channels[0].status, 'cancelled');
});

test('removed selections make no requests and do not remain queued when reselected later', async () => {
  const h = fixture();
  h.keywords.get('k').reviewStatus = 'pending';
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls.length, 0);
  assert.equal(h.keywords.get('k').siteCollection.status, 'cancelled');
  assert.equal(h.keywords.get('k').adCollection.status, 'cancelled');
});

test('new channel flag is explicit and bounded; historical ad-only jobs keep their limits', () => {
  assert.equal(
    validateMarketJob({ kind: 'ads', keywordIds: ['a'], maxSites: 20 })
      .includeSearchSites,
    false,
  );
  for (const input of [
    { kind: 'ads', keywordIds: ['a'], includeSearchSites: 'true' },
    { kind: 'ads', keywordIds: ['a'], includeSearchSites: true, maxSites: 20 },
    { kind: 'site_metrics', siteIds: ['s'], includeSearchSites: true },
  ])
    assert.throws(() => validateMarketJob(input));
});

test('cancel during search retains returned sites and starts no further paid calls', async () => {
  const h = fixture(),
    collect = h.io.collect;
  let cancelled = false;
  h.io.isCancelled = async () => cancelled;
  h.io.collect = async (...args) => {
    const result = await collect(...args);
    cancelled = true;
    return result;
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.saved.at(-1).status, 'cancelled');
  assert.ok(h.docs.has('sites:US-brand.example'));
  assert.deepEqual(h.keywords.get('k').siteIds, ['US-brand.example']);
  assert.equal(h.calls.length, 1);
  assert.equal(h.keywords.get('k').siteCollection.status, 'cancelled');
  assert.equal(h.keywords.get('k').adCollection.status, 'cancelled');
});
