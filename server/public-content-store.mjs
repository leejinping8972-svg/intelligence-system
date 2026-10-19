import { createHash } from 'node:crypto';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';

import { openAdsKey } from './ads-provider.mjs';
import { pool, putDocument, sql } from './database.mjs';
import { modelReportText, postModel } from './model-provider.mjs';
import { articleAction } from './public-article-details.mjs';
import { PUBLIC_CONTENT_PROMPT } from './public-content-ai.mjs';
import {
  CONTENT_SOURCES,
  validItemId,
  validJobId,
} from './public-content-domain.mjs';
import { executeContentJob, newContentJob } from './public-content-engine.mjs';
import { readYoutubeKey } from './youtube-config.mjs';

const get = async (name) => {
  const result = await pool.query(
    'SELECT value FROM workspace_documents WHERE name=$1',
    [name],
  );
  return result.rows[0]?.value;
};
const write = (name, value, connection = pool) =>
  putDocument('workspace_documents', name, value, false, connection);
const getJob = (id) => get(`content:job:${id}`);
const getItem = (id) => get(`content:item:${id}`);
async function update(name, transform) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    // The serial search runner creates records; API updates only existing records.
    const result = await c.query(
      'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
      [name],
    );
    const row = result.rows[0];
    const value = transform(row?.value);
    await write(name, value, c);
    await c.query('COMMIT');
    return value;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
const cacheName = (step, input) =>
  `content:cache:${createHash('sha256')
    .update(
      JSON.stringify([
        step.source,
        step.query,
        input.market,
        input.language,
        input.limit,
        input.sources.length,
      ]),
    )
    .digest('hex')}`;
