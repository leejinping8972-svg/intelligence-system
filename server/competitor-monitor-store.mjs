/* eslint-disable unicorn/no-await-expression-member -- Document SQL follows existing server query conventions. */
/* eslint-disable unicorn/prefer-ternary -- Each scheduler branch supplies a separate set of IO callbacks. */
import { setTimeout as pause } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { pool, putDocument, lock, unlock } from './database.mjs';
import { requireAdmin } from './auth.mjs';
import { cleanKeyword, naturalKey } from './domain.mjs';
import { saveKeyword } from './store.mjs';
import { maintenance } from './database-admin.mjs';
import {
  dayKey,
  digest,
  due,
  mergeObserved,
  validateHotwords,
  validateSchedule,
} from './competitor-monitor-domain.mjs';
import {
  executeHotwords,
  executeMonitor,
} from './competitor-monitor-engine.mjs';
import {
  fetchHotwordSeed,
  scanAdvertiser,
  scanSite,
} from './competitor-monitor-providers.mjs';

const PREFIX = 'competitor:';
export function createMonitorStore(connection = pool) {
  const read = async (name) =>
    (
      await connection.query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [name],
      )
    ).rows[0]?.value;
  const write = (name, value) =>
    putDocument('workspace_documents', name, value, false, connection);
  const list = async (prefix) =>
    (
      await connection.query(
        'SELECT name,value FROM workspace_documents WHERE name LIKE $1 ORDER BY name DESC LIMIT 500',
        [`${prefix}%`],
      )
    ).rows;
  return { read, write, list };
}

export async function withCompetitorIdle(callback) {
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'competitor-runner');
    if (!held) throw new Error('竞品监控或热词榜正在执行，请稍后操作');
    return await callback(c);
  } finally {
    try {
      if (held) await unlock(c, 'competitor-runner');
    } finally {
      c.release();
    }
  }
}

export async function competitorAction(input, user) {
  if (input.action === 'server_competitor_snapshot') {
    const db = createMonitorStore();
    return {
      targets: (await db.list(`${PREFIX}target:`)).map((r) => r.value),
      configs: (await db.list(`${PREFIX}hot-config:`)).map((r) => r.value),
      runs: (await db.list(`${PREFIX}run:`)).map((r) => r.value),
      rankings: (await db.list(`${PREFIX}ranking:`)).map((r) => r.value),
      events: (await db.list(`${PREFIX}event:`))
        .slice(0, 100)
        .map((r) => r.value),
    };
  }
  requireAdmin(user);
  return withCompetitorIdle(async (c) => {
    const db = createMonitorStore(c);
    if (input.action === 'server_competitor_save') {
      const schedule = validateSchedule(input);
      let site, ad;
      if (input.siteId)
        site = await db.read(
          `business:sites:${String(input.siteId).slice(0, 160)}`,
        );
      if (input.adId)
        ad = await db.read(`business:ads:${String(input.adId).slice(0, 160)}`);
      if (
        !['site', 'advertiser'].includes(input.kind) ||
        (input.kind === 'site' ? !site : !ad?.pageId)
      )
        throw new Error('请选择有效站点或含Page ID的广告主');
      const market = input.kind === 'site' ? site.market : ad.market;
      if (
        !['US', 'MX', 'VN'].includes(market) ||
        (site && site.market !== market)
      )
        throw new Error('关联站点与广告主须属于同一市场');
      const pageId = String(
        (input.kind === 'advertiser' ? ad.pageId : input.pageId) || '',
      );
      if (pageId && !/^\d{1,40}$/.test(pageId))
        throw new Error('广告主Page ID须为数字，不能用品牌名替代');
      const id = digest(
        `${input.kind}:${market}:${input.kind === 'site' ? site.id : pageId}`,
      );
      const name = `${PREFIX}target:${id}`;
      const old = await db.read(name);
      if (!old && (await db.list(`${PREFIX}target:`)).length >= 100)
        throw new Error('最多监控100个对象，请先移除不再需要的监控');
      const value = {
        ...schedule,
        id,
        kind: input.kind,
        market,
        siteId: site?.id || '',
        pageId,
        label: site?.domain || ad?.brand || pageId,
        updatedAt: new Date().toISOString(),
        createdAt: old?.createdAt || new Date().toISOString(),
      };
      // Target identity changes require a fresh baseline for the new channel.
      if (old && (old.siteId !== value.siteId || old.pageId !== value.pageId))
        throw new Error('监控对象关联已变化，请先移除旧监控再重新添加');
      await db.write(name, value);
      return { saved: true, target: value };
    }
    if (input.action === 'server_competitor_hot_save') {
      const config = validateHotwords(input);
      await db.write(`${PREFIX}hot-config:${config.market}`, config);
      return { saved: true };
    }
    const hot = input.kind === 'hotwords';
    const id = hot ? String(input.market) : String(input.id);
    if (hot ? !['US', 'MX', 'VN'].includes(id) : !/^[a-f\d]{32}$/.test(id))
      throw new Error('监控编号无效');
    const name = `${PREFIX}${hot ? 'hot-config' : 'target'}:${id}`;
    const config = await db.read(name);
    if (!config) throw new Error('监控配置不存在');
    if (input.action === 'server_competitor_remove' && !hot) {
      for (const key of [
        name,
        `${PREFIX}baseline:${id}:products`,
        `${PREFIX}baseline:${id}:ads`,
        `${PREFIX}crawl:${id}:products`,
        `${PREFIX}crawl:${id}:ads`,
      ])
        await c.query('DELETE FROM workspace_documents WHERE name=$1', [key]);
      return { removed: true };
    }
    if (input.action === 'server_competitor_pause') {
      await db.write(name, { ...config, enabled: false, requested: false });
      return { saved: true };
    }
    if (input.action === 'server_competitor_check') {
      const run = await db.read(`${PREFIX}run:${hot ? 'hot-' : ''}${id}`);
      if (run?.day === dayKey())
        throw new Error(
          '本日已经检查或尝试执行，明日再更新；异常付费请求不会自动重放',
        );
      await db.write(name, { ...config, requested: true });
      return { queued: true };
    }
    throw new Error('不支持的监控操作');
  });
}

