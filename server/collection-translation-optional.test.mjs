/* oxlint-disable vitest/no-import-node-test -- Server regressions use the Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { translationKey } from './collection-translation-domain.mjs';
import { translationBatchKey } from './collection-translation-recovery.mjs';
import {
  translateCollectedResult,
  translateCollectionRecords,
} from './collection-translation.mjs';
import { jobProgress } from './job-progress.mjs';
import { createKeywordSaver } from './keyword-store.mjs';
import { taskOverview } from './task-overview.mjs';

function harness() {
  const stored = new Map();
  const calls = [];
  const io = {
    read: async (items) =>
      new Map(items.map((item) => [item.key, stored.get(item.key)])),
    claim: async (items, owner) => {
      for (const item of items) {
        assert.equal(
          stored.has(item.key),
          false,
          'invalid and unknown claims must not be reclaimed',
        );
        stored.set(item.key, { status: 'started', owner });
      }
      return new Map(items.map((item) => [item.key, stored.get(item.key)]));
    },
    write: async (key, value) => stored.set(key, value),
    readBatch: async (owner) => stored.get(translationBatchKey(owner)),
    request: async (items) => {
      calls.push(items.map((item) => item.text));
      return {
        result: {
          items: items.map((item) => ({
            id: item.key,
            text: item.text === 'elahring' ? item.text : `中文${item.text}`,
          })),
        },
      };
    },
  };
  const translate = (kind, records) =>
    translateCollectionRecords(kind, records, io, { optional: true });
  return { stored, calls, io, translate };
}

test('a non-Chinese response preserves its original and valid members without replaying the model', async () => {
  const h = harness();
  const original = [
    { term: 'elahring', seedTerm: 'elahring' },
    { term: 'sleep' },
  ];
  const translated = await h.translate('keywords', original);
  assert.equal(translated[0].term, 'elahring');
  assert.equal(translated[0].termZh, undefined);
  assert.equal(translated[0].collectionTranslation.status, 'partial');
  assert.match(translated[0].collectionTranslation.message, /未包含中文/);
  assert.equal(translated[1].termZh, '中文sleep');
  assert.equal(translated[1].collectionTranslation.status, 'complete');
  assert.deepEqual(await h.translate('keywords', original), translated);
  assert.equal(h.calls.length, 1);
  assert.equal(h.stored.get(translationKey('elahring')).status, 'invalid');
  assert.equal(original[0].collectionTranslation, undefined);
});

test('cached invalid or unknown translations do not block fresh independent texts', async () => {
  const h = harness();
  h.stored.set(translationKey('invalid'), {
    status: 'invalid',
    owner: 'bad',
    error: '没有有效译文',
  });
  h.stored.set(translationKey('unknown'), {
    status: 'started',
    owner: 'pending',
  });
  const result = await h.translate('keywords', [
    { term: 'invalid' },
    { term: 'unknown' },
    { term: 'fresh' },
  ]);
  assert.deepEqual(h.calls, [['fresh']]);
  assert.equal(result[2].termZh, '中文fresh');
  assert.match(result[1].collectionTranslation.message, /尚未确认/);
  assert.equal(h.stored.get(translationKey('unknown')).owner, 'pending');
  assert.equal(h.stored.get(translationKey('invalid')).status, 'invalid');
});

test('an invalid early batch does not suppress later batches or their valid translations', async () => {
  const h = harness();
  const records = [
    { term: 'elahring' },
    ...Array.from({ length: 33 }, (_, i) => ({ term: `valid-${i}` })),
  ];
  const result = await h.translate('keywords', records);
  assert.equal(h.calls.length, 2);
  assert.equal(result[0].collectionTranslation.status, 'partial');
  assert.equal(result[1].termZh, '中文valid-0');
  assert.equal(result.at(-1).termZh, '中文valid-32');
});

test('fallback keeps successful fields and manual translations without labeling untranslated originals as Chinese', async () => {
  const h = harness();
  const [result] = await h.translate('products', [
    {
      title: 'sleep',
      ingredient: 'elahring',
      brand: 'Brand',
      brandZh: '手工品牌',
    },
  ]);
  assert.equal(result.titleZh, '中文sleep');
  assert.equal(result.ingredient, 'elahring');
  assert.equal(result.ingredientZh, undefined);
  assert.equal(result.brandZh, '手工品牌');
  assert.ok(result.collectionTranslation.fields.title);
  assert.equal(result.collectionTranslation.fields.ingredient, undefined);
});

test('untranslated changed text clears its stale machine translation', async () => {
  const h = harness();
  const [first] = await h.translate('products', [{ title: 'sleep' }]);
  const [second] = await h.translate('products', [
    { ...first, title: 'elahring' },
  ]);
  assert.equal(second.title, 'elahring');
  assert.equal(second.titleZh, undefined);
  assert.equal(second.collectionTranslation.fields.title, undefined);
});

test('nested related-query translation failures preserve raw queries and do not block the keyword', async () => {
  const h = harness();
  const [result] = await h.translate('keywords', [
    { term: 'sleep', trendRelatedTop: [{ query: 'elahring', value: 10 }] },
  ]);
  assert.equal(result.termZh, '中文sleep');
  assert.equal(result.trendRelatedTop[0].query, 'elahring');
  assert.equal(result.trendRelatedTop[0].value, 10);
  assert.equal(result.collectionTranslation.status, 'partial');
});

test('missing model configuration and cache read failures keep original records usable', async () => {
  for (const stage of ['read', 'prepareRequest']) {
    const h = harness();
    h.io[stage] = async () => {
      throw Error(`synthetic ${stage} unavailable`);
    };
    const [result] = await h.translate('keywords', [{ term: 'raw' }]);
    assert.equal(result.term, 'raw');
    assert.match(result.collectionTranslation.message, /unavailable/);
    assert.equal(h.calls.length, 0);
  }
});

test('a model timeout leaves its unknown claim intact and never triggers another paid attempt', async () => {
  const h = harness();
  let calls = 0;
  h.io.request = async () => {
    calls++;
    throw Error('synthetic model timeout');
  };
  const [first] = await h.translate('keywords', [{ term: 'raw' }]);
  const [second] = await h.translate('keywords', [{ term: 'raw' }]);
  assert.match(first.collectionTranslation.message, /timeout/);
  assert.match(second.collectionTranslation.message, /未确认/);
  assert.equal(calls, 1);
  assert.equal(h.stored.get(translationKey('raw')).status, 'started');
});

test('optional translation still honors cancellation before issuing a model request', async () => {
  const h = harness();
  h.io.isCancelled = async () => true;
  await assert.rejects(
    h.translate('keywords', [{ term: 'raw' }]),
    /任务已取消/,
  );
  assert.equal(h.calls.length, 0);
});

test('collection results keep source metrics and independent kinds despite a translation gap', async () => {
  const h = harness();
  const source = {
    products: [{ title: 'elahring' }],
    keywords: [{ term: 'sleep' }],
    creditsCharged: 2,
    apiUnits: 10,
  };
  const result = await translateCollectedResult(source, h.translate);
  assert.equal(result.products[0].title, 'elahring');
  assert.equal(result.keywords[0].termZh, '中文sleep');
  assert.equal(result.creditsCharged, 2);
  assert.equal(result.apiUnits, 10);
});

test('translation fallback cannot hide a keyword persistence failure', async () => {
  const h = harness();
  const save = createKeywordSaver({
    pool: {
      connect: async () => {
        throw Error('synthetic database write unavailable');
      },
    },
    sql: (s) => s,
    prepare: async (r) => (await h.translate('keywords', [r]))[0],
  });
  await assert.rejects(
    save({ term: 'elahring', market: 'US' }),
    /database write unavailable/,
  );
});

test('historical initialization failures show their real stop reason and unexecuted rows', () => {
  const job = {
    status: 'partial',
    input: {
      expansionOnly: true,
      seeds: ['elahring', 'elah', 'Elah'],
      markets: ['US'],
      sources: ['semrush', 'sorftime'],
    },
    checkpoint: {
      keywords: [{ id: 'seed', term: 'elahring', market: 'US' }],
      logs: ['翻译结果已返回但校验失败：采集翻译未包含中文'],
    },
  };
  const progress = jobProgress(job);
  const overview = taskOverview(job, { progress });
  assert.match(overview.reason, /停止原因：.*未包含中文/);
  assert.match(overview.reason, /发现组合 0\/3/);
  assert.equal(progress.rows[0].status, 'not_started');
  assert.match(progress.rows[0].message, /月搜索量未执行/);
});

test('a successful collection reports translation gaps without claiming collection failed', () => {
  const job = {
    status: 'awaiting_review',
    input: {
      expansionOnly: true,
      seeds: ['elahring'],
      markets: ['US'],
      sources: ['semrush'],
    },
    checkpoint: {
      discoveryComplete: true,
      metricIndex: 1,
      keywords: [
        {
          id: 'seed',
          term: 'elahring',
          market: 'US',
          collectionTranslation: { status: 'partial' },
          semrushCollection: { status: 'completed' },
        },
      ],
      logs: ['old translation failed'],
    },
  };
  const progress = jobProgress(job);
  const overview = taskOverview(job, { progress });
  assert.equal(overview.outcome, '本次采集目标完成');
  assert.match(overview.reason, /中文翻译未完成/);
  assert.doesNotMatch(overview.reason, /停止原因/);
  assert.equal(progress.failed, 0);
  assert.equal(progress.rows[0].status, 'collected');
});

test('a specific current failure remains visible alongside expansion progress', () => {
  const job = {
    status: 'partial',
    input: {
      expansionOnly: true,
      seeds: ['seed'],
      markets: ['US'],
      sources: ['semrush'],
    },
    checkpoint: { keywords: [], stopReason: '保存关键词失败', logs: [] },
  };
  assert.match(
    taskOverview(job, { progress: jobProgress(job) }).reason,
    /停止原因：保存关键词失败/,
  );
});
