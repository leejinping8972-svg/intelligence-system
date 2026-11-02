import assert from 'node:assert/strict';
import test from 'node:test';

import {
  requestFailed,
  requestLogFromEvent,
  requestLogRange,
  requestStarted,
  requestSucceeded,
  safeRequestUrl,
  summarizeRequestLogs,
} from './request-log.mjs';

test('request metadata removes query secrets and keeps host/path', () => {
  assert.deepEqual(
    safeRequestUrl('https://api.example.com/products?api_key=secret#item'),
    {
      host: 'api.example.com',
      path: '/products',
      url: 'https://api.example.com/products',
    },
  );
  assert.deepEqual(safeRequestUrl('file:///tmp/private'), {
    host: '',
    path: '',
    url: '',
  });
});

test('request outcomes capture duration, HTTP 429 and Retry-After', () => {
  const start = requestStarted(
    {
      jobId: 'job-1',
      sourceId: 'official_sites',
      url: 'https://shop.example/products?token=secret',
      attempt: 2,
    },
    '2026-11-02T00:00:00.000Z',
  );
  const response = new Response('', {
    status: 429,
    headers: { 'retry-after': '60', 'x-ratelimit-remaining': '0' },
  });
  const result = requestSucceeded(start, response, '2026-11-02T00:00:01.250Z');
  assert.equal(result.durationMs, 1250);
  assert.equal(result.httpStatus, 429);
  assert.equal(result.rateLimited, true);
  assert.equal(result.retryAfterSeconds, 60);
  assert.equal(result.outcome, 'http_error');
  assert.equal(result.retry, true);
  assert.equal(JSON.stringify(result).includes('secret'), false);

  const failed = requestFailed(
    start,
    Object.assign(new Error('private upstream body'), {
      status: 429,
      retryAfterSeconds: 90,
      code: 'RATE_LIMITED',
    }),
    '2026-11-02T00:00:02.000Z',
  );
  assert.equal(failed.durationMs, 2000);
  assert.equal(failed.httpStatus, 429);
  assert.equal(failed.rateLimited, true);
  assert.equal(failed.errorKind, 'RATE_LIMITED');
  assert.equal(JSON.stringify(failed).includes('private upstream body'), false);
});

test('request log summary groups task frequency and applies filters', () => {
  const events = [
    {
      id: 'a', requestId: 'a', jobId: 'job-a', task: '站点采集', step: 'catalog',
      sourceId: 'official_sites', market: 'US', host: 'shop.example', path: '/products',
      startedAt: '2026-11-01T16:00:00.000Z', finishedAt: '2026-11-01T16:00:01.000Z',
      durationMs: 1000, status: 'done', outcome: 'success', httpStatus: 200, rateLimited: false,
    },
    {
      id: 'b', requestId: 'b', jobId: 'job-a', task: '站点采集', step: 'detail',
      sourceId: 'official_sites', market: 'US', host: 'shop.example', path: '/products/a',
      startedAt: '2026-11-01T16:01:00.000Z', finishedAt: '2026-11-01T16:01:02.000Z',
      durationMs: 2000, status: 'failed', outcome: 'error', httpStatus: 429, rateLimited: true,
    },
    {
      id: 'c', requestId: 'c', jobId: 'job-b', task: '关键词研究', step: 'trend',
      sourceId: 'google_trends', market: 'US', host: 'trends.google.com', path: '/trends',
      startedAt: '2026-11-01T16:02:00.000Z', finishedAt: '2026-11-01T16:02:01.000Z',
      durationMs: 1000, status: 'done', outcome: 'success', httpStatus: 200, rateLimited: false,
    },
  ];
  const snapshot = summarizeRequestLogs(events, { days: 3, query: 'job-a' }, new Date('2026-11-02T00:00:00.000Z'));
  assert.equal(snapshot.total, 2);
  assert.equal(snapshot.summary.rateLimited, 1);
  assert.equal(snapshot.summary.failed, 1);
  assert.equal(snapshot.byTask[0].key, '站点采集');
  assert.equal(snapshot.byTask[0].count, 2);
  assert.equal(snapshot.entries[0].jobId, 'job-a');
  assert.throws(() => requestLogRange({ days: 999 }, new Date('2026-11-02T00:00:00.000Z')));
});

test('request log projection never exposes a missing request or arbitrary payload', () => {
  assert.equal(requestLogFromEvent({ id: 'old', record: { apiKey: 'secret' } }), null);
  const projected = requestLogFromEvent({
    id: 'e', sourceId: 'brave', task: '搜索', jobId: 'j', step: 'search',
    request: requestStarted({ url: 'https://api.example/search?q=secret' }, '2026-11-02T00:00:00.000Z'),
  });
  assert.equal(projected.path, '/search');
  assert.equal(JSON.stringify(projected).includes('secret'), false);
});
