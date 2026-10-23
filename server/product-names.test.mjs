import assert from 'node:assert/strict';
import test from 'node:test';

import { productChineseName } from './product-names.mjs';

test('the five product names in the requested list have specific Chinese references', () => {
  const cases = [
    ['DHEA Supplement', '脱氢表雄酮补充剂'],
    ['Huperzine A Supplement', '石杉碱甲补充剂'],
    ['Cissus Quadrangularis Extract Supplement', '四棱白粉藤提取物补充剂'],
    ['Dihydromyricetin DHM (50 ct.)', '二氢杨梅素 (DHM) (50 ct.)'],
    ['Nootropic Stack (Alpha GPC + Uridine)', '促智配方组合 (甘油磷酸胆碱 + 尿苷)'],
  ];
  for (const [title, expected] of cases)
    assert.equal(productChineseName({ title }), expected);
});

test('an explicit saved reference wins without changing the original record', () => {
  const record = Object.freeze({ title: 'DHEA Supplement', titleZh: '  人工核对参考  ' });
  assert.equal(productChineseName(record), '人工核对参考');
  assert.equal(record.title, 'DHEA Supplement');
  assert.equal(record.titleZh, '  人工核对参考  ');
  assert.equal(productChineseName({ ...record, titleZh: '  ' }), '脱氢表雄酮补充剂');
});

test('unknown ingredient and brand names do not become translations through dosage forms', () => {
  for (const title of ['Mystery Supplement', 'Mystery Dietary Supplements', 'Mystery Extract Capsules 60 ct.', 'SuperDHEA Supplement', 'Cissus QuadrangularisX'])
    assert.equal(productChineseName({ title }), '');
});

test('brand text is protected even when it contains dictionary terms', () => {
  assert.equal(productChineseName({ title: 'Double Wood Supplements DHEA Supplement 100 mg', brand: 'Double Wood Supplements' }), 'Double Wood Supplements 脱氢表雄酮补充剂 100 mg');
  assert.equal(productChineseName({ title: 'IRON LABS Vitamin C 500 mg', brand: 'Iron Labs' }), 'IRON LABS 维生素C 500 mg');
  assert.equal(productChineseName({ title: 'DHEA Supplement', brand: 'DHEA' }), '');
});

test('unknown words, strengths and pack counts are retained alongside known ingredients', () => {
  assert.equal(productChineseName({ title: 'Acme-X HUPERZINE A 200 mcg / 120 Capsules' }), 'Acme-X 石杉碱甲 200 mcg / 120 胶囊');
  assert.equal(productChineseName({ title: 'Dihydromyricetin (DHM) 500 mg - 50 ct.' }), '二氢杨梅素 (DHM) 500 mg - 50 ct.');
  assert.equal(productChineseName({ title: 'Magnesium Glycinate 120 Capsules' }), '甘氨酸镁 120 胶囊');
});

test('Chinese originals and empty or malformed records are handled without guesses', () => {
  assert.equal(productChineseName({ title: '未知配方 60粒' }), '未知配方 60粒');
  for (const record of [null, undefined, {}, { title: '' }, { title: 5 }, { titleZh: true }])
    assert.equal(productChineseName(record), '');
});
