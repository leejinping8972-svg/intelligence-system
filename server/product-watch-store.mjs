import { randomUUID } from 'node:crypto';

import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import {
  discoveryDay,
  scheduleSlot,
  stableId,
} from './discovery-monitor-domain.mjs';
import { readProduct, upsertProduct } from './platform-products-jobs.mjs';
import { inNewProductPool } from './product-pool-domain.mjs';
import {
  observation,
  watchConfig,
  watchDefaults,
  watchTrends,
} from './product-watch-domain.mjs';
import { collect, saveCheckpoint } from './store.mjs';

const read = async (name, c = pool) =>
  (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [name]))
    .rows[0]?.value;
const idValid = (id) =>
  typeof id === 'string' && /^[a-z\d._-]{1,160}$/i.test(id);
async function submit(config, day, c) {
  const requestId = stableId(`product-watch:${config.market}:${day}`);
  const old = (
    await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
      requestId,
    ])
  ).rows[0];
  if (old) return old;
  const active = (
    await c.query(
      "SELECT input FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
    )
  ).rows.some(
    (r) => r.input.kind === 'product_watch' && r.input.market === config.market,
  );
  if (active) throw new Error('上一轮商品持续监控尚未完成，未创建重叠任务');
  const id = randomUUID();
  const input = {
    kind: 'product_watch',
    market: config.market,
    markets: [config.market],
    seeds: [],
    day,
  };
  const checkpoint = {
    submittedAt: new Date().toISOString(),
    cursor: '',
    pending: [],
    index: 0,
    calls: 0,
    succeeded: 0,
    failures: [],
    logs: [],
  };
  await c.query(
    'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
    [id, requestId, input, checkpoint],
  );
  return { id, input, checkpoint };
}
export async function productWatchAction(input, user) {
  if (input.action === 'server_product_watch_history') {
    if (!idValid(input.productId)) throw new Error('商品编号无效');
    const rows = (
      await pool.query(
        'SELECT value FROM workspace_documents WHERE name LIKE $1 ORDER BY name DESC LIMIT 90',
        [`product-watch:observation:${stableId(input.productId)}:%`],
      )
    ).rows.map((r) => r.value);
    return watchTrends(rows);
  }
  if (!['MX', 'US', 'VN'].includes(input.market))
    throw new Error('请选择监控市场');
  const key = `product-watch:config:${input.market}`;
  if (input.action === 'server_product_watch_config')
    return { config: (await read(key)) || watchDefaults(input.market) };
  requireAdmin(user);
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'monitor-config');
    if (!held) throw new Error('监控配置正在保存，请稍后重试');
    if (input.action === 'server_product_watch_save') {
      const config = {
        ...(await read(key, c)),
        ...watchConfig(input),
        updatedAt: new Date().toISOString(),
      };
      await putDocument('workspace_documents', key, config, false, c);
      return { config };
    }
    if (input.action === 'server_product_watch_run') {
      const config = (await read(key, c)) || watchDefaults(input.market);
      const job = await submit(config, discoveryDay(Date.now()), c);
      await putDocument(
        'workspace_documents',
        key,
        { ...config, lastJobId: job.id },
        false,
        c,
      );
      return { jobId: job.id };
    }
    throw new Error('不支持的商品持续监控操作');
  } finally {
    if (held) await unlock(c, 'monitor-config');
    c.release();
  }
}
// Called exclusively while holding the common runner/deployment lock.
export async function tickProductWatch(now = Date.now()) {
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'monitor-config');
    if (!held) return;
    for (const market of ['US', 'MX', 'VN']) {
      const key = `product-watch:config:${market}`;
      const config = await read(key, c);
      if (!config) continue;
      const day = scheduleSlot(config, now);
      if (!day || config.lastScheduledDay === day) continue;
      const active = (
        await c.query(
          "SELECT input FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
        )
      ).rows.some(
        (r) => r.input.kind === 'product_watch' && r.input.market === market,
      );
      if (active) continue;
      const job = await submit(config, day, c);
      await putDocument(
        'workspace_documents',
        key,
        { ...config, lastScheduledDay: day, lastJobId: job.id },
        false,
        c,
      );
    }
  } finally {
    if (held) await unlock(c, 'monitor-config');
    c.release();
  }
}

