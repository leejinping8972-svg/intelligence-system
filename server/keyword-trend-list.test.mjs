import assert from 'node:assert/strict';
import test from 'node:test';
import { keywordTrendList } from './keyword-trend-list.mjs';

test('visible rolling comparisons use the latest saved series instead of old core summaries', () => {
  const end = Date.parse('2026-10-29T00:00:00Z');
  const record = { trendHistoryResolution: 'day', trendHistoryCollectedAt: '2026-10-29T12:00:00Z', trendHistoryPoints: Array.from({ length: 400 }, (_, i) => ({ date: new Date(end - (400 - i) * 86400000).toISOString().slice(0, 10), value: i < 220 ? 20 : 40 })), coreSummary: { periods: { 30: [{ key: 'relativeHeat', value: 99 }] } } };
  const rows = keywordTrendList(record).trendRollingSummary;
  assert.deepEqual(rows.map(row => row.label), ['近30天', '近90天', '近180天']);
  assert.equal(rows[0].heat, 40);
  assert.equal(rows[0].change, 0);
  assert.equal(rows[2].change, 100);
  assert.equal(record.coreSummary.periods[30][0].value, 99);
});
