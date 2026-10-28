/* oxlint-disable unicorn/no-await-expression-member, unicorn/no-array-callback-reference -- SQL adapters and explicit market filters follow existing server modules. */
import { randomUUID } from 'node:crypto';

import { openAdsKey } from './ads-provider.mjs';
import { currentAiPrompt } from './ai-prompt-config.mjs';
import { aiSystemText } from './ai-prompt-defaults.mjs';
import { lock, pool, putDocument, unlock } from './database.mjs';
import {
  buildMarketSnapshot,
  marketModelSample,
  marketObservationRecords,
  publicSnapshot,
  snapshotEvidence,
  validateMarketReport,
} from './market-report-domain.mjs';
import { modelReportText, postModel } from './model-provider.mjs';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const documents = async (prefix) =>
  (
    await pool.query(
      'SELECT value FROM workspace_documents WHERE name LIKE $1',
      [`${prefix}%`],
    )
  ).rows.map((row) => row.value);

async function observationRecords(market) {
  const observations = await documents(`market:observation:${market}:`);
  return marketObservationRecords(observations);
}

export async function submitMarketReport(input) {
  if (!uuid.test(input.requestId || '')) throw new Error('缺少任务提交编号');
  const value = validateMarketReport(input);
  const c = await pool.connect();
  let held = false;
  try {
    held = await lock(c, 'insight-submit');
    if (!held) throw new Error('正在提交其他报告，请稍后重试');
    const duplicate = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (duplicate) return duplicate;
    const active = (
      await c.query(
        "SELECT id FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    const id = randomUUID();
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [id, input.requestId, value, { submittedAt: new Date().toISOString() }],
    );
    const report = {
      id,
      kind: 'market_analysis',
      reportType: 'market',
      title: value.title,
      market: value.market,
      period: value.period,
      endDate: value.endDate,
      createdAt: new Date().toISOString(),
      status: 'queued',
      evidenceIds: [],
      researchFocus: value.researchFocus,
    };
    await putDocument(
      'workspace_documents',
      `business:insightReports:${id}`,
      report,
    );
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
      .rows[0];
  } finally {
    if (held) await unlock(c, 'insight-submit');
    c.release();
  }
}

async function analyzeSnapshot(snapshot, evidence, focus) {
  const stored = (
    await pool.query('SELECT value FROM provider_configs WHERE name=$1', [
      'provider:analysis:v1',
    ])
  ).rows[0]?.value;
  if (!stored) throw new Error('尚未配置语义分析模型；已生成确定性市场统计');
  const config = JSON.parse(openAdsKey(stored));
  const prompt = await currentAiPrompt('market_analysis');
  const sample = marketModelSample(evidence).map((record) => ({
    id: record.id,
    kind: record.kind,
    platform: record.platform,
    text: record.text.slice(0, 800),
  }));
  const result = await postModel(config, [
    { role: 'system', content: aiSystemText(prompt) },
    {
      role: 'user',
      content: JSON.stringify({
        researchFocus: focus,
        snapshot: publicSnapshot(snapshot),
        evidence: sample,
      }),
    },
  ]);
  let parsed;
  try {
    parsed = JSON.parse(
      modelReportText(result)
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, ''),
    );
  } catch {
    throw new Error('模型未返回有效JSON；已保留确定性市场统计');
  }
  const allowed = new Set(sample.map((record) => record.id));
  const findings = (Array.isArray(parsed.findings) ? parsed.findings : [])
    .slice(0, 12)
    .map((finding) => ({
      label: String(finding.label || '').slice(0, 40),
      interpretation: String(finding.interpretation || '').slice(0, 500),
      suggestion: String(finding.suggestion || '').slice(0, 500),
      evidenceIds: [
        ...new Set(
          Array.isArray(finding.evidenceIds) ? finding.evidenceIds : [],
        ),
      ]
        .filter((id) => allowed.has(id))
        .slice(0, 30),
      confidence: ['中', '低', '高'].includes(finding.confidence)
        ? finding.confidence
        : '低',
    }))
    .filter(
      (finding) =>
        finding.label &&
        finding.interpretation &&
        finding.evidenceIds.length > 0,
    );
  if (findings.length === 0)
    throw new Error('模型没有返回可追溯证据的结论；已保留市场统计');
  return {
    schemaVersion: 1,
    summary: String(parsed.summary || '').slice(0, 800),
    method: '大模型对冻结快照和分层证据进行归纳；计数由系统生成',
    model: config.model,
    inputEvidenceCount: sample.length,
    totalEvidenceCount: evidence.length,
    usage: result.usage || null,
    prompt,
    findings,
    limitations: [
      ...new Set([
        ...(snapshot.limitations || []),
        ...(Array.isArray(parsed.limitations) ? parsed.limitations : []).map(
          String,
        ),
      ]),
    ].slice(0, 10),
  };
}

