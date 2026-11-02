const MAX_TASK_LENGTH = 160;
const MAX_HOST_LENGTH = 255;
const MAX_PATH_LENGTH = 512;

const text = (value, max = 160) =>
  String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, max);

function finiteInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

export function safeRequestUrl(value) {
  if (!value) return { host: '', path: '', url: '' };
  try {
    const url = new URL(String(value));
    if (!['http:', 'https:'].includes(url.protocol))
      return { host: '', path: '', url: '' };
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return {
      host: text(url.host.toLowerCase(), MAX_HOST_LENGTH),
      path: text(url.pathname || '/', MAX_PATH_LENGTH),
      url: text(url.toString(), MAX_HOST_LENGTH + MAX_PATH_LENGTH + 16),
    };
  } catch {
    return { host: '', path: '', url: '' };
  }
}

export function parseRetryAfter(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? Math.max(0, (timestamp - now) / 1000) : null;
}

export function requestStarted(context = {}, startedAt = new Date().toISOString()) {
  const location = safeRequestUrl(context.url || context.requestUrl);
  const attempt = Math.max(1, finiteInteger(context.attempt, 1));
  return {
    ...(context.requestId ? { requestId: text(context.requestId, 180) } : {}),
    method: text(context.method || 'GET', 16).toUpperCase(),
    host: location.host,
    path: location.path,
    url: location.url,
    startedAt,
    attempt,
    retry: context.retry === true || attempt > 1,
    lane: text(context.lane || context.sourceId || '', 80),
  };
}

function responseDetails(value) {
  if (!value) return {};
  const status = Number(
    value instanceof Response ? value.status : value.statusCode ?? value.status,
  );
  const details = Number.isInteger(status) && status >= 100 ? { httpStatus: status } : {};
  const headers = value instanceof Response ? value.headers : value.headers;
  if (headers?.get) {
    const retryAfter = parseRetryAfter(headers.get('retry-after'));
    if (retryAfter !== null) details.retryAfterSeconds = retryAfter;
    for (const [name, key] of [
      ['x-ratelimit-limit', 'rateLimitLimit'],
      ['x-ratelimit-remaining', 'rateLimitRemaining'],
      ['x-ratelimit-reset', 'rateLimitReset'],
    ]) {
      const header = headers.get(name);
      if (header) details[key] = text(header, 80);
    }
  } else if (headers) {
    const retryAfter = parseRetryAfter(headers['retry-after'] || headers['Retry-After']);
    if (retryAfter !== null) details.retryAfterSeconds = retryAfter;
  }
  return details;
}

function durationMs(request, finishedAt) {
  const started = Date.parse(request.startedAt);
  const finished = Date.parse(finishedAt);
  return Number.isFinite(started) && Number.isFinite(finished)
    ? Math.max(0, Math.round(finished - started))
    : null;
}

export function requestSucceeded(request, result, finishedAt = new Date().toISOString()) {
  const details = responseDetails(result);
  return {
    ...request,
    ...details,
    finishedAt,
    durationMs: durationMs(request, finishedAt),
    outcome: details.httpStatus >= 400 ? 'http_error' : 'success',
    rateLimited: details.httpStatus === 429,
  };
}

export function requestFailed(request, error, finishedAt = new Date().toISOString()) {
  const httpStatus = Number(error?.status || error?.statusCode);
  const retryAfterSeconds = Number(error?.retryAfterSeconds);
  return {
    ...request,
    ...(Number.isInteger(httpStatus) && httpStatus >= 100
      ? { httpStatus }
      : {}),
    ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
      ? { retryAfterSeconds }
      : {}),
    finishedAt,
    durationMs: durationMs(request, finishedAt),
    outcome: 'error',
    rateLimited: httpStatus === 429,
    errorKind: text(error?.code || error?.name || 'request_failed', 80),
  };
}

export function requestLogFromEvent(event = {}) {
  const request = event.request;
  if (!request || typeof request !== 'object' || !request.startedAt) return null;
  const httpStatus = Number(request.httpStatus);
  return {
    id: text(event.id, 180),
    requestId: text(request.requestId || event.requestId || event.id, 180),
    jobId: text(event.jobId, 160),
    task: text(event.task || '未记录任务', MAX_TASK_LENGTH),
    step: text(event.step || '未记录环节', MAX_TASK_LENGTH),
    sourceId: text(event.sourceId || 'unattributed', 80),
    market: text(event.market || 'ALL', 40),
    method: text(request.method || 'GET', 16),
    host: text(request.host, MAX_HOST_LENGTH),
    path: text(request.path, MAX_PATH_LENGTH),
    url: text(request.url, MAX_HOST_LENGTH + MAX_PATH_LENGTH + 16),
    startedAt: text(request.startedAt, 40),
    finishedAt: text(request.finishedAt, 40),
    durationMs:
      request.durationMs === null || request.durationMs === undefined
        ? null
        : finiteInteger(request.durationMs),
    status: text(event.status || 'started', 24),
    outcome: text(request.outcome || 'pending', 24),
    httpStatus: Number.isInteger(httpStatus) ? httpStatus : null,
    retryAfterSeconds:
      Number.isFinite(Number(request.retryAfterSeconds))
        ? Number(request.retryAfterSeconds)
        : null,
    rateLimitLimit: text(request.rateLimitLimit, 80),
    rateLimitRemaining: text(request.rateLimitRemaining, 80),
    rateLimitReset: text(request.rateLimitReset, 80),
    attempt: Math.max(1, finiteInteger(request.attempt, 1)),
    retry: request.retry === true,
    rateLimited: request.rateLimited === true || httpStatus === 429,
    lane: text(request.lane, 80),
    errorKind: text(request.errorKind, 80),
  };
}

