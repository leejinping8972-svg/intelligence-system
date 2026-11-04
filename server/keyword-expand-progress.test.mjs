import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJob } from './domain.mjs';
import { jobProgress } from './job-progress.mjs';
import { runJob } from './runner.mjs';
import { taskOverview } from './task-overview.mjs';

test('expansion progress uses discovery/Semrush counts instead of trend zeros', () => {
  const input = validateJob({
    seeds: ['magnesium'],
    markets: ['US'],
    sources: ['google_autocomplete', 'semrush'],
    limit: 0,
  });
  const keywords = Array.from({ length: 10 }, (_, i) => ({
    id: `k${i}`,
    term: `term ${i}`,
    market: 'US',
    series: [],
    trendStatus: 'pending',
    semrushCollection:
      i < 3
        ? { status: 'completed', message: 'ok' }
        : i === 3
          ? { status: 'failed', message: 'Semrush 报告异常' }
          : undefined,
  }));
  const job = {
    id: 'p1',
    status: 'running',
    input,
    checkpoint: {
      discoveryComplete: true,
      discoveryIndex: 1,
      metricIndex: 4,
      semBlocked: 'Semrush 报告异常，已停止后续指标调用，请先查看首条错误',
      keywords,
      startedAt: '2026-11-03T10:00:00.000Z',
    },
  };
  const progress = jobProgress(job);
  assert.equal(progress.phase, 'discovery');
  assert.equal(progress.discovered, 10);
  assert.equal(progress.processed, 10);
  assert.equal(progress.succeeded, 3);
  assert.equal(progress.failed, 1);
  const overview = taskOverview(job, { progress });
  assert.equal(overview.total, 10);
  assert.equal(overview.processed, 10);
  assert.equal(overview.succeeded, 3);
  assert.equal(overview.failed, 1);
  assert.equal(overview.remaining, 0);
  assert.equal(overview.percent, 100);
});

test('Semrush block stops metric loop without walking remaining keywords', async () => {
  const input = validateJob({
    seeds: ['magnesium'],
    markets: ['US'],
    sources: ['semrush'],
    limit: 0,
  });
  const job = {
    id: 'block-1',
    status: 'running',
    input,
    checkpoint: {},
  };
  const metricCalls = [];
  await runJob(job, {
    collect: async (_job, step) => {
      if (String(step).startsWith('sem-discover'))
        return {
          generatedAt: '2026-11-03T00:00:00.000Z',
          apiUnits: 0,
          suggestions: [
            {
              items: [
                { term: 'magnesium glycinate', source: 'Semrush' },
                { term: 'magnesium citrate', source: 'Semrush' },
                { term: 'magnesium oxide', source: 'Semrush' },
              ],
            },
          ],
        };
      metricCalls.push(step);
      throw new Error('Semrush HTTP 403');
    },
    saveKeyword: async (record) => record,
    saveCheckpoint: async (_job, cp, status) => {
      Object.assign(job.checkpoint, cp);
      if (status) job.status = status;
    },
    patchCollection: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    checkCancelled: async () => {},
    submitResearchTrends: async () => ({ accepted: 0, reused: 0 }),
    now: () => Date.parse('2026-11-03T12:00:00.000Z'),
  });
  assert.equal(job.status, 'awaiting_review');
  assert.equal(metricCalls.length, 1);
  assert.match(job.checkpoint.semBlocked, /Semrush/);
  assert.match(job.checkpoint.logs.join('\n'), /跳过剩余/);
  assert.ok(job.checkpoint.metricIndex >= 1);
  assert.ok(job.checkpoint.metricIndex < job.checkpoint.keywords.length);
});
