import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyTranslations,
  planTranslations,
  translationBatches,
  translationHash,
  translationKey,
  translationParts,
} from './collection-translation-domain.mjs';
import {
  translateCollectedResult,
  translateCollectionRecords,
} from './collection-translation.mjs';
import { mergePlatformProduct } from './platform-product-data.mjs';
import { gateSourceFields } from './source-field-domain.mjs';

function harness() {
  const stored = new Map();
  const calls = [];
  const io = {
    read: async (items) =>
      new Map(items.map((item) => [item.key, stored.get(item.key)])),
    claim: async (items, owner) => {
      for (const item of items)
        if (stored.get(item.key)?.status === 'started')
          throw Error('结果尚未确认，不重复调用');
      for (const item of items)
        if (!stored.has(item.key))
          stored.set(item.key, { status: 'started', owner });
      return new Map(items.map((item) => [item.key, stored.get(item.key)]));
    },
    write: async (key, value) => stored.set(key, value),
    request: async (items) => {
      calls.push(items);
      return {
        result: {
          items: items.map((item) => ({
            id: item.key,
            text: `中文${item.text}`,
          })),
        },
        model: 'synthetic',
      };
    },
  };
  return { io, stored, calls };
}

test('collection translates ads, products, sites and keyword batches before returning results', async () => {
  const h = harness();
  const source = {
    ads: [
      { id: 'a', brand: 'Brand', headline: 'Magnesium', copy: 'Sleep support' },
    ],
    products: [{ id: 'p', title: 'Magnesium', benefits: ['Sleep support'] }],
    sites: [
      {
        id: 's',
        brand: 'Brand',
        mainProducts: ['Magnesium'],
        description: 'Sleep support',
      },
    ],
    suggestions: [
      { source: 'synthetic', items: [{ term: 'Magnesium', source: 'test' }] },
    ],
    creditsCharged: 1,
  };
  const result = await translateCollectedResult(source, (kind, rows) =>
    translateCollectionRecords(kind, rows, h.io),
  );
  assert.equal(result.ads[0].brandZh, '中文Brand');
  assert.equal(result.products[0].titleZh, '中文Magnesium');
  assert.deepEqual(result.sites[0].mainProductsZh, ['中文Magnesium']);
  assert.equal(result.suggestions[0].items[0].termZh, '中文Magnesium');
  assert.equal(result.creditsCharged, 1);
  assert.equal(
    h.calls.length,
    1,
    'same texts across kinds reuse persistent cache',
  );
  assert.equal(
    source.ads[0].brandZh,
    undefined,
    'source response stays unchanged',
  );
});

test('manual Chinese names, Chinese source values and numeric values do not request a model', async () => {
  const h = harness();
  const [record] = await translateCollectionRecords(
    'products',
    [
      {
        title: 'Foreign title',
        titleZh: '人工中文名',
        brand: '中文品牌',
        size: '120',
      },
    ],
    h.io,
  );
  assert.equal(record.titleZh, '人工中文名');
  assert.equal(record.brandZh, '中文品牌');
  assert.equal(record.sizeZh, '120');
  assert.equal(h.calls.length, 0);
});

test('batch deduplication and cache reuse avoid repeat calls across later collections', async () => {
  const h = harness();
  const records = [
    { term: 'creatine' },
    { term: 'creatine' },
    { term: 'magnesium', seedTerm: 'creatine' },
  ];
  await translateCollectionRecords('keywords', records, h.io);
  await translateCollectionRecords('keywords', records, h.io);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].length, 2);
});

test('mixed source languages are translated while Chinese dosage notation stays usable', async () => {
  const h = harness();
  const [record] = await translateCollectionRecords(
    'products',
    [{ title: 'Maltitol 无糖 candy', ingredient: '维生素C', size: '120粒' }],
    h.io,
  );
  assert.equal(record.titleZh, '中文Maltitol 无糖 candy');
  assert.equal(record.ingredientZh, '维生素C');
  assert.equal(record.sizeZh, '120粒');
  assert.equal(h.calls.flat().length, 1);
});

