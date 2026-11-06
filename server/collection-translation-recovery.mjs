import { inspectTranslations } from './collection-translation-domain.mjs';

export const translationBatchKey = (owner) =>
  `collection:translation:batch:${owner}`;
export function translationSample(items) {
  return {
    items: items.map((item, index) => ({
      id: `t${index + 1}`,
      text: item.text,
      ...(item.allowOriginal ? { keepBrand: true } : {}),
    })),
  };
}
export function restoreTranslationIds(result, items) {
  if (!Array.isArray(result?.items)) return result;
  const ids = new Map(items.map((item, index) => [`t${index + 1}`, item.key]));
  return {
    ...result,
    items: result.items.map((item) =>
      item && typeof item === 'object'
        ? { ...item, id: ids.get(item.id) || item.id }
        : item,
    ),
  };
}

export async function saveTranslationResponse(io, owner, items, response) {
  // Save the paid response before validation or individual cache writes.
  await io.write(translationBatchKey(owner), {
    status: 'received',
    items,
    result: response.result,
    model: response.model,
    usage: response.usage,
    at: new Date().toISOString(),
  });
  return applyTranslationResponse(io, owner, items, response);
}

export async function saveInvalidTranslations(
  io,
  owner,
  items,
  message,
  targetKeys,
) {
  const issues = new Map(items.map((item) => [item.key, message]));
  for (const item of items.filter(
    (item) => !targetKeys || targetKeys.has(item.key),
  ))
    await io.write(item.key, {
      status: 'invalid',
      owner,
      error: message,
      at: new Date().toISOString(),
    });
  return { values: new Map(), issues };
}

async function applyTranslationResponse(
  io,
  owner,
  items,
  response,
  targetKeys,
) {
  const { values, issues } = inspectTranslations(response.result, items);
  for (const item of items.filter(
    (item) => !targetKeys || targetKeys.has(item.key),
  ))
    await io.write(
      item.key,
      values.has(item.key)
        ? {
            status: 'complete',
            text: values.get(item.key),
            at: new Date().toISOString(),
            model: response.model,
          }
        : {
            status: 'invalid',
            owner,
            error: issues.get(item.key) || '采集翻译未完整返回',
            at: new Date().toISOString(),
          },
    );
  return { values, issues };
}

export async function recoverTranslationResponse(io, owner, targetKeys) {
  const batch = await io.readBatch?.(owner);
  if (batch?.status !== 'received' || !Array.isArray(batch.items)) return;
  if (batch.finishReason === 'length')
    return saveInvalidTranslations(
      io,
      owner,
      batch.items,
      '采集翻译达到输出上限，内容可能不完整',
      targetKeys,
    );
  let result = batch.result;
  if (!result && typeof batch.raw === 'string') {
    try {
      result = restoreTranslationIds(JSON.parse(batch.raw), batch.items);
    } catch {
      return saveInvalidTranslations(
        io,
        owner,
        batch.items,
        '采集翻译已返回，但JSON格式无法识别',
        targetKeys,
      );
    }
  }
  if (!result) return;
  return applyTranslationResponse(
    io,
    owner,
    batch.items,
    { ...batch, result },
    targetKeys,
  );
}

export function invalidTranslationError(issues) {
  return Object.assign(
    new Error(
      `翻译结果已返回但校验失败：${[...new Set(issues.values())].join('；')}。有效译文及原始结果已保存，不自动重复调用模型`,
    ),
    { code: 'COLLECTION_TRANSLATION_INVALID' },
  );
}
