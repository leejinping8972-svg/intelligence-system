/* oxlint-disable vitest/no-import-node-test -- Node server tests run without Vitest. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pendingSourceFields,
  sourceFieldSample,
} from './source-field-domain.mjs';

test('sites without extractable sources are marked analyzed and skipped', () => {
  const value = {
    id: 'site-empty',
    title: '',
    brand: '',
    description: '',
    mainProducts: [],
    sourceEvidence: [],
    sourceContent: {},
  };
  assert.equal(sourceFieldSample('sites', value).sources.length, 0);
  const next = pendingSourceFields('sites', value);
  assert.equal(next.fieldAnalysis.status, 'analyzed');
  assert.equal(next.fieldAnalysis.skipReason, 'no_extractable_sources');
  assert.deepEqual(next.fieldAnalysis.sources, []);
});

test('sites with description still enter pending analysis', () => {
  const next = pendingSourceFields('sites', {
    id: 'site-ready',
    title: 'Example Shop',
    description: 'We sell vitamins and minerals online.',
  });
  assert.equal(next.fieldAnalysis.status, 'pending');
  assert.ok(next.fieldAnalysis.sources.length > 0);
});

test('sites reuse top-level mainProducts and sourceEvidence when sourceContent is empty', () => {
  const sample = sourceFieldSample('sites', {
    id: 'US-example.com',
    brand: 'Example Brand',
    title: '',
    description: '',
    mainProducts: ['Vitamin D3', 'Omega-3'],
    sourceEvidence: [
      {
        keyword: 'Official shop sells Vitamin D3 softgels with checkout',
        source: '官网核验',
      },
    ],
  });
  assert.ok(
    sample.sources.some((s) => s.id === 'title' && s.text === 'Example Brand'),
  );
  assert.ok(sample.sources.some((s) => s.id === 'site-product-0'));
  assert.ok(sample.sources.some((s) => s.id === 'site-evidence-0'));
  const pending = pendingSourceFields('sites', {
    id: 'US-example.com',
    brand: 'Example Brand',
    mainProducts: ['Vitamin D3'],
    sourceEvidence: [{ keyword: 'Official shop sells Vitamin D3 softgels' }],
  });
  assert.equal(pending.fieldAnalysis.status, 'pending');
});
