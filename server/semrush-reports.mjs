import process from 'node:process';
import { createHash } from 'node:crypto';
import { pool, putDocument } from './database.mjs';
import { decryptSemrushKey } from './semrush-config.mjs';
import { connectSemrush, safeSemrushError } from './semrush-mcp.mjs';

export function mcpPayload(result) {
  if (result.isError)
    throw new Error(
      result.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join(' ') || 'Semrush 报告失败',
    );
  if (result.structuredContent) return result.structuredContent;
  const text = result.content
    ?.filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Semrush 返回了无法识别的报告格式');
  }
}
export function csvRows(text) {
  if (/^ERROR\s*50\s*::\s*(NOTHING FOUND|NO DATA FOUND)/i.test(text.trim()))
    return [];
  if (/^ERROR/i.test(text.trim()))
    throw new Error(`Semrush ${text.trim().slice(0, 300)}`);
  const delimiter = text.split('\n')[0].includes(';') ? ';' : ',';
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i <= text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (c === delimiter || c === '\n' || c === undefined)) {
      row.push(cell.replace(/\r$/, ''));
      cell = '';
      if (c !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  const headers = rows.shift() || [];
  return rows.map((values) =>
    Object.fromEntries(
      headers.map((key, i) => [key.replace(/^\uFEFF/, '').trim(), values[i]]),
    ),
  );
}
export function reportRows(payload) {
  const data = payload.data;
  if (typeof data === 'string') return csvRows(data);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.data)) return data.data;
  throw new Error('Semrush 报告未返回可识别的数据行');
}
const get = (r, ...keys) => {
  for (const key of keys)
    if (r[key] !== undefined && r[key] !== null && r[key] !== '') return r[key];
};
const numeric = (r, keys, max = Infinity) => {
  const v = get(r, ...keys);
  if (v === undefined || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(String(v).trim()))
    return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
};
export function rowMetrics(row, market, at, report = 'phrase_this') {
  const metrics = {
    market,
    source: `Semrush MCP · ${report}`,
    collectedAt: at,
    database: market.toLowerCase(),
    report,
  };
  for (const [key, keys, max] of [
    ['monthlySearchVolume', ['volume', 'search_volume', 'Search Volume', 'Nq']],
    [
      'difficulty',
      [
        'keyword_difficulty',
        'Keyword Difficulty',
        'Keyword Difficulty Index',
        'Kd',
      ],
      100,
    ],
    ['cpc', ['cpc', 'CPC', 'Cp']],
    ['advertisingCompetition', ['competitive_density', 'Competition', 'Co'], 1],
  ]) {
    const value = numeric(row, keys, max);
    if (value !== undefined) metrics[key] = value;
  }
  const intent = get(row, 'intent', 'Intent', 'Intents', 'Int');
  if (intent !== undefined) metrics.intent = String(intent).slice(0, 100);
  return metrics;
}
export const rowTerm = (row) =>
  String(get(row, 'keyword', 'Keyword', 'Ph') || '')
    .normalize('NFKC')
    .replaceAll(/\s+/g, ' ')
    .trim();
const cacheName = (term, market) =>
  `semrush:metrics:${market}:${createHash('sha256').update(term.toLowerCase()).digest('hex')}`;