test('a placeholder collection field cannot replace the translation of a retained product field', async () => {
  const h = harness();
  const [patch] = await translateCollectionRecords(
    'products',
    [{ id: 'p', brand: '品牌待确认', ingredient: '平台未返回配方' }],
    h.io,
  );
  const merged = mergePlatformProduct(
    {
      id: 'p',
      brand: 'Known brand',
      brandZh: '已知品牌',
      ingredient: 'Magnesium',
      ingredientZh: '镁',
    },
    patch,
  );
  assert.equal(merged.brand, 'Known brand');
  assert.equal(merged.brandZh, '已知品牌');
  assert.equal(merged.ingredient, 'Magnesium');
  assert.equal(merged.ingredientZh, '镁');
});

test('related query and seed translations are saved with the collected keyword', async () => {
  const h = harness();
  const [record] = await translateCollectionRecords(
    'keywords',
    [
      {
        term: 'magnesium',
        seedTerm: 'sleep',
        trendRelatedTop: [{ query: 'sleep support', value: 100 }],
        trendRelatedRising: [{ query: 'calm', breakout: true }],
      },
    ],
    h.io,
  );
  assert.equal(record.seedTermZh, '中文sleep');
  assert.equal(record.trendRelatedTop[0].queryZh, '中文sleep support');
  assert.equal(record.trendRelatedRising[0].queryZh, '中文calm');
  assert.equal(record.trendRelatedRising[0].breakout, true);
});

test('changed source text replaces machine translation but never edits the original', async () => {
  const h = harness();
  const [first] = await translateCollectionRecords(
    'ads',
    [{ headline: 'First headline' }],
    h.io,
  );
  const [second] = await translateCollectionRecords(
    'ads',
    [{ ...first, headline: 'New headline' }],
    h.io,
  );
  assert.equal(second.headline, 'New headline');
  assert.equal(second.headlineZh, '中文New headline');
  assert.equal(second.sellingPointZh, '中文New headline');
  assert.equal(
    second.collectionTranslation.fields.headline,
    translationHash(JSON.stringify('New headline')),
  );
});

test('changing copy refreshes a generated selling point but retains an edited one', async () => {
  const h = harness();
  const [first] = await translateCollectionRecords(
    'ads',
    [{ copy: 'First copy' }],
    h.io,
  );
  const [second] = await translateCollectionRecords(
    'ads',
    [{ ...first, copy: 'Changed copy' }],
    h.io,
  );
  assert.equal(second.sellingPointZh, '中文Changed copy');
  const [edited] = await translateCollectionRecords(
    'ads',
    [{ ...first, copy: 'Changed copy', sellingPointZh: '人工提炼的卖点' }],
    h.io,
  );
  assert.equal(edited.sellingPointZh, '人工提炼的卖点');
});

test('a later batch joins translations started while its earlier batch was pending', async () => {
  const h = harness();
  const originalRequest = h.io.request;
  let releaseFirst, releaseShared, startedFirst, startedShared;
  const firstStarted = new Promise((resolve) => {
    startedFirst = resolve;
  });
  const sharedStarted = new Promise((resolve) => {
    startedShared = resolve;
  });
  h.io.request = async (items) => {
    if (items.some((item) => item.text === 'batch-0')) {
      startedFirst();
      await new Promise((resolve) => {
        releaseFirst = resolve;
      });
    }
    if (items.some((item) => item.text === 'shared-last')) {
      startedShared();
      await new Promise((resolve) => {
        releaseShared = resolve;
      });
    }
    return originalRequest(items);
  };
  const first = translateCollectionRecords(
    'keywords',
    [
      ...Array.from({ length: 32 }, (_, i) => ({ term: `batch-${i}` })),
      { term: 'shared-last' },
    ],
    h.io,
  );
  await firstStarted;
  const other = translateCollectionRecords(
    'keywords',
    [{ term: 'shared-last' }],
    h.io,
  );
  await sharedStarted;
  releaseFirst();
  // Let the first collection reach its next batch while shared-last is pending.
  await new Promise((resolve) => setImmediate(resolve));
  releaseShared();
  const [records, shared] = await Promise.all([first, other]);
  assert.equal(records.at(-1).termZh, shared[0].termZh);
  assert.equal(
    h.calls.flat().filter((item) => item.text === 'shared-last').length,
    1,
  );
});

