import { createHash } from 'node:crypto';

import { pool, putDocument } from './database.mjs';
import { safeSemrushError } from './semrush-mcp.mjs';
import { client, mcpPayload, reportRows } from './semrush-reports.mjs';
export function domainMetrics(row, market, domain, at) {
  const m = {
    domain,
    market,
    collectedAt: at,
    source: 'Semrush MCP · domain_rank',
  };
  for (const [field, keys] of [
    ['organicTraffic', ['organic_traffic', 'Organic Traffic', 'Ot']],
    ['organicKeywords', ['organic_keywords', 'Organic Keywords', 'Or']],
    ['paidTraffic', ['paid_traffic', 'Adwords Traffic', 'At']],
    ['paidKeywords', ['paid_keywords', 'Adwords Keywords', 'Ad']],
  ]) {
    const v = keys
      .map((k) => row[k])
      .find((v) => v !== undefined && v !== null && v !== '');
    if (/^\d+(?:\.\d+)?$/.test(String(v)) && Number.isFinite(Number(v)))
      m[field] = Number(v);
  }
  return m;
}
export async function collectSiteMetrics(request) {
  const at = new Date().toISOString();
    const { domain, market } = request;
  if (!/^[a-z0-9.-]+$/i.test(domain) || !['MX', 'US', 'VN'].includes(market))
    throw new Error('站点域名或市场不正确');
  const name = `site:semrush:${market}:${createHash('sha256').update(domain).digest('hex')}`;
  const cached = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [name])
  ).rows[0]?.value;
  if (cached && Date.now() - Date.parse(cached.cachedAt) < 30 * 86_400_000)
    return { ...cached.result, cached: true, apiUnits: 0 };
  const { c, key, semrushKeyId } = await client();
  try {
    const schema = mcpPayload(
      await c.rpc('tools/call', {
        name: 'get_report_schema',
        arguments: { report: 'domain_rank' },
      }),
    );
    if (
      schema.report !== 'domain_rank' ||
      !schema.parameters?.database?.enum?.includes(market.toLowerCase())
    )
      throw new Error('Semrush 域名报告不支持此市场');
    const allowed = schema.parameters.export_columns?.items?.enum || [];
    const target = schema.parameters.target
      ? 'target'
      : schema.parameters.domain
        ? 'domain'
        : null;
    if (!target) throw new Error('Semrush 域名报告缺少目标参数，已停止查询');
    const payload = mcpPayload(
      await c.rpc('tools/call', {
        name: 'execute_report',
        arguments: {
          report: 'domain_rank',
          params: {
            [target]: domain,
            database: market.toLowerCase(),
            export_columns: [
              'domain',
              'organic_traffic',
              'organic_keywords',
              'paid_traffic',
              'paid_keywords',
            ].filter((k) => allowed.includes(k)),
          },
        },
      }),
    );
    const row = reportRows(payload)[0];
    const result = {
      metrics: row ? domainMetrics(row, market, domain, at) : null,
      apiUnits: payload.metadata?.usage?.api_units,
      message: row
        ? '已获取目标市场自然搜索指标（Semrush估算）'
        : 'Semrush 未收录此域名，保留未知',
    };
    await putDocument('provider_configs', name, { cachedAt: at, result });
    return { ...result, semrushKeyId };
  } catch (error) {
    throw new Error(safeSemrushError(error, key), { cause: e });
  }
}
