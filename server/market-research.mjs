/* oxlint-disable unicorn/no-await-expression-member -- SQL access follows the existing server adapters. */
import { randomUUID } from 'node:crypto';

import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import { submitInsight } from './insight-jobs.mjs';
import { submitMarketJob } from './market-jobs.mjs';
import {
  defaultMarketPlan,
  marketChildRequestId,
  marketRunStages,
  terminalStatus,
  validateMarketPlan,
} from './market-research-domain.mjs';
import { originalMarketRecord } from './market-report-domain.mjs';
import { submitPlatformProducts } from './platform-products-jobs.mjs';
import { submitProducts } from './product-jobs.mjs';
import { publicContentAction } from './public-content-store.mjs';

const PLAN = 'market:collection:plan:';
const RUN = 'market:collection:run:';
const read = async (name, c = pool) =>
  (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [name]))
    .rows[0]?.value;
const write = (name, value, c = pool) =>
  putDocument('workspace_documents', name, value, false, c);
const job = async (id) =>
  (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];

async function sourceReadiness() {
  const { rows } = await pool.query(
    "SELECT name FROM provider_configs WHERE name IN ('provider:scrapecreators:v1','provider:analysis:v1')",
  );
  const names = new Set(rows.map((row) => row.name));
  return {
    scrapeCreators: names.has('provider:scrapecreators:v1'),
    analysisModel: names.has('provider:analysis:v1'),
  };
}

async function keywordRecords(ids, market) {
  if (ids.length === 0) return [];
  const { rows } = await pool.query(
    'SELECT data FROM research_keywords WHERE data IS NOT NULL',
  );
  const wanted = new Set(ids);
  return rows
    .map((row) => row.data)
    .filter(
      (record) =>
        wanted.has(record.id) &&
        record.dataNature !== 'demo' &&
        record.market === market &&
        record.reviewStatus === 'selected',
    );
}

async function marketDocuments(prefix, market) {
  const { rows } = await pool.query(
    'SELECT value FROM workspace_documents WHERE name LIKE $1',
    [`${prefix}%`],
  );
  return rows
    .map((row) => row.value)
    .filter(
      (value) => value?.market === market || value?.searchMarket === market,
    )
    .filter((record) => originalMarketRecord(record));
}

async function captureObservation(run) {
  if (run.observationSaved) return;
  const [products, ads, sites, content, evidence] = await Promise.all([
    marketDocuments('business:products:', run.plan.market),
    marketDocuments('business:ads:', run.plan.market),
    marketDocuments('business:sites:', run.plan.market),
    marketDocuments('content:item:', run.plan.market),
    marketDocuments('business:researchEvidence:', run.plan.market),
  ]);
  const capturedAt = new Date().toISOString();
  await write(`market:observation:${run.plan.market}:${run.id}`, {
    schemaVersion: 1,
    runId: run.id,
    market: run.plan.market,
    capturedAt,
    products,
    ads,
    sites,
    content,
    comments: evidence.filter((record) => record.kind === 'comment'),
  });
  run.observationSaved = true;
  run.observationAt = capturedAt;
}

function failStage(stage, error) {
  stage.status = 'failed';
  stage.message = error instanceof Error ? error.message : String(error);
  stage.finishedAt = new Date().toISOString();
}

async function pollResearchJob(stage) {
  const current = stage.jobId ? await job(stage.jobId) : null;
  if (!current) return false;
  stage.status = current.cancelled ? 'cancelled' : current.status;
  stage.message = current.checkpoint?.logs?.at(-1) || stage.message;
  if (terminalStatus(stage.status))
    stage.finishedAt ||= new Date().toISOString();
  return terminalStatus(stage.status);
}

async function productQueries(run) {
  const products = await marketDocuments('business:products:', run.plan.market);
  return [
    ...new Set(
      [
        ...products
          .filter(
            (record) =>
              ['tiktok_shop', 'TikTok Shop'].includes(
                record.sourcePlatform || record.source,
              ) &&
              Date.parse(record.lastCollectedAt || record.updatedAt || 0) >=
                Date.parse(run.startedAt),
          )
          .toSorted(
            (a, b) =>
              Number(b.sourceMetrics?.reportedSales || b.sales || 0) -
              Number(a.sourceMetrics?.reportedSales || a.sales || 0),
          )
          .map((record) => record.title),
        ...run.plan.seeds,
      ].filter(Boolean),
    ),
  ].slice(0, run.plan.budgets.maxContentQueries);
}

