import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoveryPlan,
  dateInWindow,
  newProductEvidence,
  scheduleSlot,
  stableId,
} from './discovery-monitor-domain.mjs';
import {
  discoveryCatalogue,
  discoverySorftime,
  normalizeDiscoveryProduct,
  normalizeSocialRows,
} from './discovery-sorftime.mjs';
import {
  gateSourceFields,
  pendingSourceFields,
  sourceFieldSample,
  validateSourceFields,
} from './source-field-domain.mjs';
import { validateIngredientResearch } from './discovery-ai.mjs';
import { runDiscoveryMonitor } from './discovery-monitor-store.mjs';
import { withFormulaIntelligence } from './formula-intelligence.mjs';
import {
  mergePlatformProduct,
  normalizeAmazon,
  normalizeAmazonContent,
} from './platform-product-data.mjs';

const now = Date.parse('2026-10-30T01:00:00Z');
const plan = (patch = {}) =>
  discoveryPlan({
    kind: 'regular_new',
    market: 'US',
    channels: ['amazon'],
    topics: 'dietary supplement',
    ...patch,
  });
const string = { type: 'string' };
const country = { type: 'string', enum: ['US', 'MX', 'VN'] };
const tool = (name, properties, required = []) => ({
  name,
  inputSchema: { type: 'object', properties, required },
});
function client(tools, value) {
  const calls = [];
  return {
    calls,
    client: {
      tools,
      rpc: async (method, input) => {
        calls.push({ method, ...input });
        return { structuredContent: value };
      },
    },
  };
}

test('seven-day listing boundary rejects missing, invalid, old and future dates; FBM requires explicit evidence', () => {
  assert.equal(dateInWindow('2026-10-24', 7, now), true);
  for (const date of ['2026-10-23', '2026-10-31', '2026-02-30', '', undefined])
    assert.equal(dateInWindow(date, 7, now), false);
  const p = {
    sourceUrl: 'https://www.amazon.com/dp/B000000001',
    decisionData: { listing: { date: '2026-10-29' } },
  };
  assert.equal(
    newProductEvidence(p, plan({ kind: 'fbm_new' }), now),
    undefined,
  );
  assert.equal(
    newProductEvidence(
      { ...p, resourceRaw: { fulfillment: 'FBM' } },
      plan({ kind: 'fbm_new' }),
      now,
    ).label,
    'FBM新品',
  );
});