const allowedDays = [1, 3, 7, 14, 30, 90];
const shanghaiDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
function dateAtShanghai(value, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  const result = Date.parse(`${value}T00:00:00+08:00`);
  return Number.isFinite(result) ? result + (end ? 86400000 : 0) : null;
}

export function requestLogRange(input = {}, now = new Date()) {
  if (input.days !== undefined && !allowedDays.includes(Number(input.days)))
    throw new Error('请求日志时间范围无效');
  const endDate = input.end ? dateAtShanghai(input.end, true) : now.getTime();
  const startDate = input.start
    ? dateAtShanghai(input.start)
    : endDate - (allowedDays.includes(Number(input.days)) ? Number(input.days) : 7) * 86400000;
  if (!Number.isFinite(startDate) || !Number.isFinite(endDate) || startDate >= endDate)
    throw new Error('请求日志时间范围无效');
  if (endDate - startDate > 90 * 86400000)
    throw new Error('请求日志最多查询90天');
  return {
    startAt: new Date(startDate).toISOString(),
    endAt: new Date(endDate).toISOString(),
    start: shanghaiDay.format(new Date(startDate)),
    end: shanghaiDay.format(new Date(endDate - 1)),
  };
}

export function summarizeRequestLogs(logs, input = {}, now = new Date()) {
  const range = requestLogRange(input, now);
  const query = text(input.query, 160).toLowerCase();
  const sourceId = text(input.sourceId, 80);
  const status = text(input.status, 24);
  const host = text(input.host, MAX_HOST_LENGTH).toLowerCase();
  const filtered = logs
    .filter((entry) =>
      entry &&
      entry.startedAt >= range.startAt &&
      entry.startedAt < range.endAt &&
      (!sourceId || entry.sourceId === sourceId) &&
      (!status || entry.status === status || entry.outcome === status) &&
      (!host || entry.host === host) &&
      (!query || `${entry.task} ${entry.jobId} ${entry.step} ${entry.host} ${entry.path}`.toLowerCase().includes(query)),
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));
  const pageSize = Math.min(100, Math.max(10, finiteInteger(input.pageSize, 50)));
  const page = Math.max(1, finiteInteger(input.page, 1));
  const rangeHours = Math.max(1 / 60, (Date.parse(range.endAt) - Date.parse(range.startAt)) / 3600000);
  const group = (key) => {
    const groups = new Map();
    for (const entry of filtered) {
      const value = entry[key] || '未记录';
      const old = groups.get(value) || { key: value, count: 0, rateLimited: 0, failed: 0, durationTotal: 0, firstAt: entry.startedAt, lastAt: entry.startedAt };
      old.count += 1;
      old.rateLimited += entry.rateLimited ? 1 : 0;
      old.failed += entry.outcome === 'error' || entry.outcome === 'http_error' ? 1 : 0;
      old.durationTotal += entry.durationMs || 0;
      if (entry.startedAt < old.firstAt) old.firstAt = entry.startedAt;
      if (entry.startedAt > old.lastAt) old.lastAt = entry.startedAt;
      groups.set(value, old);
    }
    return [...groups.values()]
      .map((entry) => ({
        ...entry,
        requestsPerHour: Number((entry.count / rangeHours).toFixed(2)),
        averageDurationMs: entry.count ? Math.round(entry.durationTotal / entry.count) : null,
      }))
      .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
      .slice(0, 50);
  };
  const durationValues = filtered.map((entry) => entry.durationMs).filter((value) => value !== null);
  return {
    entries: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    start: range.start,
    end: range.end,
    checkedAt: now.toISOString(),
    truncated: input.truncated === true,
    summary: {
      requests: filtered.length,
      rateLimited: filtered.filter((entry) => entry.rateLimited).length,
      failed: filtered.filter((entry) => entry.outcome === 'error' || entry.outcome === 'http_error').length,
      pending: filtered.filter((entry) => entry.status === 'started').length,
      averageDurationMs: durationValues.length ? Math.round(durationValues.reduce((a, b) => a + b, 0) / durationValues.length) : null,
      maxDurationMs: durationValues.length ? Math.max(...durationValues) : null,
      requestsPerHour: Number((filtered.length / rangeHours).toFixed(2)),
    },
    byTask: group('task'),
    bySource: group('sourceId'),
    byHost: group('host'),
    coverage: input.truncated
      ? '日志量超过读取上限，仅展示最近一部分记录；请缩小时间范围或按任务/来源筛选。'
      : '仅统计已写入请求元数据的来源调用；URL 查询参数、Cookie 和凭证不会保存。',
  };
}
