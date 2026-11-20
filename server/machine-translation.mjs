import { randomUUID } from 'node:crypto';

import {
  inspectTranslations,
  translationBatches,
} from './collection-translation-domain.mjs';

const endpoint = 'https://transmart.qq.com/api/imt';
const cachePrefix = 'collection:machine-translation:v1:';
const serviceKey = `${cachePrefix}service`;
const cooldownMs = 5 * 60_000;
const inFlight = new Map();

// Anonymous public machine translation: no research-provider key or model call.
// Keep this separate from model claims, including requests of unknown outcome.
export function machineTranslationKey(key) {
  return `${cachePrefix}${key}`;
}

export async function requestMachineTranslation(items, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
      body: JSON.stringify({
        header: {
          fn: 'auto_translation',
          client_key: `browser-monitor-${randomUUID()}`,
        },
        type: 'plain',
        model_category: 'normal',
        source: { lang: 'auto', text_list: items.map((item) => item.text) },
        target: { lang: 'zh' },
      }),
    });
  } catch {
    throw new Error('机翻服务连接失败或超时，已保留原文');
  }
  if (!response.ok)
    throw new Error(`机翻服务 HTTP ${response.status}，已保留原文`);
  // The source batch is bounded to 2400 characters; reject unexpected payloads.
  const body = await response.text();
  if (body.length > 100_000) throw new Error('机翻响应过长，已保留原文');
  let result;
  try {
    result = JSON.parse(body);
  } catch {
    throw new Error('机翻响应格式无法识别，已保留原文');
  }
  if (
    result.header?.ret_code !== 'succ' ||
    result.tgt_lang !== 'zh' ||
    !Array.isArray(result.auto_translation) ||
    result.auto_translation.length !== items.length
  )
    throw new Error('机翻服务未完整返回中文译文，已保留原文');
  return {
    items: result.auto_translation.map((text, index) => ({
      id: items[index].key,
      text,
    })),
  };
}

async function defaults() {
  const { pool, putDocument } = await import('./database.mjs');
  return {
    read: async (key) => {
      const result = await pool.query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [key],
      );
      return result.rows[0]?.value;
    },
    write: (key, value) => putDocument('workspace_documents', key, value),
    request: requestMachineTranslation,
  };
}

export async function translateMachineItems(items, overrides) {
  const io = overrides || (await defaults());
  const values = new Map();
  const issues = new Map();
  for (const batch of translationBatches(items)) {
    const result = await translateMachineBatch(batch, io);
    for (const [key, text] of result.values) values.set(key, text);
    for (const [key, message] of result.issues) issues.set(key, message);
  }
  return { values, issues };
}

async function translateMachineBatch(items, io) {
  const now = io.now || Date.now;
  const values = new Map();
  const issues = new Map();
  const pending = [];
  for (const item of items) {
    if (item.allowOriginal) {
      values.set(item.key, item.text);
      continue;
    }
    const saved = await io.read(machineTranslationKey(item.key));
    const checked = inspectTranslations(
      { items: [{ id: item.key, text: saved?.text }] },
      [item],
    );
    if (saved?.status === 'complete' && checked.values.has(item.key))
      values.set(item.key, checked.values.get(item.key));
    else if (saved?.retryAt > now()) issues.set(item.key, saved.error);
    else pending.push(item);
  }
  if (pending.length === 0) return { values, issues };
  const service = await io.read(serviceKey);
  if (service?.retryAt > now()) {
    for (const item of pending) issues.set(item.key, service.error);
    return { values, issues };
  }
  // Concurrent collections of the same text share one machine request too.
  const fresh = pending.filter((item) => !inFlight.has(item.key));
  let task;
  if (fresh.length > 0) {
    task = (async () => {
      let result;
      try {
        result = inspectTranslations(await io.request(fresh), fresh);
      } catch (error) {
        const failure = { error: error.message, retryAt: now() + cooldownMs };
        await io.write(serviceKey, failure);
        result = {
          values: new Map(),
          issues: new Map(fresh.map((item) => [item.key, error.message])),
        };
      }
      for (const item of fresh) {
        const text = result.values.get(item.key);
        await io.write(
          machineTranslationKey(item.key),
          text
            ? {
                status: 'complete',
                text,
                provider: 'transmart',
                at: new Date(now()).toISOString(),
              }
            : {
                status: 'failed',
                error: result.issues.get(item.key),
                retryAt: now() + cooldownMs,
              },
        );
      }
      return result;
    })();
    for (const item of fresh) {
      const itemTask = task.then((result) => ({
        text: result.values.get(item.key),
        error: result.issues.get(item.key),
      }));
      itemTask.catch(() => {});
      inFlight.set(item.key, itemTask);
    }
  }
  const waiting = pending.map((item) => [item, inFlight.get(item.key)]);
  try {
    for (const [item, promise] of waiting) {
      const result = await promise;
      if (result.text) values.set(item.key, result.text);
      else issues.set(item.key, result.error);
    }
  } finally {
    if (task) {
      // A shared older request can reject before this batch finishes. Keep our
      // own entries claimed until its cache writes have settled as well.
      await task.catch(() => {});
      for (const item of fresh) inFlight.delete(item.key);
    }
  }
  return { values, issues };
}
