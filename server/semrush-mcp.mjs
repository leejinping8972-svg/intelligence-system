import { readMcpResult } from './mcp-response.mjs';
import { scheduleSource } from './source-scheduler.mjs';

export const SEMRUSH_MCP_URL = 'https://mcp.semrush.com/v2/mcp';
const REQUIRED = ['keyword_research', 'get_report_schema', 'execute_report'];
export function validateSemrushKey(value) {
  const key = typeof value === 'string' ? value.trim() : '';
  if (key.length < 10 || key.length > 4096 || /\s|https?:\/\//i.test(key))
    throw new Error(
      '请输入 API Key 本身，不要粘贴网址或 Authorization 前缀；留空不会覆盖原配置',
    );
  return key;
}
export function safeSemrushError(error, key) {
  return String(error?.message || error || 'Semrush MCP 连接失败')
    .replaceAll(key || '\u0000', '[已隐藏]')
    .replaceAll(key ? encodeURIComponent(key) : '\u0000', '[已隐藏]')
    .replaceAll(/Sorftime/g, 'Semrush')
    .slice(0, 600);
}
export async function connectSemrush(key, fetcher = fetch) {
  key = validateSemrushKey(key);
  let protocol = '';
  let sequence = 0;
  let session = '';
  const rpc = async (method, params = {}, notify = false) =>
    scheduleSource(
      'semrush',
      async () => {
        const id = ++sequence;
        const response = await fetcher(SEMRUSH_MCP_URL, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(20_000),
          headers: {
            authorization: `Apikey ${key}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(session ? { 'mcp-session-id': session } : {}),
            ...(protocol ? { 'mcp-protocol-version': protocol } : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            ...(notify ? {} : { id }),
            method,
            params,
          }),
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error('Semrush MCP 返回重定向，已停止转发以保护 API Key');
        }
        if (!response.ok) {
          await response.body?.cancel();
          const reasons = {
            401: 'API Key 无效或已过期，请核对提供方给出的有效期',
            403: '当前 Key 或订阅没有此 MCP 访问权限',
            429: '服务限流或额度限制，请稍后检测并核对账户额度',
          };
          throw Object.assign(
            new Error(
              `Semrush MCP HTTP ${response.status}：${reasons[response.status] || '官方服务暂未接受请求'}`,
            ),
            {
              status: response.status,
              retryAfterSeconds:
                Number(response.headers.get('retry-after')) || 0,
            },
          );
        }
        session = response.headers.get('mcp-session-id') || session;
        if (notify) {
          await response.body?.cancel();
          return;
        }
        return await readMcpResult(response, id);
      },
      { intervalMs: fetcher === fetch ? 1000 : 0 },
    );
  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'luckdate-intelligence-system', version: '1.0.0' },
    });
    protocol = initialized.protocolVersion || '2025-03-26';
    await rpc('notifications/initialized', {}, true);
    const tools = [];
    let cursor;
    for (let page = 0; page < 10; page++) {
      const listed = await rpc('tools/list', cursor ? { cursor } : {});
      tools.push(...(Array.isArray(listed.tools) ? listed.tools : []));
      cursor = listed.nextCursor;
      if (!cursor) break;
    }
    return { tools, protocol, rpc };
  } catch (error) {
    throw new Error(safeSemrushError(error, key));
  }
}
export async function semrushConnectionStatus(
  key,
  verify = false,
  fetcher = fetch,
) {
  const basic = {
    endpoint: SEMRUSH_MCP_URL,
    configured: Boolean(key),
    ready: false,
  };
  if (!key)
    return {
      ...basic,
      message: '接入组件已安装，等待管理员填写 Semrush API Key',
    };
  if (!verify) return { ...basic, message: 'API Key 已加密保存，尚未检测连接' };
  try {
    const client = await connectSemrush(key, fetcher);
    const names = client.tools
      .map((tool) => tool.name)
      .filter((name) => typeof name === 'string');
    const missing = REQUIRED.filter((name) => !names.includes(name));
    return {
      ...basic,
      ready: missing.length === 0,
      connected: true,
      checkedAt: new Date().toISOString(),
      protocol: client.protocol,
      toolCount: names.length,
      tools: names.slice(0, 100),
      message: missing.length
        ? `MCP 握手成功，但缺少关键词工具：${missing.join('、')}。请核对订阅和 Key 权限`
        : 'MCP 握手及关键词工具发现通过。尚未执行数据报告；报告权限、可用字段和实际扣费需用小批量查询验证',
    };
  } catch (error) {
    return {
      ...basic,
      checkedAt: new Date().toISOString(),
      message: safeSemrushError(error, key),
    };
  }
}
