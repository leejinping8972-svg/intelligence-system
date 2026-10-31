import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAds,
  scrapeRequest,
  sealAdsKey,
  openAdsKey,
} from './ads-provider.mjs';
import {
  runMarketJob,
  validateMarketJob,
  verifyAdSite,
} from './market-jobs.mjs';
import { publicAddress, landingUrl } from './safe-web.mjs';
import { scoreSite } from './site-scoring.mjs';
import { domainMetrics } from './site-metrics.mjs';
test('normalizes nested Meta snapshots, deduplicates IDs and rejects platform destinations', () => {
  const r = { id: 'kw', term: 'creatine gummies', market: 'US' };
  const raw = {
    ad_archive_id: '123',
    page_name: 'Brand',
    is_active: true,
    snapshot: {
      body: { text: 'Gummies' },
      link_url: 'https://example.com/products/1',
      images: [{ original_image_url: 'https://cdn.example.com/1.jpg' }],
      cards: [{ link_url: 'https://facebook.com/brand' }],
    },
  };
  const data = normalizeAds(
    { searchResults: [raw, raw], credits_charged: 1 },
    r,
  );
  assert.equal(data.ads.length, 1);
  assert.deepEqual(data.ads[0].landingUrls, ['https://example.com/products/1']);
  assert.equal(data.ads[0].copy, 'Gummies');
  assert.equal(data.ads[0].status, '投放中');
  assert.equal(normalizeAds({ searchResults: [] }, r).creditsCharged, null);
  assert.throws(() => normalizeAds({}, r), /searchResults/);
});
test('public landing requests reject local and mapped addresses; non-http links are discarded', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.0.1',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(landingUrl('javascript:alert(1)'), null);
  assert.equal(landingUrl('http://localhost/api'), null);
  assert.equal(landingUrl('https://user:password@example.com/'), null);
});
test('provider secrets are authenticated and never included in redirect failures', async () => {
  const secret = Buffer.alloc(32, 3).toString('base64'),
    sealed = sealAdsKey('test-key-only', secret);
  assert.equal(openAdsKey(sealed, secret), 'test-key-only');
  assert.throws(() =>
    openAdsKey(sealed, Buffer.alloc(32, 4).toString('base64')),
  );
  await assert.rejects(
    scrapeRequest(
      '/v1/facebook/adLibrary/search/ads',
      {},
      'test-key-only',
      async () =>
        new Response('', {
          status: 302,
          headers: { location: 'https://other.example' },
        }),
    ),
    /HTTP 302/,
  );
});
test('site scoring distinguishes unknown, real zero, stale and wrong-market metrics', () => {
  const now = Date.now(),
    site = {
      keyword: 'creatine gummies',
      brand: 'Creatine gummies',
      mainProducts: ['creatine gummies'],
      signals: ['Product结构化数据'],
      confidence: 90,
      market: 'US',
    };
  assert.equal(scoreSite(site, now).coverage, 70);
  assert.equal(scoreSite(site, now).status, 'provisional');
  const metrics = {
    market: 'US',
    collectedAt: new Date(now).toISOString(),
    organicTraffic: 0,
  };
  assert.equal(scoreSite({ ...site, metrics }, now).coverage, 100);
  assert.equal(scoreSite({ ...site, metrics }, now).dimensions[2].value, 0);
  assert.equal(
    scoreSite({ ...site, metrics: { ...metrics, market: 'MX' } }, now).coverage,
    70,
  );
  assert.equal(
    scoreSite(
      {
        ...site,
        metrics: {
          ...metrics,
          collectedAt: new Date(now - 31 * 86400000).toISOString(),
        },
      },
      now,
    ).coverage,
    70,
  );
  const m = domainMetrics(
    {
      'Organic Traffic': '12000',
      'Organic Keywords': '',
      'Adwords Traffic': '0',
    },
    'US',
    'example.com',
    new Date(now).toISOString(),
  );
  assert.equal(m.organicTraffic, 12000);
  assert.equal(m.organicKeywords, undefined);
  assert.equal(m.paidTraffic, 0);
});
test('ad landing evidence must pass storefront validation', async () => {
  const ad = {
    brand: 'Brand',
    archiveId: '123',
    evidenceUrl: 'https://www.facebook.com/ads/library/?id=123',
  };
  const r = { id: 'k', market: 'US', term: 'creatine gummies' };
  await assert.rejects(
    verifyAdSite('https://example.com/', r, ad, async () => ({
      html: '<title>Blog</title>',
      url: 'https://example.com/',
    })),
    /电商验证/,
  );
  const site = await verifyAdSite('https://example.com/', r, ad, async () => ({
    html: '<title>Brand</title><script type="application/ld+json">{"@type":"Product","name":"Creatine Gummies"}</script><button>Add to cart</button>',
    url: 'https://example.com/',
  }));
  assert.equal(site.sources[0], 'Meta 广告库 / ScrapeCreators');
  assert.equal(site.sourceEvidence[0].adId, '123');
  assert.equal(site.id, 'US-example.com');
});
test('validates task bounds and rejects duplicate selected IDs', () => {
  assert.equal(
    validateMarketJob({ kind: 'ads', keywordIds: ['a'], maxRequests: 1001 }).maxRequests,
    undefined,
  );
  assert.equal(validateMarketJob({ kind: 'ads', keywordIds: ['a'] }).siteSearchPages, 1);
  for (const input of [
    { kind: 'ads', keywordIds: ['a', 'a'] },
    { kind: 'ads', keywordIds: [] },
    { kind: 'ads', keywordIds: ['a'], maxPages: 11 },
    { kind: 'ads', keywordIds: ['a'], siteSearchPages: 4 },
  ])
    assert.throws(() => validateMarketJob(input));
});
function harness(maxRequests = 1) {
  const docs = new Map(),
    states = [],
    calls = [];
  const job = {
    id: 'test-job',
    input: {
      kind: 'ads',
      records: [{ id: 'k', term: 'creatine gummies', market: 'US' }],
      maxAds: 100,
      maxPages: 3,
      maxSites: 10,
      maxRequests,
      adStatus: 'ACTIVE',
    },
    checkpoint: {},
  };
  const io = {
    isCancelled: async () => false,
    readKeyword: async () => ({ reviewStatus: 'selected' }),
    patchCollection: async () => {},
    readDoc: async (k) => docs.get(k),
    mergeBusiness: async (k, v) => {
      docs.set(k, { ...docs.get(k), ...v });
    },
    verifyAdSite: async () => ({
      id: 'US-example.com',
      domain: 'example.com',
      market: 'US',
    }),
    collect: async (j, step, req) => {
      calls.push(step);
      return req.sources[0] === 'ads'
        ? {
            ads: [
              { id: 'a', landingUrls: ['https://example.com/'], siteIds: [] },
            ],
            cursor: 'next',
            creditsCharged: 1,
          }
        : { metrics: { organicTraffic: 1 }, message: 'ok' };
    },
    saveCheckpoint: async (j, cp, status) => {
      states.push({ cp: structuredClone(cp), status });
    },
  };
  return { job, io, docs, states, calls };
}
test('legacy request caps do not stop pagination; page limits preserve ads and sites', async () => {
  const h = harness();
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls.filter((c) => c.startsWith('ads:')).length, 3);
  assert.ok(h.docs.has('ads:a'));
  assert.ok(h.docs.has('sites:US-example.com'));
  assert.equal(h.states.at(-1).status, 'completed');
  assert.equal(h.states.at(-1).cp.requests, 3);
});
test('cancellation ends the job without issuing requests', async () => {
  const h = harness();
  h.io.isCancelled = async () => true;
  await runMarketJob(h.job, h.io);
  assert.deepEqual(h.calls, []);
  assert.equal(h.states.at(-1).status, 'cancelled');
});

test('terminal partial and cancelled jobs clear only their own active keyword states', async () => {
  for (const cancelled of [false, true]) {
    const h = harness();
    const keywords = new Map([
      [
        'k',
        {
          reviewStatus: 'selected',
          adCollection: { jobId: h.job.id, status: 'queued', count: 0 },
        },
      ],
      [
        'other',
        {
          reviewStatus: 'selected',
          adCollection: { jobId: 'new-job', status: 'queued' },
        },
      ],
    ]);
    h.job.input.records.push({ id: 'other', term: 'other', market: 'US' });
    h.io.readKeyword = async (id) => keywords.get(id);
    h.io.patchCollection = async (id, field, patch) => {
      const k = keywords.get(id);
      k[field] = { ...k[field], ...patch };
    };
    h.io.isCancelled = async () => cancelled;
    await runMarketJob(h.job, h.io);
    assert.equal(
      keywords.get('k').adCollection.status,
      cancelled ? 'cancelled' : 'completed',
    );
    assert.equal(keywords.get('other').adCollection.status, 'queued');
  }
});
