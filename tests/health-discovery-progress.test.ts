import type { Task } from '../apps/web-antd/src/views/intelligence/data';
import { describe, expect, it } from 'vitest';
import { partialTaskCanContinue, taskSummary } from '../apps/web-antd/src/views/intelligence/task-list';

function task(): Task {
  return {
    id: 'synthetic', market: 'US', title: '常规新品发现', status: 'running', created: '', steps: [],
    overview: {
      status: 'running', total: 212, processed: 29, succeeded: 29, failed: 0, remaining: 183,
      waiting: 0, percent: 14, outcome: '商品资料处理中', reason: '', startedAt: '', finishedAt: '', elapsedSeconds: null,
      healthDiscovery: {
        categories: { total: 212, processed: 29, succeeded: 29, failed: 0, remaining: 183 },
        products: { returned: 6, accepted: 1, excluded: 0, review: 1, pending: 4, evidenceSkipped: 0, limitSkipped: 0 },
        pages: { processed: 29, pending: 0, failed: 0, truncated: 0 },
        issues: 2, remainingWork: 187, phase: '商品资料处理中',
      },
    },
  };
}

describe('health discovery task summary', () => {
  it('names the category scope and separates accepted, pending, source rows and auxiliary errors', () => {
    const summary = taskSummary(task());
    expect(summary.percent).toBe(14);
    expect(summary.label).toBe('类目首屏 29/212 · 商品资料处理中');
    expect(summary.result).toContain('查询成功 29 · 失败 0 · 待查 183');
    expect(summary.result).toContain('商品入库 1 · 排除 0 · 待确认 1 · 待处理 4');
    expect(summary.result).toContain('来源返回 6 条（含重复） · 已取 29 页 · 待翻页 0');
    expect(summary.result).toContain('执行异常 2 条');
    expect(summary.result).not.toContain('采集成功 29');
    expect(summary.result).not.toContain('失败/受限');
  });

  it('retains the active or stopped phase after first-page coverage reaches 100%', () => {
    const t = task(), o = t.overview;
    if (!o?.healthDiscovery) throw new Error('Expected discovery progress');
    const h = o.healthDiscovery;
    Object.assign(o, { processed: 212, remaining: 0, percent: 100, outcome: '后续分页采集中' });
    Object.assign(h.categories, { processed: 212, succeeded: 212, remaining: 0 });
    h.pages.pending = 2;
    h.pages.truncated = 1;
    h.products.limitSkipped = 3;
    expect(taskSummary(t).label).toBe('类目首屏 212/212 · 后续分页采集中');
    expect(taskSummary(t).result).toContain('翻页未完整 1 个类目');
    expect(taskSummary(t).result).toContain('数量上限跳过 3 条');
    expect(taskSummary(t).result).toContain('进度条仅表示类目首屏查询进度');
    t.status = 'partial'; o.status = 'partial'; o.outcome = '已停止 · 采集未完成';
    expect(partialTaskCanContinue(t)).toBe(true);
    h.remainingWork = 0;
    expect(partialTaskCanContinue(t)).toBe(false);
    h.remainingWork = 2; t.canContinue = false;
    expect(partialTaskCanContinue(t)).toBe(false);
  });
});