test('long copy is segmented without discarding text or splitting Unicode characters', async () => {
  const h = harness();
  const copy = '💚A'.repeat(3500);
  assert.equal(translationParts(copy).join(''), copy);
  const [result] = await translateCollectionRecords('ads', [{ copy }], h.io);
  assert.equal(result.copy, copy);
  assert.ok(result.copyZh.length > copy.length);
  for (const batch of h.calls)
    assert.ok(batch.reduce((n, item) => n + item.text.length, 0) <= 2400);
});

test('incomplete model output fails collection and cannot be retried automatically', async () => {
  const h = harness();
  h.io.request = async (items) => {
    h.calls.push(items);
    return { result: { items: [] } };
  };
  await assert.rejects(
    translateCollectionRecords('keywords', [{ term: 'unknown' }], h.io),
    /不完整/,
  );
  await assert.rejects(
    translateCollectionRecords('keywords', [{ term: 'unknown' }], h.io),
    /未确认/,
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.stored.get(translationKey('unknown')).status, 'started');
});

test('unknown previous translation does not make a new model request', async () => {
  const h = harness();
  h.stored.set(translationKey('unknown'), {
    status: 'started',
    owner: 'previous',
  });
  await assert.rejects(
    translateCollectionRecords('keywords', [{ term: 'unknown' }], h.io),
    /未确认/,
  );
  assert.equal(h.calls.length, 0);
});

test('overlapping calls in one process share an in-flight translation', async () => {
  const h = harness();
  const results = await Promise.all([
    translateCollectionRecords('keywords', [{ term: 'concurrent' }], h.io),
    translateCollectionRecords('keywords', [{ term: 'concurrent' }], h.io),
  ]);
  assert.equal(h.calls.length, 1);
  assert.equal(results[0][0].termZh, results[1][0].termZh);
});

test('source-field pending gates preserve translations made during collection', async () => {
  const h = harness();
  const [ad] = await translateCollectionRecords(
    'ads',
    [
      {
        id: 'a',
        brand: 'Brand',
        headline: 'Headline',
        copy: 'Copy',
        benefits: ['Benefit'],
      },
    ],
    h.io,
  );
  const saved = gateSourceFields('ads', undefined, ad, ad);
  assert.equal(saved.headlineZh, '中文Headline');
  assert.deepEqual(saved.benefits, ['Benefit']);
  assert.equal(saved.fieldAnalysis.status, 'pending');
  const changed = gateSourceFields(
    'ads',
    undefined,
    { ...ad, headline: 'Different' },
    { headline: 'Different' },
  );
  assert.equal(changed.headlineZh, undefined);
  const [site] = await translateCollectionRecords(
    'sites',
    [{ brand: 'Brand', mainProducts: ['Product'], description: 'Description' }],
    h.io,
  );
  const siteSaved = gateSourceFields('sites', undefined, site, site);
  assert.equal(siteSaved.descriptionZh, '中文Description');
  assert.deepEqual(siteSaved.mainProducts, ['Product']);
});

test('missing or unrelated translation IDs never count as a complete collection', () => {
  const records = [{ title: 'Title' }];
  assert.throws(
    () =>
      applyTranslations(
        records,
        planTranslations('products', records),
        new Map(),
      ),
    /未完整/,
  );
  const batches = translationBatches(
    Array.from({ length: 70 }, (_, i) => ({ text: `term ${i}` })),
  );
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [32, 32, 6],
  );
});

test('cancellation stops before claiming or charging another translation batch', async () => {
  const h = harness();
  h.io.isCancelled = async () => true;
  await assert.rejects(
    translateCollectionRecords('keywords', [{ term: 'cancelled' }], h.io),
    /已取消/,
  );
  assert.equal(h.stored.size, 0);
  assert.equal(h.calls.length, 0);
});
