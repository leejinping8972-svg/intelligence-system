import { createHash } from 'node:crypto';

import { openAdsKey } from './ads-provider.mjs';
import { currentAiPrompt } from './ai-prompt-config.mjs';
import { aiSystemText } from './ai-prompt-defaults.mjs';
import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import { modelReportText, postModel } from './model-provider.mjs';
import { recordSourceCall } from './source-usage.mjs';

const translationKey = (term) =>
  `keyword:translation:v1:${createHash('sha256').update(term.toLocaleLowerCase()).digest('hex')}`;

export async function keywordTranslationsAction(input, user, overrides = {}) {
  if (!['admin', 'researcher'].includes(user?.role))
    throw Object.assign(new Error('请先登录'), { status: 401 });
  if (
    !Array.isArray(input.terms) ||
    input.terms.length === 0 ||
    input.terms.length > 40 ||
    input.terms.some(
      (term) => typeof term !== 'string' || !term.trim() || term.length > 255,
    )
  )
    throw new Error('每次可翻译1～40个有效词');
  if (
    !Array.isArray(input.keywordIds) ||
    input.keywordIds.length === 0 ||
    input.keywordIds.length > 100 ||
    input.keywordIds.some(
      (id) => typeof id !== 'string' || !id || id.length > 100,
    ) ||
    new Set(input.keywordIds).size !== input.keywordIds.length
  )
    throw new Error('请提供当前列表中的有效关键词');
  const terms = [
    ...new Set(
      input.terms.map((term) =>
        term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim(),
      ),
    ),
  ];
  const io = {
    async records(ids) {
      const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
      const result = await pool.query(
        sql(
          `SELECT data FROM research_keywords WHERE data->>'id' IN (${placeholders})`,
          `SELECT data FROM research_keywords WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id')) IN (${placeholders})`,
        ),
        ids,
      );
      return result.rows.map((row) => row.data);
    },
    async read(values) {
      const names = values.map((value) => translationKey(value));
      const placeholders = names.map((_, index) => `$${index + 1}`).join(',');
      const result = await pool.query(
        `SELECT name,value FROM workspace_documents WHERE name IN (${placeholders})`,
        names,
      );
      return new Map(result.rows.map((row) => [row.name, row.value?.termZh]));
    },
    write: (term, termZh) =>
      putDocument('workspace_documents', translationKey(term), {
        term,
        termZh,
        updatedAt: new Date().toISOString(),
      }),
    saveKeywordName: (term, termZh) =>
      pool.query(
        sql(
          "UPDATE research_keywords SET data=jsonb_set(data,'{termZh}',to_jsonb($2::text),true),updated_at=now() WHERE lower(data->>'term')=lower($1) AND coalesce(data->>'termZh','')=''",
          "UPDATE research_keywords SET data=JSON_SET(data,'$.termZh',$2),updated_at=now() WHERE lower(JSON_UNQUOTE(JSON_EXTRACT(data,'$.term')))=lower($1) AND coalesce(JSON_UNQUOTE(JSON_EXTRACT(data,'$.termZh')),'')=''",
        ),
        [term, termZh],
      ),
    async withLock(callback) {
      const connection = await pool.connect();
      try {
        if (!(await lock(connection, 'keyword-translation'))) return null;
        try {
          return await callback();
        } finally {
          await unlock(connection, 'keyword-translation');
        }
      } finally {
        connection.release();
      }
    },
    async config() {
      const result = await pool.query(
        'SELECT value FROM provider_configs WHERE name=$1',
        ['provider:analysis:v1'],
      );
      if (!result.rows[0]?.value) throw new Error('请先配置语义分析模型');
      return JSON.parse(openAdsKey(result.rows[0].value));
    },
    prompt: () => currentAiPrompt('keyword_translation'),
    post: postModel,
    record: recordSourceCall,
    ...overrides,
  };
  const records = await io.records(input.keywordIds);
  if (
    records.length !== input.keywordIds.length ||
    records.some((record) => record.dataNature === 'demo')
  )
    throw new Error('关键词已变化，请刷新列表后重试');
  const allowed = new Set(
    records
      .flatMap((record) => [
        record.term,
        record.seedTerm,
        ...(record.trendRelatedTop || []).map((item) => item.query),
        ...(record.trendRelatedRising || []).map((item) => item.query),
      ])
      .filter((term) => typeof term === 'string')
      .map((term) => term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()),
  );
  if (terms.some((term) => !allowed.has(term)))
    throw new Error('只允许翻译当前关键词及其相关查询');
  const cached = await io.read(terms);
  const missing = terms.filter((term) => !cached.get(translationKey(term)));
  if (missing.length === 0) {
    for (const term of terms)
      await io.saveKeywordName(term, cached.get(translationKey(term)));
    return {
      items: terms.map((term) => ({
        term,
        termZh: cached.get(translationKey(term)),
      })),
      cached: true,
    };
  }
  const translated = await io.withLock(async () => {
    const latest = await io.read(terms);
    const pending = terms.filter((term) => !latest.get(translationKey(term)));
    if (pending.length === 0) {
      for (const term of terms)
        await io.saveKeywordName(term, latest.get(translationKey(term)));
      return {
        items: terms.map((term) => ({
          term,
          termZh: latest.get(translationKey(term)),
        })),
        cached: true,
      };
    }
    const config = await io.config();
    const prompt = await io.prompt();
    const records = pending.map((term, index) => ({
      id: String(index),
      term,
      market: 'ALL',
    }));
    const result = await io.record(
      {
        sourceId: 'analysis',
        task: 'keyword_translation',
        step: 'translate',
        project: (response) => ({
          usage: response.usage || {},
          model: config.model,
        }),
      },
      () =>
        io.post(config, [
          { role: 'system', content: aiSystemText(prompt) },
          { role: 'user', content: JSON.stringify({ items: records }) },
        ]),
    );
    let parsed;
    try {
      parsed = JSON.parse(
        modelReportText(result)
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/, ''),
      );
    } catch {
      throw new Error('模型译名未完整返回，本次请求已记账且不会自动重试');
    }
    const names = validateNames(parsed, records);
    for (const item of names) {
      const term = pending[Number(item.id)];
      await io.write(term, item.termZh);
      await io.saveKeywordName(term, item.termZh);
      latest.set(translationKey(term), item.termZh);
    }
    return {
      items: terms.map((term) => ({
        term,
        termZh: latest.get(translationKey(term)),
      })),
      model: config.model,
      usage: result.usage || null,
      cached: false,
    };
  });
  if (!translated) throw new Error('译名补齐正在执行，请稍后重试');
  return translated;
}

