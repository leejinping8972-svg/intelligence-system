import { randomUUID } from 'node:crypto';

import { pool, putDocument } from './database.mjs';
import { requireAdmin } from './auth.mjs';
import { openAdsKey, sealAdsKey } from './ads-provider.mjs';
import { modelEndpoint, modelReportText, postModel } from './model-provider.mjs';

const NAME = 'provider:concept-seed:v1';

async function readStored() {
  return (await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])).rows[0]?.value;
}

function publicStatus(stored) {
  if (!stored) return { configured: false, message: '尚未配置百炼概念种子词模型' };
  const value = JSON.parse(openAdsKey(stored));
  return {
    configured: true,
    baseUrl: value.baseUrl,
    model: value.model,
    maxTokens: value.maxTokens,
    message: '概念种子词模型已配置；生成建议时调用，超时不会自动重试',
  };
}

function cleanKeywords(value) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.keywords)
      ? value.keywords
      : [];
  return [...new Set(list.map((item) => typeof item === 'string' ? item.normalize('NFKC').replaceAll(/\s+/g, ' ').trim() : '').filter((item) => item && item.length <= 120))].slice(0, 30);
}

export async function conceptSeedAction(input, user) {
  const stored = await readStored();
  if (input.action === 'server_concept_seed_config') {
    requireAdmin(user);
    if (input.requestId && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId))
      throw new Error('配置保存编号无效');
    const old = stored ? JSON.parse(openAdsKey(stored)) : {};
    const value = {
      baseUrl: modelEndpoint(input.baseUrl).toString(),
      model: String(input.model || '').trim(),
      apiKey: String(input.apiKey || old.apiKey || '').trim(),
      maxTokens: 600,
    };
    if (!value.model || value.model.length > 200 || !value.apiKey || value.apiKey.length > 4096 || /\s/.test(value.apiKey))
      throw new Error('请检查百炼模型名和 API Key');
    const sealed = sealAdsKey(JSON.stringify(value));
    await putDocument('provider_configs', NAME, {
      ...sealed,
      updatedAt: new Date().toISOString(),
      lastSaveId: input.requestId || randomUUID(),
    });
    return publicStatus(sealed);
  }
  if (input.action === 'server_concept_seed_status') return publicStatus(stored);
  if (input.action !== 'server_concept_seed_suggest') throw new Error('概念种子词请求无效');
  const description = String(input.description || '').normalize('NFKC').replaceAll(/\s+/g, ' ').trim().slice(0, 1000);
  if (!description) return { keywords: [], configured: Boolean(stored), message: '未填写方向描述，请手动输入种子关键词' };
  if (!stored) return { keywords: [], configured: false, message: '尚未配置模型，请手动输入种子关键词' };
  const config = JSON.parse(openAdsKey(stored));
  const result = await postModel(config, [
    {
      role: 'system',
      content: '你是关键词研究助手。根据用户的概念方向，输出与方向直接相关的英文种子关键词。只返回JSON，不要Markdown和解释，格式必须是 {"keywords":["..."]}。最多12个，每个不超过80个字符，避免品牌词、重复词和无关泛词。',
    },
    { role: 'user', content: JSON.stringify({ directionDescription: description }) },
  ], 5000);
  let parsed;
  try {
    parsed = JSON.parse(modelReportText(result).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
  } catch {
    throw new Error('种子关键词模型未返回有效 JSON');
  }
  return { keywords: cleanKeywords(parsed), configured: true, model: config.model };
}
