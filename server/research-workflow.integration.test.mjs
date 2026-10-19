import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const original = process.env.DATABASE_URL;
if (!original)
  throw new Error(
    'Run in the server QA container with DATABASE_URL configured',
  );
const name = `research_qa_${randomUUID().replaceAll('-', '')}`,
  admin = new pg.Pool({ connectionString: original });
// FORCE cleanup may notify an idle client after it has left the active query.
// Handle the expected termination without dumping connection internals.
const cleanupError = (error) => {
  if (error.code !== '57P01')
    throw new Error(
      `QA database connection failed: ${error.code || error.name}`,
    );
};
admin.on('error', cleanupError);
await admin.query(`CREATE DATABASE ${name}`);
const db = new URL(original);
db.pathname = `/${name}`;
process.env.DATABASE_URL = db.toString();
process.env.DATABASE_CONFIG_FILE = `/tmp/${name}.json`;
const { migrate, pool, saveKeyword } = await import('./store.mjs');
pool.on('error', cleanupError);
const { putDocument } = await import('./database.mjs');
const { sealAdsKey } = await import('./ads-provider.mjs');
const {
  submitInsight,
  runInsightJob,
  insightDetails,
  reviewInsight,
  insightSnapshot,
} = await import('./insight-jobs.mjs');
const { submitProducts, runProductsJob } = await import('./product-jobs.mjs');
const { analysisConfig } = await import('./model-provider.mjs');
const { reportPromptAction, currentAdPrompt } =
  await import('./report-prompts.mjs');