const listJobs = async () => {
  const result = await pool.query(
    sql(
      "SELECT value FROM workspace_documents WHERE name LIKE 'content:job:%' ORDER BY value->>'submittedAt' DESC LIMIT 100",
      "SELECT value FROM workspace_documents WHERE name LIKE 'content:job:%' ORDER BY JSON_UNQUOTE(JSON_EXTRACT(value,'$.submittedAt')) DESC LIMIT 100",
    ),
  );
  return result.rows.map((r) => r.value);
};
const active = (j) => ['queued', 'running'].includes(j.status);
async function credentials(name) {
  const result = await pool.query(
    'SELECT value FROM provider_configs WHERE name=$1',
    [name],
  );
  return result.rows[0]?.value;
}
async function scrapeKey() {
  const stored = await credentials('provider:scrapecreators:v1');
  return stored ? openAdsKey(stored) : '';
}
async function organize(sample) {
  const stored = await credentials('provider:analysis:v1');
  if (!stored) throw new Error('尚未配置模型');
  const config = JSON.parse(openAdsKey(stored));
  const result = await postModel(config, [
    { role: 'system', content: PUBLIC_CONTENT_PROMPT },
    { role: 'user', content: JSON.stringify({ items: sample }) },
  ]);
  let parsed;
  try {
    parsed = JSON.parse(
      modelReportText(result)
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, ''),
    );
  } catch {
    throw new Error('模型返回不完整或不是JSON');
  }
  return { parsed, usage: result.usage || null, model: config.model };
}
const io = {
  getJob,
  getItem,
  youtubeKey: readYoutubeKey,
  scrapeKey,
  organize,
  getArticle: (id) => get(`content:article:${id}`),
  writeArticle: (id, value) => write(`content:article:${id}`, value),
  saveJob: (job) =>
    update(`content:job:${job.id}`, (old) =>
      old?.status === 'cancelled' ? { ...job, status: 'cancelled' } : job,
    ),
  updateItem: (id, transform) => update(`content:item:${id}`, transform),
  async readCache(step, input) {
    const cached = await get(cacheName(step, input));
    return cached && Date.now() - Date.parse(cached.at) < 86_400_000
      ? cached.result
      : null;
  },
  writeCache: (step, input, result) =>
    write(cacheName(step, input), { at: new Date().toISOString(), result }),
};
// Dedicated lock IDs avoid reusing the keyword runner/submission advisory locks.
async function lease(name, id, callback) {
  const c = await pool.connect();
  let held = false;
  const lost = new AbortController();
  const onError = () => lost.abort();
  c.on?.('error', onError);
  try {
    const result = await c.query(
      sql(
        'SELECT pg_try_advisory_lock($1) AS locked',
        'SELECT GET_LOCK($1,0) AS locked',
      ),
      [sql(String(id), `intelligence:${name}`)],
    );
    held = Boolean(result.rows[0]?.locked);
    return held ? await callback(lost.signal) : null;
  } finally {
    if (held)
      await c
        .query(
          sql('SELECT pg_advisory_unlock($1)', 'SELECT RELEASE_LOCK($1)'),
          [sql(String(id), `intelligence:${name}`)],
        )
        .catch(() => {});
    c.removeListener?.('error', onError);
    c.release();
  }
}
export async function runContentQueue(signal) {
  while (!signal.aborted) {
    try {
      await lease('public-content-runner', 89_761_031, async (leaseSignal) => {
        const jobs = await listJobs();
        const job = jobs
          .filter((j) => active(j))
          .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0];
        if (job) await executeContentJob(job, { ...io, signal, leaseSignal });
      });
    } catch {
      console.warn(
        'Public content queue paused; saved progress will be resumed',
      );
    }
    await sleep(2000, undefined, { signal }).catch(() => {});
  }
}
export async function withPublicContentIdle(callback) {
  const result = await lease('public-content-runner', 89_761_031, () =>
    lease('public-content-submit', 89_761_032, async () => {
      const jobs = await listJobs();
      if (jobs.some((j) => active(j)))
        throw new Error('公共内容任务尚未结束，请等待或取消后再切换数据库');
      return callback();
    }),
  );
  if (result === null)
    throw new Error('公共内容请求执行中，请稍后再切换数据库');
  return result;
}
export async function publicContentAction(input, user) {
  if (
    ['server_content_article_get', 'server_content_article_submit'].includes(
      input.action,
    )
  ) {
    const result = await articleAction(input, user, {
      ...io,
      listJobs,
      submitLease: (callback) =>
        lease('public-content-submit', 89_761_032, callback),
    });
    if (result === null)
      throw new Error('正在提交其他公共内容任务，请稍后再试');
    return result;
  }
  if (input.action === 'server_content_status') {
    const [youtube, scrape, model] = await Promise.all([
      credentials('provider:youtube:v1'),
      credentials('provider:scrapecreators:v1'),
      credentials('provider:analysis:v1'),
    ]);
    return {
      sources: Object.entries(CONTENT_SOURCES).map(([id, s]) => ({
        id,
        ...s,
        configured:
          !s.credential ||
          (s.credential === 'youtube'
            ? Boolean(youtube || process.env.YOUTUBE_API_KEY)
            : Boolean(scrape)),
      })),
      modelConfigured: Boolean(model),
      maxQueries: 3,
      maxAiItems: 10,
    };
  }
  if (
    input.action === 'server_content_submit' ||
    input.action === 'server_content_transcript'
  ) {
    const result = await lease(
      'public-content-submit',
      89_761_032,
      async () => {
        if (!validJobId(input.requestId)) throw new Error('搜索提交编号无效');
        const duplicate = await getJob(input.requestId);
        if (duplicate) {
          const same =
            input.action === 'server_content_submit'
              ? duplicate.mode === 'search' &&
                isDeepStrictEqual(
                  newContentJob(input.input || {}, input.requestId, user.id)
                    .input,
                  duplicate.input,
                )
              : duplicate.mode === 'transcript' &&
                duplicate.itemId === input.itemId;
          if (!same) throw new Error('提交编号已用于其他搜索，请重新提交');
          return { job: duplicate };
        }
        const jobs = await listJobs();
        if (jobs.filter((j) => active(j)).length >= 5)
          throw new Error('已有5项公共内容任务，请等待或取消后再提交');
        let job;
        if (input.action === 'server_content_submit')
          job = newContentJob(input.input || {}, input.requestId, user.id);
        else {
          if (!validItemId(input.itemId)) throw new Error('内容编号无效');
          const item = await getItem(input.itemId);
          if (!item || item.source !== 'youtube')
            throw new Error('只能获取已入库 YouTube 视频的字幕');
          job = {
            id: input.requestId,
            userId: user.id,
            mode: 'transcript',
            itemId: item.id,
            input: {
              query: item.title,
              market: item.searchMarket,
              language: item.searchLanguage,
            },
            status: 'queued',
            submittedAt: new Date().toISOString(),
            itemIds: [item.id],
            steps: [
              {
                source: 'youtube_transcript',
                query: item.title,
                status: 'pending',
                count: 0,
              },
            ],
            requests: 0,
            creditsCharged: 0,
            unknownChargeRequests: 0,
            aiStatus: 'disabled',
          };
        }
        await write(`content:job:${job.id}`, job);
        return { job };
      },
    );
    if (!result) throw new Error('正在提交其他公共内容任务，请稍后再试');
    return result;
  }
  if (input.action === 'server_content_snapshot') {
    if (input.jobId && !validJobId(input.jobId))
      throw new Error('任务编号无效');
    const jobs = await listJobs();
    const selected = input.jobId ? await getJob(input.jobId) : jobs[0];
    let items;
    if (input.favorites === true) {
      const result = await pool.query(
        sql(
          "SELECT value FROM workspace_documents WHERE name LIKE 'content:item:%' AND value->>'favorite'='true' ORDER BY value->>'collectedAt' DESC LIMIT 1000",
          "SELECT value FROM workspace_documents WHERE name LIKE 'content:item:%' AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.favorite'))='true' ORDER BY JSON_UNQUOTE(JSON_EXTRACT(value,'$.collectedAt')) DESC LIMIT 1000",
        ),
      );
      items = result.rows.map((r) => r.value);
    } else {
      const records = selected
        ? await Promise.all(selected.itemIds.map((id) => getItem(id)))
        : [];
      items = records.filter(Boolean);
    }
    return { jobs: jobs.slice(0, 40), job: selected || null, items };
  }
  if (input.action === 'server_content_cancel') {
    if (!validJobId(input.jobId)) throw new Error('任务编号无效');
    const job = await update(`content:job:${input.jobId}`, (old) => {
      if (!old) throw new Error('任务不存在');
      return active(old)
        ? { ...old, status: 'cancelled', updatedAt: new Date().toISOString() }
        : old;
    });
    return { job };
  }
  if (input.action === 'server_content_save') {
    if (!validItemId(input.itemId)) throw new Error('内容编号无效');
    for (const key of ['keywordIds', 'productIds'])
      if (
        input[key] !== undefined &&
        (!Array.isArray(input[key]) ||
          input[key].length > 20 ||
          input[key].some(
            (v) => typeof v !== 'string' || !/^[\w:-]{1,120}$/.test(v),
          ))
      )
        throw new Error('关联记录格式无效');
    const item = await update(`content:item:${input.itemId}`, (old) => {
      if (!old) throw new Error('内容不存在，请刷新结果');
      return {
        ...old,
        ...(typeof input.favorite === 'boolean'
          ? { favorite: input.favorite }
          : {}),
        ...(input.keywordIds
          ? { keywordIds: [...new Set(input.keywordIds)] }
          : {}),
        ...(input.productIds
          ? { productIds: [...new Set(input.productIds)] }
          : {}),
      };
    });
    return { item };
  }
  throw new Error('未知的公共内容操作');
}
