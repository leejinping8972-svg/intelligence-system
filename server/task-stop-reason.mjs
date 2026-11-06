export function checkpointFailureCount(value) {
  return Array.isArray(value)
    ? value.length
    : Number.isFinite(value) && value >= 0
      ? Math.floor(value)
      : 0;
}

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
      /失败|异常|限流|上限|未完成|停止|未知|不足|未返回|未确认|尚未确认|校验|无效|不完整|error|failed|timeout|timed out|lock wait|invalid|unavailable/i.test(
        line,
      ),
  );
  const reason = saved || logged || '';
  if (/Lock wait timeout/i.test(reason))
    return '数据库写入等待超时，本轮已停止；已保存的结果保留';
  return reason;
}
