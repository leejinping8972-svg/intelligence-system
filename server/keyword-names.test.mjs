/* oxlint-disable vitest/no-import-node-test -- Server test suite uses Node. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { aiPromptSnapshot } from './ai-prompt-defaults.mjs';
import { cleanKeyword, editableKeywordPatch } from './domain.mjs';
import {
  keywordNamesAction,
  keywordTranslationsAction,
  validateNames,
} from './keyword-names.mjs';

const record = {
  id: 'one',
  term: 'creatine gummies',
  market: 'US',
  dataNature: 'collected',
};
test('Chinese names survive normalization and editable patches without admitting arbitrary fields', () => {
  assert.equal(
    cleanKeyword({ ...record, termZh: '  肌酸 软糖  ' }).termZh,
    '肌酸 软糖',
  );
  assert.equal(
    cleanKeyword({ ...record, termZh: { prompt: 'bad' } }).termZh,
    undefined,
  );
  assert.deepEqual(
    editableKeywordPatch({ termZh: '肌酸软糖', term: 'replaced', id: 'bad' }),
    { termZh: '肌酸软糖' },
  );
  assert.equal(editableKeywordPatch({ termZh: '' }).termZh, '');
  assert.equal(
    editableKeywordPatch({ termZh: '词'.repeat(300) }).termZh.length,
    255,
  );
});
test('model translations must match exactly the requested IDs and contain Chinese', () => {
  assert.deepEqual(
    validateNames({ items: [{ id: 'one', termZh: '肌酸软糖' }] }, [record]),
    [{ id: 'one', termZh: '肌酸软糖' }],
  );
  for (const items of [
    [],
    [{ id: 'wrong', termZh: '词' }],
    [{ id: 'one', termZh: 'English' }],
    [{ id: 'one', termZh: '词'.repeat(256) }],
  ])
    assert.throws(() => validateNames({ items }, [record]));
  assert.throws(() =>
    validateNames(
      {
        items: [
          { id: 'one', termZh: '词' },
          { id: 'one', termZh: '词' },
        ],
      },
      [record, { ...record, id: 'two' }],
    ),
  );
});
test('only explicit admin requests make one configured-model call; missing records and over-limit rejected before charging', async () => {
  let calls = 0;
  const io = {
    records: async () => [record],
    prompt: async () => aiPromptSnapshot('keyword_translation'),
    config: async () => ({ model: 'synthetic-model' }),
    post: async (_config, messages) => {
      calls++;
      assert.deepEqual(JSON.parse(messages[1].content).items, [
        { id: record.id, term: record.term, market: 'US' },
      ]);
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ id: 'one', termZh: '肌酸软糖' }],
              }),
            },
          },
        ],
        usage: { total_tokens: 90, secret: 'not returned' },
      };
    },
  };
  await assert.rejects(
    () => keywordNamesAction({ ids: ['one'] }, { role: 'researcher' }, io),
    /管理员/,
  );
  await assert.rejects(
    () =>
      keywordNamesAction(
        { ids: Array.from({ length: 51 }, (_, i) => String(i)) },
        { role: 'admin' },
        io,
      ),
    /1～50/,
  );
  await assert.rejects(
    () => keywordNamesAction({ ids: ['missing'] }, { role: 'admin' }, io),
    /已变化/,
  );
  assert.equal(calls, 0);
  const result = await keywordNamesAction(
    { ids: ['one'] },
    { role: 'admin' },
    io,
  );
  assert.deepEqual(result.items, [{ id: 'one', termZh: '肌酸软糖' }]);
  assert.deepEqual(result.usage, { total_tokens: 90 });
  assert.equal(calls, 1);
});
test('timeouts and truncated responses never retry the model automatically', async () => {
  let calls = 0;
  const io = {
    records: async () => [record],
    prompt: async () => aiPromptSnapshot('keyword_translation'),
    config: async () => ({}),
    post: async () => {
      calls++;
      throw new Error('timeout');
    },
  };
  await assert.rejects(
    () => keywordNamesAction({ ids: ['one'] }, { role: 'admin' }, io),
    /timeout/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      keywordNamesAction(
        { ids: ['one'] },
        { role: 'admin' },
        {
          ...io,
          post: async () => ({
            choices: [{ finish_reason: 'length', message: { content: '{}' } }],
          }),
        },
      ),
    /未完整返回/,
  );
});

test('automatic keyword translations reuse persisted names and record one paid call', async () => {
  const cache = new Map();
  const saved = new Map();
  let calls = 0;
  let recorded = 0;
  const io = {
    records: async () => [
      {
        id: 'keyword-1',
        term: 'creatine gummies',
        seedTerm: 'protein powder',
        trendRelatedTop: [{ query: 'fish oil capsules' }],
      },
    ],
    read: async (terms) =>
      new Map(
        terms
          .filter((term) => cache.has(term))
          .map((term) => [
            `keyword:translation:v1:${createHash('sha256').update(term.toLocaleLowerCase()).digest('hex')}`,
            cache.get(term),
          ]),
      ),
    write: async (term, termZh) => {
      cache.set(term, termZh);
    },
    saveKeywordName: async (term, termZh) => {
      saved.set(term, termZh);
    },
    withLock: async (callback) => callback(),
    config: async () => ({ model: 'synthetic-model' }),
    prompt: async () => aiPromptSnapshot('keyword_translation'),
    record: async (context, callback) => {
      assert.equal(context.sourceId, 'analysis');
      recorded++;
      return callback();
    },
    post: async (_config, messages) => {
      calls++;
      const items = JSON.parse(messages[1].content).items;
      assert.deepEqual(
        items.map((item) => item.term),
        ['creatine gummies', 'protein powder'],
      );
      return {
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  { id: '0', termZh: '肌酸软糖' },
                  { id: '1', termZh: '蛋白粉' },
                ],
              }),
            },
          },
        ],
        usage: { total_tokens: 48 },
      };
    },
  };
  await assert.rejects(
    () =>
      keywordTranslationsAction(
        { terms: ['unrelated paid query'], keywordIds: ['keyword-1'] },
        { role: 'researcher' },
        io,
      ),
    /只允许翻译/,
  );
  await assert.rejects(
    () =>
      keywordTranslationsAction(
        { terms: [], keywordIds: ['keyword-1'] },
        { role: 'admin' },
        io,
      ),
    /1～40/,
  );
  const input = {
    keywordIds: ['keyword-1'],
    terms: ['creatine gummies', 'protein powder', 'creatine gummies'],
  };
  const first = await keywordTranslationsAction(
    input,
    { role: 'researcher' },
    io,
  );
  assert.deepEqual(first.items, [
    { term: 'creatine gummies', termZh: '肌酸软糖' },
    { term: 'protein powder', termZh: '蛋白粉' },
  ]);
  assert.equal(first.usage.total_tokens, 48);
  assert.equal(saved.get('creatine gummies'), '肌酸软糖');
  const second = await keywordTranslationsAction(input, { role: 'admin' }, io);
  assert.equal(second.cached, true);
  assert.deepEqual(second.items, first.items);
  assert.equal(calls, 1);
  assert.equal(recorded, 1);
});
