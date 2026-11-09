import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectionRange,
  matchesCollectionRange,
  resourceCollectionTime,
  productDiscoveryDay,
} from './collection-time.mjs';
import { admitMonitoredProduct } from './monitor-product-pool.mjs';
import { scanSite } from './competitor-monitor-providers.mjs';

test('collection range uses inclusive Shanghai calendar days and rejects invalid ranges', () => {
  assert.deepEqual(collectionRange('2026-11-09', '2026-11-09'), {
    from: '2026-11-08T16:00:00.000Z',
    to: '2026-11-09T16:00:00.000Z',
  });
  for (const value of ['2026-02-30', '2026-11-09x', {}, 'not-date'])
    assert.throws(() => collectionRange(value));
  assert.throws(() => collectionRange('2026-11-10', '2026-11-09'));
  assert.equal(
    matchesCollectionRange(
      'keywords',
      { collectedAt: '2026-11-08T15:59:59.999Z' },
      '2026-11-09',
      '2026-11-09',
    ),
    false,
  );
  assert.equal(
    matchesCollectionRange(
      'keywords',
      { collectedAt: '2026-11-08T16:00:00Z' },
      '2026-11-09',
      '2026-11-09',
    ),
    true,
  );
  assert.equal(
    matchesCollectionRange(
      'keywords',
      { collectedAt: '2026-11-09T15:59:59.999Z' },
      '2026-11-09',
      '2026-11-09',
    ),
    true,
  );
  assert.equal(
    matchesCollectionRange(
      'keywords',
      { collectedAt: '2026-11-09T16:00:00Z' },
      '2026-11-09',
      '2026-11-09',
    ),
    false,
  );
});
test('collection time matches displayed successful captures and never uses first-seen or publication', () => {
  assert.equal(
    resourceCollectionTime('products', {
      firstSeenAt: '2026-11-09',
      publishedAt: '2026-11-09',
    }),
    '',
  );
  assert.equal(
    resourceCollectionTime('ads', { firstSeenAt: '2026-11-09' }),
    '',
  );
  assert.equal(
    resourceCollectionTime('products', {
      lastCollectedAt: '2026-11-08',
      sourceMetrics: { collectedAt: '2026-11-09T01:00:00Z' },
      sourceContent: { collectedAt: 'invalid' },
    }),
    '2026-11-09T01:00:00.000Z',
  );
  assert.equal(
    resourceCollectionTime('sites', {
      lastCollectedAt: '2026-11-08',
      sourceEvidence: [{ collectedAt: '2026-11-09T02:00:00Z' }],
    }),
    '2026-11-09T02:00:00.000Z',
  );
  assert.equal(
    productDiscoveryDay({
      firstSeenAt: '2026-11-08T16:00:00Z',
      lastCollectedAt: '2026-11-10T10:00:00Z',
    }),
    '2026-11-09',
  );
});
const at = '2026-11-09T02:00:00.000Z';
const product = () => ({
  id: 'test',
  market: 'VN',
  firstSeenAt: at,
  decisionData: {
    listing: {
      date: '2026-11-05',
      provider: 'Public catalog',
      platform: '西之月',
      market: 'VN',
      collectedAt: at,
      evidenceUrl: 'https://shop.test/products/1',
    },
  },
  sourceMetrics: {
    soldRaw: '100+',
    soldProvider: 'Public catalog',
    soldPlatform: '西之月',
    soldSourceField: 'month_sale',
    soldEvidenceUrl: 'https://shop.test/products/1',
    soldCollectedAt: at,
    collectedAt: at,
  },
});
test('monitor admits recent source listing plus positive same-capture sales, including baseline observations', () => {
  const item = product();
  const result = admitMonitoredProduct(null, item, item, Date.parse(at));
  assert.equal(result.newProductClassifications[0].type, 'new_listing');
  assert.equal(result.newProductClassifications[0].salesEvidence.value, 100);
  assert.equal(result.newProductClassifications[0].listingDate, '2026-11-05');
  assert.equal(
    admitMonitoredProduct(result, result, item, Date.parse(at)),
    result,
  );
});
test('monitor rejects unknown/old/future dates, exposure, ratings, stale sales and zero sales', () => {
  const mutators = [
    (p) => delete p.decisionData,
    (p) => (p.decisionData.listing.date = '2026-10-20'),
    (p) => (p.decisionData.listing.date = '2026-11-09'),
    (p) => (p.decisionData.listing.dateBasis = 'exposure'),
    (p) => (p.sourceMetrics.soldRaw = '0+'),
    (p) => (p.sourceMetrics.soldRaw = 'invalid'),
    (p) => delete p.sourceMetrics.soldSourceField,
    (p) => (p.sourceMetrics.soldPlatform = 'other-platform'),
    (p) => (p.sourceMetrics.soldProvider = 'other-source'),
    (p) => {
      p.sourceMetrics.soldCollectedAt = p.decisionData.listing.collectedAt =
        '2026-11-10T00:00:00Z';
    },
    (p) => (p.sourceMetrics.soldCollectedAt = '2026-11-08T02:00:00Z'),
    (p) => (p.sourceMetrics.soldEvidenceUrl = 'javascript:alert(1)'),
    (p) => {
      delete p.sourceMetrics.soldRaw;
      p.sourceMetrics.ratingCount = 5;
    },
  ];
  for (const mutate of mutators) {
    const p = product();
    mutate(p);
    assert.equal(admitMonitoredProduct(null, p, p, Date.parse(at)), p);
  }
});
test('monitor prunes persisted and newly discovered asset links without consuming page budget', async () => {
  const calls = [];
  const result = await scanSite(
    { id: 's', domain: 'shop.test', market: 'US' },
    async (k, call) => call(),
    1,
    async (url) => {
      calls.push(url);
      return {
        url,
        html:
          '<script type="application/ld+json">' +
          JSON.stringify({
            '@type': 'Product',
            name: 'Product',
            url: 'https://shop.test/products/1',
          }) +
          '</script><a href="/cdn/shop/products/a.css">CSS</a><a href="/products/1.oembed">Embed</a>',
      };
    },
    {
      queue: [
        'https://shop.test/cdn/shop/products/a.css',
        'https://shop.test/products/1.oembed',
        'https://shop.test/products/1',
      ],
      visited: [],
    },
    async () => {},
  );
  assert.deepEqual(calls, ['https://shop.test/products/1']);
  assert.equal(result.items.length, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.errors, []);
});
