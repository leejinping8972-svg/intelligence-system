import assert from 'node:assert/strict';
import test from 'node:test';
import { planWestmonthMetricsBackfill, westmonthBackfillPatch } from './westmonth-metrics-backfill.mjs';

const at = '2026-10-28T03:00:00Z';
const prior = '2026-10-27T00:00:00Z';
const product = (id) => ({ id: `VN-qa-${id}`, market: 'VN', siteId: 'VN-westmonth.com', title: 'QA item',
  evidenceUrl: `https://www.westmonth.com/products/${id}`, catalogListedAtRaw: '2026-10-10 09:47:07',
  catalogEvidenceUrl: 'https://api-x.westmonth.com/product-center/shop/products/load-list?source=rankings', lastCollectedAt: prior,
  imageUrl: 'https://oss.westmonth.com/products/images/SKU00052853/a.jpg', favorite: true, reviewed: true,
});

test('previously captured listing fills without requests and keeps the original observation time', async () => {
  const plan = await planWestmonthMetricsBackfill([{ ...product(1), sourceMetrics: { soldRaw: '100+' } }], {
    now: Date.parse(at), fetchPage: async () => { throw new Error('must not fetch'); },
  });
  assert.equal(plan.requests, 0);
  assert.equal(plan.listing, 1);
  assert.equal(plan.sales, 0);
  assert.equal(plan.entries[0].patch.decisionData.listing.collectedAt, prior);
  assert.equal(plan.entries[0].patch.decisionData.listing.date, '2026-10-10');
  assert.equal(plan.entries[0].patch.favorite, undefined);
});

test('catalog fills many exact products in one request and missing identities use bounded exact lookup', async () => {
  const calls = [];
  const plan = await planWestmonthMetricsBackfill([product(1), product(2), product(3)], {
    now: Date.parse(at), maxRequests: 2, fetchPage: async (url) => {
      calls.push(url);
      if (calls.length === 2) return { html: JSON.stringify({ code: 0, data: { id: 3, month_sale: '3000+', onsale_at: '2026-10-10 09:47:07' } }) };
      const rows = (calls.length === 1 ? [1,2] : [999,3]).map((id) => ({ product_id: id, product_name: 'QA item', month_sale: id * 1000, product_addtime: '2026-10-10 09:47:07' }));
      return { html: JSON.stringify({ code: 0, data: { page: 1, pagesize: 60, total: rows.length, data: rows } }) };
    },
  });
  assert.equal(plan.requests, 2);
  assert.equal(plan.listing, 3);
  assert.equal(plan.sales, 3);
  assert.deepEqual(plan.unresolvedSales, []);
  assert.equal(plan.entries[2].patch.sourceMetrics.soldRaw, '3000+');
});

test('rate limits stop further requests while still filling previously captured listing dates', async () => {
  let calls = 0;
  const plan = await planWestmonthMetricsBackfill([product(1), product(2)], {
    now: Date.parse(at), fetchPage: async () => { calls++; throw Object.assign(new Error('HTTP 429'), { status: 429 }); },
  });
  assert.equal(calls, 1);
  assert.equal(plan.listing, 2);
  assert.equal(plan.sales, 0);
  assert.equal(plan.unresolvedSales.length, 2);
});

test('backfill excludes other sites and markets and preserves existing verified fields', () => {
  const p = product(1);
  assert.equal(westmonthBackfillPatch({ ...p, siteId: 'US-other' }, {}, at), undefined);
  assert.equal(westmonthBackfillPatch({ ...p, market: 'US' }, {}, at), undefined);
  assert.equal(westmonthBackfillPatch({ ...p, evidenceUrl: 'https://evil.example/products/1' }, {}, at), undefined);
  const listing = { date: '2026-09-01', provider: 'Saved', platform: '西之月', market: 'VN', collectedAt: prior, evidenceUrl: p.evidenceUrl };
  assert.equal(westmonthBackfillPatch({ ...p, decisionData: { listing }, sourceMetrics: { soldRaw: '500+' } }, { sourceMetrics: { soldRaw: '3000+' } }, at), undefined);
});
