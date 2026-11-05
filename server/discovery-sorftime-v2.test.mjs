import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoveryPlan,
  newProductEvidence,
} from './discovery-monitor-domain.mjs';
import {
  discoverySorftime,
  normalizeSocialRows,
  normalizeDiscoveryProduct,
} from './discovery-sorftime.mjs';
import { runDiscoveryMonitor } from './discovery-monitor-store.mjs';

const now = Date.parse('2026-11-05T01:00:00Z');
const schema = (properties) => ({ type: 'object', properties });
const string = { type: 'string' };
const integer = { type: 'integer' };
const site = { type: 'string', enum: ['US', 'VN'] };
const plan = (patch = {}) =>
  discoveryPlan({
    kind: 'regular_new',
    market: 'US',
    channels: ['amazon'],
    days: 30,
    maxProducts: 1000,
    maxPages: 50,
    ...patch,
  });

test('Sorftime new plans support three channels and cap products/posts independently', () => {
  assert.equal(plan().sourceMode, 'sorftime');
  assert.equal(plan().requireSales, true);
  assert.deepEqual(
    plan({ channels: ['amazon', 'tiktok', 'shopee'] }).sourceMarkets,
    { amazon: 'US', tiktok: 'US', shopee: 'VN' },
  );
  assert.equal(
    plan({ kind: 'ingredients', channels: ['reddit'], maxProducts: 5000 })
      .maxProducts,
    5000,
  );
  assert.throws(() => plan({ maxProducts: 1001 }));
  assert.throws(() => plan({ kind: 'fbm_new', channels: ['tiktok'] }));
});

test('category-scoped Sorftime calls use actual date/sales filters with no product search phrase', async () => {
  for (const channel of ['amazon', 'tiktok', 'shopee']) {
    let args;
    const tool = {
      name:
        channel === 'amazon' ? 'product_search' : `${channel}_product_search`,
      inputSchema: schema({
        amz_site: site,
        site,
        node_id: string,
        page: integer,
        online_date_range_min: string,
        online_date_range_max: string,
        exposure_time_min: string,
        exposure_time_max: string,
        month_sale_volume_range_min: integer,
        month_sale_count_min: integer,
        shipping_type: string,
      }),
    };
    const result = await discoverySorftime(
      {
        ...plan({
          kind: channel === 'amazon' ? 'fbm_new' : 'regular_new',
          channels: [channel],
        }),
        channel,
        nodeId: '1234',
        now,
      },
      {
        client: {
          tools: [tool],
          rpc: async (_m, input) => {
            args = input.arguments;
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    page: 1,
                    page_count: 1,
                    data: [
                      {
                        asin: 'B000000001',
                        product_id: '12345678901',
                        title: 'Synthetic oral supplement',
                        monthly_sales_volume: 12,
                        online_date: '2026-10-07',
                      },
                    ],
                  }),
                },
              ],
            };
          },
        },
      },
    );
    assert.equal(args.node_id, '1234');
    assert.equal(args.month_sale_volume_range_min, 1);
    assert.equal(args.attribute_name, undefined);
    assert.equal(args.keyword, undefined);
    assert.equal(args.online_date_range_min, '2026-10-07');
    assert.equal(result.products[0].resourceRaw.salesEvidence.value, 12);
    assert.equal(result.hasMore, false);
    if (channel === 'amazon')
      assert.equal(
        result.products[0].resourceRaw.fulfillmentEvidence.basis,
        'source_query_filter',
      );
  }
});

test('positive monthly sales and real listing date are required; exposure is not a listing date', async () => {
  const p = {
    sourceUrl: 'https://www.amazon.com/dp/B000000001',
    decisionData: { listing: { date: '2026-10-07' } },
    resourceRaw: { salesEvidence: { value: 1 } },
  };
  assert.ok(newProductEvidence(p, plan(), now));
  assert.equal(
    newProductEvidence(
      { ...p, resourceRaw: { salesEvidence: { value: 0 } } },
      plan(),
      now,
    ),
    undefined,
  );
  assert.equal(
    newProductEvidence(
      {
        ...p,
        decisionData: {},
        resourceRaw: {
          salesEvidence: { value: 5 },
          exposureDate: '2026-11-01',
        },
      },
      plan(),
      now,
    ),
    undefined,
  );
});

test('known empty MCP responses are empty results; errors and arbitrary text remain failures', async () => {
  for (const [text, isError, empty] of [
    ['No data available.', false, true],
    ['No relevant data.', false, true],
    ['No relevant data.', true, false],
    ['Unauthorized', false, false],
  ]) {
    const call = () =>
      discoverySorftime(
        { ...plan(), channel: 'amazon', nodeId: '123', now },
        {
          client: {
            tools: [
              {
                name: 'product_search',
                inputSchema: schema({
                  amz_site: site,
                  node_id: string,
                  online_date_range_min: string,
                  month_sale_volume_range_min: integer,
                }),
              },
            ],
            rpc: async () => ({ isError, content: [{ type: 'text', text }] }),
          },
        },
      );
    if (empty) assert.equal((await call()).sourceRows, 0);
    else await assert.rejects(call);
  }
});

