import { openAdsKey, scrapeRequest } from './ads-provider.mjs';
import { pool } from './database.mjs';
import { redditUrl } from './ingredient-trend-domain.mjs';

export function trendSourceSpec(request) {
  if (request.op === 'community') {
    if (!/^[a-z\d_]{3,21}$/i.test(request.community || ''))
      throw new Error('社区名无效');
    if (request.cursor && !/^t3_[a-z\d]+$/i.test(request.cursor))
      throw new Error('社区游标无效');
    return {
      path: '/v1/reddit/subreddit',
      method: 'GET',
      params: {
        subreddit: request.community,
        sort: 'new',
        ...(request.cursor ? { after: request.cursor } : {}),
      },
    };
  }
  if (
    request.op !== 'comments' ||
    typeof (request.cursor || '') !== 'string' ||
    (request.cursor || '').length > 100_000
  )
    throw new Error('评论请求无效');
  return {
    path: '/v1/reddit/post/comments',
    method: (request.cursor || '').length > 1800 ? 'POST' : 'GET',
    params: {
      url: redditUrl(request.url),
      ...(request.cursor ? { cursor: request.cursor } : {}),
    },
  };
}
export async function ingredientTrendSource(request, overrides = {}) {
  const spec = trendSourceSpec(request),
    db = overrides.pool || pool;
  const result = await db.query(
    'SELECT value FROM provider_configs WHERE name=$1',
    ['provider:scrapecreators:v1'],
  );
  const stored = result.rows[0]?.value;
  if (!stored) throw new Error('请先配置ScrapeCreators API Key');
  const key = (overrides.openKey || openAdsKey)(stored);
  let requestLog, rawSnapshot;
  const fetcher = async (url, init) => {
    const started = Date.now();
    const safe = new URL(url);
    safe.searchParams.delete('cursor');
    requestLog = {
      method: init.method,
      url: safe.href,
      host: safe.hostname,
      path: safe.pathname,
      startedAt: new Date(started).toISOString(),
      attempt: 1,
      retry: false,
      lane: 'scrapecreators',
    };
    try {
      const response = await (overrides.fetcher || fetch)(url, init);
      rawSnapshot = await response.clone().text();
      requestLog = {
        ...requestLog,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        httpStatus: response.status,
        outcome: response.ok ? 'success' : 'error',
      };
      if (!response.ok) {
        // Keep the actual error response, without credentials or opaque cursor contents.
        const text = rawSnapshot.replaceAll(key, '[redacted]').slice(0, 4000);
        const error = Object.assign(
          new Error(`ScrapeCreators HTTP ${response.status}`),
          { status: response.status, rawPreview: { requestLog, body: text } },
        );
        await response.body?.cancel();
        throw error;
      }
      return response;
    } catch (error) {
      error.rawPreview ||= {
        requestLog,
        body: String(rawSnapshot || '')
          .replaceAll(key, '[redacted]')
          .slice(0, 4000),
      };
      throw error;
    }
  };
  let raw;
  try {
    raw = await (overrides.scrapeRequest || scrapeRequest)(
      spec.path,
      spec.params,
      key,
      fetcher,
      spec.method,
    );
  } catch (error) {
    error.rawPreview ||= {
      requestLog,
      body: String(rawSnapshot || '')
        .replaceAll(key, '[redacted]')
        .slice(0, 4000),
    };
    throw error;
  }
  return {
    raw,
    creditsCharged: Number.isFinite(raw.credits_charged)
      ? raw.credits_charged
      : null,
    provider: 'scrapecreators',
    requests: 1,
    requestLog,
  };
}
