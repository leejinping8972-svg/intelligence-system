import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeEvidence,
  evidenceReport,
  validateModelReport,
  adEvidence,
  sourceUrl,
} from './research-evidence.mjs';
import { modelEndpoint } from './model-provider.mjs';
import { validateInsight, runInsightJob } from './insight-jobs.mjs';
import {
  catalogLinks,
  normalizeProduct,
  runProductsJob,
} from './product-jobs.mjs';
const url = 'https://www.reddit.com/r/Supplements/comments/abc/topic/';
test('comments preserve original text, deduplicate native IDs, and do not infer consumer country', () => {
  const r = normalizeEvidence(
    {
      comments: [
        { id: '1', body: 'Too expensive? How much sugar?', url: `${url}c1/` },
        { id: '1', body: 'Too expensive? How much sugar?', url: `${url}c1/` },
        { id: '2', body: '[deleted]', url },
      ],
    },
    { kind: 'reddit_comments', url, market: 'MX' },
  );
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].text, 'Too expensive? How much sugar?');
  assert.equal(r.records[0].market, 'MX');
  assert.match(r.records[0].marketBasis, /未证明/);
  assert.throws(
    () => normalizeEvidence({ items: [] }, { kind: 'reddit_comments' }),
    /未返回预期列表/,
  );
});
test('Reddit external-link posts retain canonical Reddit discussion URLs', () => {
  const r = normalizeEvidence(
    {
      posts: [
        {
          id: '1',
          title: 'Creatine gummies',
          url: 'https://shop.example/p',
          permalink: '/r/Supplements/comments/abc/topic/',
        },
      ],
    },
    { kind: 'reddit_search', market: 'US' },
  );
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].url, url);
});
test('many comments from one post do not become many independent sources', () => {
  const records = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    text: 'expensive price',
    url: `${url}${i}`,
    sourceUrl: url,
  }));
  const report = evidenceReport(records);
  assert.equal(report.sourceCount, 1);
  assert.match(report.confidence, /低/);
  assert.equal(report.themes[0].count, 40);
});
test('model conclusions must cite real evidence; no ungrounded findings accepted', () => {
  assert.throws(
    () =>
      validateModelReport(
        {
          summary: 'Great',
          findings: [{ label: 'Buy', evidenceIds: ['invented'] }],
        },
        [{ id: '1' }],
      ),
    /缺少有效证据/,
  );
  const report = validateModelReport(
    {
      summary: 'Questions',
      findings: [{ label: 'Price', evidenceIds: ['1', 'bad', '1'] }],
    },
    [{ id: '1' }],
  );
  assert.deepEqual(report.findings[0].evidenceIds, ['1']);
});
test('model endpoint and source inputs reject insecure or mismatched URLs', () => {
  assert.throws(() => modelEndpoint('http://localhost:8080/v1'));
  assert.throws(() => modelEndpoint('https://user:secret@example.com/v1'));
  assert.equal(
    modelEndpoint('https://example.com/v1/').pathname,
    '/v1/chat/completions',
  );
  assert.equal(sourceUrl('javascript:alert(1)'), '');
  assert.equal(
    sourceUrl('https://youtube.com.evil.example/a', ['youtube.com']),
    '',
  );
  assert.throws(() =>
    validateInsight({
      kind: 'consumer_research',
      market: 'US',
      sourceKind: 'youtube_comments',
      urls: url,
    }),
  );
});
test('ad claims have immutable text-specific evidence identity and separate analysis labels', () => {
  const ad = {
    id: 'a',
    copy: 'Save 20%, buy creatine gummies',
    evidenceUrl: 'https://facebook.com/ads/library/?id=123',
    market: 'US',
  };
  const a = adEvidence(ad),
    b = adEvidence({ ...ad, copy: 'Changed claim' });
  assert.notEqual(a.id, b.id);
  assert.equal(a.kind, 'advertiser_claim');
  assert.ok(
    evidenceReport([a], 'advertiser').themes.some((t) => t.key === 'offer'),
  );
});
function insightHarness(responses) {
  const docs = new Map(),
    saves = [];
  let calls = 0;
  return {
    docs,
    saves,
    get calls() {
      return calls;
    },
    io: {
      collect: async () => responses[calls++],
      read: async (key) => docs.get(key),
      put: async (key, value) => docs.set(key, structuredClone(value)),
      saveCheckpoint: async (job, cp, status) =>
        saves.push({ cp: structuredClone(cp), status }),
      cancelled: async () => false,
    },
  };
}
test('consumer pagination saves deduplicated evidence up to page cap despite legacy zero request cap', async () => {
  const record = {
    id: 'r1',
    text: 'price?',
    url,
    sourceUrl: url,
    platform: 'Reddit',
    kind: 'comment',
  };
  const h = insightHarness([
    { records: [record], cursor: 'next', creditsCharged: 1 },
    {
      records: [record, { ...record, id: 'r2' }],
      cursor: 'more',
      creditsCharged: 1,
    },
  ]);
  await runInsightJob(
    {
      id: 'job',
      input: {
        kind: 'consumer_research',
        market: 'US',
        title: 'Test',
        sourceKind: 'reddit_comments',
        urls: [url],
        maxPages: 2,
        maxRequests: 0,
        limit: 200,
      },
      checkpoint: {},
    },
    h.io,
  );
  const report = h.docs.get('insightReports:job');
  assert.equal(h.calls, 2);
  assert.equal(report.evidenceIds.length, 2);
  assert.equal(report.status, 'partial');
  assert.equal(report.creditsCharged, 2);
  assert.equal(report.statistics.sourceCount, 1);
});
test('cancelled jobs make no provider or model request and preserve cancellation status', async () => {
  const h = insightHarness([]);
  await runInsightJob(
    {
      id: 'job',
      input: {
        kind: 'consumer_research',
        market: 'US',
        title: 'Test',
        sourceKind: 'reddit_comments',
        urls: [url],
        maxPages: 2,
        maxRequests: 2,
        limit: 20,
      },
      checkpoint: {},
    },
    { ...h.io, cancelled: async () => true },
  );
  assert.equal(h.calls, 0);
  assert.equal(h.docs.get('insightReports:job').status, 'cancelled');
});
test('AI failure retains original evidence and reports a partial analysis', async () => {
  const h = insightHarness([]);
  h.docs.set('researchEvidence:1', { id: '1', text: 'price?', url });
  await runInsightJob(
    {
      id: 'job',
      input: {
        kind: 'evidence_analysis',
        market: 'US',
        title: 'Reanalysis',
        analyze: true,
        evidenceIds: ['1'],
      },
      checkpoint: {},
    },
    {
      ...h.io,
      analyzeRecords: async () => {
        throw new Error('Model quota');
      },
    },
  );
  assert.equal(h.docs.get('insightReports:job').status, 'partial');
  assert.match(h.docs.get('insightReports:job').modelError, /quota/);
  assert.equal(h.docs.get('insightReports:job').statistics.sampleSize, 1);
});
test('catalog traversal follows only same-host product, collection and sitemap links', () => {
  assert.deepEqual(
    catalogLinks(
      '<a href="/products/a">a</a><a href="https://evil.test/products/b">b</a><a href="/collections/all?page=2">next</a>',
      'https://shop.example/',
    ),
    [
      'https://shop.example/products/a',
      'https://shop.example/collections/all?page=2',
    ],
  );
  assert.deepEqual(
    catalogLinks(
      '<sitemapindex><sitemap><loc>https://shop.example/sitemap_products_1.xml</loc></sitemap></sitemapindex>',
      'https://shop.example/sitemap.xml',
      true,
    ),
    ['https://shop.example/sitemap_products_1.xml'],
  );
});
test('product identity ignores marketing parameters and unknown formulation is explicit', () => {
  const s = { id: 's', domain: 'shop.example', market: 'US', brand: 'B' },
    p = {
      title: 'Creatine',
      url: 'https://shop.example/products/a?utm_source=fb',
      currency: 'USD',
    };
  const a = normalizeProduct(p, s),
    b = normalizeProduct({ ...p, url: 'https://shop.example/products/a' }, s);
  assert.equal(a.id, b.id);
  assert.match(a.ingredient, /未公开/);
  assert.equal(a.imageUrl, undefined);
  assert.throws(
    () =>
      normalizeProduct(
        { ...p, url: 'https://other.example/products/a' },
        { ...s, domain: 'shop.example' },
      ),
    /不是当前独立站/,
  );
});
test('product crawl persists images as links and respects page cap', async () => {
  const docs = new Map(),
    saved = [];
  let calls = 0;
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Product',
      name: 'Creatine Gummies',
      url: 'https://shop.example/products/a',
      image: 'https://shop.example/a.jpg',
      offers: { price: 20, priceCurrency: 'USD' },
    }) +
    '</script><a href="/products/b">more</a>';
  await runProductsJob(
    {
      id: 'pjob',
      input: {
        records: [
          { id: 's', domain: 'shop.example', brand: 'B', market: 'US' },
        ],
        maxProducts: 100,
        maxRequests: 1,
        maxPagesPerSite: 1,
      },
      checkpoint: {},
    },
    {
      getHostGate: async () => ({}),
      setHostGate: async () => {},
      fetchPage: async (url) => {
        calls++;
        return { html, url };
      },
      saveCheckpoint: async (_j, cp, status) =>
        saved.push({ cp: structuredClone(cp), status }),
      mergeBusiness: async (k, v) => docs.set(k, v),
      patchSite: async (id, v) => docs.set(id, v),
      readProduct: async () => null,
      linkKeywords: async () => {},
      cancelled: async () => false,
    },
  );
  assert.equal(calls, 1);
  const p = [...docs.values()].find((v) => v.imageUrl);
  assert.equal(p.imageUrl, 'https://shop.example/a.jpg');
  assert.equal(docs.get('s').productCollection.status, 'partial');
  assert.equal(saved.at(-1).status, 'partial');
});
