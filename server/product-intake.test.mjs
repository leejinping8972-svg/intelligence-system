import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareProductIntake } from './product-intake.mjs';
import { productIntakeSource } from './product-intake-sorftime.mjs';
import { normalizeDiscoveryProduct } from './discovery-sorftime.mjs';
import {
  sourceFieldSample,
  validateSourceFields,
} from './source-field-domain.mjs';
import { productListingDate } from './product-listing.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { coreMetrics } from './model.js';
import { runProductResourceDiscovery } from './product-resource-engine.mjs';

const at = '2026-11-05T01:00:00Z';
const makeProduct = () =>
  normalizeDiscoveryProduct(
    {
      asin: 'B000000001',
      title:
        'Magnesium with L-Theanine for Calm and Sleep Support, 30 Servings',
      brand: 'Example',
      price: 20,
      online_date: '2026-10-10',
      monthly_sales_volume: 5,
      main_image: 'https://example.test/original.jpg',
    },
    { channel: 'amazon', market: 'US' },
    at,
  );

test('title ingredients, selling points and full Chinese translations are accepted with their original evidence', () => {
  const product = makeProduct();
  const sample = sourceFieldSample('products', product);
  const result = validateSourceFields(
    {
      supplement: { value: true, sourceId: 'title', quote: product.title },
      fields: [
        {
          field: 'ingredient',
          value: ['Magnesium', 'L-Theanine'],
          sourceId: 'title',
          quote: product.title,
          relation: 'mention',
        },
        {
          field: 'claim',
          value: 'Calm and Sleep Support',
          sourceId: 'title',
          quote: product.title,
          relation: 'claim',
        },
        {
          field: 'size',
          value: '30 Servings',
          sourceId: 'title',
          quote: product.title,
          relation: 'attribute',
        },
      ],
      translations: [
        {
          field: 'titleZh',
          text: '镁与茶氨酸舒缓睡眠补充剂，30份',
          sourceId: 'title',
          quote: product.title,
        },
        {
          field: 'ingredientZh',
          text: ['镁', '茶氨酸'],
          sourceId: 'title',
          quote: product.title,
        },
        {
          field: 'claimZh',
          text: '舒缓及睡眠支持',
          sourceId: 'title',
          quote: product.title,
        },
        {
          field: 'sizeZh',
          text: '30份',
          sourceId: 'title',
          quote: product.title,
        },
      ],
    },
    sample,
  );
  assert.equal(result.patch.ingredient, 'Magnesium; L-Theanine');
  assert.equal(result.patch.ingredientZh, '镁；茶氨酸');
  assert.deepEqual(result.patch.benefitsZh, ['舒缓及睡眠支持']);
  assert.equal(result.patch.sizeZh, '30份');
  assert.equal(result.patch.ingredientInsights.length, 2);
  assert.equal(result.patch.dose, undefined);
  assert.equal(result.analysis.fields.ingredient.quote, product.title);
});

test('negated ingredients and translations attached to the wrong source do not become product fields', () => {
  const p = {
    title: 'Magnesium supplement without Melatonin',
    brand: 'Example',
  };
  const result = validateSourceFields(
    {
      fields: [
        {
          field: 'ingredient',
          value: 'Melatonin',
          sourceId: 'title',
          quote: p.title,
          relation: 'mention',
        },
      ],
      translations: [
        {
          field: 'titleZh',
          text: '虚构标题',
          sourceId: 'product-brand',
          quote: p.brand,
        },
      ],
    },
    sourceFieldSample('products', p),
  );
  assert.equal(result.patch.ingredient, undefined);
  assert.equal(result.patch.titleZh, undefined);
});