async function advanceStage(run, stage) {
  const plan = run.plan;
  if (stage.status === 'queued' || stage.status === 'running') {
    if (stage.key === 'tiktok_content') {
      const current = stage.jobId && (await read(`content:job:${stage.jobId}`));
      if (current && !terminalStatus(current.status)) {
        stage.status = current.status;
        stage.message = current.steps?.at(-1)?.message || stage.message;
        return;
      }
      if (current) {
        stage.itemIds = [
          ...new Set([...(stage.itemIds || []), ...(current.itemIds || [])]),
        ];
        if (['cancelled', 'failed', 'partial'].includes(current.status))
          stage.failures = (stage.failures || 0) + 1;
        stage.queryIndex = (stage.queryIndex || 0) + 1;
        stage.jobId = '';
      }
      const queries =
        stage.queries || (stage.queries = await productQueries(run));
      if ((stage.queryIndex || 0) >= queries.length) {
        stage.status = stage.failures ? 'partial' : 'completed';
        stage.finishedAt = new Date().toISOString();
        stage.message = `完成${queries.length}个商品词检索，保存${stage.itemIds?.length || 0}条内容`;
        return;
      }
      const requestId = marketChildRequestId(
        run.id,
        stage.key,
        stage.queryIndex || 0,
      );
      const result = await publicContentAction(
        {
          action: 'server_content_submit',
          requestId,
          input: {
            query: queries[stage.queryIndex || 0],
            market: plan.market,
            language: plan.language,
            sources: ['tiktok'],
            scopes: ['local'],
            limit: plan.budgets.contentPerQuery,
            includeRelated: false,
            organize: false,
            fetchDetails: true,
            keywordIds: plan.keywordIds.slice(0, 20),
          },
        },
        { id: run.userId, role: 'admin' },
      );
      stage.jobId = result.job.id;
      stage.status = 'queued';
      stage.message = `检索 ${stage.queryIndex + 1}/${queries.length}：${queries[stage.queryIndex]}`;
      return;
    }
    await pollResearchJob(stage);
    return;
  }

  stage.startedAt = new Date().toISOString();
  if (stage.key === 'tiktok_shop') {
    const result = await submitPlatformProducts({
      requestId: marketChildRequestId(run.id, stage.key),
      terms: plan.seeds.join('\n'),
      market: plan.market,
      providers: ['tiktok_shop'],
      maxProducts: plan.budgets.maxProducts,
      perKeyword: plan.budgets.perKeyword,
      maxDetailProducts: Math.min(plan.budgets.maxProducts, 100),
      maxDomains: 3,
      semrushUnitLimit: 0,
      trend: false,
      enrich: true,
      completeAll: true,
    });
    stage.jobId = result.id;
    stage.status = result.status;
    return;
  }
  if (stage.key === 'tiktok_content') {
    stage.status = 'queued';
    stage.queryIndex = 0;
    stage.itemIds = [];
    await advanceStage(run, stage);
    return;
  }
  if (stage.key === 'tiktok_comments') {
    const content = run.stages.find((item) => item.key === 'tiktok_content');
    const items = await Promise.all(
      (content?.itemIds || []).map((id) => read(`content:item:${id}`)),
    );
    const urls = [
      ...new Set(
        items
          .filter(Boolean)
          .map((item) => item.url)
          .filter((url) => /tiktok\.com/i.test(url)),
      ),
    ].slice(0, plan.budgets.commentVideos);
    if (urls.length === 0) {
      stage.status = 'completed';
      stage.message = '未发现可抓评论的TikTok公开视频链接';
      stage.finishedAt = new Date().toISOString();
      return;
    }
    const result = await submitInsight({
      requestId: marketChildRequestId(run.id, stage.key),
      kind: 'consumer_research',
      sourceKind: 'tiktok_comments',
      market: plan.market,
      title: `${plan.market} 商品相关TikTok评论样本`,
      urls: urls.join('\n'),
      maxPages: plan.budgets.commentPages,
      limit: 1000,
      keywordIds: plan.keywordIds.slice(0, 30),
      siteIds: [],
      productIds: [],
      analyze: false,
    });
    stage.jobId = result.id;
    stage.status = result.status;
    return;
  }
  if (stage.key === 'meta_ads') {
    const result = await submitMarketJob({
      requestId: marketChildRequestId(run.id, stage.key),
      kind: 'ads',
      keywordIds: plan.keywordIds,
      maxPages: plan.budgets.adPages,
      maxAds: plan.budgets.maxAdsPerKeyword,
      maxSites: 10,
      siteSearchPages: 1,
      includeSearchSites: true,
      adStatus: 'ACTIVE',
    });
    stage.jobId = result.id;
    stage.status = result.status;
    return;
  }
  if (stage.key === 'site_products') {
    const sites = (
      await marketDocuments('business:sites:', plan.market)
    ).filter(
      (site) =>
        (site.keywordIds || []).some((id) => plan.keywordIds.includes(id)) ||
        Date.parse(site.lastCollectedAt || site.updatedAt || 0) >=
          Date.parse(run.startedAt),
    );
    const ids = [
      ...new Set(sites.map((site) => site.id).filter(Boolean)),
    ].slice(0, 100);
    if (ids.length === 0) {
      stage.status = 'completed';
      stage.message = '本轮未发现可继续采集的独立站';
      stage.finishedAt = new Date().toISOString();
      return;
    }
    const result = await submitProducts(
      {
        requestId: marketChildRequestId(run.id, stage.key),
        siteIds: ids,
        maxProducts: plan.budgets.siteProducts,
        maxDetailProducts: Math.min(
          plan.budgets.siteDetailProducts,
          plan.budgets.siteProducts,
        ),
        maxPagesPerSite: 120,
        maxPaidRequests: 0,
        maxBrowserPages: 0,
      },
      { id: run.userId, role: 'admin' },
    );
    stage.jobId = result.id;
    stage.status = result.status;
  }
}

