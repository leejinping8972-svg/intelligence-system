import { dayKey } from './competitor-monitor-domain.mjs';

export const MAX_PUBLIC_RECOVERIES = 3;
export function publicRetryDelay(error, attempts = 0) {
  const status = Number(
    error.status ||
      String(error.message || '').match(/HTTP\s+(\d{3})/)?.[1] ||
      0,
  );
  const retryAfter = Math.max(0, Number(error.retryAfterSeconds) || 0) * 1000;
  const base = status === 429 || status === 403 ? 30 * 60_000 : 5 * 60_000;
  return Math.max(retryAfter, Math.min(base * 2 ** attempts, 6 * 3_600_000));
}
export function publicRecoveryPlan(target, last, progress, now = Date.now()) {
  if (
    !target.siteId ||
    !last ||
    last.day !== dayKey(now) ||
    ['running', 'interrupted'].includes(last.status)
  )
    return { eligible: false };
  const channel = last.channels?.find((c) => c.kind === 'products');
  const failures = (last.errors || []).join(' ');
  const recognized = /429|HTTP\s+5\d\d|超时|timeout|ECONNRESET|ETIMEDOUT/i.test(
    failures,
  );
  const partial = channel?.status === 'partial' && progress?.queue?.length > 0;
  if (
    !channel ||
    channel.status === 'completed' ||
    (!recognized &&
      !partial &&
      !progress?.nextRunAt &&
      !progress?.manualRequired)
  )
    return { eligible: false };
  const attempts = last.publicRecoveryAttempts || 0;
  const terminal =
    progress?.manualRequired === true ||
    attempts >= MAX_PUBLIC_RECOVERIES;
  const fallbackAt =
    (Date.parse(last.finishedAt || '') || now) +
    publicRetryDelay({ message: failures }, attempts);
  const nextRunAt = progress?.nextRunAt || fallbackAt;
  let reason = '冷却后仅恢复官网，不重跑广告或Semrush';
  if (attempts >= MAX_PUBLIC_RECOVERIES)
    reason = '今日已完成3轮恢复，停止自动尝试';
  else if (progress?.manualRequired)
    reason = '目标持续拒绝访问，需检查公开来源';
  return {
    eligible: !terminal,
    attempts,
    nextRunAt,
    ready: !terminal && now >= nextRunAt,
    reason,
  };
}
