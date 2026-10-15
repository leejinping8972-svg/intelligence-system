import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- standalone regression test
import test from 'node:test';

import { trendOption } from '../apps/web-antd/src/views/intelligence/charts.ts';

test('annual weekly chart preserves dates and filters by elapsed days, not point count', () => {
  const points = Array.from({ length: 53 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 9, 12 + index * 7))
      .toISOString()
      .slice(0, 10),
    value: index,
  }));
  const keyword = {
    series: points.map((point) => point.value),
    trendPoints: points,
    updatedAt: '2026-10-15',
    dataNature: 'collected',
  };
  const annual = trendOption(keyword, 365);
  assert.equal(annual.xAxis.data.length, 53);
  assert.equal(annual.xAxis.data[0], '2025-10-12');
  assert.equal(annual.xAxis.data.at(-1), '2026-10-11');
  const recent = trendOption(keyword, 30);
  assert.equal(recent.xAxis.data.length, 5);
  assert.equal(recent.xAxis.data[0], '2026-09-13');
});
