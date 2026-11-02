import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { pool, putDocument } from './database.mjs';
import { sealAdsKey, openAdsKey } from './ads-provider.mjs';
import { requireAdmin } from './auth.mjs';
import { publicAddress } from './safe-web.mjs';
import { validateModelReport } from './research-evidence.mjs';
import {
  adModelInput,
  AD_REPORT_CONTRACT,
  LEGACY_RESEARCH_PROMPT,
  promptSnapshot,
} from './ad-report-prompt.mjs';
const NAME = 'provider:analysis:v1';
export function modelEndpoint(value) {
  const u = new URL(String(value));
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.port && u.port !== '443') ||
    /localhost|\.local$|\.internal$/i.test(u.hostname)
  )
    throw new Error('模型接口必须是公网 HTTPS 地址，不含密钥、查询参数或账号');
  if (!u.pathname.endsWith('/chat/completions'))
    u.pathname = `${u.pathname.replace(/\/$/, '')}/chat/completions`;
  return u;
}
export function modelRequestBody(config, messages) {
  const u = modelEndpoint(config.baseUrl);
  const aliyun =
    [
      'dashscope.aliyuncs.com',
      'dashscope-us.aliyuncs.com',
      'dashscope-intl.aliyuncs.com',
    ].includes(u.hostname) ||
    u.hostname.endsWith('.maas.aliyuncs.com') ||
    u.hostname.endsWith('.dashscope.aliyuncs.com');
  const modern =
    /^qwen3\.(?:5|6|7)-(?:plus|flash)(?:-\d{4}-\d{2}-\d{2})?$|^qwen3\.8-(?:max|flash)(?:-(?:\d{4}|\d{4}-\d{2}-\d{2}))?$/.test(
      config.model,
    );
  return {
    model: config.model,
    messages,
    max_tokens: config.maxTokens || 2000,
    ...(aliyun &&
    (modern ||
      /^qwen-(?:plus|flash)(?:-latest|-\d{4}-\d{2}-\d{2})?$/.test(config.model))
      ? { enable_thinking: false }
      : {}),
    ...(aliyun && modern ? { response_format: { type: 'json_object' } } : {}),
  };
}
export function modelReportText(result) {
  const choice = result.choices?.[0];
  if (choice?.finish_reason === 'length')
    throw new Error(
      '报告已达到输出token上限，内容可能不完整；请减少本次分析样本后重试，系统未自动重复调用',
    );
  if (typeof choice?.message?.content !== 'string')
    throw new Error('模型未返回文本内容');
  return choice.message.content;
}
export async function postModel(config, messages) {
  const u = modelEndpoint(config.baseUrl);
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error('模型接口指向非公网地址');
  const body = JSON.stringify(modelRequestBody(config, messages));
  return new Promise((resolve, reject) => {
    const pinned = addresses[0];
    const req = https.request(
      u,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
        lookup: (_h, opts, cb) =>
          cb(null, opts.all ? [pinned] : pinned.address, pinned.family),
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new Error(
              `模型接口 HTTP ${res.statusCode}；请核对模型名、额度和接口权限`,
            ),
          );
          return;
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (b) => {
          bytes += b.length;
          if (bytes > 1_000_000) res.destroy(new Error('模型响应超出限制'));
          else chunks.push(b);
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            reject(new Error('模型响应不是有效 JSON'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('模型接口超时，未自动重试以避免重复计费')),
      90000,
    );
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body);
  });
}
export async function analysisConfig(input, user) {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])
  ).rows[0]?.value;
  if (input.action === 'server_analysis_config') {
    requireAdmin(user);
    const old = stored ? JSON.parse(openAdsKey(stored)) : {};
    if (
      input.requestId &&
      !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId)
    )
      throw new Error('配置保存编号无效');
    const lastSaveId = input.requestId || randomUUID();
    const value = {
      baseUrl: modelEndpoint(input.baseUrl).toString(),
      model: String(input.model || '').trim(),
      apiKey: String(input.apiKey || old.apiKey || '').trim(),
      maxTokens: Number(input.maxTokens || 2000),
    };
    if (
      !value.model ||
      value.model.length > 200 ||
      !value.apiKey ||
      value.apiKey.length > 4096 ||
      /\s/.test(value.apiKey) ||
      !Number.isInteger(value.maxTokens) ||
      value.maxTokens < 500 ||
      value.maxTokens > 4000
    )
      throw new Error('请检查模型名、密钥和输出上限（500～4000 tokens）');
    await putDocument('provider_configs', NAME, {
      ...sealAdsKey(JSON.stringify(value)),
      updatedAt: new Date().toISOString(),
      lastSaveId,
    });
    return {
      configured: true,
      lastSaveId,
      baseUrl: value.baseUrl,
      model: value.model,
      maxTokens: value.maxTokens,
      message: '模型配置已加密保存；生成报告时才调用',
    };
  }
  if (!stored)
    return {
      configured: false,
      message: '尚未配置语义分析模型，仍可采集和查看证据统计',
    };
  const value = JSON.parse(openAdsKey(stored));
  return {
    configured: true,
    lastSaveId: stored.lastSaveId,
    baseUrl: value.baseUrl,
    model: value.model,
    maxTokens: value.maxTokens,
    message: '模型已配置；费用由模型服务商另外计收',
  };
}
export async function analyzeRecords(records, kind, context = {}) {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [NAME])
  ).rows[0]?.value;
  if (!stored)
    throw new Error(
      '请先在数据源与设置配置语义分析模型；ScrapeCreators Key 只用于采集',
    );
  const isAd = kind === 'ad_analysis';
  const prepared = isAd ? adModelInput(records) : null;
  const sample =
    prepared?.evidence ||
    records.slice(0, 80).map((r) => ({
      id: r.id,
      text: r.text.slice(0, 1000),
      kind: r.kind,
      platform: r.platform,
    }));
  if (!sample.length) throw new Error('没有可分析的文本证据');
  const prompt = isAd ? context.prompt || promptSnapshot() : null;
  const config = JSON.parse(openAdsKey(stored));
  const systemPrompt = isAd
    ? `${prompt.text}\n${prompt.systemContract || AD_REPORT_CONTRACT}\n摘要不超过200字，每条结论正文尽量不超过180字，遵守本次输出预算。`
    : LEGACY_RESEARCH_PROMPT;
  const result = await postModel(config, [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: JSON.stringify({
        kind,
        researchFocus: context.researchFocus || '',
        evidence: sample,
        coverage: prepared?.coverage,
        inputLimits: { maxOutputTokens: config.maxTokens },
        availableData:
          '广告文案及已有转写和采集元数据；未输入视频画面、落地页正文、消费者评论、Semrush指标或投放绩效',
      }),
    },
  ]);
  const text = modelReportText(result);
  let parsed;
  try {
    parsed = JSON.parse(
      text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''),
    );
  } catch {
    throw new Error('模型未返回有效 JSON，保留证据统计，可稍后重试');
  }
  return {
    ...validateModelReport(parsed, sample, { ad: isAd }),
    model: config.model,
    inputEvidenceCount: sample.length,
    totalEvidenceCount: records.length,
    usage: result.usage || null,
    ...(isAd
      ? {
          schemaVersion: 2,
          prompt,
          systemPrompt,
          coverage: prepared.coverage,
          researchFocus: context.researchFocus || '',
        }
      : {}),
  };
}
