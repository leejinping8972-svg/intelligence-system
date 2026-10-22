import test from 'node:test';
import assert from 'node:assert/strict';
import { formulaStatistics, opportunityRows, radarStatistics } from './model.js';
import { createPublicObservationReader, encodeStatistic, decodeStatistic } from './workspace-statistics.mjs';

test('compressed findings preserve every field and legacy rows remain readable', () => {
  const row = { id: 'radar-qa', title: '补充剂', evidence: Array.from({ length: 30 }, () => ({ detail: 'Evidence text '.repeat(100), url: 'https://example.com/product' })), score: null };
  const packed = encodeStatistic(row);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(row).length / 3);
  assert.deepEqual(decodeStatistic(packed), row);
  assert.equal(decodeStatistic(row), row);
});

test('formula totals cover the full dataset and do not mix unknown sales periods', () => {
  const products = Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, market: 'VN', siteId: 's', brand: i % 2 ? 'A' : 'B', reviewed: i < 10, ingredientInsights: [{ name: 'Magnesium' }], sourceMetrics: { reportedSales: 999999 } }));
  const summary = formulaStatistics(products);
  assert.equal(summary.coverage.total, 150);
  assert.equal(summary.coverage.observed, 150);
  assert.equal(summary.coverage.verified, 10);
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0].products, 150);
  assert.equal(summary.rows[0].score, 3020);
  products[0].formula = { fingerprint: 'verified-specific', status: 'verified', ingredients: [{ name: 'Vitamin D' }] };
  assert.equal(formulaStatistics(products).rows.length, 2);
});
test('radar statistics use every finding and include all activity dates', () => {
  const rows = Array.from({ length: 43 }, (_, i) => ({ type: i % 2 ? 'ad' : 'product', confidenceScore: 80, businessScore: i % 2 ? null : 60, firstSeenAt: '2026-10-22' }));
  const stats = radarStatistics(rows);
  assert.equal(stats.counts.product, 22);
  assert.equal(stats.counts.ad, 21);
  assert.equal(stats.counts.verified, 43);
  assert.equal(stats.averageScore, 60);
  assert.deepEqual(stats.activity['2026-10-22'], { product: 22, ad: 21 });
});
test('opportunity grouping preserves whole-dataset site counts and repeated titles', () => {
  const state = { products: Array.from({ length: 80 }, (_, i) => ({ id: `p${i}`, title: 'same', market: 'US', brand: 'A', siteId: 's', ingredient: 'Mg', category: 'Sleep' })), sites: [{ id: 's', brand: 'S', market: 'US' }], keywords: [] };
  assert.equal(opportunityRows(state, 'site')[0].count, 80);
  assert.equal(opportunityRows(state, 'ingredient')[0].count, 80);
  assert.equal(new Set(opportunityRows(state, 'new').map(r => r.id)).size, 80);
});
test('public feed cache makes no requests during TTL and keeps last good feed after outage', async (context) => {
  let requests = 0;
  let now = Date.now(), offline = false;
  context.mock.method(Date, 'now', () => now);
  const reader = createPublicObservationReader({ fetcher: async url => {
    requests++;
    if (offline) throw new Error('offline');
    return new Response(JSON.stringify(url.pathname.includes('free-') ? { signals: [] } : { observations: [] }));
  } });
  const first = await reader();
  assert.equal(requests, 2);
  assert.equal((await reader()), first);
  assert.equal(requests, 2);
  offline = true;
  now += 300_001;
  const stale = await reader();
  assert.deepEqual(stale.free, first.free);
  assert.equal(stale.freeStale, true);
  assert.equal((await reader()), stale);
  assert.equal(requests, 4);
  const unavailable = createPublicObservationReader({ fetcher: async () => { throw new Error('offline'); } });
  const result = await unavailable();
  assert.equal(result.free, null);
  assert.equal(result.freeStale, true);
});
