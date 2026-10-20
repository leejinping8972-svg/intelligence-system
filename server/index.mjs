import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { isWorkspaceSyncKey } from './workspace-sync-keys.mjs';
import { createServer } from 'node:http';
import process from 'node:process';

import { authAction, requireAdmin, sessionUser } from './auth.mjs';
import { databaseAction, maintenance } from './database-admin.mjs';
import {
  currentDatabase,
  lock,
  putDocument,
  sql,
  unlock,
} from './database.mjs';
import { cleanKeyword, editableKeywordPatch, validateJob } from './domain.mjs';
import { localCollect, migrateCredentials } from './local-provider.mjs';
import { assessKeyword } from './model.js';
import { jobTasks, runQueue } from './runner.mjs';
import { retryRecords } from './job-progress.mjs';
import { semrushAction } from './semrush-config.mjs';
import { youtubeAction } from './youtube-config.mjs';
import { publicBranding } from './public-branding.mjs';
import { workspaceSnapshot } from './workspace-snapshot.mjs';
import { submitKeywordJob } from './keyword-submit.mjs';
import { submitEnrichment, cancelEnrichment } from './enrichment-jobs.mjs';
import { migrate, pool, saveKeyword } from './store.mjs';

import { adsConfig } from './ads-provider.mjs';
import { submitMarketJob } from './market-jobs.mjs';
import { scoreSite } from './site-scoring.mjs';
import { analysisConfig } from './model-provider.mjs';
import { reportPromptAction } from './report-prompts.mjs';
import {
  submitInsight,
  insightSnapshot,
  insightDetails,
  reviewInsight,
} from './insight-jobs.mjs';
import { submitProducts } from './product-jobs.mjs';
import { submitPlatformProducts } from './platform-products-jobs.mjs';
import { protectPlatformClientEdit } from './platform-product-data.mjs';
import { registerRelease, releaseHistory } from './release-history.mjs';
import { serveAdMedia } from './ad-media.mjs';
import {
  publicContentAction,
  runContentQueue,
  withPublicContentIdle,
} from './public-content-store.mjs';
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const secret = Buffer.from(process.env.SERVER_BRIDGE_KEY || '');
if (secret.length < 32) throw new Error('SERVER_BRIDGE_KEY must be configured');
await migrate();
await registerRelease();
const controller = new AbortController();
void runQueue(controller.signal);
void runContentQueue(controller.signal);
async function api(input, user) {
  if (input.action?.startsWith('server_content_'))
    return publicContentAction(input, user);
  switch (input.action) {
    case 'server_youtube_config':
    case 'server_youtube_status':
      return youtubeAction(input, user);
    case 'server_ad_report_prompt':
    case 'server_ad_report_prompt_save':
      return reportPromptAction(input, user);
    case 'server_analysis_config':
    case 'server_analysis_status':
      return analysisConfig(input, user);
    case 'server_insight_snapshot':
      return insightSnapshot(input);
    case 'server_insight_details':
      return insightDetails(input);
    case 'server_review_insight':
      return reviewInsight(input);
    case 'server_submit_insight': {
      const job = await submitInsight(input);
      return { jobId: job.id, tasks: jobTasks(job) };
    }
    case 'server_submit_products': {
      const job = await submitProducts(input);
      return { jobId: job.id, tasks: jobTasks(job) };
    }
    case 'server_submit_platform_products': {
      const job = await submitPlatformProducts(input);
      return { jobId: job.id, tasks: jobTasks(job) };
    }
    case 'server_release_history':
      return releaseHistory(user);
    case 'server_ads_config':
    case 'server_ads_status':
      return adsConfig(input, user);
    case 'server_submit_market': {
      const job = await submitMarketJob(input);
      return { jobId: job.id, tasks: jobTasks(job) };
    }

    case 'server_semrush_config':
    case 'server_semrush_status':
      return semrushAction(input, user);
    case 'server_workspace_snapshot': {
      const { rows } = await pool.query(
        "SELECT name,value FROM workspace_documents WHERE name LIKE 'business:%'",
      );
      return {
        entries: rows
          .filter((row) => isWorkspaceSyncKey(row.name.slice(9)))
          .map((row) => ({
            key: row.name.slice(9),
            value: row.name.startsWith('business:sites:')
              ? { ...row.value, assessment: scoreSite(row.value) }
              : row.value,
          })),
      };
    }
    case 'server_workspace_delta':
      return workspaceSnapshot(input, {
        pool,
        sql,
        jobTasks,
        scoreSite,
        isWorkspaceSyncKey,
      });
    case 'server_task_detail': {
      if (!uuid.test(input.jobId)) throw new Error('任务编号无效');
      const { rows } = await pool.query(
        'SELECT * FROM research_jobs WHERE id=$1',
        [input.jobId],
      );
      if (!rows[0]) throw new Error('任务不存在或已移除');
      return { tasks: jobTasks(rows[0]) };
    }
    case 'server_workspace_sync': {
      if (!Array.isArray(input.entries) || input.entries.length > 1000)
        throw new Error('每次最多同步1000条业务记录');
      if (
        input.entries.some((entry) =>
          /^(branding|preferences):/.test(entry.key),
        )
      )
        requireAdmin(user);
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        for (const entry of input.entries) {
          if (
            typeof entry.key !== 'string' ||
            !isWorkspaceSyncKey(entry.key) ||
            entry.key.length > 160 ||
            JSON.stringify(entry.value).length > 500_000
          )
            throw new Error('业务记录格式不正确');
          if (entry.value === null) {
            if (!input.importOnly)
              await connection.query(
                'DELETE FROM workspace_documents WHERE name=$1',
                [`business:${entry.key}`],
              );
          } else {
            if (entry.key.startsWith('products:') && !input.importOnly) {
              const old = (
                await connection.query(
                  'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
                  [`business:${entry.key}`],
                )
              ).rows[0]?.value;
              entry.value = protectPlatformClientEdit(old, entry.value);
            }
            await putDocument(
              'workspace_documents',
              `business:${entry.key}`,
              entry.value,
              Boolean(input.importOnly),
              connection,
            );
          }
        }
        await connection.query('COMMIT');
        return { saved: true };
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    }
    case 'server_status': {
      const { rows } = await pool.query(
        "SELECT count(*)::integer AS active FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      );
      return {
        ready: true,
        stage: 'keywords',
        activeJobs: rows[0].active,
        storage: currentDatabase().engine,
        execution: 'server',
        message: '关键词任务在腾讯云后台执行，关闭浏览器后继续运行',
      };
    }
    case 'server_submit_enrichment': {
      const job = await submitEnrichment(input);
      return { jobId: job.id, tasks: jobTasks(job) };
    }
    case 'server_retry_trends':
    case 'server_submit': {
      if (!uuid.test(input.requestId)) throw new Error('缺少任务提交编号');
      const duplicate = await pool.query(
        'SELECT * FROM research_jobs WHERE request_id=$1',
        [input.requestId],
      );
      if (duplicate.rows[0])
        return {
          jobId: duplicate.rows[0].id,
          acceptedKeywords:
            duplicate.rows[0].input.existingRecords?.length ??
            duplicate.rows[0].input.limit,
          tasks: jobTasks(duplicate.rows[0]),
        };
      let requested = input.input || {};
      if (input.action === 'server_retry_trends') {
        if (!uuid.test(input.jobId)) throw new Error('任务编号无效');
        const { rows } = await pool.query(
          'SELECT * FROM research_jobs WHERE id=$1',
          [input.jobId],
        );
        const previous = rows[0];
        if (!previous || ['queued', 'running'].includes(previous.status))
          throw new Error('请等待原任务结束，再重试未完成趋势');
        const all = await pool.query(
          'SELECT data FROM research_keywords ORDER BY updated_at DESC LIMIT 10000',
        );
        const records = retryRecords(
          previous.checkpoint.keywords || [],
          all.rows.map((row) => row.data),
        );
        if (!records.length)
          throw new Error(
            '该任务已无采集失败的趋势；低搜索量或零基数不需要重复抓取',
          );
        requested = {
          existingRecords: records,
          seeds: [],
          sources: [],
          depth: 1,
          limit: records.length,
          markets: [...new Set(records.map((record) => record.market))],
        };
      }
      const value = validateJob(requested);
      if (value.existingRecords) {
        const current = await pool.query(
          'SELECT data FROM research_keywords ORDER BY updated_at DESC LIMIT 10000',
        );
        const byId = new Map(current.rows.map((r) => [r.data.id, r.data]));
        value.existingRecords = value.existingRecords.map((record) => {
          const saved = byId.get(record.id);
          if (
            !saved ||
            saved.market !== record.market ||
            saved.term !== record.term
          )
            throw new Error(
              '选中的关键词已更新或删除，请刷新后重新选择；未提交部分名单',
            );
          return saved;
        });
      }
      if (value.sources.includes('semrush')) {
        const { rows } = await pool.query(
          'SELECT name FROM provider_configs WHERE name=$1',
          ['provider:semrush:mcp:v1'],
        );
        if (!rows.length)
          throw new Error('请先在数据源与设置中配置 Semrush MCP');
      }
      const { job, reused } = await submitKeywordJob(value, input.requestId, {
        pool,
        lock,
        unlock,
      });
      return {
        jobId: job.id,
        tasks: jobTasks(job),
        reused,
        acceptedKeywords: value.existingRecords?.length ?? value.limit,
      };
    }
    case 'server_snapshot': {
      const [keywords, jobs] = await Promise.all([
        pool.query(
          'SELECT data FROM research_keywords ORDER BY updated_at DESC LIMIT 10000',
        ),
        pool.query(
          'SELECT * FROM research_jobs ORDER BY created_at DESC LIMIT 200',
        ),
      ]);
      return {
        keywords: keywords.rows.map(({ data }) => ({
          ...data,
          assessment: assessKeyword(data),
        })),
        tasks: jobs.rows.flatMap(jobTasks),
        generatedAt: new Date().toISOString(),
      };
    }
    case 'server_import_keywords': {
      if (
        !uuid.test(input.clientId) ||
        !Array.isArray(input.keywords) ||
        input.keywords.length > 1000
      )
        throw new Error('本机迁移请求格式不正确，每次最多1000个关键词');
      const records = input.keywords.map(cleanKeyword);
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        const claimed = await connection.query(
          sql(
            'INSERT INTO research_imports(client_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING client_id',
            'INSERT IGNORE INTO research_imports(client_id) VALUES($1)',
          ),
          [input.clientId],
        );
        if (claimed.rowCount)
          for (const record of records)
            await saveKeyword(record, true, connection);
        await connection.query('COMMIT');
        return {
          imported: claimed.rowCount ? records.length : 0,
          initialized: Boolean(claimed.rowCount),
        };
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        connection.release();
      }
    }
    case 'server_patch_keywords': {
      if (!Array.isArray(input.updates) || input.updates.length > 100)
        throw new Error('每次最多更新100个关键词');
      for (const update of input.updates) {
        const patch = editableKeywordPatch(update.patch || {});
        await pool.query(
          sql(
            "UPDATE research_keywords SET data=data || $2::jsonb,updated_at=now() WHERE data->>'id'=$1",
            "UPDATE research_keywords SET data=JSON_MERGE_PATCH(data,CAST($2 AS JSON)),updated_at=now() WHERE JSON_UNQUOTE(JSON_EXTRACT(data,'$.id'))=$1",
          ),
          [String(update.id), patch],
        );
      }
      return { saved: true };
    }
    case 'server_cancel': {
      if (!uuid.test(input.jobId)) throw new Error('任务编号无效');
      await pool.query(
        "UPDATE research_jobs SET cancelled=true,status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
        [input.jobId],
      );
      const { rows } = await pool.query(
        'SELECT * FROM research_jobs WHERE id=$1',
        [input.jobId],
      );
      await cancelEnrichment(rows[0]);
      return { cancelled: true };
    }
    case 'server_clear_keywords': {
      requireAdmin(user);
      if (input.confirm !== 'clear-keyword-results')
        throw new Error('缺少清除确认');
      const connection = await pool.connect();
      try {
        await connection.query('BEGIN');
        if (!(await lock(connection)))
          throw new Error(
            '请先取消后台关键词任务，等待当前采集请求结束后再清除',
          );
        await connection.query(
          "UPDATE research_jobs SET cancelled=true,status='cancelled' WHERE status IN ('queued','running')",
        );
        await connection.query('DELETE FROM research_requests');
        await connection.query('DELETE FROM research_jobs');
        await connection.query('DELETE FROM research_keywords');
        await connection.query(
          "DELETE FROM workspace_documents WHERE name LIKE 'business:%' AND name NOT IN ('business:branding:main','business:preferences:main')",
        );
        await connection.query('COMMIT');
        return { cleared: true };
      } catch (error) {
        await connection.query('ROLLBACK');
        throw error;
      } finally {
        await unlock(connection).catch(() => {});
        connection.release();
      }
    }
    default: {
      throw new Error('不支持的云端业务操作');
    }
  }
}
let activeRequests = 0;
const server = createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  const supplied = Buffer.from(String(request.headers['x-server-key'] || ''));
  const internal =
    supplied.length === secret.length && timingSafeEqual(supplied, secret);
  let requestUrl;
  try {
    requestUrl = new URL(request.url, 'http://localhost');
  } catch {
    response.writeHead(400).end('{"error":"请求地址无效"}');
    return;
  }
  if (
    ['GET', 'HEAD'].includes(request.method) &&
    requestUrl.pathname === '/api/media'
  ) {
    activeRequests++;
    try {
      if (!internal && !(await sessionUser(request, true)))
        throw Object.assign(new Error('请先登录后播放素材'), { status: 401 });
      const id = requestUrl.searchParams.get('ad');
      if (!id || !/^meta-[A-Z]{2}-\d{1,40}$/.test(id))
        throw Object.assign(new Error('广告编号无效'), { status: 400 });
      const ad = (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [`business:ads:${id}`],
        )
      ).rows[0]?.value;
      if (!ad) throw Object.assign(new Error('广告不存在'), { status: 404 });
      const index = Number(requestUrl.searchParams.get('index') || 0);
      await serveAdMedia(
        request,
        response,
        ad,
        requestUrl.searchParams.get('kind') || 'video',
        index,
      );
    } catch (e) {
      if (!response.headersSent)
        response
          .writeHead(e.status || 502)
          .end(JSON.stringify({ error: e.message }));
      else response.destroy();
    } finally {
      activeRequests--;
    }
    return;
  }
  if (request.method !== 'POST' || request.url !== '/api') {
    response.writeHead(401).end('{"error":"未授权"}');
    return;
  }
  if (
    !internal &&
    (request.headers.origin !== 'https://is.luckdate.com' ||
      !String(request.headers['content-type'] || '').startsWith(
        'application/json',
      ))
  ) {
    response.writeHead(403).end('{"error":"请从正式域名登录访问"}');
    return;
  }
  if (maintenance) {
    response.writeHead(503).end('{"error":"正在切换数据库，请稍后刷新"}');
    return;
  }
  activeRequests += 1;
  try {
    let size = 0;
    const chunks = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8_000_000) {
        response.writeHead(413).end('{"error":"请求数据过大"}');
        return;
      }
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (input.action === 'public_branding') {
      const { rows } = await pool.query(
        "SELECT value FROM workspace_documents WHERE name='business:branding:main'",
      );
      response.end(JSON.stringify(publicBranding(rows[0]?.value)));
      return;
    }
    const user = internal
      ? { id: null, role: 'admin' }
      : await sessionUser(
          request,
          ![
            'auth_status',
            'server_snapshot',
            'server_status',
            'server_workspace_snapshot',
            'server_workspace_delta',
            'server_task_detail',
          ].includes(input.action),
        );
    if (input.action?.startsWith('auth_')) {
      response.end(
        JSON.stringify(await authAction(input, request, response, user)),
      );
      return;
    }
    if (!internal && !user) {
      response.writeHead(401).end('{"error":"请先登录管理员或研究员账号"}');
      return;
    }
    if (input.action?.startsWith('database_')) {
      requireAdmin(user);
      if (input.action === 'database_migrate' && activeRequests > 1)
        throw new Error('当前有请求执行中，请稍后重试迁移');
      response.end(
        JSON.stringify(
          input.action === 'database_migrate'
            ? await withPublicContentIdle(() => databaseAction(input))
            : await databaseAction(input),
        ),
      );
    } else if (input.action === 'server_setup_credentials') {
      if (!internal) throw new Error('仅部署过程允许迁移服务凭证');
      response.end(
        JSON.stringify(await migrateCredentials(input.credentials || {})),
      );
    } else if (input.action?.startsWith('server_'))
      response.end(JSON.stringify(await api(input, user)));
    else {
      if (input.action === 'keyword_sources_config') requireAdmin(user);
      const result = await localCollect(input);
      response.statusCode = result.status;
      response.end(await result.text());
    }
  } catch (error) {
    const message =
      error.code || error instanceof SyntaxError
        ? '服务暂不可用或请求格式错误'
        : error.message;
    response
      .writeHead(error.status || 400)
      .end(JSON.stringify({ error: message }));
  } finally {
    activeRequests -= 1;
  }
});
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.listen(Number(process.env.PORT || 8080), '0.0.0.0', () =>
  console.warn('Research server ready'),
);
process.on('SIGTERM', () => {
  controller.abort();
  server.close();
  setTimeout(() => process.exit(0), 1000).unref();
});