export async function persistObservation(c, target, kind, item, event, at) {
  const db = createMonitorStore(c);
  const businessName = `business:${kind}:${item.id}`;
  await c.query('BEGIN');
  try {
    const old = (
      await c.query(
        'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
        [businessName],
      )
    ).rows[0]?.value;
    await db.write(businessName, mergeObserved(old, item, at));
    if (event) {
      event.keywordIds = [];
      for (const term of event.terms) {
        const keyword = cleanKeyword({
          id: randomUUID(),
          market: target.market,
          term,
          source: '竞品上新',
          category: '待分类',
          collectedAt: at,
          dataNature: 'collected',
        });
        await saveKeyword(keyword, true, c);
        const key = naturalKey(keyword);
        const found = (
          await c.query(
            'SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
            [key],
          )
        ).rows[0].data;
        const value = {
          ...found,
          source: [
            ...new Set([...(found.source || '').split(' / '), '竞品上新']),
          ]
            .filter(Boolean)
            .join(' / '),
          siteIds: [
            ...new Set([
              ...(found.siteIds || []),
              ...(target.siteId ? [target.siteId] : []),
            ]),
          ],
          productIds: [
            ...new Set([
              ...(found.productIds || []),
              ...(kind === 'products' ? [item.id] : []),
            ]),
          ],
        };
        await c.query(
          'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
          [key, value],
        );
        event.keywordIds.push(found.id);
      }
      if (kind === 'ads') {
        const ad = await db.read(businessName);
        await db.write(businessName, {
          ...ad,
          keywordIds: [
            ...new Set([...(ad.keywordIds || []), ...event.keywordIds]),
          ],
        });
      }
      await db.write(`${PREFIX}event:${at}:${event.id}`, event);
    }
    await db.write(`${PREFIX}seen:${target.id}:${kind}:${digest(item.id)}`, {
      at,
      itemId: item.id,
    });
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  }
}

