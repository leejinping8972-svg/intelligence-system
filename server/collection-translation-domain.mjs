import { createHash } from 'node:crypto';

export const translationFields = {
  products: [
    'title',
    'brand',
    'category',
    'form',
    'size',
    'ingredient',
    'claim',
    'benefits',
  ],
  sites: ['brand', 'category', 'description', 'mainProducts'],
  ads: ['brand', 'headline', 'copy', 'category', 'claim', 'benefits'],
  keywords: ['term', 'seedTerm'],
  queries: ['query'],
};
export const translationHash = (text) =>
  createHash('sha256').update(String(text)).digest('hex');
export const translationKey = (text, brand = false) =>
  `collection:translation:v1:${brand ? 'brand:' : ''}${translationHash(text)}`;
const needsTranslation = (text) =>
  /\p{L}/u.test(text) &&
  !/^\{\{\s*[a-z_][\w.]*\s*\}\}$/i.test(text.trim()) &&
  (!/\p{Script=Han}/u.test(text) || /\p{Script=Latin}{2,}/u.test(text)) &&
  !/^https?:\/\//i.test(text);

export function translationParts(text) {
  const characters = [...text];
  const parts = [];
  for (let i = 0; i < characters.length; i += 1200)
    parts.push(characters.slice(i, i + 1200).join(''));
  return parts;
}

export function planTranslations(kind, records) {
  const items = new Map();
  const plans = records.map((record) => {
    const fields = [];
    if (record.dataNature === 'demo') return fields;
    for (const field of translationFields[kind] || []) {
      const original = record[field];
      if (typeof original !== 'string' && !Array.isArray(original)) continue;
      const values = Array.isArray(original) ? original : [original];
      const brand = field === 'brand' || (kind === 'ads' && field === 'headline' &&
        typeof original === 'string' && original.trim() === record.brand?.trim());
      const saved = record[`${field}Zh`];
      const proof = record.collectionTranslation?.fields?.[field];
      if (
        (Array.isArray(saved)
          ? saved.length === values.length && saved.every(Boolean)
          : typeof saved === 'string' && saved.trim()) &&
        (!proof || proof === translationHash(JSON.stringify(original)))
      )
        continue;
      const parts = values.map((value) =>
        typeof value === 'string' && value.trim()
          ? translationParts(value)
          : [],
      );
      for (const group of parts)
        for (const text of group) {
          if (needsTranslation(text))
            items.set(translationKey(text, brand), {
              key: translationKey(text, brand),
              text,
              allowOriginal: brand,
            });
        }
      fields.push({ field, original, parts, brand });
    }
    return fields;
  });
  return { items: [...items.values()], plans };
}

export function applyTranslations(records, plan, translated) {
  return records.map((record, index) => {
    const result = { ...record };
    const proof = { ...record.collectionTranslation?.fields };
    for (const { field, original, parts, brand } of plan.plans[index]) {
      const values = parts.map((group) =>
        group
          .map((text) => {
            if (!needsTranslation(text)) return text;
            const value = translated.get(translationKey(text, brand));
            if (!value)
              throw new Error('采集翻译未完整返回，原始采集响应已保留');
            return value;
          })
          .join(''),
      );
      result[`${field}Zh`] = Array.isArray(original) ? values : values[0] || '';
      proof[field] = translationHash(JSON.stringify(original));
    }
    if (plan.plans[index].length)
      result.collectionTranslation = {
        version: 1,
        status: 'complete',
        fields: proof,
      };
    const previousFallback = record.headlineZh || record.copyZh;
    if (
      (!record.sellingPointZh || record.sellingPointZh === previousFallback) &&
      (result.headlineZh || result.copyZh)
    )
      result.sellingPointZh = result.headlineZh || result.copyZh;
    return result;
  });
}

export function translationBatches(items) {
  const batches = [];
  let batch = [];
  let length = 0;
  for (const item of items) {
    if (
      batch.length &&
      (batch.length >= 32 || length + item.text.length > 2400)
    ) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(item);
    length += item.text.length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function inspectTranslations(result, items) {
  const values = new Map();
  const issues = new Map();
  const returned = Array.isArray(result?.items) ? result.items : [];
  const counts = new Map();
  for (const item of returned) if (item && typeof item.id === 'string') counts.set(item.id, (counts.get(item.id) || 0) + 1);
  for (const item of items) {
    if (!counts.has(item.key)) issues.set(item.key, '采集翻译数量不完整，缺少对应译文');
  }
  for (const item of returned) {
    if (!item || typeof item !== 'object') continue;
    const source = items.find((entry) => entry.key === item.id);
    if (!source) continue;
    if (counts.get(item.id) !== 1) { issues.set(item.id, '采集翻译返回重复编号'); continue; }
    if (typeof item.text !== 'string' || !item.text.trim()) { issues.set(item.id, '采集翻译返回空译文'); continue; }
    if (item.text.length > 12000) { issues.set(item.id, '采集翻译返回超长译文'); continue; }
    if (!/\p{Script=Han}/u.test(item.text) && !(source.allowOriginal && item.text.trim() === source.text.trim())) { issues.set(item.id, '采集翻译未包含中文，原文已保留'); continue; }
    values.set(item.id, item.text.trim());
  }
  return { values, issues, unexpected: returned.some((item) => !items.some((source) => source.key === item?.id)) };
}

export function validateTranslations(result, items) {
  const { values, issues, unexpected } = inspectTranslations(result, items);
  if (issues.size || unexpected) throw new Error([...issues.values()][0] || '采集翻译返回未知编号');
  return values;
}

export function freshTranslation(record, field) {
  return (
    record.collectionTranslation?.status === 'complete' &&
    record.collectionTranslation.fields?.[field] ===
      translationHash(JSON.stringify(record[field]))
  );
}
