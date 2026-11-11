/* oxlint-disable vitest/no-import-node-test -- Server regression uses the Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { productWatchSource } from './product-watch-sorftime.mjs';

const product = {
  sourcePlatform: 'Amazon',
  sourceProductId: 'B000000001',
  market: 'US',
};
// Shape of Sorftime's retained tool declaration: dimensions are in prose, and
// the optional type parameter defaults to monthly sales rather than daily.
const description =
  'Trend dimension, default SalesVolume. Enum: SalesVolume=Monthly sales volume trend; SalesAmount=Monthly sales amount trend;DailySalesVolume=It indicates the sales quantity of the ASIN on Amazon for the corresponding date; AsinSalesVolume=ASIN-level monthly sales volume.';
function fixture(metricSchema) {
  metricSchema ||= { type: 'string', description, default: 'SalesVolume' };
  const calls = [];
  const tool = {
    name: 'product_trend',
    inputSchema: {
      type: 'object',
      required: ['asin'],
      properties: {
        asin: { type: 'string' },
        amz_site: { type: 'string', enum: ['US'] },
        type: metricSchema,
      },
    },
  };
  const client = {
    tools: [tool],
    rpc: async (_method, request) => {
      calls.push(request);
      return request.arguments.type === 'DailySalesVolume'
        ? {
            structuredContent: {
              data: {
                asin: product.sourceProductId,
                type: 'DailySalesVolume',
                data: ['20261105', 0, '20261106', 5, '20261107', 6],
              },
            },
          }
        : { content: [{ type: 'text', text: '2026年10月=123' }] };
    },
  };
  return { tool, client, calls };
}

test('description-only daily capability sends the explicit daily metric and preserves real zero', async () => {
  const f = fixture();
  const result = await productWatchSource({ product }, { client: f.client });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].arguments.type, 'DailySalesVolume');
  assert.equal(f.calls[0].arguments.asin, product.sourceProductId);
  assert.equal(f.calls[0].arguments.amz_site, 'US');
  assert.deepEqual(
    result.dailySales.map((p) => p.value),
    [0, 5, 6],
  );
  assert.equal(result.usage.sorftimeCalls, 1);
});

test('description-only monthly dimensions remain separate from daily data', async () => {
  for (const monthlyMetric of ['SalesVolume', 'SalesAmount']) {
    const f = fixture();
    const result = await productWatchSource(
      { product, monthlyMetric },
      { client: f.client },
    );
    assert.equal(f.calls[0].arguments.type, monthlyMetric);
    assert.deepEqual(result.monthlyTrend.points, [
      { date: '2026-10', value: 123, partial: false },
    ]);
    assert.equal(result.dailySales, undefined);
  }
});

test('an explicit enum excluding daily overrides prose and never makes a data request', async () => {
  const f = fixture({ type: 'string', description, enum: ['SalesVolume'] });
  const result = await productWatchSource({ product }, { client: f.client });
  assert.equal(result.unsupported, true);
  assert.equal(f.calls.length, 0);
});

test('missing declarations and similarly named dimensions cannot select daily by default', async () => {
  for (const text of [
    '',
    'Default DailySalesVolume',
    'NotDailySalesVolume=daily',
    'DailySalesVolumeDisabled=not supported',
    'SalesVolume=Monthly sales volume trend',
  ]) {
    const f = fixture({
      type: 'string',
      description: text,
      default: 'SalesVolume',
    });
    const result = await productWatchSource({ product }, { client: f.client });
    assert.equal(result.unsupported, true);
    assert.equal(f.calls.length, 0);
  }
});

test('description support retains required-parameter and response-identity protections', async () => {
  const required = fixture();
  required.tool.inputSchema.required.push('newRequiredParameter');
  await assert.rejects(
    productWatchSource({ product }, { client: required.client }),
    /必填参数已变化/,
  );
  assert.equal(required.calls.length, 0);
  const wrongIdentity = fixture();
  wrongIdentity.client.rpc = async () => ({
    structuredContent: {
      data: {
        asin: 'B999999999',
        type: 'DailySalesVolume',
        data: ['20261107', 6],
      },
    },
  });
  await assert.rejects(
    productWatchSource({ product }, { client: wrongIdentity.client }),
    /商品标识或指标结构不一致/,
  );
});
