import assert from 'node:assert/strict';
import test from 'node:test';
import { gateSourceFields, sourceFieldSample, validateSourceFields } from './source-field-domain.mjs';
import { projectRecord } from './workspace-reads.mjs';
import { groupAdvertisers } from './model.js';

test('ad translations require Chinese text and matching source quotes', () => {
  const sample = sourceFieldSample('ads', {
    id: 'a', brand: 'Health Shop', headline: 'Better sleep',
    copy: 'Wake up rested', evidenceUrl: 'https://example.com/ad',
  });
  const { patch, analysis } = validateSourceFields({ fields: [], translations: [
    { field: 'brandZh', text: '健康商店', sourceId: 'ad-brand', quote: 'Health Shop' },
    { field: 'headlineZh', text: '睡得更好', sourceId: 'title', quote: 'Better sleep' },
    { field: 'copyZh', text: '醒来精神饱满', sourceId: 'ad-brand', quote: 'Wake up rested' },
  ] }, sample);
  assert.equal(patch.brandZh, '健康商店');
  assert.equal(patch.headlineZh, '睡得更好');
  assert.equal(patch.sellingPointZh, '睡得更好');
  assert.equal(patch.copyZh, undefined);
  assert.equal(analysis.fields.headlineZh.quote, 'Better sleep');
  const copyOnly = validateSourceFields({ fields: [], translations: [
    { field: 'copyZh', text: '醒来精神饱满', sourceId: 'ad-copy', quote: 'Wake up rested' },
  ] }, sample);
  assert.equal(copyOnly.patch.sellingPointZh, '醒来精神饱满');
});

test('ad list projection retains Chinese display and batch filter links', () => {
  const projected = projectRecord('ads', {
    id: 'a', brand: 'Health Shop', brandZh: '健康商店', market: 'US',
    headline: 'Better sleep', headlineZh: '睡得更好', copy: 'Rested',
    copyZh: '精神饱满', sellingPointZh: '睡得更好',
    collectionBatches: ['October', 'November'],
  });
  assert.equal(projected.data.headlineZh, '睡得更好');
  assert.deepEqual(projected.data.collectionBatches, ['October', 'November']);
  assert.ok(projected.links.some(([relation, target]) => relation === 'batch' && target === 'November'));
  assert.match(projected.columns.at(-1), /健康商店/);
});

test('Vietnamese advertiser text and creative title use separate source quotes', () => {
  const sample = sourceFieldSample('ads', {
    id: 'vn-ad', brand: 'Vitabiotics Vietnam',
    headline: 'Bổ Sung Vitamin & Khoáng Chất Cho Phụ Nữ',
  });
  const { patch } = validateSourceFields({ fields: [], translations: [
    { field: 'brandZh', text: 'Vitabiotics 越南', sourceId: 'ad-brand', quote: 'Vitabiotics Vietnam' },
    { field: 'headlineZh', text: '为女性补充维生素和矿物质', sourceId: 'title', quote: 'Bổ Sung Vitamin & Khoáng Chất Cho Phụ Nữ' },
  ] }, sample);
  assert.equal(patch.brandZh, 'Vitabiotics 越南');
  assert.equal(patch.headlineZh, '为女性补充维生素和矿物质');
});

test('changing only advertiser name invalidates its old translation', () => {
  const old = {
    id: 'vn-ad', brand: 'Vitabiotics Vietnam', brandZh: 'Vitabiotics 越南',
    headline: 'Better sleep', headlineZh: '睡得更好',
  };
  old.fieldAnalysis = {
    status: 'analyzed',
    fingerprint: sourceFieldSample('ads', old).fingerprint,
  };
  const next = gateSourceFields('ads', old, { ...old, brand: 'New advertiser' }, { brand: 'New advertiser' });
  assert.equal(next.brandZh, undefined);
  assert.equal(next.fieldAnalysis.status, 'pending');
});

test('advertiser groups display a translated name while retaining the source name', () => {
  const [advertiser] = groupAdvertisers([
    { id: 'a', pageId: '123', market: 'VN', brand: 'Vitabiotics Vietnam', brandZh: 'Vitabiotics 越南', status: '投放中' },
  ], []);
  const projected = projectRecord('advertisers', advertiser);
  assert.equal(projected.data.name, 'Vitabiotics Vietnam');
  assert.equal(projected.data.nameZh, 'Vitabiotics 越南');
  assert.match(projected.columns.at(-1), /vitabiotics 越南/);
});