export async function competitorTick(c, providers = {}) {
  if (maintenance) return;
  const db = createMonitorStore(c),
    now = Date.now(),
    at = new Date(now).toISOString(),
    day = dayKey(now);
  const targets = [
    ...(await db.list(`${PREFIX}target:`)),
    ...(await db.list(`${PREFIX}hot-config:`)),
  ];
  // One target per tick lets pause/configuration requests obtain the same lock.
  for (const entry of targets) {
    const config = entry.value,
      hot = entry.name.includes('hot-config:');
    const id = hot ? `hot-${config.market}` : config.id;
    const runName = `${PREFIX}run:${id}`;
    const last = await db.read(runName);
    if (last?.status === 'running')
      await db.write(runName, {
        ...last,
        status: 'interrupted',
        errors: [...(last.errors || []), '进程中断，本日不自动重放未确认请求'],
      });
    if (last?.day === day || (!config.requested && !due(config, last, now)))
      continue;
    await db.write(entry.name, { ...config, requested: false });
    const request = async (step, call) => {
      const name = `${PREFIX}request:${day}:${id}:${digest(step)}`;
      const journal = await db.read(name);
      if (journal?.status === 'completed') return journal.response;
      if (journal) throw new Error('该请求已尝试但结果未确认，本日不重复调用');
      await db.write(name, { status: 'started', at, step });
      try {
        const response = await call();
        await db.write(name, { status: 'completed', at, step, response });
        return response;
      } catch (error) {
        await db.write(name, {
          status: 'failed',
          at,
          step,
          error: error.message,
        });
        throw error;
      }
    };
    const io = {
      at,
      day,
      request,
      saveRun: (r) =>
        db.write(runName, {
          ...r,
          id,
          label: config.label || 'Semrush热词榜',
          market: config.market,
        }),
    };
    if (hot)
      await executeHotwords(config, {
        ...io,
        fetchSeed: (seed, req) =>
          (providers.fetchHotwordSeed || fetchHotwordSeed)(config, seed, req),
        previous: () => db.read(`${PREFIX}ranking:${config.market}`),
        saveRanking: async (r) => {
          await c.query('BEGIN');
          try {
            for (const row of r.rows)
              await saveKeyword(
                {
                  market: config.market,
                  term: row.term,
                  source: 'Semrush热词',
                  metrics: row.metrics,
                  seedTerm: row.seed,
                  collectedAt: at,
                  dataNature: 'collected',
                },
                true,
                c,
              );
            await db.write(`${PREFIX}ranking:${config.market}`, r);
            await db.write(`${PREFIX}history:${config.market}:${day}`, r);
            await c.query('COMMIT');
          } catch (error) {
            await c.query('ROLLBACK');
            throw error;
          }
        },
      });
    else
      await executeMonitor(config, {
        ...io,
        baseline: (kind) => db.read(`${PREFIX}baseline:${id}:${kind}`),
        setBaseline: (kind) =>
          db.write(`${PREFIX}baseline:${id}:${kind}`, { at }),
        seen: (kind, itemId) =>
          db.read(`${PREFIX}seen:${id}:${kind}:${digest(itemId)}`),
        persist: (kind, item, event) =>
          persistObservation(c, config, kind, item, event, at),
        saveProgress: (kind, value) =>
          value
            ? db.write(`${PREFIX}crawl:${id}:${kind}`, value)
            : c.query('DELETE FROM workspace_documents WHERE name=$1', [
                `${PREFIX}crawl:${id}:${kind}`,
              ]),
        scan: async (kind, req, remaining) => {
          if (remaining <= 0) throw new Error('已达到本日请求预算');
          const progress = await db.read(`${PREFIX}crawl:${id}:${kind}`);
          if (kind === 'ads')
            return (providers.scanAdvertiser || scanAdvertiser)(
              config,
              req,
              remaining,
              undefined,
              progress,
            );
          const site = await db.read(`business:sites:${config.siteId}`);
          if (!site) throw new Error('监控站点已删除');
          return (providers.scanSite || scanSite)(
            site,
            req,
            remaining,
            undefined,
            progress,
          );
        },
      });
    return;
  }
}

export async function runCompetitorQueue(signal) {
  while (!signal.aborted) {
    try {
      await withCompetitorIdle((c) => competitorTick(c));
    } catch (error) {
      if (!/正在执行/.test(error.message))
        console.error('竞品监控：', error.message);
    }
    try {
      await pause(15_000, undefined, { signal });
    } catch {
      break;
    }
  }
}