test('published_time is respected; summaries require original posts; PascalCase full posts are supported', () => {
  const request = { channel: 'reddit', days: 30, now };
  const stats = {};
  const search = normalizeSocialRows(
    {
      data: [
        {
          reddit_id: 't3_synthetic',
          published_time: '2026-10-07',
          summary: 'Summary mentions an ingredient',
          url: '',
        },
        { reddit_id: 't3_old', published_time: '2026-10-06', summary: 'old' },
        { reddit_id: 't3_missing', summary: 'no date' },
      ],
    },
    request,
    new Date(now).toISOString(),
    stats,
  );
  assert.equal(search.length, 1);
  assert.equal(search[0].requiresContent, true);
  assert.equal(search[0].text, '');
  assert.equal(search[0].url, 'https://www.reddit.com/comments/synthetic/');
  assert.equal(stats.outsideWindow, 1);
  assert.equal(stats.missingDate, 1);
  const full = normalizeSocialRows(
    {
      data: {
        RedditId: 't3_synthetic',
        PublishedTime: '2026-10-07',
        Title: 'Synthetic original',
        Content: 'Original discusses creatine',
      },
    },
    { ...request, postDetail: true, record: search[0] },
    new Date(now).toISOString(),
  );
  assert.equal(full[0].text, 'Original discusses creatine');
  assert.equal(full[0].requiresContent, undefined);
  assert.equal(
    normalizeSocialRows(
      { data: { RedditId: 't3_other', Title: 'Wrong post' } },
      { ...request, postDetail: true, record: search[0] },
      new Date(now).toISOString(),
    ).length,
    0,
  );
});

test('runner fetches date-eligible summary candidates as original posts before ingredient analysis', async () => {
  const calls = [];
  let status;
  const job = {
    id: 'synthetic-job',
    input: {
      plan: plan({
        kind: 'ingredients',
        channels: ['reddit'],
        topics: ['synthetic'],
        maxDetails: 0,
      }),
    },
    checkpoint: { calls: 0, products: 0, logs: [] },
  };
  const record = {
    id: 'candidate',
    sourceId: 't3_synthetic',
    platform: 'reddit',
    url: 'https://www.reddit.com/comments/synthetic/',
    title: '',
    text: '',
    publishedAt: '2026-11-01',
    requiresContent: true,
  };
  const io = {
    now: () => now,
    pool: { query: async () => ({ rows: [{ cancelled: false }] }) },
    collect: async (_j, _s, req) => {
      calls.push(req);
      if (req.sources[0] === 'ingredient_analysis') {
        assert.equal(req.records[0].text, 'Original creatine text');
        return { ingredients: [], model: 'synthetic' };
      }
      return req.postDetail
        ? {
            sourceRows: 1,
            records: [
              {
                ...record,
                id: 'original',
                requiresContent: false,
                text: 'Original creatine text',
              },
            ],
          }
        : { sourceRows: 1, records: [record] };
    },
    saveCheckpoint: async (j, cp, s) => {
      j.checkpoint = cp;
      status = s;
    },
    read: async () => undefined,
    putDocument: async () => {},
  };
  for (let i = 0; i < 8 && !['completed', 'partial'].includes(status); i++)
    await runDiscoveryMonitor(job, io);
  assert.equal(status, 'completed');
  assert.equal(calls.filter((c) => c.postDetail).length, 1);
  assert.equal(job.checkpoint.records.length, 1);
  assert.equal(job.checkpoint.analysisDone, true);
});


test('TikTok falls back to dated exposure, preserves true launch priority and does not apply to other platforms', async () => {
  const at = new Date(now).toISOString();
  const raw = { product_id: '12345678901', product_url: 'https://www.tiktok.com/shop/pdp/12345678901', title: 'Synthetic oral supplement', month_sale_count: 5, exposure_time: '2026-11-01' };
  const product = normalizeDiscoveryProduct(raw, {channel:'tiktok',market:'US'}, at);
  assert.equal(product.decisionData.listing.date, '2026-11-01');
  assert.equal(product.decisionData.listing.dateBasis, 'exposure');
  assert.equal(product.decisionData.listing.sourceField, 'exposure_time');
  const evidence = newProductEvidence(product, plan({channels:['tiktok'],days:7,completeDays:true}), now);
  assert.equal(evidence.dateBasis, 'exposure');
  const listed = normalizeDiscoveryProduct({...raw, online_date:'2026-10-01'}, {channel:'tiktok',market:'US'}, at);
  assert.equal(listed.decisionData.listing.dateBasis, 'listing');
  assert.equal(newProductEvidence(listed, plan({channels:['tiktok'],days:7,completeDays:true}), now), undefined);
  const amazon = normalizeDiscoveryProduct({...raw,asin:'B000000001'}, {channel:'amazon',market:'US'}, at);
  assert.equal(amazon.decisionData?.listing, undefined);
  const { mergePlatformProduct } = await import('./platform-product-data.mjs');
  assert.equal(mergePlatformProduct(listed,product).decisionData.listing.dateBasis, 'listing');
  assert.equal(mergePlatformProduct(product,listed).decisionData.listing.dateBasis, 'listing');
  const { discoveryDecision } = await import('./discovery-newness.mjs');
  const decision = discoveryDecision(product, 'product', now);
  assert.match(decision.reason, /曝光日期不等于实际上架日期/);
  assert.match(decision.label, /曝光/);
});
