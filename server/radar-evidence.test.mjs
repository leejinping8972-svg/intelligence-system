import assert from 'node:assert/strict';
import test from 'node:test';

import { benefitSignal, ingredientSignal } from '../workers/site-discovery/src/product-signal-rules.js';
import { productFromJsonLd } from './collector.js';
import {
  buildCollectedRadarFindings,
  buildFreeSourceRadarFindings,
  buildRadarFindings,
  buildRadarReport,
  radarStatistics,
} from './model.js';

const now = Date.parse('2026-10-28T06:00:00Z');
const observed = new Date(now - 86_400_000).toISOString();
const product = (patch = {}) => ({
  id: 'p',
  title: 'Synthetic supplement',
  brand: 'QA',
  market: 'US',
  category: 'Nutrition',
  form: 'capsule',
  ingredient: 'Inulin',
  dose: '',
  reviewed: false,
  dataNature: 'collected',
  benefits: [],
  ingredientInsights: [],
  firstSeenAt: observed,
  evidenceUrl: 'https://example.com/products/qa',
  ...patch,
});
const state = (products, patch = {}) => ({
  products,
  keywords: [],
  ads: [],
  ...patch,
});
const keyword = (patch = {}) => ({
  id: 'k',
  term: 'inulin',
  market: 'US',
  category: 'Nutrition',
  source: 'Synthetic trend',
  productIds: ['p'],
  series: [],
  listSummary: true,
  trendSummary: [{ change: 40 }, { change: null }, { change: null }],
  ...patch,
});
const ad = (patch = {}) => ({
  id: 'a',
  productId: 'p',
  market: 'US',
  platform: 'Meta',
  dataNature: 'collected',
  firstSeenAt: observed,
  keywordIds: [],
  ...patch,
});
function clock(context) {
  context.mock.method(Date, 'now', () => now);
}

test('exclusion filters retain real ingredient names and short genuine benefits', () => {
  assert.equal(ingredientSignal('Vitamin C', 'Inulin, Vitamin C. Free of: gluten, soy'), 'Vitamin C');
  assert.equal(ingredientSignal('Gluten', 'Wheat flour, Gluten'), 'Gluten');
  assert.equal(ingredientSignal('Gluten', 'Inulin, Gluten-free'), '');
  assert.equal(benefitSignal('Energy'), 'Energy');
  assert.equal(benefitSignal('Supports pregnancy health'), 'Supports pregnancy health');
  assert.equal(benefitSignal('\u8865\u9499'), '\u8865\u9499');
});

test('collector filters disclaimer sentences and exclusion badges before saving signals', () => {
  const record = productFromJsonLd(
    {
      name: 'Synthetic fiber',
      description:
        'Supports digestive balance. These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure or prevent any disease.',
      ingredients:
        'Inulin 5 g, Non-GMO, Gluten-free, Vitamin C 20 mg. Free of: wheat, soy',
    },
    'https://example.com/products/qa',
    'US',
    'QA',
  );
  assert.deepEqual(record.benefits, ['Supports digestive balance.']);
  assert.deepEqual(
    record.ingredientInsights.map((row) => row.name),
    ['Inulin', 'Vitamin C'],
  );
});

test('legacy disclaimers never become concepts, even across many brands', (context) => {
  clock(context);
  const products = Array.from({ length: 40 }, (_, i) =>
    product({
      id: `p${i}`,
      brand: `Brand ${i}`,
      benefits: [
        '*These statements have not been evaluated by the Food and Drug Administration.',
        'This product is not intended to diagnose, treat, cure, or prevent any disease.',
        'Consult your healthcare professional before use.',
        'Suggested Usage: Take two capsules daily.',
      ],
    }),
  );
  assert.equal(
    buildRadarFindings(state(products), 7, false).filter(
      (row) => row.type === 'concept',
    ).length,
    0,
  );
});

