import { createHash } from 'node:crypto';

export const FIELDS = ['brand', 'headline', 'copy'];
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const missing = (value, field) => Boolean(String(value[field] || '').trim()) && !String(value[`${field}Zh`] || '').trim();

export function splitSource(source, limit = 1800) {
  const parts = [];
  let offset = 0;
  while (offset < source.length) {
    let end = Math.min(offset + limit, source.length);
    if (end < source.length) {
      const window = source.slice(offset, end);
      const boundaries = [...window.matchAll(/[.!?。！？;；\n]\s*/g)];
      const boundary = boundaries.filter((match) => match.index + match[0].length > limit / 2).at(-1);
      if (boundary) end = offset + boundary.index + boundary[0].length;
      else {
        const whitespace = Math.max(window.lastIndexOf(' '), window.lastIndexOf('\t'));
        if (whitespace > limit / 2) end = offset + whitespace + 1;
      }
    }
    parts.push(source.slice(offset, end));
    offset = end;
  }
  return parts;
}

export function translationPlan(rows) {
  const tasks = new Map();
  const references = new Map();
  for (const row of rows) {
    const refs = {};
    for (const field of FIELDS) {
      if (!missing(row.value, field)) continue;
      const source = String(row.value[field]);
      const key = `${field}:${digest(source)}`;
      if (!tasks.has(key)) {
        const parts = splitSource(source);
        tasks.set(key, parts.map((text, index) => ({ id: `${key}:${index}`, field, text })));
      }
      refs[field] = key;
    }
    references.set(row.name, refs);
  }
  return { tasks, references, segments: [...tasks.values()].flat() };
}

export function makeBatches(segments, maxChars = 3300, maxItems = 18) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const item of segments) {
    if (current.length && (chars + item.text.length > maxChars || current.length >= maxItems)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += item.text.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function parseTranslations(result, batch) {
  if (result.choices?.[0]?.finish_reason !== 'stop') throw new Error(`模型输出未完成: ${result.choices?.[0]?.finish_reason || 'unknown'}`);
  const content = result.choices[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('模型未返回文本');
  const parsed = JSON.parse(content.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
  if (!Array.isArray(parsed.translations) || parsed.translations.length !== batch.length) throw new Error('模型返回条数不匹配');
  const expected = new Map(batch.map((item) => [item.id, item]));
  const translations = {};
  for (const item of parsed.translations) {
    const source = expected.get(item?.id);
    const value = String(item?.text || '').trim();
    if (!source || Object.hasOwn(translations, item.id) || !value || value.length > Math.max(500, source.text.length * 4))
      throw new Error('模型译文编号、内容或长度无效');
    translations[item.id] = value;
  }
  return translations;
}

export function translatedValue(row, refs, tasks, translations, skipIncomplete = false) {
  const next = { ...row.value };
  for (const [field, key] of Object.entries(refs)) {
    if (!missing(next, field)) continue;
    const parts = tasks.get(key);
    if (!parts?.every((part) => translations.has(part.id))) {
      if (skipIncomplete) continue;
      throw new Error(`译文不完整: ${row.name}/${field}`);
    }
    next[`${field}Zh`] = parts.map((part) => translations.get(part.id)).join('\n').trim();
  }
  if (!String(next.sellingPointZh || '').trim()) next.sellingPointZh = next.headlineZh || next.copyZh || '';
  return next;
}
