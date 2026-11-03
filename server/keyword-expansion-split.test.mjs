import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJob } from './domain.mjs';
import { jobProgress } from './job-progress.mjs';
import { runJob } from './runner.mjs';

test('expansion job accepts unlimited keywords and strips research social trends', () => {
  const input = validateJob({
    seeds: ['creatine', 'protein'],
    markets: ['US', 'MX'],
    sources: ['google_autocomplete', 'amazon_autocomplete'],
    depth: 1,
    socialTrends: {
      sources: ['tiktok'],
      maxPages: 3,
      budgetAcknowledged: true,
    },
  });
  assert.equal(input.limit, 0);
  assert.equal(input.expansionOnly, true);
  assert.equal(input.socialTrends, undefined);
});

test('expansion runJob finishes awaiting_review without trend queue or social dispatch', async () => {
  const saved = [];
  const collects = [];
  let socialCalls = 0;
  const input = validateJob({
    seeds: ['magnesium'],
    markets: ['US'],
    sources: ['google_autocomplete'],
    depth: 1,
  });
  const job = { id: 'expand-1', input, checkpoint: {}, status: 'running' };
  await runJob(job, {
    collect: async (_job, step, payload) => {
      collects.push({ step, limit: payload.limit });
      return {
        generatedAt: '2026-11-03T00:00:00.000Z',
        suggestions: [
          {
            market: 'US',
            items: [
              { term: 'magnesium glycinate', source: 'Google 联想' },
              { term: 'magnesium citrate', source: 'Google 联想' },
              { term: 'magnesium oxide', source: 'Google 联想' },
            ],
            sources: [
              { source: 'Google 联想', count: 3, status: 'ok', message: 'ok' },
            ],
          },
        ],
      };
    },
    saveKeyword: async (record) => {
      saved.push({ ...record });
      return record;
    },
    saveCheckpoint: async (_job, cp, status) => {
      Object.assign(job.checkpoint, cp);
      if (status) job.status = status;
    },
    patchCollection: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    checkCancelled: async () => {},
    submitResearchTrends: async () => {
      socialCalls += 1;
      return { accepted: 1, reused: 0 };
    },
    now: () => Date.parse('2026-11-03T12:00:00.000Z'),
  });
  assert.equal(job.status, 'awaiting_review');
  assert.equal(job.checkpoint.trendQueueVersion, undefined);
  assert.equal(socialCalls, 0);
  assert.ok(saved.length >= 4);
  assert.ok(saved.every((row) => row.reviewStatus === 'pending'));
  assert.ok(collects.every((row) => row.limit >= 1000));
  const progress = jobProgress(job);
  assert.equal(progress.terminal, true);
  assert.equal(progress.percent, 100);
  assert.equal(progress.shortfall, 0);
  assert.match(
    job.checkpoint.logs.join('\n'),
    /趋势采集 \/ 每日监测/,
  );
});

test('trend-only enrichment still initializes the Google trend queue', async () => {
  const record = {
    id: 'k1',
    term: 'creatine gummies',
    market: 'US',
    source: '候选',
    reviewStatus: 'selected',
  };
  const input = validateJob({
    existingRecords: [record],
    seeds: [],
    sources: [],
    markets: ['US'],
    depth: 1,
    limit: 1,
  });
  const job = { id: 'trend-1', input, checkpoint: {}, status: 'running' };
  await runJob(job, {
    collect: async () => {
      throw new Error('trend-only jobs should not collect discovery');
    },
    saveKeyword: async (row) => row,
    saveCheckpoint: async (_job, cp, status) => {
      Object.assign(job.checkpoint, cp);
      if (status) job.status = status;
    },
    patchCollection: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    checkCancelled: async () => {},
    submitResearchTrends: async () => ({ accepted: 0, reused: 0 }),
    now: () => 1_000,
  });
  assert.equal(job.checkpoint.trendQueueVersion, 1);
  assert.ok(Array.isArray(job.checkpoint.trendWork));
  assert.equal(job.checkpoint.trendWork.length, 1);
  assert.notEqual(job.status, 'awaiting_review');
});
