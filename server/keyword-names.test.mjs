/* oxlint-disable vitest/no-import-node-test -- Server test suite uses Node. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

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
test('explicit names action validates authorization and records before using the shared translator', async () => {
  let calls = 0;
  const io = {
    records: async () => [record],
    translate: async (kind, records) => {
      calls++;
      assert.equal(kind, 'keywords');
      assert.deepEqual(
        records.map(({ id, term }) => ({ id, term })),
        [{ id: record.id, term: record.term }],
      );
      return records.map((item) => ({ ...item, termZh: '肌酸软糖' }));
    },
  };
  await assert.rejects(
    keywordNamesAction({ ids: ['one'] }, { role: 'researcher' }, io),
    /管理员/,
  );
  await assert.rejects(
    keywordNamesAction(
      { ids: Array.from({ length: 51 }, (_, i) => String(i)) },
      { role: 'admin' },
      io,
    ),
    /1～50/,
  );
  await assert.rejects(
    keywordNamesAction({ ids: ['missing'] }, { role: 'admin' }, io),
    /已变化/,
  );
  assert.equal(calls, 0);
  assert.deepEqual(
    (await keywordNamesAction({ ids: ['one'] }, { role: 'admin' }, io)).items,
    [{ id: 'one', termZh: '肌酸软糖' }],
  );
  assert.equal(calls, 1);
});

test('manual names use the common failure contract and never silently retry or save a partial result', async () => {
  let calls = 0;
  const io = {
    records: async () => [record],
    translate: async () => {
      calls++;
      throw Error('timeout');
    },
  };
  await assert.rejects(
    keywordNamesAction({ ids: ['one'] }, { role: 'admin' }, io),
    /timeout/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    keywordNamesAction(
      { ids: ['one'] },
      { role: 'admin' },
      { ...io, translate: async () => [] },
    ),
    /不完整/,
  );
});

test('explicit repair sends keywords and seed terms through one shared translator and rejects unrelated text', async () => {
  const saved = new Map(),
    batches = [];
  const io = {
    records: async () => [
      {
        id: 'keyword-1',
        term: 'creatine gummies',
        seedTerm: 'protein powder',
        trendRelatedTop: [{ query: 'fish oil capsules' }],
      },
    ],
    translate: async (kind, rows) => {
      assert.equal(kind, 'keywords');
      batches.push(rows);
      return rows.map((row) => ({
        ...row,
        termZh: row.term === 'creatine gummies' ? '肌酸软糖' : '蛋白粉',
      }));
    },
    saveKeywordName: async (term, termZh) => saved.set(term, termZh),
  };
  await assert.rejects(
    keywordTranslationsAction(
      { terms: ['unrelated'], keywordIds: ['keyword-1'] },
      { role: 'researcher' },
      io,
    ),
    /只允许翻译/,
  );
  await assert.rejects(
    keywordTranslationsAction(
      { terms: [], keywordIds: ['keyword-1'] },
      { role: 'admin' },
      io,
    ),
    /1～40/,
  );
  assert.equal(batches.length, 0);
  const result = await keywordTranslationsAction(
    {
      keywordIds: ['keyword-1'],
      terms: ['creatine gummies', 'protein powder', 'creatine gummies'],
    },
    { role: 'researcher' },
    io,
  );
  assert.deepEqual(result.items, [
    { term: 'creatine gummies', termZh: '肌酸软糖' },
    { term: 'protein powder', termZh: '蛋白粉' },
  ]);
  assert.equal(batches.length, 1);
  assert.deepEqual(
    batches[0].map((row) => row.term),
    ['creatine gummies', 'protein powder'],
  );
  assert.equal(saved.get('creatine gummies'), '肌酸软糖');
});
