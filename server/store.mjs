import process from 'node:process';

import { ssoSchema } from './admin-sso-store.mjs';
import { engine, pool, sql } from './database.mjs';
import { cleanKeyword, naturalKey } from './domain.mjs';
import { decryptSemrushKey, semrushKeyIdentifier } from './semrush-config.mjs';

export { pool } from './database.mjs';

export async function migrate() {
  if (engine === 'mysql') {
    for (const statement of mysqlSchema) await pool.query(statement);
  } else
    await pool.query(`
    CREATE TABLE IF NOT EXISTS research_jobs (
      id uuid PRIMARY KEY, request_id uuid UNIQUE NOT NULL,
      input jsonb NOT NULL, checkpoint jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'queued', cancelled boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS research_keywords (
      natural_key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS research_requests (
      job_id uuid NOT NULL REFERENCES research_jobs(id), step text NOT NULL,
      paid_allowance integer NOT NULL DEFAULT 0, status text NOT NULL,
      response jsonb, error text, PRIMARY KEY(job_id, step)
    );
    CREATE TABLE IF NOT EXISTS research_imports (client_id uuid PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS provider_configs (name text PRIMARY KEY, value jsonb NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace_documents (name text PRIMARY KEY, value jsonb NOT NULL, revision integer NOT NULL DEFAULT 1);
  `);
  for (const statement of authSchema) await pool.query(statement);
}
export const authSchema = [
  ssoSchema,
  `CREATE TABLE IF NOT EXISTS admin_users (id varchar(36) PRIMARY KEY, username varchar(64) UNIQUE NOT NULL, display_name varchar(100) NOT NULL, password_hash varchar(256) NOT NULL, role varchar(20) NOT NULL, enabled integer NOT NULL DEFAULT 1, created_at bigint NOT NULL, last_login_at bigint, password_changed_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash varchar(64) PRIMARY KEY, user_id varchar(36) NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, last_seen_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_login_attempts (attempt_key varchar(128) PRIMARY KEY, failures integer NOT NULL, locked_until bigint NOT NULL, updated_at bigint NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS admin_audit (id varchar(36) PRIMARY KEY, actor_id varchar(36), action varchar(100) NOT NULL, target_id varchar(64), created_at bigint NOT NULL)`,
];
export const mysqlSchema = [
  `CREATE TABLE IF NOT EXISTS research_jobs (id varchar(36) PRIMARY KEY, request_id varchar(36) UNIQUE NOT NULL, input json NOT NULL, checkpoint json NOT NULL, status varchar(32) NOT NULL DEFAULT 'queued', cancelled boolean NOT NULL DEFAULT false, created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS research_keywords (natural_key varchar(512) COLLATE utf8mb4_bin PRIMARY KEY, data json NOT NULL, updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS research_requests (job_id varchar(36) NOT NULL, step varchar(100) NOT NULL, paid_allowance integer NOT NULL DEFAULT 0, status varchar(32) NOT NULL, response json, error text, PRIMARY KEY(job_id,step), FOREIGN KEY(job_id) REFERENCES research_jobs(id))`,
  `CREATE TABLE IF NOT EXISTS research_imports (client_id varchar(36) PRIMARY KEY, imported_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3))`,
  `CREATE TABLE IF NOT EXISTS provider_configs (name varchar(160) PRIMARY KEY, value json NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS workspace_documents (name varchar(180) PRIMARY KEY, value json NOT NULL, revision integer NOT NULL DEFAULT 1)`,
];
export async function saveKeyword(value, importOnly = false, client = pool) {
  const record = cleanKeyword(value);
  if (importOnly) {
    const found = await client.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE',
      [naturalKey(record)],
    );
    const old = found.rows[0]?.data;
    if (old) {
      const sources = [
        ...new Set([...old.source.split(' / '), ...record.source.split(' / ')]),
      ].join(' / ');
      const richer =
        !old.series?.length && record.series.length > 0
          ? {
              ...record,
              ...Object.fromEntries(
                [
                  'id',
                  'favorite',
                  'reviewStatus',
                  'reviewNote',
                  'termZh',
                  'metrics',
                  'productIds',
                ]
                  .filter((key) => old[key] !== undefined)
                  .map((key) => [key, old[key]]),
              ),
            }
          : old;
      await client.query(
        'UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1',
        [naturalKey(record), { ...richer, source: sources }],
      );
      return;
    }
  }
  const merge = importOnly
    ? 'DO NOTHING'
    : `DO UPDATE SET data = EXCLUDED.data || jsonb_build_object(
    'id', research_keywords.data->'id', 'favorite', research_keywords.data->'favorite',
    'reviewStatus', research_keywords.data->'reviewStatus', 'reviewNote', research_keywords.data->'reviewNote',
    'source', concat_ws(' / ', EXCLUDED.data->>'source', CASE WHEN research_keywords.data->>'source' LIKE '%竞品上新%' AND EXCLUDED.data->>'source' NOT LIKE '%竞品上新%' THEN '竞品上新' END, CASE WHEN research_keywords.data->>'source' LIKE '%Semrush热词%' AND EXCLUDED.data->>'source' NOT LIKE '%Semrush热词%' THEN 'Semrush热词' END),
    'termZh', COALESCE(research_keywords.data->'termZh', EXCLUDED.data->'termZh'),
    'metrics', research_keywords.data->'metrics',
    'productIds', COALESCE(research_keywords.data->'productIds', EXCLUDED.data->'productIds'),
    'siteIds', research_keywords.data->'siteIds', 'siteCollection', research_keywords.data->'siteCollection', 'semrushCollection', research_keywords.data->'semrushCollection', 'adCollection', research_keywords.data->'adCollection'), updated_at=now()`;
  await client.query(
    sql(
      `INSERT INTO research_keywords(natural_key,data) VALUES($1,$2) ON CONFLICT(natural_key) ${merge}`,
      `INSERT ${importOnly ? 'IGNORE' : ''} INTO research_keywords(natural_key,data) VALUES($1,$2) ${importOnly ? '' : `ON DUPLICATE KEY UPDATE data=JSON_SET(VALUES(data), '$.source',CONCAT_WS(' / ',JSON_UNQUOTE(JSON_EXTRACT(VALUES(data),'$.source')),IF(JSON_UNQUOTE(JSON_EXTRACT(data,'$.source')) LIKE '%竞品上新%' AND JSON_UNQUOTE(JSON_EXTRACT(VALUES(data),'$.source')) NOT LIKE '%竞品上新%','竞品上新',NULL),IF(JSON_UNQUOTE(JSON_EXTRACT(data,'$.source')) LIKE '%Semrush热词%' AND JSON_UNQUOTE(JSON_EXTRACT(VALUES(data),'$.source')) NOT LIKE '%Semrush热词%','Semrush热词',NULL)), '$.id',JSON_EXTRACT(data,'$.id'),'$.favorite',JSON_EXTRACT(data,'$.favorite'),'$.reviewStatus',JSON_EXTRACT(data,'$.reviewStatus'),'$.reviewNote',JSON_EXTRACT(data,'$.reviewNote'),'$.termZh',COALESCE(JSON_EXTRACT(data,'$.termZh'),JSON_EXTRACT(VALUES(data),'$.termZh')),'$.metrics',JSON_EXTRACT(data,'$.metrics'),'$.productIds',COALESCE(JSON_EXTRACT(data,'$.productIds'),JSON_EXTRACT(VALUES(data),'$.productIds')),'$.siteIds',JSON_EXTRACT(data,'$.siteIds'),'$.siteCollection',JSON_EXTRACT(data,'$.siteCollection'),'$.semrushCollection',JSON_EXTRACT(data,'$.semrushCollection'),'$.adCollection',JSON_EXTRACT(data,'$.adCollection')),updated_at=now()`}`,
    ),
    [naturalKey(record), record],
  );
  return (
    await client.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1',
      [naturalKey(record)],
    )
  ).rows[0]?.data;
}
export async function saveCheckpoint(job, checkpoint, status = 'running') {
  await pool.query(
    "UPDATE research_jobs SET checkpoint=$2,status=CASE WHEN cancelled THEN 'cancelled' ELSE $3 END,updated_at=now() WHERE id=$1",
    [job.id, { ...checkpoint, updatedAt: new Date().toISOString() }, status],
  );
}
export async function collect(job, step, request) {
  const cached = await pool.query(
    'SELECT * FROM research_requests WHERE job_id=$1 AND step=$2',
    [job.id, step],
  );
  if (cached.rows[0]) {
    const row = cached.rows[0];
    if (row.status === 'done') {
      const { semrushKeyId: _internalSemrushKeyId, ...publicResult } =
        row.response || {};
      return publicResult;
    }
    throw new Error(
      row.error ||
        '上次请求结果未知，已保留调用额度，不自动重复请求；可新建免费趋势补齐任务',
    );
  }
  const semrushRequest =
    request.sources?.includes('semrush') ||
    request.sources?.includes('site_metrics') ||
    (request.sources?.includes('platform_products') &&
      request.provider === 'semrush');
  let semrushKeyId;
  if (semrushRequest) {
    try {
      const config = await pool.query(
        'SELECT value FROM provider_configs WHERE name=$1',
        ['provider:semrush:mcp:v1'],
      );
      const stored = config.rows[0]?.value;
      if (stored) {
        const secret = process.env.PROVIDER_CONFIG_ENCRYPTION_KEY;
        semrushKeyId = semrushKeyIdentifier(
          decryptSemrushKey(stored, secret),
          secret,
        );
      }
    } catch {
      // A missing/unreadable key must not block the request journal; its cost
      // will remain unattributed rather than being assigned to a guessed key.
    }
  }
  await pool.query(
    "INSERT INTO research_requests(job_id,step,paid_allowance,status,response) VALUES($1,$2,$3,'started',$4)",
    [
      job.id,
      step,
      request.sorftimeRequestLimit || 0,
      semrushKeyId ? { semrushKeyId } : null,
    ],
  );
  try {
    const provider = process.env.COLLECTOR_URL
      ? null
      : await import('./local-provider.mjs');
    const response = request.sources?.includes('platform_products')
      ? Response.json(
          await (
            await import('./platform-products-provider.mjs')
          ).platformProductRequest(request),
        )
      : request.sources?.includes('google_trends_part')
        ? Response.json(
            await (
              await import('./trend-provider.mjs')
            ).collectTrendPart(request),
          )
        : request.sources?.includes('semantic_analysis')
          ? Response.json(
              await (
                await import('./model-provider.mjs')
              ).analyzeRecords(request.records, request.kind, request.context),
            )
          : request.sources?.includes('social_research')
            ? Response.json(
                await (
                  await import('./insight-jobs.mjs')
                ).collectSocialPage(request),
              )
            : request.sources?.includes('ad_transcript')
              ? Response.json(
                  await (
                    await import('./insight-jobs.mjs')
                  ).collectAdTranscript(request),
                )
              : request.sources?.includes('ads')
                ? Response.json(
                    await (
                      await import('./ads-provider.mjs')
                    ).collectAds(request),
                  )
                : request.sources?.includes('site_metrics')
                  ? Response.json(
                      await (
                        await import('./site-metrics.mjs')
                      ).collectSiteMetrics(request),
                    )
                  : request.sources?.includes('semrush')
                    ? Response.json(
                        await (
                          await import('./semrush-reports.mjs')
                        ).collectSemrush(request),
                      )
                    : process.env.COLLECTOR_URL
                      ? await fetch(process.env.COLLECTOR_URL, {
                          method: 'POST',
                          redirect: 'error',
                          headers: {
                            'content-type': 'application/json',
                            'x-server-key': process.env.SERVER_BRIDGE_KEY,
                          },
                          body: JSON.stringify({
                            ...request,
                            action: 'server_collect',
                          }),
                          signal: AbortSignal.timeout(240_000),
                        })
                      : await provider.localCollect({
                          ...request,
                          action: request.sources?.includes('site_discovery')
                            ? 'site_research'
                            : 'keyword_research',
                        });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `采集服务HTTP ${response.status}`);
    const persistedResult = {
      ...result,
      ...(result.semrushKeyId || semrushKeyId
        ? { semrushKeyId: result.semrushKeyId || semrushKeyId }
        : {}),
    };
    await pool.query(
      "UPDATE research_requests SET status='done',response=$3 WHERE job_id=$1 AND step=$2",
      [job.id, step, persistedResult],
    );
    const { semrushKeyId: _internalSemrushKeyId, ...publicResult } =
      persistedResult;
    return publicResult;
  } catch (error) {
    await pool.query(
      "UPDATE research_requests SET status='failed',error=$3 WHERE job_id=$1 AND step=$2",
      [job.id, step, String(error.message).slice(0, 1000)],
    );
    throw error;
  }
}
export async function usage(jobId) {
  const { rows } = await pool.query(
    'SELECT status,response,paid_allowance FROM research_requests WHERE job_id=$1',
    [jobId],
  );
  return rows.reduce(
    (total, row) => ({
      confirmed:
        total.confirmed +
        (row.status === 'done'
          ? Number(row.response?.usage?.sorftimeCalls || 0)
          : 0),
      reserved:
        total.reserved +
        (row.status === 'done' ? 0 : Number(row.paid_allowance)),
    }),
    { confirmed: 0, reserved: 0 },
  );
}
