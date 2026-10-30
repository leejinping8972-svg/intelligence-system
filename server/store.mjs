import process from 'node:process';

import { ssoSchema } from './admin-sso-store.mjs';
import { platformLinkSchema } from './platform-link-store.mjs';
import { identitySchema } from './identity-store.mjs';
import { engine, pool, sql } from './database.mjs';
import { createKeywordSaver } from './keyword-store.mjs';
import { decryptSemrushKey, semrushKeyIdentifier } from './semrush-config.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';

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
  await migrateWorkspaceReads(pool, engine);
}
export const authSchema = [
  ssoSchema,
  ...platformLinkSchema,
  ...identitySchema,
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
export const saveKeyword = createKeywordSaver({ pool, sql });
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
      const { semrushKeyId: _internalSemrushKeyId, requestUsage: _usage, ...publicResult } =
        row.response || {};
      return publicResult;
    }
    throw new Error(
      row.error ||
        '上次请求结果未知，已保留调用额度，不自动重复请求；可新建免费趋势补齐任务',
    );
  }
  const semrushRequest =
    request.sources?.includes('semrush_sites') ||
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
  const requestUsage = {
    startedAt: new Date().toISOString(),
    sources: request.sources || [],
    provider: request.provider || null,
    operation: request.op || null,
  };
  await pool.query(
    "INSERT INTO research_requests(job_id,step,paid_allowance,status,response) VALUES($1,$2,$3,'started',$4)",
    [
      job.id,
      step,
      request.sorftimeRequestLimit || 0,
      { requestUsage, ...(semrushKeyId ? { semrushKeyId } : {}) },
    ],
  );
  try {
    const provider = process.env.COLLECTOR_URL
      ? null
      : await import('./local-provider.mjs');
    const response = request.sources?.includes('discovery_sorftime')
      ? Response.json(await (await import('./discovery-sorftime.mjs')).discoverySorftime(request))
      : request.sources?.includes('field_analysis')
        ? Response.json(await (await import('./discovery-ai.mjs')).fieldAnalysisRequest(request))
        : request.sources?.includes('ingredient_analysis')
          ? Response.json(await (await import('./discovery-ai.mjs')).ingredientAnalysisRequest(request))
      : request.sources?.includes('semrush_sites')
      ? Response.json(await (await import('./semrush-sites-provider.mjs')).collectSemrushSites(request))
      : request.sources?.includes('platform_products')
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
      requestUsage,
      ...(result.semrushKeyId || semrushKeyId
        ? { semrushKeyId: result.semrushKeyId || semrushKeyId }
        : {}),
    };
    await pool.query(
      "UPDATE research_requests SET status='done',response=$3 WHERE job_id=$1 AND step=$2",
      [job.id, step, persistedResult],
    );
    const { semrushKeyId: _internalSemrushKeyId, requestUsage: _usage, ...publicResult } =
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
