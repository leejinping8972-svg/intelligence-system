import assert from 'node:assert/strict';
import test from 'node:test';

import { assessKeyword } from './model.js';

test('new concept receives a provisional score when trend, volume and KD are absent', () => {
  const assessment = assessKeyword({
    id: 'concept-score-1',
    term: 'magnesium glycinate',
    market: 'US',
    category: '功能性营养',
    source: '用户种子词',
    growth: null,
    series: [],
    favorite: false,
    reviewStatus: 'pending',
  });
  assert.equal(typeof assessment.score, 'number');
  assert.ok(assessment.grade);
  assert.equal(assessment.status, 'provisional');
  assert.equal(assessment.coverage, 30);
  assert.ok(assessment.tags.includes('待补KD'));
});

test('natural search KD contributes to the competition dimension', () => {
  const assessment = assessKeyword({
    id: 'concept-score-2',
    term: 'magnesium glycinate capsules',
    market: 'US',
    category: '功能性营养',
    source: 'Semrush',
    growth: null,
    series: [],
    favorite: false,
    reviewStatus: 'pending',
    metrics: {
      market: 'US',
      source: 'Semrush',
      collectedAt: new Date().toISOString(),
      difficulty: 25,
    },
  });
  const competition = assessment.dimensions.find((item) => item.key === 'competition');
  assert.equal(competition?.score, 75);
  assert.equal(competition?.coveredWeight, 5);
});
