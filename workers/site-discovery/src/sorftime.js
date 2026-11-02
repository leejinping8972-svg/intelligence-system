const MCP_URL = 'https://mcp.sorftime.com/';
const SOURCE = 'Sorftime · Amazon';
const TOOLS = {
  keyword_extends: { keyword: 'keyword', market: 'keyword_support_site' },
  keyword_related_words: { keyword: 'searchKeyword', market: 'amzSite' },
};
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

export async function readMcpResult(response, id) {
  if (!response.body) throw new Error('Sorftime MCP 返回空响应');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return parseMcpResponse(text, id);
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 4_000_000)
        throw new Error('Sorftime 返回数据过大，请减少结果数量');
      try {
        return parseMcpResponse(text, id);
      } catch (error) {
        if (error.message !== 'Sorftime MCP 未返回可识别的响应') throw error;
      }
    }
  } finally {
    await reader.cancel();
  }
}

async function connect(token, fetcher = fetch) {
  if (!token) throw new Error('请先在数据源与设置保存 Sorftime MCP Token');
  const url = new URL(MCP_URL);
  url.searchParams.set('key', token);
  let session;
  let protocol;
  let sequence = 0;
  const rpc = async (method, params, notify = false) => {
    const id = ++sequence;
    const response = await fetcher(url.toString(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'user-agent': 'intelligence-system/1.0 Sorftime-MCP-client',
        ...(session ? { 'mcp-session-id': session } : {}),
        ...(protocol ? { 'mcp-protocol-version': protocol } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        ...(notify ? {} : { id }),
        method,
        params,
      }),
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(
        'Sorftime MCP 返回重定向，已停止转发以保护 Token，请检查服务地址',
      );
    }
    session = response.headers.get('mcp-session-id') || session;
    if (!response.ok) {
      const detail = safeError(await response.text(), token).slice(0, 400);
      throw new Error(
        `Sorftime MCP ${method} 返回HTTP ${response.status}：${detail}`,
      );
    }
    if (notify) {
      await response.body?.cancel();
      return;
    }
    return readMcpResult(response, id);
  };
  try {
    let listed;
    try {
      const initialized = await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'intelligence-system-keyword-research',
          version: '1.0.0',
        },
      });
      protocol = initialized.protocolVersion || '2025-03-26';
      await rpc('notifications/initialized', {}, true);
    } catch (error) {
      if (
        !/Sorftime MCP (initialize|notifications\/initialized) 返回HTTP 400/.test(
          error.message,
        )
      )
        throw error;
      session = undefined;
      protocol = undefined;
      // Sorftime also exposes stateless JSON-RPC; metadata discovery remains authenticated.
      listed = await rpc('tools/list', {});
    }
    listed ||= await rpc('tools/list', {});
    const tool = Object.keys(TOOLS)
      .map((name) => listed.tools?.find((item) => item.name === name))
      .find(Boolean);
    if (!tool) {
      const available = (listed.tools || [])
        .filter((item) =>
          /keyword|related|关键词|authorization/i.test(item.name),
        )
        .map(
          (item) =>
            `${item.name}(${Object.keys(item.inputSchema?.properties || {}).join(',')})`,
        )
        .slice(0, 12)
        .join('；');
      throw new Error(
        `Sorftime 返回的关键词工具需要适配：${available || '未返回关键词工具'}`,
      );
    }
    const properties = tool.inputSchema?.properties || {};
    const fields = TOOLS[tool.name];
    if (!properties[fields.market] || !properties[fields.keyword])
      throw new Error('Sorftime 关键词参数已变更，需更新接入后再调用');
    return { rpc, tool, fields };
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
    const supported =
      client.tool.inputSchema.properties[client.fields.market].enum;
    return {
      configured: true,
      ready: true,
      markets: [...MARKETS],
      message: 'MCP 已连接，可调用延伸关键词工具；实际数据按账户额度计费',
      ...(Array.isArray(supported)
        ? {
            markets: [...MARKETS].filter((market) =>
              supported.some((value) => String(value).toUpperCase() === market),
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
  const add = (term) => {
    const normalized = term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim();
    if (normalized && normalized.length <= 255)
      keywords.set(normalized.toLocaleLowerCase(), {
        term: normalized,
        source: SOURCE,
      });
  };
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
      } else if (keywordArray) add(text);
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
    if (typeof term === 'string') add(term);
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
    const properties = client.tool.inputSchema.properties;
    const supported = properties[client.fields.market].enum;
    const siteValue = Array.isArray(supported)
      ? supported.find((value) => String(value).toUpperCase() === market)
      : market;
    if (!siteValue)
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
        name: client.tool.name,
        arguments: {
          [client.fields.market]: siteValue,
          [client.fields.keyword]: term,
          ...(properties.page
            ? { page: properties.page.type === 'string' ? '1' : 1 }
            : {}),
        },
      });
      for (const item of parseSorftimeKeywords(response, limit + 1)) {
        const key = item.term.toLocaleLowerCase();
        if (key === keyword.normalize('NFKC').toLocaleLowerCase()) continue;
        items.set(key, item);
        if (items.size >= limit) break;
      }
    };
    await query(keyword);
    if (depth === 2) {
      for (const item of [...items.values()]) {
        if (items.size >= limit || budget.remaining <= 0) break;
        if (item.term.toLocaleLowerCase() === keyword.normalize('NFKC').toLocaleLowerCase()) continue;
        await query(item.term);
      }
    }
    if (budget.remaining <= 0 && items.size < limit)
      message = '已达到本任务 Sorftime 调用上限，保留已获取关键词';
    else if (items.size > 0 && items.size < limit)
      message = `${depth === 2 ? '已完成二级扩词并遍历首轮返回词' : '已完成一级扩词'}；本来源去重后返回${items.size}个词，低于本组目标${limit}个，未继续更深层扩词`;
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
