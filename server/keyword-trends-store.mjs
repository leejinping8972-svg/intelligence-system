/* eslint-disable unicorn/no-await-expression-member -- SQL adapters follow the existing document-store convention. */
import { openAdsKey } from './ads-provider.mjs';
import { lock, pool, putDocument, unlock } from './database.mjs';
import { trendDigest } from './keyword-trends-domain.mjs';
import { maintenance } from './database-admin.mjs';
import { validateJob } from './domain.mjs';
import { submitKeywordJob } from './keyword-submit.mjs';
import { advanceTrendQueue, trendAction } from './keyword-trends-engine.mjs';
import { fetchSocialTrend } from './keyword-trends-provider.mjs';
import { dispatchResearchTrends } from './keyword-research-trends.mjs';

export function keywordTrendIO(c = pool, overrides = {}) {
  const read = async (name) =>
    (
      await c.query('SELECT value FROM workspace_documents WHERE name=$1', [
        name,
      ])
    ).rows[0]?.value;
  const db = {
    read,
    write: (name, value) =>
      putDocument('workspace_documents', name, value, false, c),
    list: async (prefix) =>
      (
        await c.query(
          'SELECT name,value FROM workspace_documents WHERE name LIKE $1 ORDER BY name DESC',
          [`${prefix}%`],
        )
      ).rows,
    commitResult: async (fn) => {
      await c.query('BEGIN');
      try {
        await fn();
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    },
  };
  return {
    db,
    summaries: async (ids) => {
      if (!Array.isArray(ids)) return db.list('keyword-trends:summary:');
      const names = [...new Set(ids)].slice(0, 100).flatMap((id) => ['tiktok', 'instagram', 'facebook'].map((source) => `keyword-trends:summary:${trendDigest(id)}:${source}`));
      if (!names.length) return [];
      return (await c.query(`SELECT name,value FROM workspace_documents WHERE name IN (${names.map((_, i) => `$${i + 1}`).join(',')})`, names)).rows;
    },
    keywords: async (ids) => {
      if (Array.isArray(ids)) {
        if (!ids.length) return [];
        const keys = [...new Set(ids)].slice(0, 100);
        return (await c.query(`SELECT payload AS data FROM workspace_read_rows WHERE collection='keywords' AND id IN (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys)).rows.map((r) => r.data);
      }
      return (await c.query('SELECT data FROM research_keywords')).rows.map(
        (r) => r.data,
      );
    },
    key: async () => {
      const record = (
        await c.query('SELECT value FROM provider_configs WHERE name=$1', [
          'provider:scrapecreators:v1',
        ])
      ).rows[0]?.value;
      return record ? openAdsKey(record) : '';
    },
    fetch: fetchSocialTrend,
    researchActive: async (id) => {
      const job = (await c.query('SELECT cancelled FROM research_jobs WHERE id=$1', [id])).rows[0];
      return !!job && !job.cancelled;
    },
    submitGoogle: async (word, requestId) =>
      (
        await submitKeywordJob(
          validateJob({
            existingRecords: [word],
            seeds: [],
            sources: [],
            markets: [word.market],
            depth: 1,
            limit: 1,
          }),
          requestId,
          { pool, lock, unlock },
        )
      ).job,
    ...overrides,
  };
}
export async function keywordTrendsAction(input, user) {
  if (input.action === 'server_keyword_trends_snapshot')
    return trendAction(input, user, keywordTrendIO());
  if (user?.role !== 'admin') throw new Error('仅管理员可配置或提交趋势采集');
  if (maintenance) throw new Error('系统维护中，请稍后提交趋势采集');
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'competitor-runner');
    if (!held) throw new Error('后台监控正在处理，请稍后提交');
    return await trendAction(input, user, keywordTrendIO(c));
  } finally {
    try {
      if (held) await unlock(c, 'competitor-runner');
    } finally {
      c.release();
    }
  }
}
// Caller holds the existing competitor-runner lock, also used by maintenance
// and deployment drains. One request per tick allows pause/save between calls.
export async function tickKeywordTrends(c, overrides = {}) {
  if (!maintenance) await advanceTrendQueue(keywordTrendIO(c, overrides));
}

export async function submitResearchTrends(job, words, now) {
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'competitor-runner');
    if (!held) return null;
    const io = keywordTrendIO(c);
    if (!await io.researchActive(job.id)) throw new Error('任务已取消；已获取的结果保留');
    return await dispatchResearchTrends(io, job, words, now);
  } finally {
    try { if (held) await unlock(c, 'competitor-runner'); }
    finally { c.release(); }
  }
}
