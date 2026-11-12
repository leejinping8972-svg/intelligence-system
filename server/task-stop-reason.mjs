export function checkpointFailureCount(value) {
  return Array.isArray(value)
    ? value.length
    : Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
}

export function safeTaskError(value) {
  return String(value || '')
    .replaceAll(/https?:\/\/[^\s"<>]+/gi, (url) => {
      try {
        const parsed = new URL(url);
        if (/mcp\.sorftime\.com/i.test(parsed.hostname)) return 'Sorftime MCP';
        return `${parsed.origin}${parsed.pathname}`;
      } catch { return '[来源地址已隐藏]'; }
    })
    .replaceAll(/\b(Bearer\s+)\S+/gi, '$1[已隐藏]')
    .replaceAll(/((?:api[_-]?key|access[_-]?token|token|password|secret)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[已隐藏]')
    .slice(0, 1000);
}

export const unrecordedStopReason = '本轮已停止，历史记录未保存具体错误；请查看执行记录，不能据此判断来源或额度故障';

export function checkpointStopReason(cp) {
  const failures = Array.isArray(cp.failures)
    ? cp.failures
        .map((item) =>
          typeof item === 'string' ? item : item?.message || item?.reason || '',
        )
        .filter(Boolean)
    : [];
  const saved = failures.at(-1) || cp.semBlockedError || cp.semBlocked;
  const logged = (cp.logs || []).findLast(
    (line) =>
      typeof line === 'string' &&
      /失败|异常|限流|上限|未完成|停止|未知|不足|未返回|未确认|尚未确认|校验|无效|不完整|无法识别|不支持|部分覆盖|断点|error|failed|timeout|timed out|lock wait|invalid|unavailable|ECONN|ENOTFOUND|HTTP\s*[45]\d\d/i.test(
        line,
      ),
  );
  const reason = safeTaskError(cp.stopReason || cp.error || saved || logged || '');
  if (/Lock wait timeout/i.test(reason))
    return '数据库写入等待超时，本轮已停止；已保存的结果保留';
  return reason;
}
