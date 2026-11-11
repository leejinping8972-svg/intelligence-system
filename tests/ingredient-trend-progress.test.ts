import type { Task } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import {
  taskStatusInfo,
  taskSummary,
} from '../apps/web-antd/src/views/intelligence/task-list';

type Overview = NonNullable<Task['overview']>;
type IngredientTask = Task & {
  overview: Overview & {
    ingredientTrend: NonNullable<Overview['ingredientTrend']>;
  };
};

function task(): IngredientTask {
  return {
    id: 'synthetic-ingredient',
    market: 'US',
    title: '成分风向',
    status: 'running',
    created: '',
    steps: [],
    overview: {
      status: 'running',
      total: 542,
      processed: 12,
      succeeded: null,
      failed: 0,
      remaining: 530,
      waiting: 0,
      percent: 2,
      outcome: '评论回访中',
      reason: '',
      startedAt: '',
      finishedAt: '',
      elapsedSeconds: null,
      ingredientTrend: {
        operation: 'collect',
        waiting: false,
        total: 542,
        processed: 12,
        percent: 2,
        phase: '评论回访中',
        posts: 129,
        newPosts: 7,
        comments: 3118,
        commentPosts: 542,
        visitedPosts: 32,
        pendingPosts: 530,
        blockedPosts: 1,
        pages: 6,
        requests: 277,
        modelCalls: 0,
        timings: {
          lastSourceMs: 2061,
          lastArchiveMs: 800,
          lastCheckpointMs: 120,
          lastQueueMs: 1800,
          lastSchedulingMs: 0,
        },
      },
    },
  };
}

describe('ingredient trend task progress', () => {
  it('shows collection counters, revisit progress and stage timings in the shared list/detail summary', () => {
    const summary = taskSummary(task());
    expect(summary.percent).toBe(2);
    expect(summary.label).toBe('评论回访 12/542帖 · 评论回访中');
    expect(summary.result).toContain('帖子 129 · 本轮新增 7 · 评论记录 3118');
    expect(summary.result).toContain('已回访 32帖 · 待续 530帖 · 请求异常 1帖');
    expect(summary.result).toContain('帖子页 6 · 来源请求 277次');
    expect(summary.result).toContain(
      '请求处理 2.1秒 · 归档 0.8秒 · 保存 0.1秒 · 续跑延迟 1.8秒 · 计划调度 0.0秒',
    );
    expect(taskStatusInfo(task())?.label).toBe('执行中');
  });

  it('shows an explicit collection dependency without inventing analysis progress', () => {
    const t = task(),
      o = t.overview,
      trend = o.ingredientTrend;
    Object.assign(trend, {
      operation: 'analyze',
      waiting: true,
      total: 0,
      processed: 0,
      percent: null,
    });
    o.outcome = '等待当日采集';
    const summary = taskSummary(t);
    expect(taskStatusInfo(t)?.label).toBe('等待采集');
    expect(summary.percent).toBeNull();
    expect(summary.label).toBe('周分析 · 等待当日采集');
    expect(summary.result).toContain('当日采集保存后自动开始分析');
    expect(summary.result).not.toContain('帖子 129');
  });

  it('separates analyzed records and model calls from collection counts', () => {
    const t = task(),
      o = t.overview,
      trend = o.ingredientTrend;
    Object.assign(trend, {
      operation: 'analyze',
      waiting: false,
      total: 2105,
      processed: 80,
      modelCalls: 2,
      percent: 3,
    });
    o.outcome = '周分析进行中';
    const summary = taskSummary(t);
    expect(summary.label).toBe('周分析 80/2105段 · 周分析进行中');
    expect(summary.result).toContain('模型请求 2次');
    expect(summary.result).not.toContain('来源请求');
  });

  it('omits an unknown collection denominator and missing timing values', () => {
    const t = task(),
      o = t.overview,
      trend = o.ingredientTrend;
    Object.assign(trend, {
      total: 0,
      processed: 0,
      percent: null,
      commentPosts: 0,
      timings: {},
    });
    o.outcome = '帖子采集中';
    const summary = taskSummary(t);
    expect(summary.label).toBe('已采 129帖 · 帖子采集中');
    expect(summary.percent).toBeNull();
    expect(summary.result).not.toContain('最近耗时');
  });

  it('preserves cancelled, failed, partial and completed badges after a dependency wait', () => {
    for (const status of [
      'cancelled',
      'failed',
      'partial',
      'completed',
    ] as const) {
      const t = task();
      t.status = status;
      t.overview.status = status;
      t.overview.ingredientTrend.waiting = true;
      expect(taskStatusInfo(t)?.label).not.toBe('等待采集');
    }
  });
});