export async function runProductWatch(job, overrides = {}) {
  const io = {
    pool,
    read,
    readProduct,
    upsertProduct,
    collect,
    putDocument,
    saveCheckpoint,
    now: Date.now,
    ...overrides,
  };
  const cp = structuredClone(job.checkpoint);
  const cancelled = async () =>
    (
      await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
        job.id,
      ])
    ).rows[0]?.cancelled;
  if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
  if (job.input.day !== discoveryDay(io.now()))
    return io.saveCheckpoint(
      job,
      {
        ...cp,
        finishedAt: new Date(io.now()).toISOString(),
        logs: [
          ...cp.logs,
          '已错过计划日期，跳过旧快照；今日任务将重新读取当前商品，不补造历史价格。',
        ],
      },
      'cancelled',
    );
  if (!cp.pending.length && !cp.exhausted) {
    const rows = (
      await io.pool.query(
        sql(
          "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:products:%' AND name>$1 AND value->>'market'=$2 AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(value->'newProductClassifications','[]'::jsonb)) e WHERE e->>'type' IN ('regular_new','fbm_new','new_listing')) ORDER BY name LIMIT 200",
          "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:products:%' AND name>$1 AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.market'))=$2 AND (JSON_SEARCH(value,'one','regular_new',NULL,'$.newProductClassifications[*].type') IS NOT NULL OR JSON_SEARCH(value,'one','fbm_new',NULL,'$.newProductClassifications[*].type') IS NOT NULL OR JSON_SEARCH(value,'one','new_listing',NULL,'$.newProductClassifications[*].type') IS NOT NULL) ORDER BY name LIMIT 200",
        ),
        [cp.cursor, job.input.market],
      )
    ).rows;
    cp.pending = rows.map((r) => r.value.id);
    cp.cursor = rows.at(-1)?.name || cp.cursor;
    cp.exhausted = rows.length < 200;
    cp.total = (cp.total || 0) + rows.length;
    return io.saveCheckpoint(job, cp, 'running');
  }
  if (!cp.pending.length)
    return io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date(io.now()).toISOString() },
      cp.failures.length ? 'partial' : 'completed',
    );
  const id = cp.pending[0];
  const at = new Date(io.now()).toISOString();
  const observationKey = `product-watch:observation:${stableId(id)}:${job.input.day}`;
  try {
    const stored = await io.read(observationKey);
    if (stored) {
      if (stored.status === 'failed')
        cp.failures.push(`${id}：${stored.reason}`);
      if (stored.status === 'completed') {
        cp.succeeded++;
        const latest = await io.read(`product-watch:latest:${id}`);
        if (!latest || latest.at <= stored.at)
          await io.putDocument(
            'workspace_documents',
            `product-watch:latest:${id}`,
            stored,
            false,
          );
      }
      cp.logs.push(`${id}：本日观察已保存，跳过重复采集`);
    } else {
      const product = await io.readProduct(id);
      if (!inNewProductPool(product) || product.market !== job.input.market)
        throw new Error('商品已移出本监控范围');
      if (
        !['Amazon', 'Shopee', 'Temu', 'TikTok Shop'].includes(
          product.sourcePlatform,
        ) ||
        !product.sourceProductId
      )
        throw new Error('缺少可监控的Sorftime商品身份');
      cp.calls++;
      const result = await io.collect(job, `watch:detail:${stableId(id)}`, {
        sources: ['product_intake_source'],
        sorftimeRequestLimit: 1,
        provider: 'sorftime',
        op: 'detail',
        product,
      });
      if (!result.product)
        throw new Error(
          result.message ||
            '来源未返回商品详情，保留旧资料；本日价格和销量留空',
        );
      if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
      let daily = [];
      let dailyError;
      if (product.sourcePlatform === 'Amazon') {
        try {
          cp.calls++;
          const sales = await io.collect(job, `watch:daily:${stableId(id)}`, {
            sources: ['product_watch_source'],
            sorftimeRequestLimit: 1,
            provider: 'sorftime',
            product,
          });
          daily = sales.dailySales || [];
          if (sales.unsupported) dailyError = sales.message;
        } catch (error) {
          dailyError = String(error.message).slice(0, 500);
        }
      }
      if (await cancelled()) return io.saveCheckpoint(job, cp, 'cancelled');
      const previous = await io.read(`product-watch:latest:${id}`);
      const value = observation(
        result.product,
        previous,
        at,
        job.input.day,
        daily,
      );
      if (dailyError) {
        value.dailyError = dailyError;
        cp.failures.push(`${id}：每日销量 ${dailyError}`);
      }
      await io.upsertProduct(result.product);
      await io.putDocument('workspace_documents', observationKey, value, true);
      await io.putDocument(
        'workspace_documents',
        `product-watch:latest:${id}`,
        value,
        false,
      );
      cp.succeeded++;
    }
  } catch (error) {
    const reason = String(error.message).slice(0, 500);
    cp.failures.push(`${id}：${reason}`);
    await io.putDocument(
      'workspace_documents',
      observationKey,
      { productId: id, day: job.input.day, at, status: 'failed', reason },
      true,
    );
  }
  cp.pending.shift();
  cp.index++;
  cp.failures = cp.failures.slice(-200);
  cp.logs = cp.logs.slice(-100);
  return io.saveCheckpoint(job, cp, 'running');
}