test('concept punctuation, repeated tags and brand capitalization do not inflate adoption', (context) => {
  clock(context);
  const products = [
    product({
      benefits: ['Supports digestive balance.', 'Supports digestive balance!'],
    }),
    product({
      id: 'p2',
      brand: ' qa ',
      benefits: ['supports digestive balance'],
    }),
  ];
  const concepts = buildRadarFindings(state(products), 7, false).filter(
    (row) => row.type === 'concept',
  );
  assert.equal(concepts.length, 1);
  assert.equal(concepts[0].adoptionCount, 1);
  assert.equal(concepts[0].evidence.length, 2);
  assert.equal(concepts[0].businessScore, null);
  assert.equal(concepts[0].status, 'pending');
});

test('legacy non-ingredients and allergen exclusions are removed while real ingredients survive', (context) => {
  clock(context);
  const names = [
    'Non-GMO',
    'Non\u2011GMO',
    'Gluten-free',
    'Gluten',
    'Soy',
    'Serving Size',
    'Vegan',
    'Inulin',
    'Vitamin C',
  ];
  const p = product({
    ingredient: 'Inulin, Vitamin C. Free of: gluten, soy',
    ingredientInsights: names.map((name) => ({
      name,
      amount: '',
      evidence: 'https://example.com/label',
    })),
  });
  const ingredients = buildRadarFindings(state([p]), 7, false).filter(
    (row) => row.type === 'ingredient',
  );
  assert.deepEqual(ingredients.map((row) => row.title).sort(), [
    'Inulin',
    'Vitamin C',
  ]);
  assert.ok(
    ingredients.every(
      (row) => row.businessScore === null && row.confidenceScore < 70,
    ),
  );
});

test('same-category unrelated trends and missing trends cannot score a finding', (context) => {
  clock(context);
  const p = product({
    benefits: ['Supports digestive balance.'],
    ingredientInsights: [{ name: 'Inulin', amount: '5 g' }],
  });
  for (const keywords of [
    [keyword({ productIds: ['unrelated'] })],
    [
      keyword({
        trendSummary: [{ change: null }, { change: null }, { change: null }],
      }),
    ],
  ]) {
    const rows = buildRadarFindings(state([p], { keywords }), 7, false);
    assert.ok(
      rows.every(
        (row) => row.businessScore === null && row.trendGrowth === null,
      ),
    );
    assert.equal(radarStatistics(rows).averageScore, null);
  }
});

test('only directly linked trends contribute and unknown launch dates stay below 70', (context) => {
  clock(context);
  const p = product({
    benefits: ['Supports digestive balance.'],
    ingredientInsights: [{ name: 'Inulin', amount: '5 g' }],
  });
  const rows = buildRadarFindings(
    state([p], {
      keywords: [
        keyword(),
        keyword({
          id: 'wrong',
          productIds: ['other'],
          trendSummary: [{ change: 900 }, {}, {}],
        }),
      ],
    }),
    7,
    false,
  );
  assert.ok(rows.every((row) => row.trendGrowth === 40));
  assert.ok(
    rows.every((row) => row.businessScore > 0 && row.businessScore < 100),
  );
  assert.equal(
    rows.find((row) => row.type === 'product').status,
    'newly-discovered',
  );
  assert.ok(rows.find((row) => row.type === 'product').confidenceScore < 70);
});

test('old ads, demo ads and ads from another market cannot score real product findings', (context) => {
  clock(context);
  const ads = [
    ad({ firstSeenAt: '2025-01-01' }),
    ad({ id: 'demo', dataNature: 'demo' }),
    ad({ id: 'other-market', market: 'VN' }),
  ];
  const rows = buildRadarFindings(state([product()], { ads }), 7, false);
  assert.equal(rows.find((row) => row.type === 'product').businessScore, null);
  const valid = buildRadarFindings(
    state([product()], { ads: [ad()] }),
    7,
    false,
  );
  assert.ok(valid.find((row) => row.type === 'product').businessScore > 0);
});

