import { client, mcpPayload, reportRows } from './semrush-reports.mjs';
import { safeSemrushError } from './semrush-mcp.mjs';

export async function collectSemrushSites(request, connect = client) {
  const { c, key, semrushKeyId } = await connect();
  try {
    const report = 'phrase_adwords';
    const schema = mcpPayload(
      await c.rpc('tools/call', {
        name: 'get_report_schema',
        arguments: { report },
      }),
    );
    const p = schema.parameters || {};
    if (
      schema.report !== report ||
      !p.database?.enum?.includes(request.market.toLowerCase())
    )
      throw new Error('Semrush付费广告主报告不支持所选市场');
    if (request.offset && !p.display_offset)
      throw new Error('当前Semrush报告不支持翻页，已停止后续请求');
    const allowed = p.export_columns?.items?.enum || [];
    if (!allowed.includes('domain'))
      throw new Error('Semrush广告主字段结构已变化');
    const params = {
      database: request.market.toLowerCase(),
      phrase: request.term,
      display_limit: request.limit,
      export_columns: ['domain', 'url'].filter((field) =>
        allowed.includes(field),
      ),
      ...(p.display_offset ? { display_offset: request.offset } : {}),
    };
    const payload = mcpPayload(
      await c.rpc('tools/call', {
        name: 'execute_report',
        arguments: { report, params },
      }),
    );
    const rows = reportRows(payload);
    if (rows.length > request.limit)
      throw new Error('Semrush报告超出请求行数，停止后续请求');
    return {
      rows,
      apiUnits: payload.metadata?.usage?.api_units,
      semrushKeyId,
      collectedAt: new Date().toISOString(),
    };
  } catch (error) {
    throw new Error(safeSemrushError(error, key));
  } finally {
    await c.close?.();
  }
}
