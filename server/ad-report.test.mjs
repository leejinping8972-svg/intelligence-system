import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adModelInput,
  promptSnapshot,
  AD_REPORT_PROMPT,
} from './ad-report-prompt.mjs';
import { validateModelReport } from './research-evidence.mjs';
import { runInsightJob } from './insight-jobs.mjs';
test('ad sampling spreads the budget across brands and preserves provenance and missing data', () => {
  const records = Array.from({ length: 85 }, (_, i) => ({
    id: `a${i}`,
    brand: 'A',
    text: `claim ${i}`,
    url: 'https://facebook.com/ad',
    status: 'active',
  }));
  records.push(
    { ...records[0], id: 'duplicate' },
    {
      id: 'b1',
      brand: 'B',
      text: 'B original',
      transcript: 'B original',
      landingUrl: 'https://brand.example/p',
    },
  );
  const data = adModelInput(records);
  assert.equal(data.evidence.length, 80);
  assert.equal(data.evidence[1].brand, 'B');
  assert.equal(data.coverage.uniqueCreativeCount, 86);
  assert.equal(data.coverage.omittedCount, 6);
  assert.equal(data.evidence[1].hasTranscript, true);
  assert.equal(data.evidence[1].landingUrl, 'https://brand.example/p');
  assert.equal(data.evidence[0].hasTranscript, false);
  const bounded = adModelInput(
    Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      brand: String(i),
      text: 'a'.repeat(9000),
    })),
  );
  assert.ok(bounded.evidence.reduce((n, e) => n + e.text.length, 0) <= 100000);
  assert.equal(bounded.coverage.truncatedCount, 80);
});
const sample = [{ id: '1', text: 'Creatine without the hassle. Shop now.' }];
const f = (section) => ({
  section,
  label: 'QA',
  observation: '原文提及便捷',
  interpretation: '便捷是定位假设',
  suggestion: '测试两种便捷表达',
  evidenceIds: ['1'],
  quotes: [
    { evidenceId: '1', text: 'invented quote' },
    { evidenceId: '1', text: 'without the hassle' },
  ],
});
test('v2 reports require evidence-backed creative, opportunity and a complete experiment', () => {
  const value = {
    summary: 'QA',
    findings: [
      f('creative'),
      f('opportunity'),
      {
        ...f('test'),
        test: {
          hypothesis: '减少麻烦可能提高点击意愿',
          control: '原表达',
          variant: '便携表达草稿',
          constant: '人群与素材相同',
          metric: '落地页点击率',
          decisionRule: '建立基线并比较区间',
        },
      },
    ],
  };
  const result = validateModelReport(value, sample, { ad: true });
  assert.deepEqual(result.findings[0].quotes, [
    { evidenceId: '1', text: 'without the hassle' },
  ]);
  assert.throws(
    () =>
      validateModelReport({ ...value, findings: [f('creative')] }, sample, {
        ad: true,
      }),
    /完整测试计划/,
  );
  assert.throws(
    () =>
      validateModelReport(
        { ...value, findings: [...value.findings.slice(0, 2), f('test')] },
        sample,
        { ad: true },
      ),
    /完整测试计划/,
  );
});
test('ad evidence reanalysis stays an ad report and uses its frozen prompt without collection', async () => {
  const docs = new Map([
    [
      'researchEvidence:1',
      { ...sample[0], kind: 'advertiser_claim', brand: 'QA' },
    ],
  ]);
  const prompt = promptSnapshot(`${AD_REPORT_PROMPT}\n自定义旧版本`);
  let analyzed;
  await runInsightJob(
    {
      id: 'qa',
      input: {
        kind: 'evidence_analysis',
        analysisKind: 'ad_analysis',
        parentReportId: 'old',
        title: 'QA',
        market: 'US',
        evidenceIds: ['1'],
        analyze: true,
        prompt,
        researchFocus: '比较开场',
      },
      checkpoint: {},
    },
    {
      read: async (key) => docs.get(key),
      put: async (key, v) => docs.set(key, structuredClone(v)),
      cancelled: async () => false,
      saveCheckpoint: async () => {},
      collect: async () => {
        throw new Error('must not collect');
      },
      analyzeRecords: async (records, kind, context) => {
        analyzed = { records, kind, context };
        return { summary: 'QA' };
      },
    },
  );
  const report = docs.get('insightReports:qa');
  assert.equal(analyzed.kind, 'ad_analysis');
  assert.equal(analyzed.context.prompt.version, prompt.version);
  assert.equal(report.kind, 'ad_analysis');
  assert.equal(report.reportType, 'ad');
  assert.equal(report.parentReportId, 'old');
  assert.equal(report.statistics.kind, 'advertiser');
  assert.equal(report.requests, 0);
});
