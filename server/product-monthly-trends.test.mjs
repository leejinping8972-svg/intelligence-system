import assert from 'node:assert/strict';
import test from 'node:test';
import {
  monthlyTrendDue,
  monthlyTrendIdentity,
  parseMonthlyTrend,
} from './product-monthly-trends.mjs';
import { productWatchSource } from './product-watch-sorftime.mjs';
import {
  observation,
  watchConfig,
  watchTrends,
} from './product-watch-domain.mjs';

const product = {
  id: 'US-test',
  sourceProductId: 'B012345678',
  sourcePlatform: 'Amazon',
  sourceMarket: 'US',
  market: 'US',
};
const at = '2026-11-10T10:00:00Z';
test('monthly text retains zeros, inserts missing months and marks the current month', () => {
  const r = parseMonthlyTrend(
    '2026年07月=0,2026年09月=346,2026年11月=900',
    product,
    'SalesVolume',
    at,
  );
  assert.deepEqual(
    r.points.map((p) => p.value),
    [0, null, 346, null, 900],
  );
  assert.equal(r.points.at(-1).partial, true);
  assert.equal(r.points[0].partial, false);
  const amount = parseMonthlyTrend(
    {
      asin: product.sourceProductId,
      type: 'SalesAmount',
      data: ['202607', 23688.45, '202608', -1],
    },
    product,
    'SalesAmount',
    at,
  );
  assert.equal(amount.currency, 'USD');
  assert.equal(amount.points[1].value, null);
});
test('monthly data rejects other identity/metric, daily periods, future dates and malformed values', () => {
  const wrap = (patch) => ({
    asin: product.sourceProductId,
    type: 'SalesVolume',
    data: ['202607', 42],
    ...patch,
  });
  for (const v of [
    wrap({ asin: 'OTHER' }),
    wrap({ type: 'DailySalesVolume' }),
    wrap({ product_trend_type: 'SalesAmount' }),
    wrap({ currency: 'MXN' }),
    wrap({ amz_site: 'MX' }),
    wrap({ data: ['20260702', 8] }),
    wrap({ data: ['202613', 8] }),
    wrap({ data: ['202612', 8] }),
    wrap({ data: ['202607', 'unknown'] }),
    wrap({ data: ['202607', 1.5] }),
    wrap({ data: ['202607'] }),
  ])
    assert.throws(() => parseMonthlyTrend(v, product, 'SalesVolume', at));
});
test('refresh uses seven-day per-metric checks including failures and identity changes', () => {
  const history = {
    identity: monthlyTrendIdentity(product),
    SalesVolume: { checkedAt: at, error: 'outcome unknown' },
  };
  assert.equal(
    monthlyTrendDue(history, product, 'SalesVolume', '2026-11-16T10:00:00Z'),
    false,
  );
  assert.equal(
    monthlyTrendDue(history, product, 'SalesVolume', '2026-11-17T10:00:00Z'),
    true,
  );
  assert.equal(monthlyTrendDue(history, product, 'SalesAmount', at), true);
  assert.equal(
    monthlyTrendDue(
      history,
      { ...product, sourceMarket: 'MX' },
      'SalesVolume',
      at,
    ),
    true,
  );
  assert.equal(
    watchConfig({ market: 'US', enabled: true, time: '01:00' }).monthlyHistory,
    true,
  );
  assert.throws(() =>
    watchConfig({
      market: 'US',
      enabled: true,
      time: '01:00',
      monthlyHistory: 'yes',
    }),
  );
});
test('history reads expose saved monthly series separately, without converting snapshots or old identities', () => {
  const row = observation(product, null, at, '2026-11-10');
  row.monthlyTrends = {
    identity: monthlyTrendIdentity(product),
    SalesVolume: { points: [{ date: '2026-07', value: 42 }] },
  };
  const result = watchTrends([row]);
  assert.equal(result.monthlyTrends.SalesVolume.points[0].value, 42);
  assert.deepEqual(result.dailySales, []);
  assert.equal(
    watchTrends([{ ...row, market: 'MX' }]).monthlyTrends,
    undefined,
  );
});
const schema = (name, values) => ({
  name: 'product_trend',
  inputSchema: {
    type: 'object',
    required: ['asin'],
    properties: {
      asin: { type: 'string' },
      amz_site: { type: 'string', enum: ['US', 'MX'] },
      [name]: { type: 'string', enum: values },
    },
  },
});
test('source supports both schema field names and never defaults to the wrong metric', async () => {
  for (const key of ['type', 'product_trend_type']) {
    const calls = [];
    const r = await productWatchSource(
      { product, monthlyMetric: 'SalesAmount' },
      {
        client: {
          tools: [schema(key, ['SalesVolume', 'SalesAmount'])],
          rpc: async (_, args) => {
            calls.push(args);
            return { content: [{ type: 'text', text: '2026年07月=23688.45' }] };
          },
        },
      },
    );
    assert.equal(calls[0].arguments[key], 'SalesAmount');
    assert.equal(r.monthlyTrend.points[0].value, 23688.45);
    assert.equal(r.usage.sorftimeCalls, 1);
  }
  const unsupported = await productWatchSource(
    { product, monthlyMetric: 'SalesAmount' },
    {
      client: {
        tools: [schema('type', ['DailySalesVolume'])],
        rpc: async () => assert.fail('unsupported metric must never call'),
      },
    },
  );
  assert.equal(unsupported.unsupported, true);
  assert.equal(unsupported.usage.sorftimeCalls, 0);
});
test('empty source stays empty, structured source validates identity and explicit variants are not mixed', async () => {
  const client = (raw) => ({
    tools: [schema('type', ['SalesVolume'])],
    rpc: async () => raw,
  });
  const empty = await productWatchSource(
    { product, monthlyMetric: 'SalesVolume' },
    {
      client: client({
        content: [{ type: 'text', text: 'No data available.' }],
      }),
    },
  );
  assert.deepEqual(empty.monthlyTrend.points, []);
  await assert.rejects(
    productWatchSource(
      { product, monthlyMetric: 'SalesVolume' },
      {
        client: client({
          structuredContent: {
            asin: 'OTHER',
            type: 'SalesVolume',
            data: ['202607', 8],
          },
        }),
      },
    ),
  );
  await assert.rejects(
    productWatchSource(
      {
        product: { ...product, sourceVariantId: 'child' },
        monthlyMetric: 'SalesVolume',
      },
      { client: client({}) },
    ),
  );
});