const { jobTasks } = await import('./runner.mjs');
let calls = 0;
const originalFetch = globalThis.fetch;
try {
  await migrate();
  await saveKeyword({
    id: 'qa-keyword',
    term: 'creatine gummies',
    market: 'US',
    category: '运动营养',
    source: 'QA fixture only',
    growth: null,
    series: [],
    favorite: false,
    reviewStatus: 'selected',
    productIds: [],
    siteIds: ['qa-site'],
    dataNature: 'collected',
  });
  await putDocument('workspace_documents', 'business:sites:qa-site', {
    id: 'qa-site',
    brand: 'QA only',
    domain: 'shop.example',
    market: 'US',
    category: '运动营养',
  });
  await putDocument(
    'provider_configs',
    'provider:scrapecreators:v1',
    sealAdsKey('QA-only-not-a-real-key'),
  );
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url).hostname, 'api.scrapecreators.com');
    calls++;
    return Response.json({
      success: true,
      credits_charged: 1,
      comments: [
        {
          id: 'qa-1',
          body: 'How much sugar? Too expensive.',
          url: 'https://www.reddit.com/r/Supplements/comments/abc/topic/c1/',
        },
      ],
    });
  };
  const input = {
    kind: 'consumer_research',
    requestId: randomUUID(),
    market: 'US',
    title: 'QA ONLY',
    sourceKind: 'reddit_comments',
    urls: 'https://www.reddit.com/r/Supplements/comments/abc/topic/',
    keywordIds: ['qa-keyword'],
    siteIds: ['qa-site'],
    maxRequests: 1,
    maxPages: 2,
    limit: 20,
  };
  const job = await submitInsight(input),
    same = await submitInsight(input);
  assert.equal(job.id, same.id);
  assert.equal(jobTasks(job)[0].researchProgress.kind, 'consumer_research');
  await runInsightJob(job);
  const details = await insightDetails({ reportId: job.id });
  assert.equal(details.evidence.length, 1);
  assert.equal(details.report.status, 'completed');
  assert.equal(details.report.statistics.sampleSize, 1);
  assert.equal(calls, 1);
  const stored = (
    await pool.query('SELECT * FROM research_jobs WHERE id=$1', [job.id])
  ).rows[0];
  await runInsightJob(stored);
  assert.equal(calls, 1, 'finished checkpoint must not repeat paid calls');
  const beforeReview = await insightDetails({ reportId: job.id });
  const reviewResult = await reviewInsight({
    reportId: job.id,
    status: 'selected',
    note: 'QA review',
  });
  assert.ok(reviewResult.report.revision > beforeReview.report.revision);
  assert.equal(reviewResult.report.reviewNote, 'QA review');
  const summary = (await insightSnapshot({ summary: true })).reports.find(
    (r) => r.id === job.id,
  );
  assert.equal(summary.revision, reviewResult.report.revision);
  assert.equal(
    summary.statistics,
    undefined,
    'list refresh sends metadata, not report content',
  );
  const evidenceIds = Array.from({ length: 205 }, (_, i) => `qa-bulk-${i}`);
  for (const id of [...evidenceIds].reverse())
    await putDocument(
      'workspace_documents',
      `business:researchEvidence:${id}`,
      { id, text: id },
    );
  await putDocument('workspace_documents', 'business:insightReports:qa-bulk', {
    id: 'qa-bulk',
    createdAt: new Date().toISOString(),
    evidenceIds: [...evidenceIds, 'missing'],
  });
  const bulk = await insightDetails({ reportId: 'qa-bulk' });
  assert.deepEqual(
    bulk.evidence.map((r) => r.id),
    evidenceIds,
    'batch evidence lookup preserves report order and skips missing records',
  );
  assert.equal(
    (await insightDetails({ reportId: job.id })).report.reviewStatus,
    'selected',
  );
  const configSaveId = randomUUID();
  const savedConfig = await analysisConfig(
    {
      action: 'server_analysis_config',
      baseUrl: 'https://model.example/v1',
      model: 'qa-model',
      apiKey: 'qa-key',
      maxTokens: 1000,
      requestId: configSaveId,
    },
    { role: 'admin' },
  );
  const state = await analysisConfig(
    { action: 'server_analysis_status' },
    { role: 'researcher' },
  );
  assert.equal(state.configured, true);
  assert.equal(state.apiKey, undefined);
  assert.equal(state.lastSaveId, configSaveId);
  assert.equal(savedConfig.lastSaveId, configSaveId);
  assert.equal(savedConfig.apiKey, undefined);
  await assert.rejects(() =>
    analysisConfig(
      {
        action: 'server_analysis_config',
        baseUrl: 'https://model.example/v1',
        model: '',
        apiKey: 'qa-replacement',
        requestId: randomUUID(),
      },
      { role: 'admin' },
    ),
  );
  assert.equal(
    (
      await analysisConfig(
        { action: 'server_analysis_status' },
        { role: 'admin' },
      )
    ).lastSaveId,
    configSaveId,
    'failed validation cannot acknowledge a new save',
  );
  await assert.rejects(() =>
    analysisConfig(
      {
        action: 'server_analysis_config',
        baseUrl: 'https://model.example/v1',
        model: 'qa-model',
        apiKey: 'bad',
      },
      { role: 'researcher' },
    ),
  );
  const promptBefore = await currentAdPrompt();
  await putDocument('workspace_documents', 'business:ads:qa-ad', {
    id: 'qa-ad',
    brand: 'QA Brand',
    market: 'US',
    headline: 'Convenient creatine',
    copy: 'Shop now',
    source: 'QA fixture only',
    platform: 'Meta',
    evidenceUrl: 'https://facebook.com/ads/library/?id=123',
    landingUrls: ['https://shop.example/p'],
  });
  const adJob = await submitInsight({
    kind: 'ad_analysis',
    market: 'US',
    title: 'QA AD REPORT',
    adIds: ['qa-ad'],
    analyze: true,
    requestId: randomUUID(),
  });
  assert.equal(adJob.input.prompt.version, promptBefore.version);
  const promptAfter = await reportPromptAction(
    {
      action: 'server_ad_report_prompt_save',
      text: `${promptBefore.text}\nQA新增研究重点`,
      version: promptBefore.version,
    },
    { role: 'admin', displayName: 'QA' },
  );
  assert.notEqual(promptAfter.version, promptBefore.version);
  assert.equal(
    (
      await pool.query('SELECT input FROM research_jobs WHERE id=$1', [
        adJob.id,
      ])
    ).rows[0].input.prompt.version,
    promptBefore.version,
    'already queued jobs keep the old prompt',
  );
  await assert.rejects(
    () =>
      reportPromptAction(
        {
          action: 'server_ad_report_prompt_save',
          text: promptBefore.text,
          version: promptBefore.version,
        },
        { role: 'admin' },
      ),
    /已被更新/,
  );
  await assert.rejects(() =>
    reportPromptAction(
      {
        action: 'server_ad_report_prompt_save',
        text: promptBefore.text,
        version: promptAfter.version,
      },
      { role: 'researcher' },
    ),
  );
  await runInsightJob(adJob, {
    analyzeRecords: async (records, kind, context) => {
      assert.equal(kind, 'ad_analysis');
      assert.equal(context.prompt.version, promptBefore.version);
      assert.equal(records[0].brand, 'QA Brand');
      assert.equal(records[0].landingUrl, 'https://shop.example/p');
      return {
        summary: 'QA model fixture only',
        findings: [],
        model: 'qa-model',
        prompt: context.prompt,
      };
    },
  });
  const rerun = await submitInsight({
    kind: 'evidence_analysis',
    reportId: adJob.id,
    market: 'US',
    title: 'QA REANALYSIS',
    requestId: randomUUID(),
  });
  assert.equal(rerun.input.prompt.version, promptAfter.version);
  assert.equal(rerun.input.analysisKind, 'ad_analysis');
  assert.equal(rerun.input.title, 'QA REANALYSIS');
  await runInsightJob(rerun, {
    analyzeRecords: async () => ({
      summary: 'QA new report only',
      findings: [],
      model: 'qa-model',
    }),
  });
  const adsPage = await insightSnapshot({
    paginated: true,
    kind: 'ad',
    market: 'US',
    page: 1,
    pageSize: 1,
  });
  assert.equal(adsPage.total, 2);
  assert.equal(adsPage.reports.length, 1);
  assert.equal(adsPage.reports[0].hasModelAnalysis, true);
  assert.equal(
    (await insightDetails({ reportId: rerun.id })).report.parentReportId,
    adJob.id,
  );
  assert.equal(
    calls,
    1,
    'ad report and reanalysis do not replay provider collection',
  );
  const products = await submitProducts({
    requestId: randomUUID(),
    siteIds: ['qa-site'],
    maxProducts: 10,
    maxRequests: 1,
  });
  const html =
    '<script type="application/ld+json">' +
    JSON.stringify({
      '@type': 'Product',
      name: 'Creatine Gummies',
      image: 'https://shop.example/image.jpg',
      url: 'https://shop.example/products/qa',
      offers: { price: 20, priceCurrency: 'USD' },
    }) +
    '</script>';
  await runProductsJob(products, { fetchPage: async (url) => ({ html, url }) });
  const saved = (
    await pool.query(
      "SELECT value FROM workspace_documents WHERE name LIKE 'business:products:%'",
    )
  ).rows;
  assert.equal(saved.length, 1);
  assert.equal(saved[0].value.imageUrl, 'https://shop.example/image.jpg');
  const keyword = (await pool.query('SELECT data FROM research_keywords'))
    .rows[0].data;
  assert.ok(keyword.productIds.includes(saved[0].value.id));
  console.log(
    JSON.stringify({
      isolatedDatabase: true,
      workflow:
        'consumer collection → evidence statistics → manual review; product catalog → product → keyword association',
      providerCalls: calls,
      productionDataChanged: false,
      modelKeyEncrypted: true,
    }),
  );
} finally {
  globalThis.fetch = originalFetch;
  await pool.end();
  await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await admin.end();
}
