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
    let payload;
    try {
      payload = JSON.parse(document);
    } catch {
      continue;
    }
    if (payload.id !== id) continue;
    if (payload.error) throw new Error(payload.error.message || 'MCP 协议错误');
    if (payload.result === undefined) throw new Error('MCP 响应缺少结果');
    return payload.result;
  }
  return undefined;
}
export async function readMcpResult(response, id) {
  if (!response.body) throw new Error('MCP 返回空响应');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      text += decoder.decode(chunk.value, { stream: !chunk.done });
      if (text.length > 4_000_000) throw new Error('MCP 响应过大，已停止读取');
      const result = parseMcpResponse(text, id);
      if (result !== undefined) return result;
      if (chunk.done) throw new Error('MCP 未返回匹配请求的有效响应');
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}