test('listing windows follow the Beijing schedule across UTC midnight and Chinese/CFU amounts remain explicit doses', () => {
  assert.equal(
    dateInWindow('2026-10-31', 1, Date.parse('2026-10-30T17:00:00Z')),
    true,
  );
  for (const dose of ['100毫克', '10 billion CFU']) {
    const sample = sourceFieldSample('products', {
      sourceContent: { attributes: { 'Amount per serving': dose } },
    });
    const result = validateSourceFields(
      {
        fields: [
          {
            field: 'dose',
            value: dose,
            sourceId: 'attribute:Amount per serving',
            quote: `Amount per serving: ${dose}`,
            relation: 'dose',
          },
        ],
      },
      sample,
    );
    assert.equal(result.patch.dose, dose);
  }
});
test('Beijing schedules run only on the selected day and time, with deterministic run IDs', () => {
  const weekly = discoveryPlan(
    {
      ...plan(),
      frequency: 'weekly',
      time: '09:00',
      weekday: 5,
      enabled: true,
    },
    true,
  );
  assert.equal(scheduleSlot(weekly, now - 1), undefined);
  assert.equal(scheduleSlot(weekly, now), '2026-10-30');
  assert.equal(scheduleSlot(weekly, now + 86400000), undefined);
  assert.equal(scheduleSlot({ ...weekly, enabled: false }, now), undefined);
  const monthly = { ...weekly, frequency: 'monthly', monthDay: 1 };
  assert.equal(
    scheduleSlot(monthly, Date.parse('2026-11-01T01:00Z')),
    '2026-11-01',
  );
  assert.equal(stableId('same'), stableId('same'));
  assert.throws(() => plan({ channels: ['amazon'], maxCalls: 101 }), /上限/);
  assert.throws(() => plan({ kind: 'fbm_new', channels: ['shopee'] }), /FBM/);
});
test('verified Sorftime parameter names: Amazon launch range and string shipping_type FBM', async () => {
  const s = client(
    [
      tool('product_search', {
        amz_site: country,
        attribute_name: string,
        page: { type: 'integer' },
        shipping_type: string,
        online_date_range_min: string,
        online_date_range_max: string,
      }),
    ],
    {
      data: [
        {
          asin: 'B000000001',
          title: 'Dietary supplement',
          online_date: '2026-10-29',
          shipping_type: 'FBM',
        },
      ],
    },
  );
  const result = await discoverySorftime(
    {
      ...plan({ kind: 'fbm_new' }),
      channel: 'amazon',
      topic: 'dietary supplement',
      now,
    },
    { client: s.client },
  );
  assert.deepEqual(s.calls[0].arguments, {
    amz_site: 'US',
    attribute_name: 'dietary supplement',
    page: 1,
    online_date_range_min: '2026-10-24',
    online_date_range_max: '2026-10-30',
    shipping_type: 'FBM',
  });
  assert.equal(result.products[0].resourceRaw.fulfillment, 'FBM');
  assert.equal(result.products[0].decisionData.listing.date, '2026-10-29');
});
test('catalogue includes six actual channels; unsupported market and required schema make no data call', async () => {
  const tools = [
    'product_search',
    'tiktok_product_search',
    'shopee_product_search',
    'temu_product_search',
    'walmart_product_search_from_name',
    'ali1688_product_search',
  ].map((n) => tool(n, { site: country, name: string }));
  assert.deepEqual(
    discoveryCatalogue(tools)
      .channels.map((c) => c.id)
      .sort(),
    ['ali1688', 'amazon', 'shopee', 'temu', 'tiktok', 'walmart'],
  );
  const s = client(
    [
      tool(
        'product_search',
        { amz_site: { type: 'string', enum: ['US'] }, unmapped: string },
        ['unmapped'],
      ),
    ],
    { data: [] },
  );
  await assert.rejects(
    discoverySorftime(
      { ...plan(), channel: 'amazon', market: 'VN', topic: 'supplement', now },
      { client: s.client },
    ),
    /市场/,
  );
  assert.equal(s.calls.length, 0);
});
test('Temu required optional strings and sale_time range, Shopee category IDs retain native schemas', async () => {
  const s = client(
    [
      tool(
        'temu_product_search',
        {
          site: country,
          node_id: string,
          brand: string,
          seller_name: string,
          sale_time_min: string,
          sale_time_max: string,
          page: { type: 'integer' },
        },
        ['node_id', 'brand', 'seller_name'],
      ),
    ],
    { data: [] },
  );
  await discoverySorftime(
    { ...plan(), channel: 'temu', nodeId: 'native-123', now },
    { client: s.client },
  );
  assert.equal(s.calls[0].arguments.node_id, 'native-123');
  assert.equal(s.calls[0].arguments.sale_time_min, '2026-10-24');
  assert.equal(s.calls[0].arguments.brand, '');
});
test('Reddit/Quora use observed search_name and reddit_id/quora_id; dates are filtered locally', async () => {
  for (const channel of ['reddit', 'quora']) {
    const name =
      channel === 'reddit' ? 'reddit_post_search' : 'quora_question_search';
    const s = client(
      [
        tool(name, { search_name: string, page: { type: 'integer' } }, [
          'search_name',
        ]),
      ],
      {
        data: [
          {
            id: channel === 'reddit' ? 't3_abc' : '123',
            url: `https://www.${channel}.com/test`,
            title: 'Novel supplement contains urolithin A',
            created_at: '2026-10-29',
          },
          {
            id: 'old',
            url: `https://www.${channel}.com/old`,
            title: 'old',
            created_at: '2020-01-01',
          },
        ],
      },
    );
    const result = await discoverySorftime(
      {
        ...plan({ kind: 'ingredients', channels: [channel] }),
        channel,
        social: true,
        topic: 'supplement',
        now,
      },
      { client: s.client },
    );
    assert.equal(s.calls[0].arguments.search_name, 'supplement');
    assert.equal(result.records.length, 1);
    const detailName =
      channel === 'reddit' ? 'reddit_comment_request' : 'quora_answer_request';
    const detail = client(
      [
        tool(
          detailName,
          { [`${channel}_id`]: string, page: { type: 'integer' } },
          [`${channel}_id`],
        ),
      ],
      { data: [] },
    );
    await discoverySorftime(
      {
        ...plan(),
        channel,
        social: true,
        detail: true,
        record: result.records[0],
        now,
      },
      { client: detail.client },
    );
    assert.equal(
      detail.calls[0].arguments[`${channel}_id`],
      channel === 'reddit' ? 't3_abc' : '123',
    );
  }
  assert.deepEqual(
    normalizeSocialRows(
      { data: [{ url: 'https://www.reddit.com/x', body: 'No date' }] },
      { channel: 'reddit', days: 7, now },
      new Date(now).toISOString(),
    ),
    [],
  );
});
test('Special Ingredients coconut oil and serving size cannot become a formula or dose', () => {
  const p = normalizeAmazon(
    { asin: 'B000000001', title: 'Prebiotic Fiber Gummies' },
    'US',
    new Date(now).toISOString(),
  );
  const patch = normalizeAmazonContent(
    {
      attributes: {
        'Special Ingredients': 'Coconut Oil',
        'Serving Size': '2 Gummies',
      },
    },
    p,
    new Date(now).toISOString(),
  );
  assert.equal(patch.ingredient, undefined);
  assert.equal(patch.dose, undefined);
  const sample = sourceFieldSample('products', { ...p, ...patch });
  const result = validateSourceFields(
    {
      fields: [
        {
          field: 'ingredient',
          value: 'Coconut Oil',
          quote: 'Special Ingredients: Coconut Oil',
          sourceId: 'attribute:Special Ingredients',
          relation: 'formula',
        },
        {
          field: 'dose',
          value: '2 Gummies',
          quote: 'Serving Size: 2 Gummies',
          sourceId: 'attribute:Serving Size',
          relation: 'dose',
        },
      ],
    },
    sample,
  );
  assert.deepEqual(result.patch, {});
  const pending = pendingSourceFields('products', {
    ...p,
    ingredient: 'Coconut Oil',
  });
  assert.equal(withFormulaIntelligence(pending).formula.status, 'unknown');
});
test('AI mapping requires exact source ID, contiguous quote, formula role, ingredient amount and no negation', () => {
  const p = {
    title: 'Dietary supplement',
    sourceContent: {
      attributes: {
        Ingredients: 'Inulin, Vitamin C',
        'Amount per serving': 'Vitamin C 100 mg',
      },
    },
    sourceUrl: 'https://example.test/p',
  };
  const sample = sourceFieldSample('products', p);
  const valid = validateSourceFields(
    {
      supplement: {
        value: true,
        sourceId: 'title',
        quote: 'Dietary supplement',
      },
      fields: [
        {
          field: 'ingredient',
          value: 'Inulin',
          sourceId: 'attribute:Ingredients',
          quote: 'Ingredients: Inulin, Vitamin C',
          relation: 'formula',
        },
        {
          field: 'dose',
          value: '100 mg',
          sourceId: 'attribute:Amount per serving',
          quote: 'Amount per serving: Vitamin C 100 mg',
          relation: 'dose',
        },
        {
          field: 'claim',
          value: 'invented',
          sourceId: 'title',
          quote: 'Dietary supplement',
          relation: 'claim',
        },
      ],
    },
    sample,
  );
  assert.equal(valid.patch.ingredient, 'Inulin');
  assert.equal(valid.patch.dose, '100 mg');
  assert.equal(valid.patch.claim, undefined);
  assert.equal(valid.analysis.supplement, true);
  const old = { ...p, ...valid.patch, fieldAnalysis: valid.analysis };
  assert.equal(
    gateSourceFields('products', old, { ...old, ingredient: 'Wrong' }, p)
      .ingredient,
    'Inulin',
  );
});
test('ingredient findings only include cited, dated records and deduplicate mentions', () => {
  const records = [
    {
      id: 'p1',
      title: 'Supplements',
      text: 'I tried urolithin A.',
      platform: 'reddit',
      url: 'https://www.reddit.com/x',
      publishedAt: '2026-10-29',
    },
  ];
  const result = validateIngredientResearch(
    {
      ingredients: [
        {
          name: 'urolithin A',
          summary: '讨论',
          mentions: [
            { id: 'p1', quote: 'I tried urolithin A.' },
            { id: 'fake', quote: 'urolithin A' },
          ],
        },
        {
          name: 'Coconut Oil',
          mentions: [{ id: 'p1', quote: 'I tried urolithin A.' }],
        },
      ],
    },
    records,
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].mentions.length, 1);
});

