import test from 'node:test';
import assert from 'node:assert/strict';
import { splitSource, translationPlan, makeBatches, parseTranslations, translatedValue } from './ad-translation-backfill-domain.mjs';

test('long text is fully preserved across translation segments', () => {
  const source = 'Giảm giá hôm nay. '.repeat(700);
  const parts = splitSource(source);
  assert.ok(parts.length > 1);
  assert.equal(parts.join(''), source);
  assert.ok(parts.every((part) => part.length <= 1800));
});

test('same source is translated once and existing Chinese fields survive', () => {
  const rows = [
    { name: 'business:ads:a', value: { brand: 'Health Shop', headline: 'Sleep well', copy: 'Buy now' } },
    { name: 'business:ads:b', value: { brand: 'Health Shop', brandZh: '健康商店', headline: 'Sleep well', copy: 'Buy now' } },
  ];
  const plan = translationPlan(rows);
  assert.equal(plan.tasks.size, 3);
  const batches = makeBatches(plan.segments, 20, 2);
  assert.ok(batches.length >= 2);
  const translations = new Map(plan.segments.map((part) => [part.id, `中文${part.field}`]));
  const next = translatedValue(rows[1], plan.references.get(rows[1].name), plan.tasks, translations);
  assert.equal(next.brandZh, '健康商店');
  assert.equal(next.headlineZh, '中文headline');
  assert.equal(next.sellingPointZh, '中文headline');
  assert.equal(next.copy, 'Buy now');
});

test('incomplete or mismatched model response is rejected before writing', () => {
  const batch = [{ id: 'a', field: 'copy', text: 'Buy now' }, { id: 'b', field: 'brand', text: 'Health Shop' }];
  const response = (translations, finish_reason = 'stop') => ({ choices: [{ finish_reason, message: { content: JSON.stringify({ translations }) } }] });
  assert.throws(() => parseTranslations(response([{ id: 'a', text: '立即购买' }]), batch), /条数不匹配/);
  assert.throws(() => parseTranslations(response([{ id: 'a', text: '立即购买' }, { id: 'a', text: '健康商店' }]), batch), /编号/);
  assert.throws(() => parseTranslations(response([{ id: 'a', text: '立即购买' }, { id: 'b', text: '健康商店' }], 'length'), batch), /未完成/);
  assert.deepEqual(parseTranslations(response([{ id: 'b', text: '健康商店' }, { id: 'a', text: '立即购买' }]), batch), { b: '健康商店', a: '立即购买' });
});

test('a failed paid batch can be skipped while other fields are saved', () => {
  const row = { name: 'business:ads:x', value: { brand: 'Health Shop', headline: 'Sleep well', copy: 'Buy now' } };
  const plan = translationPlan([row]);
  const translations = new Map(plan.segments.filter((part) => part.field !== 'copy').map((part) => [part.id, `中文${part.field}`]));
  assert.throws(() => translatedValue(row, plan.references.get(row.name), plan.tasks, translations), /译文不完整/);
  const next = translatedValue(row, plan.references.get(row.name), plan.tasks, translations, true);
  assert.equal(next.brandZh, '中文brand');
  assert.equal(next.headlineZh, '中文headline');
  assert.equal(next.copyZh, undefined);
  assert.equal(next.sellingPointZh, '中文headline');
});
