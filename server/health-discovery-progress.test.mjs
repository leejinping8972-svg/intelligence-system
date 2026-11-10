/* oxlint-disable vitest/no-import-node-test -- Server tests run with the native Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { futureHealthPlan, healthCategoryWork, healthCategoryKey } from './health-category-domain.mjs';
import { runHealthDiscovery } from './health-discovery-runner.mjs';
import { healthDiscoveryProgress } from './health-discovery-progress.mjs';
import { taskOverview } from './task-overview.mjs';
import { compactTask } from './workspace-snapshot.mjs';

const plan = futureHealthPlan({ kind: 'regular_new', market: 'US', channels: ['amazon', 'tiktok'], maxPages: 5, maxProducts: 500 });
const job = () => ({ input: { kind: 'discovery_monitor', plan: structuredClone(plan) }, status: 'running', checkpoint: {} });
function snapshot() {
  const j = job(), work = healthCategoryWork(plan);
  j.checkpoint = {
    healthCoverage: Object.fromEntries(work.map((w, i) => [healthCategoryKey(w), {
      firstPage: i < 29 ? 'done' : 'pending', pages: i < 29 ? 1 : 0,
    }])),
    work: work.slice(29), pending: [{}, {}, {}, {}], products: 1, sourceRows: 6,
    healthReviewCount: 1, failures: ['辅助卖家资料未匹配', '辅助卖家资料未匹配'],
  };
  return j;
}

test('new and FBM tasks know their fixed category scope before the first execution', () => {
  const j = job(); j.status = 'queued';
  assert.equal(taskOverview(j, {}).total, 212);
  assert.equal(taskOverview(j, {}).processed, 0);
  assert.equal(taskOverview(j, {}).remaining, 212);
  j.input.plan = { ...plan, kind: 'fbm_new', channels: ['amazon'] };
  assert.equal(taskOverview(j, {}).total, 208);
});

test('saved first-page coverage advances despite no legacy index; product counts and issues stay distinct', () => {
  const j = snapshot(), before = structuredClone(j);
  const overview = taskOverview(j, {});
  assert.deepEqual([overview.processed, overview.total, overview.percent], [29, 212, 14]);
  assert.equal(overview.failed, 0, 'auxiliary details errors are not category failures');
  assert.equal(overview.healthDiscovery.issues, 2);
  assert.deepEqual(overview.healthDiscovery.products, {
    returned: 6, accepted: 1, excluded: 0, review: 1, pending: 4, evidenceSkipped: 0, limitSkipped: 0,
  });
  assert.equal(overview.outcome, '商品资料处理中');
  assert.deepEqual(j, before, 'projection must not change checkpoints or inputs');
  const nextWork = j.checkpoint.work.shift();
  Object.assign(j.checkpoint.healthCoverage[healthCategoryKey(nextWork)], { firstPage: 'done', pages: 1 });
  const next = taskOverview(j, {});
  assert.deepEqual([next.processed, next.total, next.remaining], [30, 212, 182]);
});

test('failed first pages count as attempted without being reported as successful', () => {
  const j = snapshot();
  const failed = j.checkpoint.work.shift();
  Object.assign(j.checkpoint.healthCoverage[healthCategoryKey(failed)], { firstPage: 'failed', error: '来源失败' });
  const o = taskOverview(j, {});
  assert.deepEqual([o.processed, o.succeeded, o.failed, o.remaining], [30, 29, 1, 182]);
  assert.equal(o.healthDiscovery.pages.failed, 1);
});

test('finished first pages do not hide pending pagination, candidates, truncation or a stopped task', () => {
  const j = snapshot();
  Object.values(j.checkpoint.healthCoverage).forEach(c => Object.assign(c, { firstPage: 'done', pages: 1 }));
  j.checkpoint.work = [{ ...healthCategoryWork(plan)[0], page: 2 }];
  assert.equal(taskOverview(j, {}).percent, 100);
  assert.equal(taskOverview(j, {}).outcome, '商品资料处理中');
  assert.equal(taskOverview(j, {}).healthDiscovery.remainingWork, 5);
  j.checkpoint.pending = [];
  assert.equal(taskOverview(j, {}).outcome, '后续分页采集中');
  const first = Object.values(j.checkpoint.healthCoverage)[0];
  first.pages = 2;
  first.truncated = 'page_limit';
  j.status = 'partial'; j.checkpoint.work = [];
  const o = taskOverview(j, {});
  assert.match(o.outcome, /未完成/);
  assert.equal(o.healthDiscovery.pages.processed, 213);
  assert.equal(o.healthDiscovery.pages.truncated, 1);
  assert.equal(o.healthDiscovery.remainingWork, 0);
  j.cancelled = true;
  assert.match(taskOverview(j, {}).outcome, /已取消/);
});

test('actual runner advances coverage through all empty categories with a stable denominator', async () => {
  const j = job();
  const io = {
    now: () => 1000,
    pool: { query: async () => ({ rows: [{ cancelled: false }] }) },
    collect: async () => ({ products: [], sourceRows: 0 }),
    saveCheckpoint: async (_job, cp, status) => { j.checkpoint = cp; j.status = status; },
  };
  for (let n = 1; n <= 212; n++) {
    await runHealthDiscovery(j, io);
    const o = taskOverview(j, {});
    assert.deepEqual([o.processed, o.total], [n, 212]);
    assert.equal(o.healthDiscovery.products.accepted, 0);
    if (n < 212) assert.ok(o.percent < 100, 'unfinished categories never round up to 100%');
  }
  assert.notEqual(taskOverview(j, {}).outcome, '本次采集目标完成');
  await runHealthDiscovery(j, io);
  assert.equal(taskOverview(j, {}).outcome, '本次采集目标完成');
});

test('task list compaction preserves the structured progress; unversioned historical tasks keep their old projection', () => {
  const j = snapshot();
  const overview = taskOverview(j, {});
  assert.deepEqual(compactTask({ overview, steps: ['a', 'b'] }).overview, overview);
  delete j.input.plan.healthCoverageVersion;
  assert.equal(healthDiscoveryProgress(j), undefined);
  j.checkpoint.index = 5;
  assert.equal(taskOverview(j, {}).processed, 5);
  assert.equal(taskOverview(j, {}).healthDiscovery, undefined);
});
