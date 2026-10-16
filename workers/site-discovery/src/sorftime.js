const MCP_URL = 'https://mcp.sorftime.com/';
const SOURCE = 'Sorftime · Amazon';
const TOOL = 'keyword_related_words';
const MARKETS = new Set(['MX', 'US']);

function safeError(message, token) {
  return String(message || 'Sorftime MCP 调用失败')
    .replaceAll(token || '\u0000', '[redacted]')
    .replaceAll(/https:\/\/mcp\.sorftime\.com[^\s"<>]*/gi, 'Sorftime MCP');
}

export function parseMcpResponse(text, id) {
  const documents = text.trim().startsWith('{')
    ? [text]
    : text.split(/\r?\n\r?\n/).map((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n'),
      );
  for (const document of documents) {
    if (!document.trim()) continue;
    let payload;
    try {
      payload = JSON.parse(document);
    } catch {
      continue;
    }
    if (payload.id !== id) continue;
    if (payload.error) throw new Error(payload.error.message || 'MCP 协议错误');
    if (payload.result === undefined) throw new Error('MCP 返回缺少结果');
    return payload.result;
  }
  throw new Error('Sorftime MCP 未返回可识别的响应');
}

async function connect(token, fetcher = fetch) {
  if (!token) throw new Error('请先在数据源与设置保存 Sorftime MCP Token');
  const url = new URL(MCP_URL);
  url.searchParams.set('key', token);
  let session;
  let sequence = 0;
  const rpc = async (method, params, notify = false) => {
    const id = ++sequence;
    const response = await fetcher(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notify ? {} : { id }),
        method,
        params,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    session = response.headers.get('mcp-session-id') || session;
    if (!response.ok)
      throw new Error(`Sorftime MCP 返回HTTP ${response.status}`);
    if (notify) {
      await response.body?.cancel();
      return;
    }
    const text = await response.text();
    if (text.length > 4_000_000)
      throw new Error('Sorftime 返回数据过大，请减少结果数量');
    return parseMcpResponse(text, id);
  };
  try {
    await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'intelligence-system-keyword-research',
        version: '1.0.0',
      },
    });
    await rpc('notifications/initialized', {}, true);
    const listed = await rpc('tools/list', {});
    const tool = listed.tools?.find((item) => item.name === TOOL);
    if (!tool)
      throw new Error(
        'Sorftime Token 未授权延伸关键词工具，请检查 MCP 权限与额度',
      );
    const properties = tool.inputSchema?.properties || {};
    if (!properties.amzSite || !properties.searchKeyword)
      throw new Error('Sorftime 关键词参数已变更，需更新接入后再调用');
    return { rpc, tool };
  } catch (error) {
    throw new Error(
      safeError(error instanceof Error ? error.message : '', token),
      { cause: error },
    );
  }
}

export async function sorftimeStatus(env, verify = false, fetcher = fetch) {
  const token = env.SORFTIME_MCP_TOKEN;
  if (!token)
    return {
      configured: false,
      ready: false,
      markets: [...MARKETS],
      message: '等待在数据源与设置填写 MCP Token',
    };
  if (!verify)
    return {
      configured: true,
      ready: false,
      markets: [...MARKETS],
      message: '密钥已配置，等待连接验证',
    };
  try {
    const client = await connect(token, fetcher);
    const supported = client.tool.inputSchema.properties.amzSite.enum;
    return {
      configured: true,
      ready: true,
      markets: [...MARKETS],
      message: 'MCP 已连接，可调用延伸关键词工具；实际数据按账户额度计费',
      ...(Array.isArray(supported)
        ? {
            markets: [...MARKETS].filter((market) =>
              supported.includes(market),
            ),
          }
        : {}),
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      markets: [...MARKETS],
      message: safeError(error.message, token),
    };
  }
}

export function parseSorftimeKeywords(result, limit) {
  if (result.isError)
    throw new Error('Sorftime 工具返回错误，请检查关键词、权限与剩余额度');
  const keywords = new Map();
  const visit = (value, keywordArray = false, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text.startsWith('{') || text.startsWith('[')) {
        try {
          visit(JSON.parse(text), keywordArray, depth + 1);
        } catch {
          /* prose is not a keyword list */
        }
      } else if (keywordArray && text.length > 0 && text.length <= 255)
        keywords.set(text.toLocaleLowerCase(), { term: text, source: SOURCE });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keywordArray, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const term =
      value.keyword ??
      value.Keyword ??
      value.searchKeyword ??
      value.SearchKeyword;
    if (typeof term === 'string' && term.trim() && term.length <= 255)
      keywords.set(term.trim().toLocaleLowerCase(), {
        term: term.trim(),
        source: SOURCE,
      });
    for (const key of [
      'Data',
      'data',
      'List',
      'list',
      'items',
      'Items',
      'keywords',
      'Keywords',
      'result',
      'results',
      'rows',
    ]) {
      if (value[key] !== undefined) visit(value[key], true, depth + 1);
    }
  };
  if (result.structuredContent) visit(result.structuredContent);
  for (const item of result.content || [])
    if (item.type === 'text') visit(item.text);
  return [...keywords.values()].slice(0, limit);
}

export async function sorftimeSuggestions(
  keyword,
  market,
  depth,
  limit,
  budget,
  env,
  fetcher = fetch,
) {
  if (!MARKETS.has(market))
    return {
      source: SOURCE,
      items: [],
      status: 'unsupported',
      message: '当前 Sorftime 来源为 Amazon 关键词，不支持越南市场，未跨国替代',
    };
  if (budget.remaining <= 0)
    return {
      source: SOURCE,
      items: [],
      status: 'error',
      message: '本任务 Sorftime 调用额度已用完，未继续请求',
    };
  const items = new Map();
  let message = '';
  try {
    const client = await connect(env.SORFTIME_MCP_TOKEN, fetcher);
    const supported = client.tool.inputSchema.properties.amzSite.enum;
    if (Array.isArray(supported) && !supported.includes(market))
      return {
        source: SOURCE,
        items: [],
        status: 'unsupported',
        message: '此账户的关键词工具不支持所选市场，未跨国替代',
      };
    const query = async (term) => {
      if (budget.remaining <= 0) return;
      budget.remaining -= 1;
      budget.used += 1;
      const response = await client.rpc('tools/call', {
        name: TOOL,
        arguments: { amzSite: market, searchKeyword: term },
      });
      for (const item of parseSorftimeKeywords(response, limit))
        items.set(item.term.toLocaleLowerCase(), item);
    };
    await query(keyword);
    if (depth === 2) {
      for (const item of [...items.values()].slice(0, 5)) {
        if (items.size >= limit || budget.remaining <= 0) break;
        await query(item.term);
      }
    }
    if (budget.remaining <= 0 && items.size < limit)
      message = '已达到本任务 Sorftime 调用上限，保留已获取关键词';
    return {
      source: SOURCE,
      items: [...items.values()].slice(0, limit),
      status: items.size > 0 ? 'success' : 'empty',
      message:
        message ||
        (items.size > 0
          ? 'Amazon 站内关键词，不等同于 Google 搜索量'
          : '未返回可识别的延伸词，详见连接与账户权限'),
    };
  } catch (error) {
    return {
      source: SOURCE,
      items: [...items.values()].slice(0, limit),
      status: items.size > 0 ? 'partial' : 'error',
      message: safeError(error.message, env.SORFTIME_MCP_TOKEN),
    };
  }
}
