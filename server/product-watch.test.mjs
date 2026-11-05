import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dailyNewProductPlan,
  inNewProductPool,
  previousListingWindow,
} from './product-pool-domain.mjs';
import {
  discoveryPlan,
  newProductEvidence,
} from './discovery-monitor-domain.mjs';
import { discoverySorftime } from './discovery-sorftime.mjs';
import {
  observation,
  parseAmazonDaily,
  watchTrends,
} from './product-watch-domain.mjs';

const at = '2026-11-04T16:00:00Z';
test('previous seven complete Beijing dates and frozen evidence exclude today', () => {
  assert.deepEqual(previousListingWindow(7, Date.parse(at)), {
    start: '2026-10-29',
    end: '2026-11-04',
  });
  const original = {
    kind: 'regular_new',
    market: 'US',
    channels: ['amazon'],
    days: 30,
    frequency: 'weekly',
  };
  const plan = discoveryPlan(dailyNewProductPlan(original), true);
  assert.equal(original.days, 30);
  assert.equal(plan.time, '00:00');
  assert.equal(plan.frequency, 'daily');
  const p = (date) => ({
    decisionData: { listing: { date } },
    resourceRaw: { salesEvidence: { value: 1 } },
  });
  assert.ok(newProductEvidence(p('2026-10-29'), plan, Date.parse(at)));
  assert.ok(newProductEvidence(p('2026-11-04'), plan, Date.parse(at)));
  assert.equal(
    newProductEvidence(p('2026-11-05'), plan, Date.parse(at)),
    undefined,
  );
  assert.equal(
    newProductEvidence(p('2026-10-28'), plan, Date.parse(at)),
    undefined,
  );
  assert.equal(
    inNewProductPool({ newProductClassifications: [{ type: 'fbm_new' }] }),
    true,
  );
});

test('source date filters match local completed-day window and do not invent sales', async () => {
  const calls = [];
  const client = {
    tools: [
      {
        name: 'product_search',
        inputSchema: {
          type: 'object',
          properties: {
            amz_site: { type: 'string', enum: ['US'] },
            node_id: { type: 'string' },
            online_date_range_min: { type: 'string' },
            online_date_range_max: { type: 'string' },
            month_sale_volume_range_min: { type: 'integer' },
          },
        },
      },
    ],
    rpc: async (_, args) => {
      calls.push(args);
      return { content: [{ type: 'text', text: 'No data available.' }] };
    },
  };
  await discoverySorftime(
    {
      channel: 'amazon',
      market: 'US',
      nodeId: '123',
      days: 7,
      completeDays: true,
      requireSales: true,
      sourceMode: 'sorftime',
      now: Date.parse(at),
    },
    { client },
  );
  assert.equal(calls[0].arguments.online_date_range_min, '2026-10-29');
  assert.equal(calls[0].arguments.online_date_range_max, '2026-11-04');
  assert.equal(calls[0].arguments.month_sale_volume_range_min, 1);
});

test('daily ASIN values retain unknown and zero, reject wrong identity or monthly series', () => {
  const p = { sourceProductId: 'SYNTHETIC' };
  const value = {
    data: {
      asin: 'SYNTHETIC',
      type: 'DailySalesVolume',
      data: ['20261102', -1, '20261103', 0, '20261104', 3, '20261105', 4],
    },
  };
  const result = parseAmazonDaily(value, p, at);
  assert.deepEqual(
    result.map((p) => p.value),
    [null, 0, 3, 4],
  );
  assert.equal(result.at(-1).partial, true);
  assert.throws(() =>
    parseAmazonDaily(value, { sourceProductId: 'OTHER' }, at),
  );
  assert.throws(() =>
    parseAmazonDaily({ data: { ...value.data, type: 'SalesVolume' } }, p, at),
  );
});

test('observations record changes and missing current values, never convert monthly difference to daily sales', () => {
  const p = {
    id: 'p',
    title: 'First',
    price: 20,
    currency: 'USD',
    collectionFields: ['price'],
    resourceRaw: {
      salesEvidence: { metric: 'monthly_sales_volume', value: 50 },
    },
  };
  const first = observation(p, null, at, '2026-11-05');
  const second = observation(
    { ...p, title: 'Updated', price: 0, collectionFields: [], resourceRaw: {} },
    first,
    '2026-11-05T16:00:00Z',
    '2026-11-06',
  );
  assert.equal(second.price, null);
  assert.equal(second.monthlySales, null);
  assert.equal(second.changes[0].field, 'title');
  assert.deepEqual(watchTrends([first, second]).dailySales, []);
  const corrections = watchTrends([
    { ...first, dailySales: [{ date: '2026-11-04', value: 2 }] },
    { ...second, dailySales: [{ date: '2026-11-04', value: 3 }] },
  ]);
  assert.equal(corrections.dailySales[0].value, 3);
});

test('US scheduled plans remove legacy foreign-source defaults without mutating old jobs', () => {
  const original = {
    kind: 'regular_new',
    market: 'US',
    channels: ['amazon', 'shopee'],
    sourceMarkets: { amazon: 'MX', shopee: 'VN' },
  };
  const plan = dailyNewProductPlan(original);
  assert.deepEqual(plan.channels, ['amazon']);
  assert.equal(plan.sourceMarkets.amazon, 'US');
  assert.equal(original.sourceMarkets.amazon, 'MX');
});
