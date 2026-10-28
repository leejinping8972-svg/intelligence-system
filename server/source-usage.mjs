import { createHash, randomUUID } from 'node:crypto';

import { requireAdmin } from './auth.mjs';
import { engine, pool, putDocument, sql } from './database.mjs';
import { semrushAction } from './semrush-config.mjs';
import { openFetchKey } from './site-fetch-config.mjs';
import {
  contentEvents,
  researchEvents,
  sourceById,
  summarizeUsage,
  usageEvent,
  validateQuota,
} from './source-usage-domain.mjs';
import {
  accountingProjection,
  createMonitorUsageReader,
  createUsageEventCache,
  usageReadWithin,
} from './source-usage-reader.mjs';

export { accountingProjection } from './source-usage-reader.mjs';
const jsonText = (column, field) =>
  sql(
    `${column}->>'${field}'`,
    `JSON_UNQUOTE(JSON_EXTRACT(${column},'$.${field}'))`,
  );
const configStamp = (source, config) =>
  createHash('sha256')
    .update(String(config?.key?.ciphertext || config?.ciphertext || ''))
    .digest('hex');
const readMonitorEvents = createMonitorUsageReader({
  engine,
  write: (name, value, connection) =>
    putDocument('workspace_documents', name, value, false, connection),
});
export async function readSourceEvents(connection = pool) {
  const research = await connection.query(
    `SELECT r.job_id,r.step,r.status,r.paid_allowance,${sql(accountingProjection('r.response'), accountingProjection('r.response', 'mysql'))} AS record,COALESCE(${jsonText('j.input', 'kind')},'keyword_research') AS task,${jsonText('j.input', 'market')} AS market FROM research_requests r JOIN research_jobs j ON j.id=r.job_id`,
  );
  const monitor = await readMonitorEvents(connection);
  const content = await connection.query(
    `SELECT name,${sql("jsonb_build_object('id',value->'id','mode',value->'mode','steps',value->'steps','input',jsonb_build_object('query',value->'input'->'query','market',value->'input'->'market'),'aiUsage',value->'aiUsage','aiStatus',value->'aiStatus','aiUsageAt',value->'aiUsageAt')", "JSON_OBJECT('id',JSON_EXTRACT(value,'$.id'),'mode',JSON_EXTRACT(value,'$.mode'),'steps',JSON_EXTRACT(value,'$.steps'),'input',JSON_OBJECT('query',JSON_EXTRACT(value,'$.input.query'),'market',JSON_EXTRACT(value,'$.input.market')),'aiUsage',JSON_EXTRACT(value,'$.aiUsage'),'aiStatus',JSON_EXTRACT(value,'$.aiStatus'),'aiUsageAt',JSON_EXTRACT(value,'$.aiUsageAt'))")} AS value FROM workspace_documents WHERE name LIKE 'content:job:%'`,
  );
  const direct = await connection.query(
    "SELECT value FROM workspace_documents WHERE name LIKE 'source-usage:event:%'",
  );
  const events = [
    ...researchEvents(
      research.rows.map((r) => ({ ...r, id: `${r.job_id}:${r.step}` })),
    ),
    ...monitor,
    ...contentEvents(content.rows),
    ...direct.rows.map((r) => r.value),
  ];
  return [...new Map(events.map((e) => [e.id, e])).values()];
}
const cachedSourceEvents = createUsageEventCache(readSourceEvents);
export async function recordSourceCall(
  context,
  callback,
  io = {
    write: (name, value) => putDocument('workspace_documents', name, value),
  },
) {
  const id = context.id || randomUUID();
  const name = `source-usage:event:${createHash('sha256').update(id).digest('hex')}`;
  const row = {
    id,
    job_id: context.jobId,
    task: context.task,
    step: context.step,
    market: context.market,
    at: new Date().toISOString(),
    status: 'started',
    record: {},
  };
  await io.write(name, usageEvent(row, context.sourceId));
  cachedSourceEvents.invalidate();
  let result;
  try {
    result = await callback();
  } catch (error) {
    await io.write(
      name,
      usageEvent({ ...row, status: 'failed' }, context.sourceId),
    );
    cachedSourceEvents.invalidate();
    throw error;
  }
  await io.write(
    name,
    usageEvent(
      {
        ...row,
        status: 'done',
        record: context.project ? context.project(result) : result,
      },
      context.sourceId,
    ),
  );
  cachedSourceEvents.invalidate();
  return result;
}
const QUOTA_PREFIX = 'source-usage:quota:';
export async function sourceUsageAction(input, user, overrides = {}) {
  requireAdmin(user);
  const io = {
    pool,
    readEvents: cachedSourceEvents,
    write: (name, value) => putDocument('provider_configs', name, value),
    semrush: semrushAction,
    fetcher: fetch,
    credentialStatus: async () => {
      const { readCredentials } = await import('./local-provider.mjs');
      const value = await readCredentials();
      return {
        brave: Boolean(value.BRAVE_SEARCH_API_KEY),
        sorftime: Boolean(value.SORFTIME_MCP_TOKEN),
      };
    },
    saveBrave: async (key) =>
      (await import('./local-provider.mjs')).saveBraveCredential(key),
    ...overrides,
  };
  if (input.action === 'server_source_credential_save') {
    if (input.sourceId !== 'brave') throw new Error('该来源请使用专用配置入口');
    return io.saveBrave(input.apiKey);
  }
  if (input.action === 'server_source_quota_save') {
    const manual = validateQuota(input);
    const name = `${QUOTA_PREFIX}${input.sourceId}`;
    const old =
      (
        await io.pool.query(
          'SELECT value FROM provider_configs WHERE name=$1',
          [name],
        )
      ).rows[0]?.value || {};
    await io.write(name, {
      ...old,
      manual,
      preferManual: input.preferManual === true,
    });
    return { saved: true };
  }
  if (input.action === 'server_source_quota_refresh') {
    const source = sourceById(input.sourceId);
    if (!source?.automatic)
      throw new Error('该来源暂不支持免费余额查询，请手动登记');
    const name = `${QUOTA_PREFIX}${source.id}`;
    const old =
      (
        await io.pool.query(
          'SELECT value FROM provider_configs WHERE name=$1',
          [name],
        )
      ).rows[0]?.value || {};
    const currentConfig = (
      await io.pool.query('SELECT value FROM provider_configs WHERE name=$1', [
        source.config,
      ])
    ).rows[0]?.value;
    const stamp = configStamp(source, currentConfig);
    let automatic = null;
    let message;
    try {
      if (source.id === 'semrush') {
        const result = await io.semrush(
          { action: 'server_semrush_balance' },
          user,
        );
        if (result.balance?.status === 'available')
          automatic = {
            remaining: result.balance.units,
            total: null,
            updatedAt: result.balance.checkedAt,
            origin: 'automatic',
          };
        message = result.balance?.message || '请先配置 Semrush Key';
      } else {
        const stored = (
          await io.pool.query(
            'SELECT value FROM provider_configs WHERE name=$1',
            [source.config],
          )
        ).rows[0]?.value;
        if (!stored?.key) throw new Error('请先配置 Firecrawl Key');
        const response = await io.fetcher(
          'https://api.firecrawl.dev/v2/team/credit-usage',
          {
            method: 'GET',
            redirect: 'error',
            headers: { authorization: `Bearer ${openFetchKey(stored.key)}` },
            signal: AbortSignal.timeout(12000),
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`余额接口 HTTP ${response.status}`);
        }
        const payload = await response.json();
        const remaining = payload.data?.remainingCredits;
        if (
          typeof remaining !== 'number' ||
          !Number.isFinite(remaining) ||
          remaining < 0
        )
          throw new Error('来源未返回可识别余额');
        automatic = {
          remaining,
          total: null,
          updatedAt: new Date().toISOString(),
          origin: 'automatic',
        };
        message = '已获取账户 credits 余额';
      }
    } catch {
      message = '账户余额读取失败，保留上次快照；可手动登记';
    }
    const latestConfig = (
      await io.pool.query('SELECT value FROM provider_configs WHERE name=$1', [
        source.config,
      ])
    ).rows[0]?.value;
    if (configStamp(source, latestConfig) !== stamp)
      throw new Error('配置已更换，请重新获取额度');
    await io.write(name, {
      ...old,
      ...(automatic ? { automatic, automaticConfigStamp: stamp } : {}),
      message,
      lastAttemptAt: new Date().toISOString(),
    });
    return { available: Boolean(automatic), message };
  }
  if (input.action !== 'server_source_usage') throw new Error('未知数据源操作');
  const [eventResult, configsResult] = await Promise.all([
    usageReadWithin(
      io.readEvents(io.pool, { refresh: input.refresh === true }),
    ),
    io.pool.query(
      "SELECT name,value FROM provider_configs WHERE name LIKE 'provider:%' OR name LIKE 'source-usage:quota:%' OR name IN ('credentials','sorftime-mcp')",
    ),
  ]);
  if (eventResult.loading) return { loading: true, retryAfterMs: 2000 };
  const events = eventResult.events;
  const configs = Object.fromEntries(
    configsResult.rows.map((r) => [r.name, r.value]),
  );
  configs.credentialStatus = await io.credentialStatus().catch(() => ({}));
  const quotas = Object.fromEntries(
    configsResult.rows
      .filter((r) => r.name.startsWith(QUOTA_PREFIX))
      .map((r) => [r.name.slice(QUOTA_PREFIX.length), r.value]),
  );
  for (const [id, quota] of Object.entries(quotas)) {
    const source = sourceById(id);
    if (
      source &&
      quota.automaticConfigStamp &&
      quota.automaticConfigStamp !== configStamp(source, configs[source.config])
    )
      quotas[id] = {
        ...quota,
        automatic: null,
        message: '密钥已更换，请重新获取额度或手动登记',
      };
  }
  const result = summarizeUsage(events, configs, quotas, input);
  // Previously captured balances remain useful without making a paid verification request.
  const scrape = result.sources.find((s) => s.id === 'scrapecreators');
  const last = configs['provider:scrapecreators:v1']?.lastCheck;
  if (!scrape.quota && typeof last?.creditsRemaining === 'number')
    scrape.quota = {
      remaining: last.creditsRemaining,
      total: null,
      updatedAt: last.checkedAt,
      origin: 'automatic',
    };
  return result;
}
