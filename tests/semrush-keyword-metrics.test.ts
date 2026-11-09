import type { Keyword } from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import {
  semrushKeywordExport,
  semrushMetricRows,
} from '../apps/web-antd/src/views/intelligence/semrush-keyword-metrics';
import SemrushKeywordMetrics from '../apps/web-antd/src/views/intelligence/components/SemrushKeywordMetrics.vue';

const keyword = (overrides = {}) =>
  ({
    id: 'qa',
    term: 'synthetic',
    market: 'US',
    metrics: {
      market: 'US',
      source: 'Semrush MCP',
      collectedAt: '2026-11-09T04:00:00Z',
      monthlySearchVolume: 0,
      searchResultCount: 0,
      cpc: 0,
      relatedRelevance: 0,
      serpFeatures: ['5', '9'],
      searchTrend: {
        version: 1,
        status: 'collected',
        scale: 'relative_0_1',
        values: Array.from({ length: 12 }, () => 0),
        collectedAt: '2026-11-08T00:00:00Z',
        report: 'phrase_this',
      },
    },
    ...overrides,
  }) as unknown as Keyword;

describe('semrush monthly trend presentation', () => {
  it('keeps actual zero values in rows and export while unsupported fields stay unknown', () => {
    const rows = semrushMetricRows(keyword());
    expect(rows.find((r) => r.label === '搜索结果数')?.value).toBe('0');
    expect(rows.find((r) => r.label === '点击成本 CPC')?.value).toBe('$0');
    expect(rows.find((r) => r.label === '自然搜索难度 KD')?.value).toBe(
      '未返回',
    );
    const row = semrushKeywordExport(keyword());
    expect(row.Semrush_搜索结果数).toBe(0);
    expect(row.Semrush_趋势日期).toBe('2026-11-08T00:00:00Z');
    expect(row.Semrush_最新月变化百分比).toBe('');
    expect(row.Semrush_月度相对趋势).toBe(
      Array.from({ length: 12 }, () => 0).join(','),
    );
    expect(
      semrushKeywordExport(keyword({ market: 'MX' })).Semrush_月度相对趋势,
    ).toBe('');
  });
  it('renders all-zero and unavailable curves distinctly, with an accessible table and source limits', async () => {
    for (const [record, expected] of [
      [keyword(), '未出现正热度'],
      [keyword({ metrics: undefined }), '尚未获取Semrush月度趋势'],
    ] as const) {
      const host = document.createElement('div');
      document.body.append(host);
      const app = createApp(SemrushKeywordMetrics, { keyword: record });
      app.mount(host);
      await nextTick();
      expect(host.textContent).toContain(expected);
      expect(host.textContent).toContain('不能据此计算日/周变化、同比');
      expect(host.querySelectorAll('tbody tr').length).toBe(
        record.metrics ? 12 : 0,
      );
      app.unmount();
      host.remove();
    }
  });
  it('opens the compact trend to inspect the source values and evidence', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const app = createApp(SemrushKeywordMetrics, {
      keyword: keyword(),
      compact: true,
    });
    app.mount(host);
    const button = host.querySelector('button');
    if (!button) throw new Error('Missing trend preview button');
    expect(button.getAttribute('aria-label')).toContain('Semrush月度趋势');
    button.click();
    await nextTick();
    await nextTick();
    expect(document.body.textContent).toContain('Semrush · 月度搜索需求');
    app.unmount();
    host.remove();
  });
});