async function updateRun(run) {
  if (!['queued', 'running'].includes(run.status)) return;
  run.status = 'running';
  const stage = run.stages.find((item) => !terminalStatus(item.status));
  if (!stage) {
    const failed = run.stages.filter((item) => item.status !== 'completed');
    run.status = failed.length > 0 ? 'partial' : 'completed';
    run.finishedAt = new Date().toISOString();
    run.message =
      failed.length > 0
        ? `${failed.length}个阶段未完整完成；其他已采集数据保留`
        : '国家市场采集计划已完成';
    await captureObservation(run);
    return;
  }
  try {
    await advanceStage(run, stage);
  } catch (error) {
    if (
      /已有5项公共内容任务|正在提交|后台已有20个任务|正在执行|正在采集|正在排队/.test(
        error.message,
      )
    ) {
      stage.status = stage.jobId ? 'queued' : 'pending';
      stage.message = '采集队列繁忙，稍后自动继续';
    } else failStage(stage, error);
  }
  run.updatedAt = new Date().toISOString();
}

async function withMarketLock(work) {
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'market-research');
    if (!held) throw new Error('国家市场计划正在处理，请稍后重试');
    return await work();
  } finally {
    if (held) await unlock(c, 'market-research');
    c.release();
  }
}

export const tickMarketResearch = () => withMarketLock(tickRuns);

async function tickRuns() {
  const { rows } = await pool.query(
    sql(
      "SELECT name,value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND value->>'status' IN ('queued','running') ORDER BY value->>'startedAt' LIMIT 10",
      "SELECT name,value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.status')) IN ('queued','running') ORDER BY JSON_UNQUOTE(JSON_EXTRACT(value,'$.startedAt')) LIMIT 10",
    ),
  );
  for (const row of rows) {
    await updateRun(row.value);
    await write(row.name, row.value);
  }
}

