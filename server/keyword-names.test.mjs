/* oxlint-disable vitest/no-import-node-test -- Server test suite uses Node. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiPromptSnapshot } from './ai-prompt-defaults.mjs';
import { keywordNamesAction, validateNames } from './keyword-names.mjs';
import { cleanKeyword, editableKeywordPatch } from './domain.mjs';

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