export async function client() {
  const { rows } = await pool.query(
    'SELECT value FROM provider_configs WHERE name=$1',
    ['provider:semrush:mcp:v1'],
  );
  if (!rows[0]) throw new Error('请先在数据源与设置中配置 Semrush API Key');
  const key = decryptSemrushKey(
    rows[0].value,
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY,
  );
  try {
    return { c: await connectSemrush(key), key };
  } catch (e) {
    throw new Error(safeSemrushError(e, key));
  }
}
async function execute(c, report, params) {
  const schema = mcpPayload(
    await c.rpc('tools/call', {
      name: 'get_report_schema',
      arguments: { report },
    }),
  );
  if (schema.report !== report)
    throw new Error('Semrush 报告标识不匹配，已停止查询');
  const allowed = schema.parameters.export_columns?.items?.enum || [];
  params.export_columns = [
    'keyword',
    'volume',
    'keyword_difficulty',
    'cpc',
    'competitive_density',
    'intent',
  ].filter((k) => allowed.includes(k));
  if (!schema.parameters.database?.enum?.includes(params.database))
    throw new Error('Semrush 当前报告不支持该国家市场');
  return mcpPayload(
    await c.rpc('tools/call', {
      name: 'execute_report',
      arguments: { report, params },
    }),
  );
}
export async function collectSemrush(request) {
  const term = request.keywords[0],
    market = request.markets[0],
    at = new Date().toISOString();
  const name = cacheName(term, market);
  if (request.semExpansion !== true) {
    const { rows } = await pool.query(
      'SELECT value FROM provider_configs WHERE name=$1',
      [name],
    );
    const cached = rows[0]?.value;
    if (cached && Date.now() - Date.parse(cached.cachedAt) < 30 * 86400000)
      return {
        ...cached.result,
        apiUnits: 0,
        cached: true,
        message: `使用30天内 Semrush 缓存，未重复调用；指标采集日期保留原值。${cached.result.message || ''}`,
      };
  }
  const { c, key } = await client();
  try {
    if (request.semExpansion === true) {
      const items = new Map(),
        sources = [];
      let apiUnits = 0;
      const reports = [
        'phrase_related',
        'phrase_fullsearch',
        'phrase_questions',
      ];
      for (const [reportIndex, report] of reports.entries()) {
        const remaining = Math.max(0, Number(request.limit) - items.size);
        if (!remaining) break;
        try {
          const payload = await execute(c, report, {
            database: market.toLowerCase(),
            phrase: term,
            display_limit: Math.ceil(
              remaining / (reports.length - reportIndex),
            ),
          });
          apiUnits += payload.metadata?.usage?.api_units || 0;
          const rows = reportRows(payload);
          for (const row of rows) {
            const word = rowTerm(row);
            if (!word || items.size >= request.limit) continue;
            items.set(word.toLowerCase(), {
              term: word,
              source: `Semrush ${report}`,
              metrics: rowMetrics(row, market, at, report),
            });
          }
          sources.push({
            source: `Semrush ${report}`,
            status: 'ok',
            count: rows.length,
            message: `报告返回${rows.length}个词`,
          });
        } catch (e) {
          sources.push({
            source: `Semrush ${report}`,
            status: 'error',
            count: 0,
            message: safeSemrushError(e, key),
          });
          if (/401|403|429|额度|权限|过期/.test(e.message)) break;
        }
      }
      for (const item of items.values())
        if (
          item.metrics.monthlySearchVolume !== undefined &&
          item.metrics.difficulty !== undefined
        )
          await putDocument('provider_configs', cacheName(item.term, market), {
            cachedAt: at,
            result: {
              metrics: item.metrics,
              apiUnits: 0,
              message: '使用 Semrush 扩词报告中已返回的指标，无需重复概览查询',
            },
          });
      return {
        generatedAt: at,
        suggestions: [
          { keyword: term, market, items: [...items.values()], sources },
        ],
        apiUnits,
      };
    }
    const payload = await execute(c, 'phrase_this', {
      database: market.toLowerCase(),
      phrase: term,
    });
    const row = reportRows(payload).find(
      (r) =>
        rowTerm(r).toLowerCase() ===
        term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase(),
    );
    const metrics = row ? rowMetrics(row, market, at) : null;
    const complete =
      metrics?.monthlySearchVolume !== undefined &&
      metrics?.difficulty !== undefined;
    const result = {
      complete,
      metrics,
      apiUnits: payload.metadata?.usage?.api_units,
      message: row
        ? complete
          ? '已获取同市场 Semrush 搜索量与自然搜索 KD；意图未返回时保留未知'
          : 'Semrush 仅返回部分指标；搜索量或自然搜索 KD 缺项仍需补充'
        : 'Semrush 未收录该关键词，不能当成搜索量为0',
    };
    await putDocument('provider_configs', name, { cachedAt: at, result });
    return result;
  } catch (e) {
    throw new Error(safeSemrushError(e, key));
  }
}
