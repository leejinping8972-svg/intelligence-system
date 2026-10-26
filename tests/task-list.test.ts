import type { Task } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import { RequestFlight } from '../apps/web-antd/src/views/intelligence/request-flight';
import {
  groupTasks,
  taskStatus,
  taskStatuses,
  taskSummary,
  taskTitle,
} from '../apps/web-antd/src/views/intelligence/task-list';
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  cloudJobId: 'job-1',
  market: 'US',
  title: '云端 · 关键词与趋势研究 · 美国',
  status: 'running',
  steps: [],
  created: '2026-10-20T00:00:00Z',
  ...extra,
});
describe('monitor task grouping', () => {
  it('shows persisted bulk states and an unrecorded market without inventing progress', () => {
    const bulk = task('bulk:US', {
      cloudJobId: 'bulk',
      status: 'bulk_running',
      readOnly: true,
      title: '云端 · Semrush 批量数据补全 · 美国',
      steps: ['已请求 0；剩余 3'],
    });
    expect(taskStatuses[taskStatus(bulk)]?.label).toBe('批处理待确认');
    expect(taskSummary(bulk)).toEqual({
      percent: null,
      label: '批处理待确认',
      result: '已请求 0；剩余 3',
    });
    const unknown = task('unknown:ALL', {
      cloudJobId: 'unknown',
      market: 'ALL',
      status: 'unavailable',
    });
    expect(groupTasks([bulk, unknown])).toHaveLength(2);
    expect(groupTasks([bulk, unknown], 'VN')).toHaveLength(0);
    expect(groupTasks([bulk, unknown], 'US')).toHaveLength(1);
  });
  it('groups one multi-market job once without combining distinct jobs with the same title or timestamp', () => {
    const rows = [
      task('j1:US'),
      task('j1:VN', { market: 'VN' }),
      task('j2:US', { cloudJobId: 'job-2' }),
    ];
    const grouped = groupTasks(rows);
    expect(grouped).toHaveLength(2);
    const first = grouped[0];
    if (!first) throw new Error('Expected a grouped task');
    expect(first.markets).toEqual(['US', 'VN']);
    expect(first.taskIds).toEqual(['j1:US', 'j1:VN']);
    expect(groupTasks(rows, 'VN')).toHaveLength(1);
    expect(rows[0]?.id).toBe('j1:US');
    expect(taskTitle(first)).toBe('关键词与趋势研究');
  });
  it('retains legacy tasks and distinguishes waiting retries from running and terminal states', () => {
    expect(
      groupTasks([
        task('legacy1', { cloudJobId: undefined }),
        task('legacy2', { cloudJobId: undefined }),
      ]),
    ).toHaveLength(2);
    const waiting = task('j1', {
      progress: { phase: 'waiting' } as Task['progress'],
    });
    expect(taskStatus(waiting)).toBe('waiting');
    expect(taskStatus({ ...waiting, status: 'cancelled' })).toBe('cancelled');
    expect(taskStatus(task('normal'))).toBe('running');
  });
});
describe('concurrent list requests', () => {
  it('returns the same pending promise to every caller, then permits a fresh request', async () => {
    const flight = new RequestFlight<number>();
    let calls = 0;
    let resolve!: (n: number) => void;
    const load = () => {
      calls++;
      return new Promise<number>((r) => {
        resolve = r;
      });
    };
    const a = flight.run(load);
    const b = flight.run(load);
    expect(a).toBe(b);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolve(7);
    expect(await a).toBe(7);
    expect(await b).toBe(7);
    expect(await flight.run(async () => 8)).toBe(8);
  });
  it('propagates errors to all callers and allows recovery', async () => {
    const flight = new RequestFlight<void>();
    const a = flight.run(async () => {
      throw new Error('offline');
    });
    const b = flight.run(async () => {});
    await expect(a).rejects.toThrow('offline');
    await expect(b).rejects.toThrow('offline');
    await expect(flight.run(async () => {})).resolves.toBeUndefined();
  });
});