test('ingredient lists and noncontiguous model quotes map to literal names in the actual product source', () => {
  const sample = sourceFieldSample('products', { title: 'Magnesium Glycinate Gummies with Chelated Magnesium Bisglycinate, without Melatonin' });
  const result = validateSourceFields({ fields: [{ field: 'ingredient', value: 'Magnesium Glycinate; Magnesium Bisglycinate', sourceId: 'title', quote: 'Magnesium Glycinate, Magnesium Bisglycinate', relation: 'mention' }], translations: [{ field: 'ingredientZh', text: ['甘氨酸镁', '双甘氨酸镁'], sourceId: 'title', quote: 'Magnesium Glycinate, Magnesium Bisglycinate' }] }, sample);
  assert.equal(result.patch.ingredient, 'Magnesium Glycinate; Magnesium Bisglycinate');
  assert.equal(result.patch.ingredientZh, '甘氨酸镁；双甘氨酸镁');
  assert.ok(sample.sources[0].text.includes(result.analysis.fields.ingredient.quote));
  const invented = validateSourceFields({ fields: [{ field: 'ingredient', value: 'Magnesium Glycinate; Creatine', sourceId: 'title', quote: sample.sources[0].text }] }, sample);
  assert.equal(invented.patch.ingredient, 'Magnesium Glycinate');
});

test('a hallucinated or negated name does not discard other proven ingredients or retain its translation', () => {
  const sample = sourceFieldSample('products', { title: 'Molecular Hydrogen Tablets without Melatonin' });
  const result = validateSourceFields({ fields: [{ field: 'ingredient', value: ['Molecular Hydrogen', 'Magnesium', 'Melatonin'], sourceId: 'title', quote: 'Molecular Hydrogen', relation: 'mention' }], translations: [{ field: 'ingredientZh', text: ['分子氢', '镁', '褪黑素'], sourceId: 'title', quote: 'Molecular Hydrogen' }] }, sample);
  assert.equal(result.patch.ingredient, 'Molecular Hydrogen');
  assert.equal(result.patch.ingredientZh, '分子氢');
});

test('product selling points keep literal items and translations may cite another current source containing the same attribute', () => {
  const sample = sourceFieldSample('products', { title: 'Energy, Stamina & Drive, 60 Capsules', sourceContent: { attributes: { 'Item Form': 'Capsule' } } });
  const result = validateSourceFields({ fields: [{ field: 'benefits', value: ['Energy', 'Stamina', 'Cures disease'], sourceId: 'title', quote: 'Energy', relation: 'mention' }, { field: 'form', value: 'Capsule', sourceId: 'attribute:Item Form', quote: 'Item Form: Capsule', relation: 'attribute' }], translations: [{ field: 'benefitsZh', text: ['能量', '耐力', '治病'], sourceId: 'title', quote: 'Energy' }, { field: 'formZh', text: '胶囊', sourceId: 'title', quote: '60 Capsules' }] }, sample);
  assert.deepEqual(result.patch.benefits, ['Energy', 'Stamina']);
  assert.deepEqual(result.patch.benefitsZh, ['能量', '耐力']);
  assert.equal(result.patch.formZh, '胶囊');
});

test('a valid ingredient prefix keeps its matching Chinese prefix when unsupported trailing names were compressed by AI', () => {
  const sample = sourceFieldSample('products', { title: 'Magnesium with D3 and K2' });
  const result = validateSourceFields({ fields: [{ field: 'ingredient', value: ['Magnesium', 'D3', 'K2', 'Vitamin D3', 'Vitamin K2', 'Biotin'], sourceId: 'title', quote: 'Magnesium with D3 and K2' }], translations: [{ field: 'ingredientZh', text: ['镁', '维生素D3', '维生素K2', '生物素'], sourceId: 'title', quote: 'Magnesium with D3 and K2' }] }, sample);
  assert.equal(result.patch.ingredientZh, '镁；维生素D3；维生素K2');
});

test('capture obtains details and content before AI, preserving usable fields when AI omits them', async () => {
  const p = makeProduct(),
    calls = [];
  const prepared = await prepareProductIntake({ id: 'job' }, p, {
    collect: async (_job, _step, request) => {
      calls.push(request.sources[0] + ':' + (request.op || 'fields'));
      if (request.op === 'detail')
        return {
          product: {
            ...p,
            brand: 'Detailed brand',
            sourceMetrics: { monthlySales: 7 },
          },
        };
      if (request.op === 'content')
        return {
          patch: {
            sourceContent: { descriptions: ['Supports calm and sleep'] },
            imageUrls: ['https://example.test/detail.jpg'],
          },
        };
      assert.ok(
        request.sample.sources.some(
          (s) => s.text === 'Supports calm and sleep',
        ),
      );
      return {
        patch: { titleZh: '镁营养补充剂' },
        analysis: {
          status: 'analyzed',
          fingerprint: request.sample.fingerprint,
          supplement: true,
        },
      };
    },
  });
  assert.deepEqual(calls, [
    'product_intake_source:detail',
    'product_intake_source:content',
    'field_analysis:fields',
  ]);
  assert.equal(prepared.product.price, 20);
  assert.equal(prepared.product.brand, 'Detailed brand');
  assert.equal(prepared.product.sourceMetrics.monthlySales, 7);
  assert.equal(prepared.product.imageUrl, p.imageUrl);
  assert.equal(prepared.product.titleZh, '镁营养补充剂');
  assert.equal(
    productListingDate(prepared.product, Date.parse(at)),
    '2026-10-10',
  );
});