test('source marketplaces remain explicit and analyzed omissions clear previously guessed semantic fields', async () => {
  const s = client(
    [tool('product_search', { amz_site: country, attribute_name: string })],
    { data: [{ asin: 'B000000001', title: 'Dietary supplement' }] },
  );
  const result = await discoverySorftime(
    {
      ...plan({ market: 'VN' }),
      channel: 'amazon',
      sourceMarket: 'US',
      topic: 'supplement',
      now,
    },
    { client: s.client },
  );
  assert.equal(s.calls[0].arguments.amz_site, 'US');
  assert.equal(result.products[0].market, 'VN');
  assert.equal(result.products[0].sourceMarket, 'US');
  const raw = normalizeDiscoveryProduct(
    { id: '123', name: 'Vitamin supplement', online_date: '2026-10-29' },
    { market: 'US', sourceMarket: 'CN', channel: 'ali1688' },
    new Date(now).toISOString(),
  );
  assert.equal(raw.sourceMarket, 'CN');
  assert.equal(raw.currency, 'CNY');
  const cleared = {
    ...pendingSourceFields('products', {
      ...result.products[0],
      ingredient: 'Coconut Oil',
      dose: '2 gummies',
    }),
    fieldAnalysis: { status: 'analyzed' },
  };
  const merged = mergePlatformProduct(
    {
      ingredient: 'Coconut Oil',
      dose: '2 gummies',
      benefits: ['invented'],
      ingredientInsights: [{ name: 'Coconut Oil' }],
    },
    cleared,
  );
  assert.doesNotMatch(merged.ingredient, /Coconut/);
  assert.deepEqual(merged.ingredientInsights, []);
});

