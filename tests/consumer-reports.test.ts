import type { ResearchReport } from '../apps/web-antd/src/views/intelligence/research-reports';

import { describe, expect, it } from 'vitest';

import {
  filterConsumerReports,
  latestKeywordReports,
  publicEvidenceUrl,
} from '../apps/web-antd/src/views/intelligence/consumer-reports';
const report = {
  id: 'r1',
  kind: 'consumer_research',
  title: '肌酸软糖',
  market: 'US',
  keywordIds: ['k1'],
  createdAt: '2026-10-01',
  status: 'completed',
  evidenceIds: ['a'],
  statistics: {
    sampleSize: 1,
    themes: [
      {
        key: 'price',
        label: '价格',
        count: 1,
        evidenceIds: ['a'],
        sourceCount: 1,
        suggestion: '比较每份价格',
      },
    ],
  },
} as ResearchReport;
describe('consumer reports', () => {
  it('matches keyword and topic together and keeps markets and ads separate', () => {
    const list = [
      report,
      {
        ...report,
        id: 'r2',
        market: 'VN',
        keywordIds: ['k2'],
      } as ResearchReport,
      { ...report, id: 'ad', kind: 'ad_analysis' },
    ];
    const filter = {
      market: 'US',
      keyword: 'k1',
      topic: '价格',
      search: '肌酸',
      review: 'ALL',
    };
    expect(filterConsumerReports(list, filter).map((r) => r.id)).toEqual([
      'r1',
    ]);
    expect(filterConsumerReports(list, { ...filter, topic: '配方' })).toEqual(
      [],
    );
  });
  it('selects latest reports for each keyword without substituting ads', () => {
    const fresh = {
      ...report,
      id: 'fresh',
      createdAt: '2026-10-21',
      status: 'queued',
    };
    const map = latestKeywordReports([
      report,
      fresh,
      { ...fresh, id: 'ad', kind: 'ad_analysis' },
    ]);
    expect(map.get('k1')?.id).toBe('fresh');
  });
  it('rejects executable and credential-bearing evidence links', () => {
    expect(publicEvidenceUrl('javascript:alert(1)')).toBe('');
    expect(publicEvidenceUrl('https://user:pass@example.com')).toBe('');
    expect(publicEvidenceUrl('https://www.reddit.com/r/test')).toContain(
      'reddit.com',
    );
  });
});