export function validateNames(parsed, records) {
  if (!Array.isArray(parsed?.items) || parsed.items.length !== records.length)
    throw new Error('译名数量不完整，未覆盖已有中文名；可手动校对后保存');
  const valid = new Set(records.map((record) => record.id));
  const seen = new Set();
  return parsed.items.map((item) => {
    if (
      !valid.has(item.id) ||
      seen.has(item.id) ||
      typeof item.termZh !== 'string'
    )
      throw new Error('模型返回未知或重复的关键词编号');
    const termZh = item.termZh.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
    if (
      !termZh ||
      termZh.length > 255 ||
      !/\p{Script=Han}/u.test(termZh) ||
      [...termZh].some((character) => character.codePointAt(0) < 32)
    )
      throw new Error('模型未返回有效中文名称，请手动校对');
    seen.add(item.id);
    return { id: item.id, termZh };
  });
}
export async function keywordNamesAction(input, user, overrides = {}) {
  requireAdmin(user);
  if (
    !Array.isArray(input.ids) ||
    input.ids.length === 0 ||
    input.ids.length > 50 ||
    input.ids.some((id) => typeof id !== 'string' || id.length > 100) ||
    new Set(input.ids).size !== input.ids.length
  )
    throw new Error('每次请选择1～50个不同关键词，未截断名单');
  const io = {
    async records() {
      const placeholders = input.ids
        .map((_, index) => `$${index + 1}`)
        .join(',');
      const result = await pool.query(
        sql(
          `SELECT data FROM research_keywords WHERE data->>'id' IN (${placeholders})`,
          `SELECT data FROM research_keywords WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id')) IN (${placeholders})`,
        ),
        input.ids,
      );
      return result.rows.map((row) => row.data);
    },
    async config() {
      const result = await pool.query(
        'SELECT value FROM provider_configs WHERE name=$1',
        ['provider:analysis:v1'],
      );
      if (!result.rows[0]?.value)
        throw new Error('请先在数据源与设置配置语义分析模型，或手动填写中文名');
      return JSON.parse(openAdsKey(result.rows[0].value));
    },
    prompt: () => currentAiPrompt('keyword_translation'),
    post: postModel,
    ...overrides,
  };
  const all = await io.records();
  const records = input.ids.map((id) => all.find((record) => record.id === id));
  if (
    records.some(
      (record) =>
        !record ||
        record.dataNature === 'demo' ||
        typeof record.term !== 'string' ||
        record.term.length > 255,
    )
  )
    throw new Error('关键词已变化或不可翻译，请刷新后重试');
  const config = await io.config();
  const prompt = await io.prompt();
  // Exactly one model call per explicit request. No automatic retry or data-source requests.
  const result = await io.post(config, [
    {
      role: 'system',
      content: aiSystemText(prompt),
    },
    {
      role: 'user',
      content: JSON.stringify({
        items: records.map(({ id, term, market }) => ({ id, term, market })),
      }),
    },
  ]);
  let parsed;
  try {
    parsed = JSON.parse(
      modelReportText(result)
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, ''),
    );
  } catch {
    throw new Error('模型译名未完整返回，未自动重试；请检查输出上限或减少词数');
  }
  return {
    items: validateNames(parsed, records),
    model: config.model,
    promptVersion: prompt.version,
    usage: Object.fromEntries(
      ['prompt_tokens', 'completion_tokens', 'total_tokens']
        .filter(
          (key) =>
            Number.isSafeInteger(result.usage?.[key]) && result.usage[key] >= 0,
        )
        .map((key) => [key, result.usage[key]]),
    ),
  };
}
