import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- Standalone Node server package.
import test from 'node:test';

import {
  cleanKeyword,
  editableKeywordPatch,
  naturalKey,
  validateJob,
} from './domain.mjs';

test('supplementation requires the selected count, received list and target to agree exactly', () => {
  const records = Array.from({ length: 34 }, (_, i) => ({
    id: `id-${i}`,
    term: `creatine ${i}`,
    market: 'US',
    source: '实采',
  }));
  const input = {
    seeds: [],
    markets: ['US'],
    sources: ['semrush'],
    limit: 34,
    expectedKeywordCount: 34,
    existingRecords: records,
  };
  assert.equal(validateJob(input).existingRecords.length, 34);
  assert.throws(
    () => validateJob({ ...input, existingRecords: records.slice(0, 9) }),
    /数量、名单/,
  );
  assert.throws(
    () =>
      validateJob({ ...input, limit: 9, existingRecords: records.slice(0, 9) }),
    /数量、名单/,
  );
  assert.throws(
    () =>
      validateJob({
        ...input,
        existingRecords: [...records.slice(0, 33), records[0]],
      }),
    /数量、名单/,
  );
  assert.throws(() => validateJob({
    ...input,
    existingRecords: [...records.slice(0, 33), { ...records[0], id: 'another-id', term: '  CREATINE   0 ' }],
  }), /数量、名单/);
});

test('accepts 100 keyword jobs and derives Sorftime calls from the result target and depth', () => {
  const input = {
    seeds: ['magnesium'],
    markets: ['US'],
    sources: ['sorftime'],
    depth: 1,
    limit: 100,
    sorftimeRequestLimit: 3,
  };
  assert.equal(validateJob(input).limit, 100);
  assert.equal(validateJob(input).sorftimeRequestLimit, 1);
  assert.equal(
    validateJob({ ...input, depth: 2, sorftimeRequestLimit: 3 })
      .sorftimeRequestLimit,
    100,
  );
  assert.equal(
    validateJob({ ...input, depth: 1, markets: ['US', 'MX', 'VN'] })
      .sorftimeRequestLimit,
    2,
  );
  assert.equal(validateJob({ ...input, limit: 1 }).sorftimeRequestLimit, 0);
  assert.equal(
    validateJob({ ...input, markets: ['VN'] }).sorftimeRequestLimit,
    0,
  );
  assert.equal(
    validateJob({ ...input, depth: 2, markets: ['VN'] }).sorftimeRequestLimit,
    0,
  );
  assert.equal(
    validateJob({ ...input, sources: ['google_autocomplete'] })
      .sorftimeRequestLimit,
    0,
  );
  for (const change of [
    { limit: 101 },
    { markets: ['CN'] },
    { sources: ['site_discovery'] },
    { seeds: [] },
  ])
    assert.throws(() => validateJob({ ...input, ...change }));
  assert.throws(() =>
    validateJob({
      ...input,
      existingRecords: Array.from({ length: 101 }, () => ({
        term: 'magnesium',
        market: 'US',
      })),
    }),
  );
});
test('normalizes keyword identity and preserves real historical associations without importing demos or credentials', () => {
  const value = cleanKeyword({
    term: 'magnesium\u202Fglycinate',
    market: 'US',
    source: 'Sorftime · Amazon',
    accessKey: 'not-for-storage',
    favorite: true,
    siteIds: ['real-site'],
    productIds: ['real-product'],
    dataNature: 'collected',
  });
  assert.equal(naturalKey(value), 'US|magnesium glycinate');
  assert.equal(value.accessKey, undefined);
  assert.deepEqual(value.siteIds, ['real-site']);
  assert.deepEqual(value.productIds, ['real-product']);
  assert.equal(value.favorite, true);
  assert.throws(() => cleanKeyword({ ...value, dataNature: 'demo' }));
});
test('keyword edits cannot replace source evidence, identities, scores or task fields', () => {
  assert.deepEqual(
    editableKeywordPatch({
      favorite: true,
      reviewStatus: 'selected',
      term: 'fake',
      source: 'fake',
      assessment: { score: 100 },
      cloudJobId: 'fake',
    }),
    { favorite: true, reviewStatus: 'selected' },
  );
  assert.deepEqual(
    editableKeywordPatch({
      metrics: {
        market: 'US',
        source: 'Manual report',
        collectedAt: '2026-10-16',
        monthlySearchVolume: 20,
        difficulty: 999,
      },
    }).metrics,
    {
      market: 'US',
      source: 'Manual report',
      collectedAt: '2026-10-16',
      monthlySearchVolume: 20,
    },
  );
});

test('new jobs opt into comparison history and keyword storage accepts the original historical series', () => {
  const input=validateJob({seeds:['magnesium'],markets:['US'],sources:['google_autocomplete'],limit:10,trendComparisonVersion:0});
  assert.equal(input.trendComparisonVersion,2);
  const history=[{date:'2024-10-20',value:40},{date:'2026-10-19',value:60}];
  const record=cleanKeyword({term:'magnesium',market:'US',source:'synthetic',trendHistoryPoints:history,trendHistoryResolution:'week',trendHistoryCollectedAt:'2026-10-20T00:00:00Z',trendHistorySourceUrl:'https://trends.google.com/trends/explore'});
  assert.deepEqual(record.trendHistoryPoints,history);
  assert.equal(record.trendHistoryResolution,'week');
});