test('source or AI failure preserves the product and a resumed unknown request never repeats the provider call', async () => {
  const journal = new Set(),
    providerCalls = [];
  const io = {
    collect: async (_job, step) => {
      if (journal.has(step)) throw Error('上次请求结果未知，不重复请求');
      journal.add(step);
      providerCalls.push(step);
      throw Error('来源暂时不可用');
    },
  };
  const first = await prepareProductIntake({ id: 'job' }, makeProduct(), io);
  const count = providerCalls.length;
  const resumed = await prepareProductIntake({ id: 'job' }, makeProduct(), io);
  assert.equal(providerCalls.length, count);
  assert.equal(first.product.price, 20);
  assert.equal(resumed.product.sourceMetrics.monthlySales, 5);
  assert.equal(resumed.product.fieldAnalysis.status, 'pending');
  assert.equal(resumed.errors.length, 3);
});

test('official board details still fetch content before AI and extract a source brand', async () => {
  const product = makeProduct(),
    calls = [];
  const prepared = await prepareProductIntake(
    { id: 'official' },
    product,
    {
      collect: async (_job, _step, request) => {
        calls.push(request.op || 'fields');
        if (request.op === 'content')
          return {
            patch: {
              sourceContent: { productInfo: { Brand: 'Ryurop' } },
              imageUrls: ['https://example.test/extra.jpg'],
            },
          };
        const sample = request.sample;
        return validateSourceFields(
          {
            fields: [
              {
                field: 'brand',
                value: 'Ryurop',
                sourceId: 'attribute:Brand',
                quote: 'Brand: Ryurop',
                relation: 'attribute',
              },
            ],
            translations: [
              {
                field: 'brandZh',
                text: 'Ryurop',
                sourceId: 'attribute:Brand',
                quote: 'Brand: Ryurop',
              },
            ],
          },
          sample,
        );
      },
    },
    { detailLoaded: true },
  );
  assert.deepEqual(calls, ['content', 'fields']);
  assert.equal(prepared.product.brand, 'Ryurop');
  assert.equal(prepared.product.brandZh, 'Ryurop');
  assert.ok(
    prepared.product.imageUrls.includes('https://example.test/extra.jpg'),
  );
});

test('an unresolved old classification blocks new intake calls during a release upgrade', async () => {
  const original = makeProduct();
  const prepared = await prepareProductIntake(
    { id: 'old-job' },
    original,
    {
      pool: { query: async () => ({ rows: [{ status: 'started' }] }) },
      collect: async () => {
        throw Error('must not send a new paid request');
      },
    },
    { legacyAnalysisStep: 'classify:old' },
  );
  assert.equal(prepared.product, original);
  assert.match(prepared.errors[0], /未知/);
});

test('Sorftime content keeps images and attributes; mismatched product identities are rejected', async () => {
  const p = makeProduct();
  const client = {
    tools: [
      {
        name: 'product_content',
        inputSchema: {
          properties: {
            asin: { type: 'string' },
            amz_site: { type: 'string', enum: ['US'] },
          },
        },
      },
    ],
    rpc: async () => ({
      structuredContent: {
        data: {
          asin: p.sourceProductId,
          main_image: ['https://example.test/detail.jpg'],
          description: 'Sleep Support',
          property: '["Special Ingredients","Magnesium"]',
        },
      },
    }),
  };
  const result = await productIntakeSource(
    { op: 'content', product: p },
    { client },
  );
  assert.equal(
    result.patch.sourceContent.attributes['Special Ingredients'],
    'Magnesium',
  );
  assert.equal(result.patch.imageUrl, 'https://example.test/detail.jpg');
  client.rpc = async () => ({
    structuredContent: {
      data: { asin: 'B999999999', description: 'Other item' },
    },
  });
  await assert.rejects(
    productIntakeSource({ op: 'content', product: p }, { client }),
    /标识不一致/,
  );
});