test('many brands alone never produce an opportunity score', (context) => {
  clock(context);
  const products = Array.from({ length: 40 }, (_, i) =>
    product({
      id: `p${i}`,
      brand: `Brand ${i}`,
      benefits: ['Supports digestive balance.'],
      ingredientInsights: [{ name: 'Inulin', amount: '5 g' }],
    }),
  );
  const rows = buildRadarFindings(state(products), 7, false);
  assert.ok(rows.every((row) => row.businessScore === null));
  assert.ok(rows.every((row) => row.confidenceScore < 70));
});

test('summary separates date-confirmed products from all discoveries and counts only scored rows', (context) => {
  clock(context);
  const confirmed = product({
    id: 'confirmed',
    decisionData: {
      listing: {
        date: '2026-10-20',
        provider: 'Synthetic public catalog',
        platform: 'Official',
        market: 'US',
        collectedAt: observed,
        evidenceUrl: 'https://example.com/products/confirmed',
      },
    },
  });
  const rows = buildRadarFindings(
    state([product(), confirmed], { keywords: [keyword()] }),
    7,
    false,
  );
  const stats = radarStatistics(rows);
  assert.equal(stats.counts.product, 2);
  assert.equal(stats.confirmedProducts, 1);
  assert.equal(stats.scored, 1);
  assert.equal(
    stats.averageScore,
    rows.find((row) => row.id === 'radar-product-p').businessScore,
  );
});

test('DSLD entries and undated catalog products remain unconfirmed; recalls are not ingredients', (context) => {
  clock(context);
  const free = buildFreeSourceRadarFindings(
    {
      signals: [
        {
          id: 'dsld',
          title: 'Synthetic label',
          source: 'NIH_DSLD',
          kind: 'product',
          market: 'US',
          observedAt: observed,
          ingredients: [],
          category: 'Nutrition',
        },
        {
          id: 'recall',
          title: 'Synthetic recall',
          source: 'OPENFDA',
          kind: 'regulatory',
          market: 'US',
          observedAt: observed,
          query: 'Inulin',
        },
      ],
    },
    7,
  );
  assert.equal(free.length, 1);
  assert.equal(free[0].status, 'pending');
  assert.ok(free[0].confidenceScore < 70);
  assert.equal(radarStatistics(free).confirmedProducts, 0);
  const catalog = buildCollectedRadarFindings(
    {
      observations: [
        {
          id: 'catalog',
          market: 'US',
          firstSeenAt: observed,
          capturedAt: observed,
          publishedAt: null,
          title: 'Synthetic catalog',
          url: 'https://example.com/products/qa',
        },
      ],
    },
    7,
  );
  assert.equal(catalog[0].status, 'newly-discovered');
  assert.ok(catalog[0].confidenceScore < 70);
});

test('observation window and activity dates use the same calendar-day bounds', (context) => {
  clock(context);
  const rows = buildRadarFindings(
    state([
      product({ id: 'last-day', firstSeenAt: '2026-10-22T01:00:00Z' }),
      product({ id: 'outside', firstSeenAt: '2026-10-21T23:00:00Z' }),
      product({ id: 'future', firstSeenAt: '2026-10-29' }),
    ]),
    7,
    false,
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['radar-product-last-day'],
  );
  assert.deepEqual(Object.keys(radarStatistics(rows).activity), ['2026-10-22']);
});

test('report preserves unscored candidates and does not claim validated commercial value', (context) => {
  clock(context);
  const report = buildRadarReport(
    buildRadarFindings(state([product()]), 7, false),
    7,
    'US',
  );
  assert.match(report, /线索评分为数据不足/);
  assert.doesNotMatch(report, /当前没有达到/);
  assert.match(report, /不包含成本、利润/);
  assert.match(report, /0个来源确认90天内上架/);
});
