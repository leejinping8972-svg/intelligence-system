import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, unlock } from './database.mjs';
import {
  discoveryKinds,
  discoveryPlan,
  newProductEvidence,
  scheduleSlot,
  stableId,
} from './discovery-monitor-domain.mjs';
import { discoverySorftime } from './discovery-sorftime.mjs';
import { upsertProduct } from './platform-products-jobs.mjs';
import {
  pendingSourceFields,
  sourceFieldSample,
} from './source-field-domain.mjs';
import { collect, saveCheckpoint } from './store.mjs';

const read = async (name, c = pool) =>
  (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [name]))
    .rows[0]?.value;
const list = async (prefix, c = pool) =>
  (
    await c.query(
      'SELECT name,value FROM workspace_documents WHERE name LIKE $1 ORDER BY name DESC LIMIT 500',
      [`${prefix}%`],
    )
  ).rows.map((r) => r.value);
export async function submitDiscovery(input, connection = pool) {
  const plan = discoveryPlan(input.plan || input);
  const requestId = input.requestId;
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(requestId || ''))
    throw new Error('提交编号无效');
  const old = (
    await connection.query('SELECT * FROM research_jobs WHERE request_id=$1', [
      requestId,
    ])
  ).rows[0];
  if (old) {
    if (!isDeepStrictEqual(old.input.plan, plan))
      throw new Error('此编号已用于不同任务');
    return old;
  }
  const id = randomUUID();
  const value = {
    kind: 'discovery_monitor',
    plan,
    market: plan.market,
    markets: [plan.market],
    seeds: [],
    monitorId: input.monitorId || '',
  };
  await connection.query(
    'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
    [
      id,
      requestId,
      value,
      {
        submittedAt: new Date().toISOString(),
        logs: [],
        calls: 0,
        products: 0,
      },
    ],
  );
  return (
    await connection.query('SELECT * FROM research_jobs WHERE id=$1', [id])
  ).rows[0];
}
export async function discoveryAction(input, user) {
  if (input.action === 'server_discovery_snapshot')
    return {
      plans: await list('discovery:monitor:'),
      ingredients: await list('discovery:ingredient:'),
    };
  if (input.action === 'server_discovery_capabilities')
    return discoverySorftime({ op: 'catalogue' });
  requireAdmin(user);
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'monitor-config');
    if (!held) throw new Error('监控配置正在保存，请稍后重试');
    if (input.action === 'server_discovery_submit') {
      const job = await submitDiscovery(input, c);
      return { jobId: job.id };
    }
    if (input.action === 'server_discovery_save') {
      const plan = discoveryPlan(input.plan || input, true);
      const id = input.id || randomUUID();
      if (!/^[\da-f-]{36}$/i.test(id)) throw new Error('监控编号无效');
      const old = await read(`discovery:monitor:${id}`, c);
      if (!old && (await list('discovery:monitor:', c)).length >= 100)
        throw new Error('最多100项监控');
      const value = {
        ...old,
        ...plan,
        id,
        updatedAt: new Date().toISOString(),
      };
      await putDocument(
        'workspace_documents',
        `discovery:monitor:${id}`,
        value,
        false,
        c,
      );
      return { plan: value };
    }
    if (input.action === 'server_discovery_delete') {
      if (!/^[\da-f-]{36}$/i.test(input.id || ''))
        throw new Error('监控编号无效');
      await c.query('DELETE FROM workspace_documents WHERE name=$1', [
        `discovery:monitor:${input.id}`,
      ]);
      return { deleted: true };
    }
    if (input.action === 'server_discovery_toggle') {
      if (
        !/^[\da-f-]{36}$/i.test(input.id || '') ||
        typeof input.enabled !== 'boolean'
      )
        throw new Error('监控编号或开关无效');
      const name = `discovery:monitor:${input.id}`;
      const old = await read(name, c);
      if (!old) throw new Error('监控不存在');
      await putDocument(
        'workspace_documents',
        name,
        { ...old, enabled: input.enabled },
        false,
        c,
      );
      return { saved: true };
    }
    throw new Error('不支持的监控操作');
  } finally {
    if (held) await unlock(c, 'monitor-config');
    c.release();
  }
}
// Invoked under the existing runner lock, so deployment drains also freeze schedules.
export async function tickDiscoveryMonitors(now = Date.now()) {
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'monitor-config');
    if (!held) return;
    for (const plan of await list('discovery:monitor:', c)) {
      const slot = scheduleSlot(plan, now);
      if (!slot) continue;
      const requestId = stableId(`discovery:${plan.id}:${slot}`);
      if (
        (
          await c.query('SELECT id FROM research_jobs WHERE request_id=$1', [
            requestId,
          ])
        ).rows.length > 0
      )
        continue;
      const job = await submitDiscovery(
        { requestId, plan, monitorId: plan.id },
        c,
      );
      if (plan.lastJobId !== job.id)
        await putDocument(
          'workspace_documents',
          `discovery:monitor:${plan.id}`,
          {
            ...plan,
            lastJobId: job.id,
            lastScheduledAt: new Date(now).toISOString(),
          },
          false,
          c,
        );
    }
  } finally {
    if (held) await unlock(c, 'monitor-config');
    c.release();
  }
}
export async function runDiscoveryMonitor(job, overrides = {}) {
  const io = {
    pool,
    collect,
    saveCheckpoint,
    upsertProduct,
    read,
    putDocument,
    now: Date.now,
    ...overrides,
  };
  const plan = job.input.plan;
  const cp = {
    ...job.checkpoint,
    logs: [...(job.checkpoint.logs || [])],
    seen: [...(job.checkpoint.seen || [])],
    records: [...(job.checkpoint.records || [])],
    failures: [...(job.checkpoint.failures || [])],
  };
  cp.asOf ||= io.now();
  cp.work ||= plan.channels.flatMap((channel) =>
    (plan.kind === 'ingredients'
      ? plan.topics
      : [channel === 'ali1688' ? '保健品' : 'dietary supplements']
    ).map((topic) => ({
      channel,
      sourceMarket: plan.sourceMarkets?.[channel],
      topic,
      page: 1,
      ...(['ali1688', 'shopee', 'temu', 'tiktok', 'tiktok_shop'].includes(
        channel,
      ) && plan.kind !== 'ingredients'
        ? { categoryLookup: true }
        : {}),
    })),
  );
  cp.pending ||= [];
  cp.covered ||= [];
  const finished = () =>
    io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date(io.now()).toISOString() },
      cp.failures.length > 0 ? 'partial' : 'completed',
    );
  const cancelled = async () =>
    (
      await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
        job.id,
      ])
    ).rows[0]?.cancelled;
  try {
    if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
    const firstPass = cp.work.some(
      (w) => !w.detail && w.page === 1 && !cp.covered.includes(w.channel),
    );
    if (
      cp.pending.length > 0 &&
      plan.kind !== 'ingredients' &&
      !firstPass &&
      cp.products < plan.maxProducts
    ) {
      const product = cp.pending.shift();
      cp.calls++;
      try {
        const sample = sourceFieldSample('products', product);
        const analyzed = await io.collect(
          job,
          `classify:${stableId(product.id)}`,
          { sources: ['field_analysis'], sample },
        );
        if (analyzed.analysis.supplement) {
          const evidence = newProductEvidence(product, plan, cp.asOf);
          if (evidence && !(await cancelled())) {
            await io.upsertProduct({
              ...pendingSourceFields('products', product),
              ...analyzed.patch,
              fieldAnalysis: {
                ...analyzed.analysis,
                model: analyzed.model,
                sources: sample.sources,
              },
              newProductClassifications: [evidence],
            });
            cp.products++;
          }
        } else
          cp.logs.push(
            `${product.title.slice(0, 70)}：保健品证据不足，未写入商品库`,
          );
      } catch (error) {
        cp.failures.push(String(error.message).slice(0, 500));
      }
    } else if (cp.work.length > 0 && cp.products < plan.maxProducts) {
      const work = cp.work.shift();
      cp.calls++;
      try {
        const result = await io.collect(
          job,
          `source:${stableId(JSON.stringify(work))}`,
          {
            sources: ['discovery_sorftime'],
            sorftimeRequestLimit: 1,
            ...plan,
            ...work,
            social: plan.kind === 'ingredients',
            now: cp.asOf,
          },
        );
        if (work.categoryLookup) {
          for (const category of result.categories || [])
            cp.work.push({
              channel: work.channel,
              sourceMarket: work.sourceMarket,
              topic: work.topic,
              nodeId: category.id,
              categoryName: category.name,
              page: 1,
            });
          if (!result.categories?.length) {
            cp.covered.push(work.channel);
            cp.failures.push(
              `${work.channel}未返回可核对的保健品类目，未进行全品类替代`,
            );
          }
        } else if (plan.kind === 'ingredients') {
          for (const record of result.records || []) {
            if (
              cp.seen.includes(record.id) ||
              cp.records.length >= plan.maxProducts
            )
              continue;
            cp.seen.push(record.id);
            cp.records.push(record);
            if (
              !work.detail &&
              cp.work.filter((w) => w.detail).length + (cp.details || 0) <
                plan.maxDetails
            )
              cp.work.push({
                channel: work.channel,
                topic: work.topic,
                record,
                detail: true,
              });
          }
          if (work.detail) cp.details = (cp.details || 0) + 1;
        } else {
          if (result.sourceRows > 0 && !result.products?.length)
            cp.failures.push(
              `${work.channel}返回了资料，但没有可识别的商品明细，未作为零新品结果`,
            );
          const missingDate = (result.products || []).filter(
            (p) => !p.decisionData?.listing?.date,
          ).length;
          const missingDelivery =
            plan.kind === 'fbm_new'
              ? (result.products || []).filter(
                  (p) => !p.resourceRaw?.fulfillment,
                ).length
              : 0;
          if (missingDate || missingDelivery)
            cp.failures.push(
              `${work.channel}跳过证据不足的商品：${missingDate}条缺上架日期，${missingDelivery}条缺发货方式`,
            );
          for (const product of result.products || []) {
            if (
              cp.seen.includes(product.id) ||
              !newProductEvidence(product, plan, cp.asOf) ||
              cp.products + cp.pending.length >= plan.maxProducts
            )
              continue;
            cp.seen.push(product.id);
            cp.pending.push(product);
          }
        }
        if (result.hasMore && !work.detail && work.page < plan.maxPages)
          cp.work.push({ ...work, page: work.page + 1 });
        if (!work.categoryLookup) cp.covered.push(work.channel);
        cp.logs.push(
          `${work.channel} · ${work.topic}：来源${result.sourceRows ?? 0}条`,
        );
      } catch (error) {
        cp.covered.push(work.channel);
        cp.failures.push(
          `${work.channel}: ${String(error.message).slice(0, 500)}`,
        );
      }
    } else {
      if (cp.work.length > 0 || cp.pending.length > 0) {
        cp.logs.push('达到本次商品或结果数量，保留已完成结果');
      }
      if (
        plan.kind === 'ingredients' &&
        cp.records.length > 0 &&
        !cp.analysisDone
      ) {
        cp.calls++;
        const result = await io.collect(job, 'ingredient-analysis', {
          sources: ['ingredient_analysis'],
          records: cp.records,
        });
        if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
        cp.ingredients = 0;
        for (const ingredient of result.ingredients) {
          const name = `discovery:ingredient:${stableId(`${plan.market}|${ingredient.key}`)}`;
          const old = await io.read(name);
          const at = new Date(cp.asOf).toISOString();
          const observations = [
            ...new Map(
              [...(old?.mentions || []), ...ingredient.mentions].map((m) => [
                m.id,
                m,
              ]),
            ).values(),
          ].slice(-300);
          await io.putDocument(
            'workspace_documents',
            name,
            {
              ...old,
              ...ingredient,
              id: stableId(name),
              market: plan.market,
              firstSeenAt: old?.firstSeenAt || at,
              lastSeenAt: at,
              firstSeenInSystem: !old,
              mentions: observations,
              mentionCount: observations.length,
              platforms: [...new Set(observations.map((m) => m.platform))],
              lastJobId: job.id,
              model: result.model,
              topics: plan.topics,
              days: plan.days,
            },
            false,
          );
          cp.ingredients++;
        }
        cp.analysisDone = true;
        cp.logs.push(
          `分析${cp.records.length}条讨论，发现${cp.ingredients}种有原文支持的成分`,
        );
      }
      return finished();
    }
    cp.logs = cp.logs.slice(-200);
    cp.nextRunAt = io.now() + 1000;
    return io.saveCheckpoint(job, cp, 'running');
  } catch (error) {
    cp.failures.push(String(error.message).slice(0, 600));
    return finished();
  }
}
export { discoveryKinds };