export async function marketResearchAction(input, user) {
  if (
    ![
      'server_market_collection_status',
      'server_market_collection_save',
      'server_market_collection_run',
      'server_market_collection_cancel',
    ].includes(input.action)
  )
    throw new Error('不支持的国家市场操作');
  return input.action === 'server_market_collection_status'
    ? handleMarketAction(input, user)
    : withMarketLock(() => handleMarketAction(input, user));
}

async function handleMarketAction(input, user) {
  if (input.action === 'server_market_collection_save') {
    requireAdmin(user);
    const plan = validateMarketPlan(input.plan);
    const records = await keywordRecords(plan.keywordIds, plan.market);
    if (records.length !== plan.keywordIds.length)
      throw new Error('部分关联关键词不存在、未入选或国家不一致，请刷新后重试');
    await write(`${PLAN}${plan.market}`, {
      ...plan,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
    });
  }
  if (input.action === 'server_market_collection_run') {
    requireAdmin(user);
    const plan = validateMarketPlan(
      input.plan || (await read(`${PLAN}${input.market}`)),
    );
    const records = await keywordRecords(plan.keywordIds, plan.market);
    if (records.length !== plan.keywordIds.length)
      throw new Error('部分关联关键词不存在、未入选或国家不一致，请刷新后重试');
    const active = (
      await pool.query(
        sql(
          "SELECT value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND value->>'status' IN ('queued','running')",
          "SELECT value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.status')) IN ('queued','running')",
        ),
      )
    ).rows.map((row) => row.value);
    if (active.some((run) => run.plan.market === plan.market))
      throw new Error('该国家已有运行中的采集计划，请等待完成或取消后再提交');
    if (active.length >= 10)
      throw new Error('已有10个国家采集计划，请稍后提交');
    const id = randomUUID();
    const now = new Date().toISOString();
    const run = {
      id,
      plan,
      userId: user.id,
      status: 'queued',
      startedAt: now,
      updatedAt: now,
      stages: marketRunStages(plan),
    };
    await write(`${RUN}${id}`, run);
    return { run };
  }
  if (input.action === 'server_market_collection_cancel') {
    requireAdmin(user);
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.runId || ''))
      throw new Error('采集运行编号无效');
    const name = `${RUN}${input.runId}`;
    const run = await read(name);
    if (!run) throw new Error('采集运行不存在');
    for (const stage of run.stages) {
      if (stage.jobId && ['queued', 'running'].includes(stage.status)) {
        // oxlint-disable-next-line unicorn/prefer-ternary -- The two branches call different asynchronous stores.
        if (stage.key === 'tiktok_content')
          await publicContentAction(
            { action: 'server_content_cancel', jobId: stage.jobId },
            user,
          ).catch(() => {});
        else
          await pool.query(
            "UPDATE research_jobs SET cancelled=true,status='cancelled',updated_at=now() WHERE id=$1 AND status IN ('queued','running')",
            [stage.jobId],
          );
      }
      if (!terminalStatus(stage.status)) {
        stage.status = 'cancelled';
        stage.finishedAt = new Date().toISOString();
      }
    }
    run.status = 'cancelled';
    run.finishedAt = new Date().toISOString();
    run.message = '采集计划已取消；此前保存的数据保留';
    await write(name, run);
    return { run };
  }
  const market = ['MX', 'US', 'VN'].includes(input.market)
    ? input.market
    : 'VN';
  const [plan, readiness, rows] = await Promise.all([
    read(`${PLAN}${market}`),
    sourceReadiness(),
    pool.query(
      sql(
        "SELECT value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND value->'plan'->>'market'=$1 ORDER BY value->>'startedAt' DESC LIMIT 10",
        "SELECT value FROM workspace_documents WHERE name LIKE 'market:collection:run:%' AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.plan.market'))=$1 ORDER BY JSON_UNQUOTE(JSON_EXTRACT(value,'$.startedAt')) DESC LIMIT 10",
      ),
      [market],
    ),
  ]);
  return {
    plan: plan || defaultMarketPlan(market),
    readiness,
    runs: rows.rows.map((row) => row.value),
  };
}
