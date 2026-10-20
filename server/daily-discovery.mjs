/* eslint-disable unicorn/no-await-expression-member -- SQL access follows the existing server adapters. */
import { pool, lock, unlock, putDocument } from './database.mjs';
import { requireAdmin } from './auth.mjs';
import { submitMarketJob } from './market-jobs.mjs';
import { submitPlatformProducts } from './platform-products-jobs.mjs';
import { readKeyword } from './enrichment-jobs.mjs';
import {
  defaultDailyPlan,
  validateDailyPlan,
  beijingTime,
  buildDailyRun,
  advanceDailyRun,
  stopPendingDailyWork,
} from './daily-discovery-domain.mjs';

const PLAN = 'discovery:daily:plan';
const RUN = 'discovery:daily:run:';
const read = async (name, c = pool) =>
  (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [name]))
    .rows[0]?.value;
const job = async (id) =>
  (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
const io = {
  job,
  keyword: readKeyword,
  findRequest: async (id) =>
    (await pool.query('SELECT * FROM research_jobs WHERE request_id=$1', [id]))
      .rows[0],
  submit: (kind, input) =>
    kind === 'ads'
      ? submitMarketJob(input, { daily: true })
      : submitPlatformProducts(input, {
          discoveryDay: input.discoveryDay,
        }),
};
export async function dailyDiscoveryAction(input, user) {
  if (input.action === 'server_daily_discovery_save') {
    requireAdmin(user);
    const plan = validateDailyPlan(input.plan || {});
    const c = await pool.connect();
    let acquired = false;
    try {
      acquired = await lock(c, 'daily-discovery');
      if (!acquired) throw new Error('每日计划正在处理，请稍后重试');
      await putDocument(
        'workspace_documents',
        PLAN,
        { ...plan, updatedAt: new Date().toISOString() },
        false,
        c,
      );
    } finally {
      if (acquired) await unlock(c, 'daily-discovery');
      c.release();
    }
  }
  const plan = (await read(PLAN)) || defaultDailyPlan;
  const runs = (
    await pool.query(
      "SELECT value FROM workspace_documents WHERE name LIKE 'discovery:daily:run:%' ORDER BY name DESC LIMIT 7",
    )
  ).rows.map((r) => r.value);
  for (const run of runs)
    for (const entry of run.work.filter(
      (e) => e.jobId && ['queued', 'running'].includes(e.status),
    )) {
      const value = await job(entry.jobId);
      entry.status = value?.status || 'failed';
      if (value?.cancelled) entry.status = 'cancelled';
      entry.reason = value?.checkpoint?.logs?.slice(-1)[0] || entry.reason;
    }
  const keywords = (
    await pool.query('SELECT data FROM research_keywords')
  ).rows.map((r) => r.data);
  return {
    plan,
    selectedCount: keywords.filter(
      (k) =>
        k.reviewStatus === 'selected' &&
        k.dataNature !== 'demo' &&
        plan.markets.includes(k.market),
    ).length,
    runs,
  };
}
let nextTick = 0;
// Called only while the ordinary runner lock is held. Existing deployment drains also freeze scheduling.
export async function tickDailyDiscovery(now = Date.now()) {
  if (now < nextTick) return;
  nextTick = now + 5000;
  const c = await pool.connect();
  let acquired = false;
  try {
    acquired = await lock(c, 'daily-discovery');
    if (!acquired) return;
    const plan = await read(PLAN, c);
    const latest = (
      await c.query(
        "SELECT name,value FROM workspace_documents WHERE name LIKE 'discovery:daily:run:%' ORDER BY name DESC LIMIT 1",
      )
    ).rows[0];
    const { day, time } = beijingTime(now);
    if (latest && (latest.value.day !== day || !plan?.enabled)) {
      const previous = latest.value;
      const before = JSON.stringify(previous);
      if (!plan?.enabled)
        await stopPendingDailyWork(
          previous,
          io,
          '计划已暂停，未排队步骤不再执行',
        );
      await advanceDailyRun(previous, io, now);
      if (before !== JSON.stringify(previous))
        await putDocument(
          'workspace_documents',
          latest.name,
          previous,
          false,
          c,
        );
      if (previous.work.some((e) => ['queued', 'running'].includes(e.status)))
        return;
    }
    if (!plan?.enabled || time < plan.time) return;
    let run = await read(`${RUN}${day}`, c);
    if (!run) {
      const keywords = (
        await c.query('SELECT data FROM research_keywords')
      ).rows.map((r) => r.data);
      run = buildDailyRun(plan, keywords, now);
      await putDocument('workspace_documents', `${RUN}${day}`, run, false, c);
    }
    const before = JSON.stringify(run);
    await advanceDailyRun(run, io, now);
    if (before !== JSON.stringify(run))
      await putDocument('workspace_documents', `${RUN}${day}`, run, false, c);
  } finally {
    if (acquired) await unlock(c, 'daily-discovery');
    c.release();
  }
}
