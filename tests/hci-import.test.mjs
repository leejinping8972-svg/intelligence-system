import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCsv } from '../apps/web-antd/src/views/intelligence/import-utils.ts';

test('CSV supports Unicode, BOM and CRLF without changing country values', () => {
  assert.deepEqual(
    parseCsv('\uFEFFterm,market\r\nmen vi sinh,VN\r\nprobióticos,MX\r\n'),
    [
      { term: 'men vi sinh', market: 'VN' },
      { term: 'probióticos', market: 'MX' },
    ],
  );
});
test('CSV keeps quoted commas, newlines and escaped quotes in one field', () => {
  assert.deepEqual(parseCsv('term,market\n"fiber, blend\n""daily""",US'), [
    { term: 'fiber, blend\n"daily"', market: 'US' },
  ]);
});
test('Malformed rows cannot silently shift prices or country columns', () => {
  assert.throws(() => parseCsv('term,market\nx,US,extra'), /列数/);
  assert.throws(() => parseCsv('term,market\n"unfinished,US'), /引号/);
});
test('Ambiguous column names are rejected', () => {
  assert.throws(() => parseCsv('term,term\nx,y'), /表头/);
  assert.throws(() => parseCsv('term,\nx,y'), /表头/);
});