test('saved source month sales and listing dates appear directly; removed period metrics stay absent even in old summaries', () => {
  const p = makeProduct();
  delete p.decisionData.listing.platform;
  delete p.decisionData.listing.market;
  p.coreSummary = {
    periods: {
      30: [
        { key: 'sales', value: 99 },
        { key: 'dailySales', value: 3 },
      ],
    },
  };
  const metrics = coreMetrics('products', p);
  assert.equal(
    metrics.find((m) => m.key === 'listingDate').value,
    '2026-10-10',
  );
  assert.equal(metrics.find((m) => m.key === 'cumulativeSold').value, 5);
  assert.ok(!metrics.some((m) => ['sales', 'dailySales'].includes(m.key)));
  const wrong = structuredClone(p);
  wrong.decisionData.listing.sourceMarket = 'MX';
  assert.equal(productListingDate(wrong), '');
});

test('new content does not erase existing descriptions and changed originals invalidate stale Chinese fields', () => {
  const p = makeProduct();
  const merged = mergePlatformProduct(
    {
      ...p,
      titleZh: '旧中文',
      sourceContent: {
        descriptions: ['Existing description'],
        attributes: { Ingredients: 'Magnesium' },
      },
    },
    {
      id: p.id,
      title: 'A different supplement',
      sourceContent: { descriptions: [], attributes: {} },
    },
  );
  assert.deepEqual(merged.sourceContent.descriptions, ['Existing description']);
  assert.equal(merged.sourceContent.attributes.Ingredients, 'Magnesium');
  assert.equal(merged.titleZh, undefined);
});

test('new platform tasks complete product fields within capture and checkpoint replay does not double-count intake', async () => {
  const p = makeProduct(),
    journal = new Map(),
    saved = new Map();
  const job = {
    id: 'new-platform-job',
    input: {
      productIntakeVersion: 2,
      market: 'US',
      resourcePlan: {
        provider: 'sorftime',
        platform: 'amazon',
        routeId: 'amazon-sorftime',
        mode: 'keyword',
        terms: ['magnesium'],
        salesWindowDays: 30,
        ranking: 'sample',
        maxProducts: 1,
        budget: { maxPages: 1, maxDetailProducts: 0 },
      },
    },
    checkpoint: {},
  };
  let failSave = true;
  const io = {
    now: () => Date.parse(at),
    isCancelled: async () => false,
    saveCheckpoint: async (_job, cp) => {
      job.checkpoint = structuredClone(cp);
    },
    readProduct: async (id) => saved.get(id),
    upsertProduct: async (product) => {
      if (failSave && product.title) {
        failSave = false;
        throw Error('Simulated storage interruption');
      }
      saved.set(product.id, product);
    },
    collect: async (_job, step, request) => {
      if (journal.has(step)) return journal.get(step);
      let result;
      if (request.sources[0] === 'field_analysis')
        result = {
          patch: { titleZh: '镁与茶氨酸补充剂' },
          analysis: {
            status: 'analyzed',
            fingerprint: request.sample.fingerprint,
            supplement: true,
          },
          usage: { requests: 1, modelTokens: 100 },
        };
      else if (request.sources[0] === 'product_intake_source')
        result = {
          empty: true,
          usage: { requests: 1, sorftimeCalls: 1, providerCalls: 1 },
        };
      else
        result = {
          products: [p],
          providerCalls: 1,
          usage: { requests: 1, sorftimeCalls: 1, providerCalls: 1 },
        };
      journal.set(step, result);
      return result;
    },
  };
  await assert.rejects(
    runProductResourceDiscovery(job, io),
    /storage interruption/,
  );
  const count = journal.size;
  await runProductResourceDiscovery(job, io);
  assert.equal(journal.size, count);
  assert.equal(count, 4);
  assert.equal(saved.get(p.id).titleZh, '镁与茶氨酸补充剂');
  assert.equal(job.checkpoint.confirmedUsage.modelTokens, 100);
  assert.equal(job.checkpoint.reserved.requests, 4);
});
