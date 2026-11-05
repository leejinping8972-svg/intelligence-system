import { requireAdmin } from './auth.mjs';
import { pool, sql } from './database.mjs';
import { translateCollectionRecords } from './collection-translation.mjs';

async function readRecords(ids) {
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
  const result = await pool.query(
    sql(
      `SELECT data FROM research_keywords WHERE data->>'id' IN (${placeholders})`,
      `SELECT data FROM research_keywords WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id')) IN (${placeholders})`,
    ),
    ids,
  );
  return result.rows.map((row) => row.data);
}
function validateIds(ids, limit) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > limit ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => typeof id !== 'string' || !id || id.length > 100)
  )
    throw new Error(`每次请选择1～${limit}个不同关键词，未截断名单`);
}
export function validateNames(parsed, records) {
  if (!Array.isArray(parsed?.items) || parsed.items.length !== records.length)
    throw new Error('译名数量不完整，未覆盖已有中文名；可手动校对后保存');
  const valid = new Set(records.map((record) => record.id)),
    seen = new Set();
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
// Explicit historical repair uses the same cache, batching, accounting and
// unknown-request protection as collection. Browsing never invokes this action.
export async function keywordTranslationsAction(input, user, overrides = {}) {
  if (!['admin', 'researcher'].includes(user?.role))
    throw Object.assign(new Error('请先登录'), { status: 401 });
  if (
    !Array.isArray(input.terms) ||
    !input.terms.length ||
    input.terms.length > 40 ||
    input.terms.some(
      (term) => typeof term !== 'string' || !term.trim() || term.length > 255,
    )
  )
    throw new Error('每次可翻译1～40个有效词');
  validateIds(input.keywordIds, 100);
  const io = {
    records: readRecords,
    translate: translateCollectionRecords,
    saveKeywordName: (term, termZh) =>
      pool.query(
        sql(
          "UPDATE research_keywords SET data=jsonb_set(data,'{termZh}',to_jsonb($2::text),true),updated_at=now() WHERE lower(data->>'term')=lower($1) AND coalesce(data->>'termZh','')=''",
          "UPDATE research_keywords SET data=JSON_SET(data,'$.termZh',$2),updated_at=now() WHERE lower(JSON_UNQUOTE(JSON_EXTRACT(data,'$.term')))=lower($1) AND coalesce(JSON_UNQUOTE(JSON_EXTRACT(data,'$.termZh')),'')=''",
        ),
        [term, termZh],
      ),
    ...overrides,
  };
  const records = await io.records(input.keywordIds);
  if (
    records.length !== input.keywordIds.length ||
    records.some((record) => record.dataNature === 'demo')
  )
    throw new Error('关键词已变化，请刷新列表后重试');
  const normalize = (term) =>
    term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
  const terms = [...new Set(input.terms.map(normalize))];
  const allowed = new Set(
    records
      .flatMap((record) => [
        record.term,
        record.seedTerm,
        ...(record.trendRelatedTop || []).map((item) => item.query),
        ...(record.trendRelatedRising || []).map((item) => item.query),
      ])
      .filter((term) => typeof term === 'string')
      .map(normalize),
  );
  if (terms.some((term) => !allowed.has(term)))
    throw new Error('只允许翻译当前关键词及其相关查询');
  const translated = await io.translate(
    'keywords',
    terms.map((term) => ({
      term,
      termZh: records.find((record) => normalize(record.term) === term)?.termZh,
    })),
  );
  const checked = validateNames(
    {
      items: translated.map((record, index) => ({
        id: String(index),
        termZh: record.termZh,
      })),
    },
    terms.map((_, index) => ({ id: String(index) })),
  );
  const items = checked.map((item, index) => ({
    term: terms[index],
    termZh: item.termZh,
  }));
  for (const item of items) await io.saveKeywordName(item.term, item.termZh);
  return { items };
}
export async function keywordNamesAction(input, user, overrides = {}) {
  requireAdmin(user);
  validateIds(input.ids, 50);
  const io = {
    records: () => readRecords(input.ids),
    translate: translateCollectionRecords,
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
  const translated = await io.translate(
    'keywords',
    records.map(({ id, term, termZh }) => ({ id, term, termZh })),
  );
  return {
    items: validateNames(
      { items: translated.map(({ id, termZh }) => ({ id, termZh })) },
      records,
    ),
  };
}
