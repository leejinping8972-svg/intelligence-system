/* eslint-disable unicorn/no-await-expression-member -- SQL adapters follow the existing document-store convention. */
import { randomUUID } from 'node:crypto';

import { openAdsKey } from './ads-provider.mjs';
import { maintenance } from './database-admin.mjs';
import { lock, pool, putDocument, unlock } from './database.mjs';
import { validateJob } from './domain.mjs';
import { dispatchResearchTrends } from './keyword-research-trends.mjs';
import { submitKeywordJob } from './keyword-submit.mjs';
import {
  buildTrendWork,
  trendDay,
  trendDigest,
} from './keyword-trends-domain.mjs';
import {
  advanceTrendQueue,
  enqueueTrendWork,
  trendAction,
} from './keyword-trends-engine.mjs';
import { fetchSocialTrend } from './keyword-trends-provider.mjs';
import { withQueueConfig } from './queue-config-lock.mjs';

export function keywordTrendIO(c = pool, overrides = {}) {
  const read = async (name) =>
    (
      await c.query('SELECT value FROM workspace_documents WHERE name=$1', [
        name,
      ])
    ).rows[0]?.value;
  const db = {
    read,
    write: async (name, value) => {
      await putDocument('workspace_documents', name, value, false, c);
      if (/^keyword-trends:(run|inbox|submission):/.test(name))
        await c.query(
          "UPDATE workspace_read_versions SET revision=revision+1 WHERE collection='tasks'",
        );
    },
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
      const names = [...new Set(ids)]
        .slice(0, 100)
        .flatMap((id) =>
          ['tiktok', 'instagram', 'facebook'].map(
            (source) => `keyword-trends:summary:${trendDigest(id)}:${source}`,
          ),
        );
      if (!names.length) return [];
      return (
        await c.query(
          `SELECT name,value FROM workspace_documents WHERE name IN (${names.map((_, i) => `$${i + 1}`).join(',')})`,
          names,
        )
      ).rows;
    },
    keywords: async (ids) => {
      if (Array.isArray(ids)) {
        if (!ids.length) return [];
        const keys = [...new Set(ids)].slice(0, 100);
        return (
          await c.query(
            `SELECT payload AS data FROM workspace_read_rows WHERE collection='keywords' AND id IN (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
            keys,
          )
        ).rows.map((r) => r.data);
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
      const job = (
        await c.query('SELECT cancelled FROM research_jobs WHERE id=$1', [id])
      ).rows[0];
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
// Submissions write an inbox; only the worker changes the day's execution work.
// Thus a slow provider response cannot overwrite a newly queued request.
function submissionIO(c) {
  const io = keywordTrendIO(c);
  io.deferDailyPause = true;
  io.db.enqueue = async (words, plan, now, trigger, parentJobId) => {
    const pending = await io.db.list('keyword-trends:inbox:');
    if (pending.length >= 100)
      throw new Error('已有100批趋势查询排队，请等待后台处理');
    const command = {
      words,
      plan,
      now: now ?? Date.now(),
      submittedAt: Date.now(),
      trigger,
      parentJobId,
    };
    await io.db.write('keyword-trends:inbox:' + randomUUID(), command);
    return {
      accepted: buildTrendWork(words, plan, now).length,
      queued: true,
      day: trendDay(now),
    };
  };
  return io;
}
export async function keywordTrendsAction(input, user) {
  if (input.action === 'server_keyword_trends_snapshot') {
    const result = await trendAction(input, user, keywordTrendIO());
    const queued = await keywordTrendIO().db.list('keyword-trends:inbox:');
    result.queuedSubmissions = queued.length;
    for (const { value } of queued)
      for (const word of value.words || [])
        for (const source of value.plan.sources) {
          if (
            source === 'google' ||
            (Array.isArray(input.keywordIds) &&
              !input.keywordIds.includes(word.id))
          )
            continue;
          let summary = result.summaries.find(
            (s) => s.keywordId === word.id && s.source === source,
          );
          if (!summary) {
            summary = {
              keywordId: word.id,
              term: word.term,
              market: word.market,
              source,
              comparisonVersion: 2,
              metric: 'publication_daily_rate',
              periods: [],
            };
            result.summaries.push(summary);
          }
          Object.assign(summary, {
            status: 'pending',
            attemptMessage: '已提交队列，等待后台处理',
          });
        }
    return result;
  }
  if (user?.role !== 'admin') throw new Error('仅管理员可配置或提交趋势采集');
  if (maintenance) throw new Error('系统维护中，请稍后提交趋势采集');
  return withQueueConfig('keyword-trends-config', (c) =>
    trendAction(input, user, submissionIO(c)),
  );
}
export async function drainTrendInbox(c, io = keywordTrendIO(c)) {
  // Only this guarded worker mutates run documents. Commands preserve pagination,
  // request journals and parent links through the existing enqueue implementation.
  const commands = await io.db.list('keyword-trends:inbox:');
  commands.sort(
    (a, b) =>
      (a.value.submittedAt ?? a.value.now) -
        (b.value.submittedAt ?? b.value.now) || a.name.localeCompare(b.name),
  );
  for (const command of commands) {
    await io.db.commitResult(async () => {
      const { words, plan, now, trigger, parentJobId } = command.value;
      if (trendDay(now) === trendDay(io.now ?? Date.now())) {
        await enqueueTrendWork(io.db, words, plan, now, trigger, parentJobId);
      } else {
        const reason =
          '排队请求已跨日过期，未发起来源调用；请确认预算后重新提交';
        for (const word of words)
          for (const source of plan.sources) {
            if (source === 'google') continue;
            const name =
              'keyword-trends:summary:' + trendDigest(word.id) + ':' + source;
            const prior = await io.db.read(name);
            await io.db.write(name, {
              ...prior,
              keywordId: word.id,
              term: word.term,
              market: word.market,
              source,
              comparisonVersion: 2,
              metric: 'publication_daily_rate',
              periods: prior?.periods || [],
              status: 'skipped',
              attemptMessage: reason,
            });
          }
        await io.db.write(command.name.replace(':inbox:', ':submission:'), {
          status: 'expired',
          reason,
          at: new Date().toISOString(),
          submittedAt: command.value.submittedAt,
          day: trendDay(now),
          parentJobId,
        });
      }
      await c.query('DELETE FROM workspace_documents WHERE name=$1', [
        command.name,
      ]);
    });
  }
  const plan = await io.db.read('keyword-trends:plan');
  if (plan && !plan.enabled) {
    const name = 'keyword-trends:run:' + trendDay(io.now ?? Date.now());
    const run = await io.db.read(name);
    if (
      run?.work.some((w) => w.trigger === 'daily' && w.status === 'pending')
    ) {
      for (const w of run.work)
        if (w.trigger === 'daily' && w.status === 'pending')
          Object.assign(w, { status: 'skipped', reason: '每日计划已暂停' });
      await io.db.write(name, run);
    }
  }
}
export async function tickKeywordTrends(c, overrides = {}) {
  if (maintenance) return;
  const io = keywordTrendIO(c, overrides);
  await drainTrendInbox(c, io);
  await advanceTrendQueue(io);
}
export async function submitResearchTrends(job, words, now) {
  return withQueueConfig('keyword-trends-config', async (c) => {
    const io = submissionIO(c);
    if (!(await io.researchActive(job.id)))
      throw new Error('任务已取消；已获取的结果保留');
    return dispatchResearchTrends(io, job, words, now);
  });
}
