import { describe, it, expect } from 'vitest';
import {
  reportDocument,
  reportFilename,
} from '../apps/web-antd/src/views/intelligence/report-document';
import { reportDocx } from '../apps/web-antd/src/views/intelligence/report-docx';
import type {
  ResearchReport,
  ResearchEvidence,
} from '../apps/web-antd/src/views/intelligence/research-reports';
const report: ResearchReport = {
  id: 'qa-report',
  title: '肌酸软糖广告研究',
  kind: 'ad_analysis',
  market: 'US',
  createdAt: '2026-10-19T00:00:00Z',
  status: 'completed',
  evidenceIds: ['a'],
  modelAnalysis: {
    schemaVersion: 2,
    summary: '先测试便捷表达',
    model: 'qa-model',
    method: 'QA',
    inputEvidenceCount: 1,
    totalEvidenceCount: 1,
    prompt: { text: '保存的实际提示词', version: 'version1', schemaVersion: 2 },
    findings: [
      {
        section: 'creative',
        label: '便捷开场',
        observation: '原文强调便捷',
        interpretation: '便捷可能影响选择',
        suggestion: '准备单变量测试',
        evidenceIds: ['a'],
      },
    ],
    limitations: ['缺少绩效数据'],
  },
};
const evidence: ResearchEvidence[] = [
  {
    id: 'a',
    brand: 'QA品牌',
    text: '原始广告文案全部保留\n第二段',
    url: 'https://facebook.com/ads/library/?id=1',
    landingUrl: 'javascript:alert(1)',
    platform: 'Meta',
    kind: 'advertiser_claim',
    market: 'US',
  },
];
describe('one coherent downloadable report', () => {
  it('includes decisions, citations, full originals, limitations and the actual prompt', () => {
    const blocks = reportDocument(report, evidence),
      text = blocks.map((b) => b.text).join('\n');
    for (const item of [
      '先测试便捷表达',
      '创意与说服链',
      '观察事实',
      'E001',
      '原始广告文案全部保留\n第二段',
      '缺少绩效数据',
      '保存的实际提示词',
    ])
      expect(text).toContain(item);
    expect(blocks.some((b) => b.url?.startsWith('javascript:'))).toBe(false);
    expect(blocks.some((b) => b.appendix && b.text.includes('第二段'))).toBe(
      true,
    );
  });
  it('does not invent a historical prompt or present rule statistics as model analysis', () => {
    const text = reportDocument(
      { ...report, modelAnalysis: undefined },
      evidence,
    )
      .map((b) => b.text)
      .join('\n');
    expect(text).toContain('尚未生成模型策略分析');
    expect(text).toContain('历史报告没有保留实际使用提示词');
    expect(
      reportFilename({ ...report, title: 'a/b:*<>?' }, 'docx'),
    ).not.toMatch(/[/:*<>?]/);
  });
  it('exports an actual DOCX ZIP rather than renaming a JSON file', async () => {
    const blob = await reportDocx(report, evidence),
      bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([80, 75, 3, 4]);
    expect(blob.size).toBeGreaterThan(5000);
  });
});
