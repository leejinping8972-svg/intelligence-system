import { randomUUID } from 'node:crypto';
import { pool, putDocument, lock, unlock } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { openAdsKey, scrapeRequest } from './ads-provider.mjs';
import { normalizeAdTranscript, transcriptSummary } from './ad-transcript.mjs';
import { currentAdPrompt } from './report-prompts.mjs';
import { currentAiPrompt } from './ai-prompt-config.mjs';
import { consumerTopics, insightSummary } from './consumer-topics.mjs';
import { readReportSummaries } from './report-read-summaries.mjs';
import { sampleRedditComments } from './consumer-comment-sample.mjs';
import {
  sourceKinds,
  sourceUrl,
  normalizeEvidence,
  evidenceReport,
  adEvidence,
} from './research-evidence.mjs';
const read = async (key) =>
  (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:${key}`,
    ])
  ).rows[0]?.value;
export async function collectAdTranscript(request) {
  if (!/^\d+$/.test(String(request.id))) throw new Error('广告缺少有效平台 ID');
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [
      'provider:scrapecreators:v1',
    ])
  ).rows[0]?.value;
  if (!stored) throw new Error('请先配置 ScrapeCreators API Key');
  const data = await scrapeRequest(
    '/v1/facebook/adLibrary/ad/transcript',
    { id: request.id, allow_long_transcription: false },
    openAdsKey(stored),
    fetch,
    'GET',
  );
  return normalizeAdTranscript(data);
}
export async function collectSocialPage(request) {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [
      'provider:scrapecreators:v1',
    ])
  ).rows[0]?.value;
  if (!stored) throw new Error('请先配置 ScrapeCreators API Key');
  const spec = sourceKinds[request.kind];
  const params =
    request.kind === 'reddit_search'
      ? {
          query: request.query,
          filter: 'posts',
          sort: 'relevance',
          timeframe: 'year',
          ...(request.cursor ? { after: request.cursor } : {}),
        }
      : {
          url: request.url,
          ...(request.cursor
            ? {
                [request.kind === 'youtube_comments'
                  ? 'continuationToken'
                  : 'cursor']: request.cursor,
              }
            : {}),
        };
  return normalizeEvidence(
    await scrapeRequest(spec.path, params, openAdsKey(stored), fetch, 'GET'),
    request,
  );
}
export function validateInsight(input) {
  if (!['US', 'MX', 'VN'].includes(input.market))
    throw new Error('请选择美国、墨西哥或越南');
  const value = {
    kind: input.kind,
    market: input.market,
    markets: [input.market],
    title: String(input.title || '消费者需求研究')
      .trim()
      .slice(0, 160),
    analyze: input.analyze === true,
    researchFocus: String(input.researchFocus || '')
      .trim()
      .slice(0, 2000),
    maxRequests: Number(input.maxRequests ?? 10),
    maxPages: Number(input.maxPages ?? 2),
    limit: Number(input.limit ?? 200),
    keywordIds: input.keywordIds || [],
    siteIds: input.siteIds || [],
    productIds: input.productIds || [],
  };
  for (const [key, max] of [
    ['maxRequests', 100],
    ['maxPages', 10],
    ['limit', 1000],
  ])
    if (!Number.isInteger(value[key]) || value[key] < 1 || value[key] > max)
      throw new Error('请求1～100次、每来源1～10页、证据1～1000条');
  for (const key of ['keywordIds', 'siteIds', 'productIds'])
    if (
      !Array.isArray(value[key]) ||
      value[key].length > 30 ||
      value[key].some((id) => typeof id !== 'string' || id.length > 160)
    )
      throw new Error('关联对象格式不正确');
  if (input.kind === 'ad_analysis') {
    if (
      !Array.isArray(input.adIds) ||
      !input.adIds.length ||
      input.adIds.length > 100 ||
      input.adIds.some((id) => typeof id !== 'string' || id.length > 160)
    )
      throw new Error('每次分析1～100条广告');
    value.adIds = [...new Set(input.adIds)];
    value.title = String(input.title || '广告策略分析').slice(0, 160);
    value.fetchTranscript = input.fetchTranscript === true;
  } else if (input.kind === 'consumer_research') {
    if (!Object.hasOwn(sourceKinds, input.sourceKind))
      throw new Error('请选择支持的公开数据来源');
    value.sourceKind = input.sourceKind;
    value.autoComments = input.sourceKind === 'reddit_search' && input.autoComments === true;
    value.maxDiscussionPosts = Number(input.maxDiscussionPosts ?? 3);
    if (!Number.isInteger(value.maxDiscussionPosts) || value.maxDiscussionPosts < 1 || value.maxDiscussionPosts > 5)
      throw new Error('评论取样帖子数需为1～5');
    value.query = String(input.query || '')
      .trim()
      .slice(0, 300);
    value.urls =
      input.sourceKind === 'reddit_search'
        ? []
        : [
            ...new Set(
              String(input.urls || '')
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean),
            ),
          ];
    if (input.sourceKind === 'reddit_search' && !value.query)
      throw new Error('请输入研究关键词');
    if (
      input.sourceKind !== 'reddit_search' &&
      (!value.urls.length ||
        value.urls.length > 20 ||
        value.urls.some(
          (u) => !sourceUrl(u, sourceKinds[input.sourceKind].hosts),
        ))
    )
      throw new Error('请填写1～20条与所选平台一致的公开 HTTPS 帖子或视频链接');
  } else if (input.kind === 'evidence_analysis') {
    if (
      typeof input.reportId !== 'string' ||
      !/^[\da-f-]{36}$/i.test(input.reportId)
    )
      throw new Error('请选择已有研究报告');
    value.reportId = input.reportId;
    value.analyze = true;
  } else throw new Error('不支持的分析任务');
  return value;
}
export async function submitInsight(input) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId))
    throw new Error('缺少任务提交编号');
  const value = validateInsight(input),
    c = await pool.connect();
  let locked = false;
  try {
    locked = await lock(c, 'insight-submit');
    if (!locked) throw new Error('正在提交，请稍后重试');
    const duplicate = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (duplicate) return duplicate;
    const active = (
      await c.query(
        "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    for (const field of ['keywordIds', 'siteIds', 'productIds'])
      for (const id of value[field]) {
        const found =
          field === 'keywordIds'
            ? (
                await c.query(
                  'SELECT data FROM research_keywords WHERE natural_key IS NOT NULL',
                )
              ).rows.some((r) => r.data.id === id && r.data.market === value.market)
            : await read(`${field === 'siteIds' ? 'sites' : 'products'}:${id}`);
        if (!found) throw new Error('关联对象已不存在，请刷新重新选择');
      }
    if (value.kind === 'ad_analysis') {
      value.analysisKind = 'ad_analysis';
      value.records = [];
      for (const id of value.adIds) {
        const ad = await read(`ads:${id}`);
        if (!ad || ad.market !== value.market)
          throw new Error('所选广告已删除或不属于目标市场');
        value.records.push(ad);
      }
    }
    if (value.kind === 'evidence_analysis') {
      const report = await read(`insightReports:${value.reportId}`);
      if (
        !report ||
        report.market !== value.market ||
        !report.evidenceIds?.length
      )
        throw new Error('该报告没有可分析证据');
      value.evidenceIds = report.evidenceIds;
      value.keywordIds = report.keywordIds || [];
      value.siteIds = report.siteIds || [];
      value.productIds = report.productIds || [];
      value.title = String(input.title || `${report.title} · 语义重评`)
        .trim()
        .slice(0, 160);
      value.analysisKind =
        report.kind === 'ad_analysis' || report.reportType === 'ad'
          ? 'ad_analysis'
          : 'consumer_research';
      value.parentReportId = report.id;
      // Preserve immutable original evidence; don't search ads or transcribe again.
    }
    if (value.analysisKind === 'ad_analysis' && value.analyze)
      value.prompt = await currentAdPrompt();
    else if (value.analyze) value.prompt = await currentAiPrompt('consumer_report');
    if (
      value.analyze &&
      !(
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:analysis:v1',
        ])
      ).rows.length
    )
      throw new Error('请先配置语义分析模型，或关闭生成模型报告选项');
    if (
      (value.kind === 'consumer_research' || value.fetchTranscript) &&
      !(
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [
          'provider:scrapecreators:v1',
        ])
      ).rows.length
    )
      throw new Error('请先配置 ScrapeCreators API Key');
    const id = randomUUID();
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, input.requestId, value, { submittedAt: new Date().toISOString() }],
    );
    await putDocument('workspace_documents', `business:insightReports:${id}`, {
      id,
      kind: value.analysisKind === 'ad_analysis' ? 'ad_analysis' : value.kind,
      reportType: value.analysisKind === 'ad_analysis' ? 'ad' : 'consumer',
      title: value.title,
      market: value.market,
      status: 'queued',
      createdAt: new Date().toISOString(),
      evidenceIds: [],
      keywordIds: value.keywordIds,
      siteIds: value.siteIds,
      productIds: value.productIds,
      parentReportId: value.parentReportId,
      prompt: value.prompt,
      researchFocus: value.researchFocus,
      message: '等待后台分析',
    });
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } finally {
    if (locked) await unlock(c, 'insight-submit');
    c.release();
  }
}
export async function insightSnapshot(input = {}) {
  const summarize = report => report.listSummary ? report : insightSummary(report);
  let reports = input.summary || input.paginated || input.latestByKeyword ? await readReportSummaries(pool) : (
    await pool.query(
      "SELECT value,revision FROM workspace_documents WHERE name LIKE 'business:insightReports:%'",
    )
  ).rows
    .map((r) => ({ ...r.value, revision: r.revision }));
  reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (input.kind === 'consumer') reports = reports.filter((r) => r.kind !== 'ad_analysis' && r.reportType !== 'ad');
  if (input.reportType && input.reportType !== 'ALL')
    reports = reports.filter(
      (r) =>
        (r.reportType ||
          (r.kind === 'market_analysis' ? 'market' : 'consumer')) ===
        input.reportType,
    );
  if (input.productId) reports = reports.filter((r) => r.productIds?.includes(input.productId));
  if (input.keywordId) reports = reports.filter((r) => r.keywordIds?.includes(input.keywordId));
  if (input.latestByKeyword) {
    if (!Array.isArray(input.keywordIds) || input.keywordIds.length > 2000) throw new Error('关键词筛选范围过大');
    const wanted = new Set(input.keywordIds), seen = new Set();
    reports = reports.filter((r) => {
      const ids = (r.keywordIds || []).filter((id) => wanted.has(id) && !seen.has(id));
      ids.forEach((id) => seen.add(id));
      return ids.length > 0;
    });
    return { reports: reports.map(summarize) };
  }
  const topicOptions = [...new Set(reports.flatMap((r) => (r.topicSummary || consumerTopics(r)).map((t) => t.label)))].sort();
  const keywordIds = [...new Set(reports.flatMap((r) => r.keywordIds || []))];
  if (!input.paginated)
    return {
      reports: input.summary
        ? reports.slice(0, 200).map(summarize)
        : reports.slice(0, 200),
    };
  if (input.kind === 'ad')
    reports = reports.filter(
      (r) => r.kind === 'ad_analysis' || r.reportType === 'ad',
    );
  if (input.market && input.market !== 'ALL')
    reports = reports.filter((r) => r.market === input.market);
  const query = String(input.search || '')
    .toLowerCase()
    .slice(0, 160);
  if (query)
    reports = reports.filter((r) =>
      `${r.title} ${r.id} ${(r.topicSummary || consumerTopics(r)).map((t) => t.label).join(' ')}`.toLowerCase().includes(query),
    );
  if (input.status && input.status !== 'ALL')
    reports = reports.filter((r) => r.status === input.status);
  if (input.topic) reports = reports.filter((r) => (r.topicSummary || consumerTopics(r)).some((t) => t.label === input.topic));
  if (input.review && input.review !== 'ALL') reports = reports.filter((r) => (r.reviewStatus || 'pending') === input.review);
  const total = reports.length,
    page = Math.max(1, Math.floor(Number(input.page) || 1)),
    pageSize = Math.max(
      1,
      Math.min(100, Math.floor(Number(input.pageSize) || 10)),
    );
  return {
    total,
    topicOptions,
    keywordIds,
    page,
    pageSize,
    reports: reports
      .slice((page - 1) * pageSize, page * pageSize)
      .map(summarize),
  };
}
export async function insightDetails(input) {
  const row = (
    await pool.query(
      'SELECT value,revision FROM workspace_documents WHERE name=$1',
      [`business:insightReports:${String(input.reportId).slice(0, 50)}`],
    )
  ).rows[0];
  const report = row && { ...row.value, revision: row.revision };
  if (!report) throw new Error('研究报告不存在');
  const ids = report.evidenceIds || [];
  const records = new Map();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const names = ids
      .slice(offset, offset + 200)
      .map((id) => `business:researchEvidence:${id}`);
    const { rows } = await pool.query(
      `SELECT name,value FROM workspace_documents WHERE name IN (${names.map((_, index) => `$${index + 1}`).join(',')})`,
      names,
    );
    for (const row of rows)
      records.set(
        row.name.slice('business:researchEvidence:'.length),
        row.value,
      );
  }
  const evidence = ids.map((id) => records.get(id)).filter(Boolean);
  if (report.reportType !== 'ad' && report.kind !== 'ad_analysis' && !report.topicSummary) report.topicSummary = consumerTopics(report, evidence);
  return { report, evidence };
}
export async function reviewInsight(input) {
  if (!['pending', 'selected', 'excluded'].includes(input.status))
    throw new Error('人工状态无效');
  const report = await read(
    `insightReports:${String(input.reportId).slice(0, 50)}`,
  );
  if (!report) throw new Error('报告不存在');
  if (['queued', 'running'].includes(report.status))
    throw new Error('请等待分析结束后再保存人工审阅结果');
  await putDocument(
    'workspace_documents',
    `business:insightReports:${report.id}`,
    {
      ...report,
      reviewStatus: input.status,
      reviewNote: String(input.note || '').slice(0, 2000),
      reviewedAt: new Date().toISOString(),
    },
  );
  const saved = (
    await pool.query(
      'SELECT value,revision FROM workspace_documents WHERE name=$1',
      [`business:insightReports:${report.id}`],
    )
  ).rows[0];
  return { saved: true, report: { ...saved.value, revision: saved.revision } };
}
export async function runInsightJob(job, overrides = {}) {
  const io = {
    collect,
    saveCheckpoint,
    read,
    analyzeRecords: (records, kind, context) =>
      collect(job, 'model-report', {
        sources: ['semantic_analysis'],
        records,
        kind,
        context,
      }),
    put: (key, value) =>
      putDocument('workspace_documents', `business:${key}`, value),
    cancelled: async () =>
      Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      ),
    ...overrides,
  };
  const v = job.input,
    cp = {
      index: 0,
      page: 0,
      requests: 0,
      evidenceIds: [],
      logs: [],
      failures: 0,
      ...job.checkpoint,
    };
  const report = {
    id: job.id,
    kind: v.analysisKind === 'ad_analysis' ? 'ad_analysis' : v.kind,
    reportType:
      v.analysisKind === 'ad_analysis' || v.kind === 'ad_analysis'
        ? 'ad'
        : 'consumer',
    parentReportId: v.parentReportId,
    prompt: v.prompt,
    researchFocus: v.researchFocus,
    documentVersion: 2,
    title: v.title,
    market: v.market,
    keywordIds: v.keywordIds,
    siteIds: v.siteIds,
    productIds: v.productIds,
    createdAt: cp.submittedAt || new Date().toISOString(),
    status: 'running',
    evidenceIds: cp.evidenceIds,
    modelAnalysis: cp.modelAnalysis || null,
  };
  const remember = async (r) => {
    await io.put(`researchEvidence:${r.id}`, r);
    if (!cp.evidenceIds.includes(r.id)) cp.evidenceIds.push(r.id);
  };
  const check = async () => {
    if (await io.cancelled()) throw new Error('任务已取消，已有证据保留');
  };
  try {
    await io.put(`insightReports:${job.id}`, report);
    if (v.kind === 'ad_analysis') {
      cp.transcriptResults ||= {};
      for (; cp.index < v.records.length; cp.index++) {
        await check();
        const ad = v.records[cp.index];
        const r = adEvidence(ad);
        cp.transcriptResults[cp.index] = {
          status: !ad.videoUrls?.length ? 'not_video' : 'skipped',
        };
        r.id = `${job.id}-${r.id}`;
        if (
          v.fetchTranscript &&
          ad.videoUrls?.length &&
          cp.requests < v.maxRequests
        ) {
          try {
            const t = await io.collect(job, `transcript:${cp.index}`, {
              sources: ['ad_transcript'],
              id: ad.archiveId,
            });
            cp.requests++;
            cp.transcriptResults[cp.index] = {
              status: t.text ? 'collected' : 'unavailable',
            };
            cp.creditsCharged =
              (cp.creditsCharged || 0) + (t.creditsCharged ?? 0);
            if (t.creditsCharged === null)
              cp.unknownCharges = (cp.unknownCharges || 0) + 1;
            if (t.text) {
              r.text += `\n视频转写（需核对）：${t.text}`;
              r.transcript = t.text;
            } else
              cp.logs.push(
                `${ad.brand}：${t.message || '平台未返回可用转录文本；广告文案仍保留'}`,
              );
          } catch (e) {
            cp.failures++;
            cp.requests++;
            cp.transcriptResults[cp.index] = {
              status:
                e.reason === 'duration_limit' ? 'duration_limit' : 'failed',
              httpStatus: e.httpStatus,
            };
            cp.logs.push(`${ad.brand}：${e.message}`);
          }
        }
        await remember(r);
        cp.transcriptSummary = transcriptSummary(cp.transcriptResults);
        await io.saveCheckpoint(job, { ...cp, index: cp.index + 1 });
      }
    } else if (v.kind === 'evidence_analysis') cp.evidenceIds = v.evidenceIds;
    else {
      const targets = v.sourceKind === 'reddit_search' ? [null] : v.urls;
      for (; cp.index < targets.length; cp.index++) {
        for (; cp.page < v.maxPages; cp.page++) {
          await check();
          if (
            cp.requests >= v.maxRequests ||
            cp.evidenceIds.length >= v.limit
          ) {
            cp.limited = true;
            break;
          }
          const data = await io.collect(job, `social:${cp.index}:${cp.page}`, {
            sources: ['social_research'],
            kind: v.sourceKind,
            url: targets[cp.index],
            query: v.query,
            market: v.market,
            cursor: cp.cursor,
            keywordIds: v.keywordIds,
            siteIds: v.siteIds,
            productIds: v.productIds,
          });
          cp.requests++;
          cp.creditsCharged =
            (cp.creditsCharged || 0) + (data.creditsCharged ?? 0);
          if (data.creditsCharged === null)
            cp.unknownCharges = (cp.unknownCharges || 0) + 1;
          for (const r of data.records) {
            if (cp.evidenceIds.length >= v.limit) {
              cp.limited = true;
              break;
            }
            await remember(r);
          }
          cp.cursor = data.cursor;
          cp.logs.push(
            `来源${cp.index + 1} 第${cp.page + 1}页：${data.records.length}条；累计去重${cp.evidenceIds.length}条`,
          );
          await io.saveCheckpoint(job, { ...cp, page: cp.page + 1 });
          if (!cp.cursor || !data.records.length) {
            cp.page = v.maxPages;
            break;
          }
        }
        if (cp.cursor) cp.limited = true;
        cp.page = 0;
        cp.cursor = '';
        await io.saveCheckpoint(job, { ...cp, index: cp.index + 1 });
        if (cp.requests >= v.maxRequests || cp.evidenceIds.length >= v.limit)
          break;
      }
    }
    await sampleRedditComments(job, io, cp, remember, check);
    await check();
    const evidence = [];
    for (const id of cp.evidenceIds) {
      const r = await io.read(`researchEvidence:${id}`);
      if (r) evidence.push(r);
    }
    report.evidenceIds = cp.evidenceIds;
    if (v.kind === 'ad_analysis')
      report.transcriptSummary = cp.transcriptSummary;
    report.statistics = evidenceReport(
      evidence,
      report.reportType === 'ad' ? 'advertiser' : 'consumer',
    );
    if (v.analyze && evidence.length && !cp.modelAnalysis) {
      await io.put(`insightReports:${job.id}`, {
        ...report,
        message: '证据统计已保存，正在生成模型报告',
      });
      try {
        cp.modelAnalysis = await io.analyzeRecords(
          evidence,
          report.reportType === 'ad' ? 'ad_analysis' : v.kind,
          { prompt: v.prompt, researchFocus: v.researchFocus },
        );
        await io.saveCheckpoint(job, cp);
        report.modelAnalysis = cp.modelAnalysis;
      } catch (e) {
        cp.failures++;
        report.modelError = e.message;
        cp.logs.push(e.message);
      }
    }
    if (report.reportType === 'consumer') report.topicSummary = consumerTopics(report, evidence);
    report.status = cp.failures || cp.limited ? 'partial' : 'completed';
    report.message = !cp.evidenceIds.length
      ? '接口未返回可用文本；不代表没有市场需求'
      : cp.limited
        ? '已保存限定范围内的样本；达到数量、页数或请求上限，并非全量'
        : '研究范围内采集结束，等待人工审阅';
    report.requests = cp.requests;
    report.finishedAt = new Date().toISOString();
    report.creditsCharged = cp.creditsCharged;
    report.unknownCharges = cp.unknownCharges || 0;
    await io.put(`insightReports:${job.id}`, report);
    await io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date().toISOString() },
      report.status,
    );
  } catch (e) {
    const cancelled = await io.cancelled();
    report.evidenceIds = cp.evidenceIds;
    report.status = cancelled ? 'cancelled' : 'partial';
    report.message = e.message;
    await io.put(`insightReports:${job.id}`, report);
    cp.logs.push(e.message);
    await io.saveCheckpoint(job, cp, report.status);
  }
}