test('multi-channel first pass reaches every source before consuming the budget on one channel AI analysis', async () => {
  const seen = [];
  let saved;
  const job = {
    id: 'qa',
    input: { plan: plan({ channels: ['amazon', 'walmart'], maxCalls: 5 }) },
    checkpoint: { calls: 0, products: 0 },
  };
  const io = {
    now: () => now,
    pool: { query: async () => ({ rows: [{ cancelled: false }] }) },
    collect: async (_job, _step, request) => {
      seen.push(
        request.sources[0] === 'field_analysis' ? 'AI' : request.channel,
      );
      return request.sources[0] === 'field_analysis'
        ? { patch: {}, analysis: { supplement: true, status: 'analyzed' } }
        : {
            products: [
              {
                id: request.channel,
                title: 'Dietary supplement',
                decisionData: { listing: { date: '2026-10-29' } },
              },
            ],
            sourceRows: 1,
          };
    },
    upsertProduct: async () => {},
    saveCheckpoint: async (_job, cp, status) => {
      job.checkpoint = structuredClone(cp);
      saved = status;
    },
  };
  for (let i = 0; i < 8 && saved !== 'completed'; i++)
    await runDiscoveryMonitor(job, io);
  assert.deepEqual(seen.slice(0, 2), ['amazon', 'walmart']);
  assert.equal(saved, 'completed');
  assert.ok(seen.length <= 5);
});
test('runner checkpoints source results, admits only AI-confirmed supplements, stops within budget and cancellation', async () => {
  let saved,
    writes = 0,
    calls = 0,
    cancelled = false;
  const job = {
    id: 'qa',
    input: { plan: plan({ maxCalls: 3, maxProducts: 5 }) },
    checkpoint: {
      submittedAt: new Date(now).toISOString(),
      calls: 0,
      products: 0,
      logs: [],
    },
  };
  const product = {
    id: 'p1',
    title: 'Dietary supplement',
    sourceUrl: 'https://example.test/p',
    decisionData: { listing: { date: '2026-10-29' } },
    sourceContent: { descriptions: ['Dietary supplement'] },
  };
  const io = {
    now: () => now,
    pool: { query: async () => ({ rows: [{ cancelled }] }) },
    collect: async (_job, _step, r) => {
      calls++;
      return r.sources[0] === 'field_analysis'
        ? {
            patch: {},
            analysis: {
              supplement: true,
              status: 'analyzed',
              fingerprint: sourceFieldSample('products', product).fingerprint,
            },
          }
        : { products: [product], sourceRows: 1, hasMore: false };
    },
    upsertProduct: async (p) => {
      writes++;
      assert.equal(p.newProductClassifications[0].label, '常规新品');
    },
    saveCheckpoint: async (_job, cp, status) => {
      saved = { cp: structuredClone(cp), status };
      job.checkpoint = structuredClone(cp);
    },
  };
  for (let i = 0; i < 5 && saved?.status !== 'completed'; i++)
    await runDiscoveryMonitor(job, io);
  assert.equal(calls, 2);
  assert.equal(writes, 1);
  assert.equal(saved.status, 'completed');
  cancelled = true;
  await runDiscoveryMonitor({ ...job, checkpoint: {} }, io);
  assert.equal(saved.status, 'cancelled');
  assert.equal(calls, 2);
});
