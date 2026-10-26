import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

import { lock, unlock, sql } from './database.mjs';
import { naturalKey, normalizeTerm } from './domain.mjs';
import { assessKeyword, classifyKeyword } from './model.js';
import { jobProgress, runnableJob } from './job-progress.mjs';
import { collect, pool, saveCheckpoint, saveKeyword, usage } from './store.mjs';

import { runEnrichment, patchCollection } from './enrichment-jobs.mjs';
import { runMarketJob } from './market-jobs.mjs';
import { runSemrushSitesJob } from './semrush-sites-store.mjs';
import { runInsightJob } from './insight-jobs.mjs';
import { runProductsJob } from './product-jobs.mjs';
import { initializeTrendQueue, runTrendJob } from './trend-queue.mjs';
import { productProgress } from './product-queue.mjs';
import { runPlatformProducts } from './platform-products-jobs.mjs';
import { completionProgress } from './platform-product-completion.mjs';
import { tickDailyDiscovery } from './daily-discovery.mjs';
import { tickMarketResearch } from './market-research.mjs';
import { runMarketReport } from './market-report-jobs.mjs';
import { runPersonaResearch } from './persona-research-store.mjs';
import { resourceResumeAllowed } from './product-resource-domain.mjs';
const label = { US: '美国', MX: '墨西哥', VN: '越南' };
export function jobTasks(job) {
  if (job.input.kind === 'semrush_sites') return job.input.markets.map((market) => ({
    id: `${job.id}:${market}`, cloudJobId: job.id, market, mode: 'live', stage: 'sites',
    title: `云端 · Semrush付费流量独立站发现 · ${label[market]}`,
    status: job.cancelled ? 'cancelled' : job.status,
    created: job.checkpoint.submittedAt || new Date(job.created_at).toISOString(),
    steps: [`关键词${Math.min(job.checkpoint.index || 0, job.input.seeds.length)}/${job.input.seeds.length}；站点${job.checkpoint.sites || 0}家；已确认${job.checkpoint.semrushUnits || 0} API units；预留${job.checkpoint.semrushReserved || 0}（不限积分）`, ...(job.checkpoint.logs || [])],
    collectionProgress: { kind: 'semrush_sites', done: job.checkpoint.index || 0, total: job.input.seeds.length,
      current: job.checkpoint.currentTerm || '', sites: job.checkpoint.sites || 0, ads: 0,
      requests: job.checkpoint.requests || 0, semrushUnits: job.checkpoint.semrushUnits || 0,
      requestLimit: job.input.seeds.length * job.input.maxPages,
      unknownCharges: job.checkpoint.unknownCharges || 0 },
  }));
  if (
    [
      'consumer_research',
      'ad_analysis',
      'evidence_analysis',
      'market_analysis',
      'persona_research',
      'products',
      'platform_products',
    ].includes(job.input.kind)
  ) {
    const names = {
      consumer_research: '消费者需求采集',
      ad_analysis: '广告拆解与分析',
      evidence_analysis: '需求语义分析',
      market_analysis: '国家市场商品与消费者分析',
      persona_research: '人群画像需求研究',
      products: '站点商品采集',
      platform_products:
        job.input.resourceCategories ? '平台真实类目查询' : job.input.resourceDiscovery ? '商品资源路径采集' : job.input.discoveryDay ? '每日关键词商品发现' : job.input.mode === 'enrich'
          ? '已有商品全量补全'
          : '平台商品发现与趋势补全',
    };
    return job.input.markets.map((market) => ({
      id: `${job.id}:${market}`,
      cloudJobId: job.id,
      market,
      mode: 'live',
      stage: ['products', 'platform_products'].includes(job.input.kind)
        ? 'products'
        : 'sites',
      title: `云端 · ${names[job.input.kind]} · ${label[market]}`,
      status: job.cancelled ? 'cancelled' : job.status,
      created:
        job.checkpoint.submittedAt || new Date(job.created_at).toISOString(),
      steps: [
        job.input.kind === 'market_analysis'
          ? `正在冻结${job.input.period === 'week' ? '周' : job.input.period === 'quarter' ? '季度' : '月度'}市场数据并生成报告`
          : job.input.kind === 'platform_products' && job.input.completeAll
          ? `已发现商品 ${job.checkpoint.products || job.input.productIds?.length || 0} 件；发现与补全共用数据请求 ${job.checkpoint.requests || 0}/${job.input.maxRequests} 次`
          : `已采集 ${job.checkpoint.evidenceIds?.length || job.checkpoint.products || 0} 条；请求 ${job.checkpoint.requests || 0}/${job.input.maxRequests} 次`,
        ...(job.checkpoint.logs || []),
      ],
      researchProgress: {
        kind: job.input.kind,
        done: job.checkpoint.index || 0,
        total:
          job.input.kind === 'platform_products' && job.input.mode === 'enrich'
            ? (job.checkpoint.work?.length ?? job.input.initialWork?.length ?? 0)
            : job.checkpoint.work?.length ||
              job.input.records?.length ||
              job.input.urls?.length ||
              1,
        evidence: job.checkpoint.evidenceIds?.length || 0,
        products: job.checkpoint.products || 0,
        requests: job.checkpoint.requests || 0,
        requestLimit: job.input.maxRequests,
        credits: job.checkpoint.creditsCharged,
        unknownCharges: job.checkpoint.unknownCharges || 0,
        stopReason: job.checkpoint.stopReason || '',
        reportId: ['products', 'platform_products'].includes(job.input.kind)
          ? ''
          : job.id,
        ...(job.input.kind === 'platform_products'
          ? {
              completion: job.input.completeAll
                ? completionProgress(job.checkpoint)
                : undefined,
              unlimitedRequests: false,
              semrushUnits: job.checkpoint.semrushUnits || 0,
              semrushReserved: job.checkpoint.semrushReserved || 0,
              semrushUnitLimit: 0,
              current: job.checkpoint.currentTerm || '',
              ...(job.input.resourceDiscovery ? {
                resource: { ...job.checkpoint.resourceProgress, budget: job.input.resourcePlan.budget, resumable: resourceResumeAllowed(job) },
                credits: job.checkpoint.confirmedUsage?.scrapeCredits,
                semrushUnits: job.checkpoint.confirmedUsage?.semrushUnits,
                semrushReserved: job.checkpoint.reserved?.semrushUnits,
                stopReason: (job.checkpoint.stopReasons || []).map((s) => s.message).join('；'),
              } : {}),
            }
          : {}),
        transcriptSummary: job.checkpoint.transcriptSummary,
        ...(job.input.kind === 'products' &&
        job.checkpoint.productQueueVersion === 2
          ? productProgress(job.checkpoint, job.input)
          : {}),
      },
    }));
  }
  if (['ads', 'site_metrics'].includes(job.input.kind))
    return job.input.markets.map((market) => ({
      id: `${job.id}:${market}`,
      cloudJobId: job.id,
      market,
      mode: 'live',
      stage: 'sites',
      title: `云端 · ${job.input.kind === 'ads' ? (job.input.discoveryOnly ? '每日关键词广告发现' : job.input.includeSearchSites ? '广告与独立站双渠道采集' : '广告与关联独立站采集') : '独立站指标与评分'} · ${label[market]}`,
      status: job.cancelled ? 'cancelled' : job.status,
      created:
        job.checkpoint.submittedAt || new Date(job.created_at).toISOString(),
      steps: [
        job.input.kind === 'site_metrics'
          ? `已处理 ${job.checkpoint.index || 0}/${job.input.records.length} 家站点；Semrush 已确认 ${job.checkpoint.semrushUnits || 0} API units`
          : `已处理 ${job.checkpoint.index || 0}/${job.input.records.length} 个对象；广告 ${job.checkpoint.ads || 0} 条；官网 ${job.checkpoint.sites || 0} 家；广告请求 ${job.checkpoint.requests || 0}/${job.input.maxRequests} 次`,
        ...(job.checkpoint.logs || []),
      ],
      collectionProgress: {
        kind: job.input.kind,
        channels: job.checkpoint.channels,
        semrushUnits: job.checkpoint.semrushUnits || 0,
        done: job.checkpoint.index || 0,
        total: job.input.records.length,
        current: job.checkpoint.currentTerm || '',
        ads: job.checkpoint.ads || 0,
        sites: job.checkpoint.sites || 0,
        requests: job.checkpoint.requests || 0,
        requestLimit: job.input.maxRequests,
        credits: job.checkpoint.creditsCharged,
        unknownCharges: job.checkpoint.unknownCharges || 0,
      },
    }));

  if (['sites', 'metrics'].includes(job.input.kind))
    return job.input.markets.map((market) => ({
      id: `${job.id}:${market}`,
      cloudJobId: job.id,
      market,
      mode: 'live',
      stage: job.input.kind === 'sites' ? 'sites' : 'keywords',
      title: `云端 · ${job.input.kind === 'sites' ? '独立站数据采集' : 'Semrush 指标与重评'} · ${label[market]}`,
      status: job.cancelled ? 'cancelled' : job.status,
      created:
        job.checkpoint.submittedAt ||
        job.checkpoint.startedAt ||
        new Date(job.created_at).toISOString(),
      steps: [
        `进度 ${job.checkpoint.index || 0}/${job.input.records.length} 个关键词；${job.checkpoint.currentTerm || ''}`,
        ...(job.checkpoint.logs || ['已提交后台，关闭页面不影响执行']),
      ],
    }));
  const progress = jobProgress(job, assessKeyword);
  return job.input.markets.map((market) => ({
    id: `${job.id}:${market}`,
    cloudJobId: job.id,
    market,
    mode: 'live',
    stage: 'keywords',
    title: `${job.input.existingRecords ? (job.input.sources.includes('semrush') ? '云端 · 数据补齐与重评' : '云端 · 趋势补齐与重评') : '云端 · 关键词与趋势研究'} · ${label[market]}`,
    status: job.cancelled ? 'cancelled' : job.status,
    created:
      job.checkpoint.submittedAt ||
      job.checkpoint.startedAt ||
      new Date(job.created_at).toISOString(),
    progress,
    steps: job.checkpoint.logs || [
      '已保存到腾讯云，等待后台执行；关闭浏览器不影响任务',
    ],
  }));
}
async function checkCancelled(id) {
  const result = await pool.query(
    'SELECT cancelled FROM research_jobs WHERE id=$1',
    [id],
  );
  if (!result.rows[0] || result.rows[0].cancelled)
    throw new Error('任务已取消；已获取的结果保留');
}
export async function runJob(job, overrides = {}) {
  const io = {
    collect,
    patchCollection,
    saveCheckpoint,
    saveKeyword,
    usage,
    checkCancelled,
    now: () => Date.now(),
    ...overrides,
  };
  const input = job.input;
  const cp = {
    discoveryIndex: 0,
    trendIndex: 0,
    metricIndex: 0,
    keywords: [],
    logs: ['任务在腾讯云后台执行；本阶段只研究关键词、趋势与评分'],
    failures: 0,
    ...job.checkpoint,
  };
  cp.startedAt ||= new Date(io.now()).toISOString();
  if (Number(cp.nextRunAt) > io.now()) return;
  cp.nextRunAt = 0;
  const add = async (term, market, seed, source, collectedAt) => {
    term = normalizeTerm(term);
    let record = cp.keywords.find(
      (item) => naturalKey(item) === naturalKey({ term, market }),
    );
    if (record)
      record.source = [
        ...new Set([...record.source.split(' / '), ...source.split(' / ')]),
      ].join(' / ');
    else {
      if (cp.keywords.length >= input.limit) return;
      record = {
        id: randomUUID(),
        term,
        market,
        seedTerm: seed,
        source,
        collectedAt,
        updatedAt: collectedAt,
        category: classifyKeyword(term, seed),
        growth: null,
        series: [],
        trendStatus: 'pending',
        trendMessage: '等待后台采集一年趋势',
        favorite: false,
        reviewStatus: 'pending',
        productIds: [],
        siteIds: [],
        dataNature: 'collected',
      };
      cp.keywords.push(record);
    }
    const stored = await io.saveKeyword(record);
    if (stored?.id) Object.assign(record, stored);
  };
  try {
    if (!cp.initialized) {
      cp.refreshTrends = !input.existingRecords;
      if (input.existingRecords) {
        cp.keywords = input.existingRecords;
        for (const record of cp.keywords) {
          const stored = await io.saveKeyword(record);
          if (stored?.id) Object.assign(record, stored);
        }
      } else {
        for (const market of input.markets)
          for (const seed of input.seeds)
            await add(
              seed,
              market,
              seed,
              '用户种子词',
              new Date().toISOString(),
            );
      }
      cp.initialized = true;
      await io.saveCheckpoint(job, cp);
    }
    const combinations = input.markets.flatMap((market) =>
      input.seeds.map((seed) => ({ market, seed })),
    );
    if (!input.existingRecords)
      for (; cp.discoveryIndex < combinations.length; cp.discoveryIndex += 1) {
        await io.checkCancelled(job.id);
        const { seed, market } = combinations[cp.discoveryIndex];
        const remaining = input.limit - cp.keywords.length;
        if (remaining <= 0) break;
        const consumed = await io.usage(job.id);
        const paidLimit = input.sources.includes('sorftime')
          ? Math.max(
              0,
              input.sorftimeRequestLimit -
                consumed.confirmed -
                consumed.reserved,
            )
          : 0;
        const requestSources = input.sources.filter(
          (source) =>
            source !== 'semrush' && (source !== 'sorftime' || paidLimit > 0),
        );
        if (input.sources.includes('semrush')) {
          try {
            const sem = await io.collect(
              job,
              `sem-discover:${cp.discoveryIndex}`,
              {
                keywords: [seed],
                markets: [market],
                sources: ['semrush'],
                semExpansion: true,
                limit: Math.ceil(
                  remaining /
                    (combinations.length - cp.discoveryIndex) /
                    (requestSources.length ? 2 : 1),
                ),
              },
            );
            cp.semUnits = (cp.semUnits || 0) + (sem.apiUnits || 0);
            for (const group of sem.suggestions || []) {
              for (const item of group.items)
                await add(
                  item.term,
                  market,
                  seed,
                  item.source,
                  sem.generatedAt,
                );
              for (const source of group.sources || []) {
                cp.logs.push(
                  `${seed} · ${source.source}：${source.count}个词；${source.message}`,
                );
                if (source.status === 'error') cp.failures++;
              }
            }
          } catch (e) {
            cp.logs.push(`${seed} · Semrush 扩词失败：${e.message}`);
            cp.failures++;
          }
        }
        if (requestSources.length === 0 && !input.sources.includes('semrush')) {
          cp.logs.push(`${seed}：Sorftime任务额度已用完，未额外调用`);
          cp.failures += 1;
        } else if (requestSources.length && cp.keywords.length < input.limit)
          try {
            cp.currentTerm = seed;
            await io.saveCheckpoint(job, cp);
            const result = await io.collect(
              job,
              `discover:${cp.discoveryIndex}`,
              {
                keywords: [seed],
                markets: [market],
                sources: requestSources,
                depth: input.depth,
                limit: Math.ceil(
                  remaining / (combinations.length - cp.discoveryIndex),
                ),
                sorftimeRequestLimit: paidLimit,
              },
            );
            for (const group of result.suggestions || []) {
              for (const item of group.items)
                await add(
                  item.term,
                  market,
                  seed,
                  item.source,
                  result.generatedAt,
                );
              for (const source of group.sources || []) {
                cp.logs.push(
                  `${label[market]} · ${seed} · ${source.source}：${source.count}个词；${source.message || source.status}`,
                );
                if (['error', 'partial'].includes(source.status))
                  cp.failures += 1;
              }
            }
          } catch (error) {
            cp.logs.push(`${seed}：关键词发现失败；${error.message}`);
            cp.failures += 1;
          }
        // Cursor and results commit together after each completed discovery stage.
        await io.saveCheckpoint(job, {
          ...cp,
          discoveryIndex: cp.discoveryIndex + 1,
        });
      }
    cp.discoveryComplete = true;
    if (input.sources.includes('semrush')) {
      for (; cp.metricIndex < cp.keywords.length; cp.metricIndex++) {
        await io.checkCancelled(job.id);
        const r = cp.keywords[cp.metricIndex];
        cp.currentTerm = r.term;
        await io.saveCheckpoint(job, cp);
        await io.patchCollection(r.id, 'semrushCollection', {
          jobId: job.id,
          status: 'queued',
          message: '等待 Semrush 指标查询',
        });
        try {
          if (cp.semBlocked) throw new Error(cp.semBlocked);
          const result = await io.collect(job, `sem-metric:${cp.metricIndex}`, {
            keywords: [r.term],
            markets: [r.market],
            sources: ['semrush'],
          });
          cp.semUnits = (cp.semUnits || 0) + (result.apiUnits || 0);
          if (result.metrics) r.metrics = result.metrics;
          r.semrushCollection = {
            jobId: job.id,
            status: result.metrics
              ? result.complete === false
                ? 'partial'
                : 'completed'
              : 'empty',
            count: result.metrics ? 1 : 0,
            apiUnits: result.apiUnits,
            message: result.message,
            finishedAt: new Date().toISOString(),
          };
          await io.patchCollection(
            r.id,
            'semrushCollection',
            r.semrushCollection,
            result.metrics ? { metrics: result.metrics } : {},
          );
          cp.logs.push(`${r.term} · Semrush：${result.message}`);
        } catch (e) {
          cp.failures++;
          cp.semBlocked =
            'Semrush 报告异常，已停止后续指标调用，请先查看首条错误';
          r.semrushCollection = {
            jobId: job.id,
            status: 'failed',
            message: e.message,
          };
          await io.patchCollection(
            r.id,
            'semrushCollection',
            r.semrushCollection,
          );
          cp.logs.push(`${r.term} · Semrush：${e.message}`);
        }
        await io.saveCheckpoint(job, {
          ...cp,
          metricIndex: cp.metricIndex + 1,
        });
      }
    }

    await io.checkCancelled(job.id);
    const consumed = await io.usage(job.id);
    cp.logs.push(
      `已输出${cp.keywords.length}个关键词，趋势已交由独立队列逐项补齐；其他业务可继续执行`,
      `Sorftime已确认${consumed.confirmed}次；结果未知并预留${consumed.reserved}次，未自动重复付费请求`,
    );
    cp.upstreamFailures = cp.failures;
    await io.saveCheckpoint(job, initializeTrendQueue(cp, io.now(), input.trendComparisonVersion));
  } catch (error) {
    let cancelled = false;
    try {
      await io.checkCancelled(job.id);
    } catch {
      cancelled = true;
    }
    cp.logs.push(error.message);
    cp.finishedAt = new Date(io.now()).toISOString();
    await io.saveCheckpoint(job, cp, cancelled ? 'cancelled' : 'partial');
  }
}
async function runLane(signal, trends = false) {
  const lockName = trends ? 'trend-runner' : 'runner';
  while (!signal.aborted) {
    let connection,
      acquired = false,
      lostConnection;
    try {
      connection = await pool.connect();
      acquired = await lock(connection, lockName);
      if (acquired) {
        // The session lock prevents overlapping runners during deployment/restart.
        // A lost session invalidates the runner lock; terminate to prevent overlapping collectors.
        // oxlint-disable-next-line unicorn/no-process-exit
        lostConnection = () => process.exit(1);
        connection.on('error', lostConnection);
        if (!trends) {
          await tickDailyDiscovery().catch((error) => {
            console.error('Daily discovery unavailable:', error.code || error.name);
          });
          await tickMarketResearch().catch((error) => {
            console.error('Market research orchestration unavailable:', error.code || error.name);
          });
        }
        const { rows } = await pool.query(
          sql(
            `SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false AND COALESCE(checkpoint->>'trendQueueVersion','0') ${trends ? '=' : '<>'} '1' AND CAST(COALESCE(checkpoint->>'nextRunAt','0') AS BIGINT) <= $1 ORDER BY updated_at LIMIT 20`,
            `SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(checkpoint,'$.trendQueueVersion')),'0') ${trends ? '=' : '<>'} '1' AND CAST(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(checkpoint,'$.nextRunAt')),'0') AS UNSIGNED) <= $1 ORDER BY updated_at LIMIT 20`,
          ),
          [Date.now()],
        );
        const next = runnableJob(rows);
        if (next) {
          await pool.query(
            "UPDATE research_jobs SET status='running',updated_at=now() WHERE id=$1",
            [next.id],
          );
          if (trends) await runTrendJob(next);
          else if (
            ['consumer_research', 'ad_analysis', 'evidence_analysis'].includes(
              next.input.kind,
            )
          )
            await runInsightJob(next);
          else if (next.input.kind === 'persona_research')
            await runPersonaResearch(next);
          else if (next.input.kind === 'market_analysis')
            await runMarketReport(next);
          else if (next.input.kind === 'semrush_sites') await runSemrushSitesJob(next);
          else if (next.input.kind === 'products') await runProductsJob(next);
          else if (next.input.kind === 'platform_products')
            await runPlatformProducts(next);
          else if (['ads', 'site_metrics'].includes(next.input.kind))
            await runMarketJob(next);
          else if (['sites', 'metrics'].includes(next.input.kind))
            await runEnrichment(next);
          else await runJob(next);
        }
      }
    } catch (error) {
      console.error('Queue unavailable:', error.code || error.name);
    } finally {
      if (acquired) await unlock(connection, lockName).catch(() => {});
      if (lostConnection) connection.removeListener('error', lostConnection);
      connection?.release();
    }
    await sleep(1500, undefined, { signal }).catch(() => {});
  }
}

export async function runQueue(signal) {
  await Promise.all([runLane(signal), runLane(signal, true)]);
}
