import { describe, expect, it, vi } from 'vitest';
import {
  ReportCache,
  type ReportDetails,
} from '../apps/web-antd/src/views/intelligence/report-cache';
import { isWorkspaceSyncKey } from '../apps/web-antd/src/views/intelligence/workspace-sync-keys';

const data = (revision = 1): ReportDetails => ({
  report: {
    id: 'report',
    revision,
    title: '需求报告',
    market: 'US',
    kind: 'consumer_research',
    status: 'completed',
    createdAt: '2026-10-19',
    evidenceIds: ['e1'],
  },
  evidence: [
    {
      id: 'e1',
      text: '原始证据',
      url: 'https://example.com',
      market: 'US',
      platform: 'Reddit',
      kind: 'comment',
    },
  ],
});
describe('report detail reuse', () => {
  it('reopens a completed report without another request and refreshes only when explicitly requested or revised', async () => {
    const cache = new ReportCache(),
      first = data(),
      next = data(2),
      load = vi.fn().mockResolvedValue(first);
    await cache.read('user-a', first.report, load);
    await cache.read('user-a', { ...first.report }, load);
    expect(load).toHaveBeenCalledTimes(1);
    await cache.read('user-a', first.report, load, true);
    expect(load).toHaveBeenCalledTimes(2);
    load.mockResolvedValue(next);
    await cache.read('user-a', next.report, load);
    expect(load).toHaveBeenCalledTimes(3);
    expect(cache.peek('user-a', 'report')).toEqual(next);
  });
  it('deduplicates concurrent preview and download requests', async () => {
    const cache = new ReportCache(),
      value = data(),
      load = vi.fn().mockResolvedValue(value);
    await Promise.all([
      cache.read('a', value.report, load),
      cache.read('a', value.report, load),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('keeps readable evidence after a failed refresh and allows retry', async () => {
    const cache = new ReportCache(),
      value = data();
    cache.save('a', value);
    await expect(
      cache.read(
        'a',
        value.report,
        async () => {
          throw new Error('offline');
        },
        true,
      ),
    ).rejects.toThrow('offline');
    expect(cache.peek('a', 'report')).toEqual(value);
    const load = vi.fn().mockResolvedValue(data(2));
    await cache.read('a', value.report, load, true);
    expect(cache.peek('a', 'report')?.report.revision).toBe(2);
  });
  it('does not freeze an unfinished report at its first snapshot', async () => {
    const cache = new ReportCache(),
      value = data();
    value.report.status = 'running';
    const load = vi.fn().mockResolvedValue(value);
    await cache.read('a', value.report, load);
    await cache.read('a', value.report, load);
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('never restores another account’s evidence from a late response', async () => {
    const cache = new ReportCache(),
      value = data();
    let complete!: (data: ReportDetails) => void;
    const pending = cache.read(
      'a',
      value.report,
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await Promise.resolve();
    expect(cache.peek('b', 'report')).toBeUndefined();
    complete(value);
    await pending;
    expect(cache.peek('b', 'report')).toBeUndefined();
    expect(cache.peek('a', 'report')).toBeUndefined();
  });
  it('a late refresh cannot undo saved review information', async () => {
    const cache = new ReportCache(),
      value = data();
    let complete!: (data: ReportDetails) => void;
    const pending = cache.read(
      'a',
      value.report,
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await Promise.resolve();
    const reviewed = data(2);
    reviewed.report.reviewStatus = 'selected';
    cache.save('a', reviewed);
    complete(value);
    await pending;
    expect(cache.peek('a', 'report')?.report.reviewStatus).toBe('selected');
  });
  it('bounds retained evidence to the most recently used reports', () => {
    const cache = new ReportCache();
    for (let i = 0; i < 21; i++) {
      const value = data();
      value.report.id = String(i);
      cache.save('a', value);
    }
    expect(cache.peek('a', '0')).toBeUndefined();
    expect(cache.peek('a', '20')).toBeDefined();
  });
});
describe('workspace sync ownership', () => {
  it('never treats backend reports, evidence or future server collections as client deletions', () => {
    const keys = [
      'sites:s1',
      'products:p1',
      'insightReports:r1',
      'researchEvidence:e1',
      'newServerCollection:x',
    ];
    expect(keys.filter(isWorkspaceSyncKey)).toEqual([
      'sites:s1',
      'products:p1',
    ]);
  });
});