export async function runMarketReport(job, overrides = {}) {
  const io = {
    products: () => documents('business:products:'),
    ads: () => documents('business:ads:'),
    sites: () => documents('business:sites:'),
    content: () => documents('content:item:'),
    comments: () => documents('business:researchEvidence:'),
    history: () => observationRecords(value.market),
    put: (key, value) => putDocument('workspace_documents', key, value),
    checkpoint: async (value, status) => {
      await pool.query(
        'UPDATE research_jobs SET checkpoint=$2,status=$3,updated_at=now() WHERE id=$1',
        [job.id, value, status],
      );
    },
    cancelled: async () =>
      Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      ),
    analyze: analyzeSnapshot,
    read: async (key) =>
      (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [key],
        )
      ).rows[0]?.value,
    ...overrides,
  };
  const value = job.input;
  const createdAt = job.checkpoint.submittedAt || new Date().toISOString();
  const report = {
    id: job.id,
    kind: 'market_analysis',
    reportType: 'market',
    documentVersion: 1,
    title: value.title,
    market: value.market,
    period: value.period,
    endDate: value.endDate,
    createdAt,
    status: 'running',
    evidenceIds: [],
    researchFocus: value.researchFocus,
  };
  try {
    if (await io.cancelled()) throw new Error('任务已取消');
    const savedSnapshot = await io.read(`business:marketSnapshots:${job.id}`);
    const prior = await io.read(`business:insightReports:${job.id}`);
    const [products, ads, sites, content, allComments, history] =
      await Promise.all([
        io.products(),
        io.ads(),
        io.sites(),
        io.content(),
        io.comments(),
        io.history(),
      ]);
    if (await io.cancelled()) throw new Error('任务已取消');
    const marketFilter = (record) =>
      record?.market === value.market || record?.searchMarket === value.market;
    const snapshot = savedSnapshot?._records
      ? savedSnapshot
      : buildMarketSnapshot(
          {
            products: [...products.filter(marketFilter), ...history.products],
            ads: [...ads.filter(marketFilter), ...history.ads],
            sites: [...sites.filter(marketFilter), ...history.sites],
            content: [...content.filter(marketFilter), ...history.content],
            comments: [
              ...allComments.filter(
                (record) => marketFilter(record) && record.kind === 'comment',
              ),
              ...history.comments,
            ],
          },
          value,
        );
    const evidence = snapshotEvidence(snapshot);
    for (const record of evidence)
      await io.put(`business:researchEvidence:${record.id}`, record);
    report.evidenceIds = evidence.map((record) => record.id);
    report.marketSnapshot = publicSnapshot(snapshot);
    report.statistics = {
      method: '按冻结时间窗对系统已保存数据去重统计',
      sampleSize: evidence.length,
      sourceCount: new Set(
        evidence.map((record) => record.sourceUrl).filter(Boolean),
      ).size,
      confidence:
        evidence.length >= 100 ? '中（多源限定样本）' : '低（样本有限）',
      themes: [],
      limitations: snapshot.limitations,
    };
    await io.put(`business:marketSnapshots:${job.id}`, snapshot);
    await io.put(`business:insightReports:${job.id}`, report);
    if (value.analyze && evidence.length > 0) {
      try {
        if (prior?.modelAnalysis) report.modelAnalysis = prior.modelAnalysis;
        else {
          if (job.checkpoint.modelStarted)
            throw new Error(
              '上次模型调用状态未确认，未自动重复调用；可手动生成新报告',
            );
          if (await io.cancelled()) throw new Error('任务已取消');
          job.checkpoint.modelStarted = true;
          await io.checkpoint(job.checkpoint, 'running');
          report.modelAnalysis = await io.analyze(
            snapshot,
            evidence,
            value.researchFocus,
          );
        }
        report.prompt = report.modelAnalysis.prompt;
      } catch (error) {
        report.modelError = error.message;
      }
    }
    if (await io.cancelled()) throw new Error('任务已取消');
    report.status =
      report.modelError && value.analyze ? 'partial' : 'completed';
    report.message =
      evidence.length > 0
        ? '报告基于冻结快照生成；结论范围受采集覆盖和预算限制'
        : '所选周期没有可用于分析的已保存市场数据';
    report.finishedAt = new Date().toISOString();
    await io.put(`business:insightReports:${job.id}`, report);
    await io.checkpoint(
      {
        ...job.checkpoint,
        finishedAt: report.finishedAt,
        evidenceIds: report.evidenceIds,
        index: 1,
        ...(report.modelError ? { stopReason: report.modelError } : {}),
      },
      report.status,
    );
  } catch (error) {
    const cancelled = await io.cancelled();
    report.status = cancelled ? 'cancelled' : 'partial';
    report.message = error.message;
    await io.put(`business:insightReports:${job.id}`, report);
    await io.checkpoint(
      { ...job.checkpoint, error: error.message },
      report.status,
    );
  }
}
