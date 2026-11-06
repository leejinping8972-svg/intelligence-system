/* oxlint-disable vitest/no-import-node-test -- Server tests run directly with Node's test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  associationTerms,
  ensureDirectKeywords,
} from './keyword-associations.mjs';

test('associationTerms keeps exact persisted query evidence and ignores unrelated text', () => {
  assert.deepEqual(
    associationTerms({
      market: 'US',
      title: 'Magnesium Gummies',
      query: ' Magnesium   Gummies ',
      queryTerms: ['magnesium gummies', 'sleep support'],
      resourceEvidence: { queryTerms: ['sleep support', 'ignored?'] },
      sourceEvidence: [{ keyword: 'magnesium gummies' }, { query: 'sleep support' }],
    }),
    ['Magnesium Gummies', 'magnesium gummies', 'sleep support', 'ignored?'],
  );
});

test('ensureDirectKeywords inserts only missing normalized terms and reuses existing records', async () => {
  const rows = new Map();
  const connection = {
    async query(statement, params = []) {
      if (statement.startsWith('SELECT natural_key,data FROM research_keywords WHERE')) {
        return { rows: params.map((key) => rows.get(key)).filter(Boolean) };
      }
      if (statement.startsWith('INSERT INTO research_keywords')) {
        if (!rows.has(params[0])) rows.set(params[0], { natural_key: params[0], data: params[1] });
        return { rows: [] };
      }
      if (statement.startsWith('SELECT data FROM research_keywords WHERE')) {
        return { rows: rows.has(params[0]) ? [{ data: rows.get(params[0]).data }] : [] };
      }
      throw new Error(`unexpected query: ${statement}`);
    },
  };
  const first = await ensureDirectKeywords({
    connection,
    sql: (postgres) => postgres,
    terms: ['  Magnesium   Gummies ', 'magnesium gummies'],
    market: 'US',
  });
  const second = await ensureDirectKeywords({
    connection,
    sql: (postgres) => postgres,
    terms: ['magnesium gummies'],
    market: 'US',
  });
  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(rows.size, 1);
  assert.equal(first[0].term, 'magnesium gummies');
});
