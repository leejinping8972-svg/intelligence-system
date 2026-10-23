import { randomUUID } from 'node:crypto';
import { pool, lock, unlock } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { mergeBusiness } from './market-jobs.mjs';
import { runSemrushSites, validateSemrushSites } from './semrush-sites.mjs';
import { naturalKey } from './domain.mjs';

const normalized = (value) =>
  String(value).normalize('NFKC').trim().toLowerCase().replaceAll(/\s+/g, ' ');
export async function submitSemrushSites(input) {
  const value = validateSemrushSites(input),
    c = await pool.connect();
  let locked = false;
  try {
    locked = await lock(c, 'market-submit');
    if (!locked) throw new Error('正在提交研究任务，请稍后重试');
    await c.query('BEGIN');
    const old = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (old) {
      await c.query('COMMIT');
      return old;
    }
    const active = (
      await c.query(
        "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    if (
      active.some(
        (j) =>
          j.input.kind === value.kind &&
          j.input.market === value.market &&
          j.input.seeds.some((s) =>
            value.seeds.some((term) => normalized(term) === normalized(s)),
          ),
      )
    )
      throw new Error('这些关键词已有Semrush站点任务，请等待完成或取消');
    if (
      !(
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:semrush:mcp:v1',
        ])
      ).rows.length
    )
      throw new Error('请先在数据源与设置中配置Semrush MCP');
    const id = randomUUID();
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, input.requestId, value, { submittedAt: new Date().toISOString() }],
    );
    const job = (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
    await c.query('COMMIT');
    return job;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (locked) await unlock(c, 'market-submit');
    c.release();
  }
}
export async function saveSemrushSite(site) {
  // Merge only evidence into an existing site, preserving verified brand/type and manual fields.
  return mergeBusiness(`sites:${site.id}`, site, {
    evidenceOnlyIfExists: true,
  });
}
export async function linkSemrushKeywords(term, market, ids) {
  if (!ids.length) return;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const rows = (
      await c.query(
        'SELECT natural_key,data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
        [naturalKey({ term, market })],
      )
    ).rows;
    for (const row of rows) {
      if (
        row.data.market !== market ||
        normalized(row.data.term) !== normalized(term)
      )
        continue;
      await c.query(
        'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
        [
          row.natural_key,
          {
            ...row.data,
            siteIds: [...new Set([...(row.data.siteIds || []), ...ids])],
          },
        ],
      );
    }
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
export async function runSemrushSitesJob(job, overrides = {}) {
  return runSemrushSites(job, {
    collect,
    saveCheckpoint,
    saveSite: saveSemrushSite,
    linkKeywords: linkSemrushKeywords,
    isCancelled: async () => {
      const row = (
        await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
          job.id,
        ])
      ).rows[0];
      return !row || row.cancelled;
    },
    ...overrides,
  });
}
