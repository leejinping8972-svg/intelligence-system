import assert from 'node:assert/strict';
import test from 'node:test';

import { validateJob } from './domain.mjs';
import { dispatchResearchTrends } from './keyword-research-trends.mjs';
import { researchSignature } from './keyword-submit.mjs';
import { trendDay } from './keyword-trends-domain.mjs';
import { advanceTrendQueue, trendAction } from './keyword-trends-engine.mjs';
import { runJob } from './runner.mjs';

const now = Date.parse('2026-10-27T04:00:00Z');
const word = { id: 'canonical', term: 'magnesium', market: 'US', dataNature: 'collected', source: 'seed', siteIds: [], productIds: [] };
const socialTrends = { sources: ['tiktok', 'instagram', 'facebook'], maxRequests: 100, maxPages: 11, budgetAcknowledged: true };
const input = (extra = {}) => validateJob({ seeds: ['magnesium'], markets: ['US'], sources: ['google_autocomplete'], limit: 1, socialTrends, ...extra });
function fixture() {
  const values = new Map();
  const db = {
    read: async name => structuredClone(values.get(name)),
    write: async (name, value) => { values.set(name, structuredClone(value)); },
    list: async prefix => [...values].filter(([name]) => name.startsWith(prefix)).map(([name, value]) => ({ name, value: structuredClone(value) })),
    commitResult: async fn => {
      const before = structuredClone(values);
      try { await fn(); }
      catch (error) { values.clear(); for (const [name, value] of before) values.set(name, value); throw error; }
    },
  };
  return { db, values, now, keywords: async () => [word], researchActive: async () => true, key: async () => { throw new Error('No provider access in tests'); } };
}
test('research validates explicit sources and credit consent; old jobs remain opted out', () => {
  assert.equal(input({ socialTrends: undefined }).socialTrends, undefined);
  for (const invalid of [{ ...socialTrends, budgetAcknowledged: false }, { ...socialTrends, sources: ['google'] }, { ...socialTrends, sources: [] }, { ...socialTrends, maxPages: 101 }])
    assert.throws(() => input({ socialTrends: invalid }));
  const a = input(); const b = input({ socialTrends: { ...socialTrends, sources: [...socialTrends.sources].reverse() } });
  assert.equal(researchSignature(a), researchSignature(b));
  assert.notEqual(researchSignature(a), researchSignature(input({ socialTrends: undefined })));
  assert.equal(researchSignature(a), researchSignature(input({ socialTrends: { ...socialTrends, maxRequests: 0 } })));
  assert.notEqual(researchSignature(a), researchSignature(input({ socialTrends: { ...socialTrends, maxPages: 10 } })));
});
test('durable dispatch survives checkpoint loss across midnight and same-day overlap deduplicates', async () => {
  const io = fixture(); const job = { id: 'research-a', input: input() };
  const result = await dispatchResearchTrends(io, job, [word], now);
  assert.equal(result.accepted, 3);
  assert.deepEqual(await dispatchResearchTrends(io, job, [word], now + 86400000), result);
  assert.equal(await io.db.read(`keyword-trends:run:${trendDay(now + 86400000)}`), undefined);
  const second = await dispatchResearchTrends(io, { ...job, id: 'research-b' }, [word], now);
  assert.equal(second.reused, 3);
  const run = await io.db.read(`keyword-trends:run:${trendDay(now)}`);
  assert.equal(run.work.length, 3);
  assert.deepEqual(run.work[0].researchParents, ['research-a', 'research-b']);
  assert.ok(run.work.every(work => work.keywordId === word.id));
  const snapshot = await trendAction({ action: 'server_keyword_trends_snapshot', keywordIds: [word.id] }, { role: 'researcher' }, io);
  assert.equal(snapshot.summaries.length, 3);
  assert.ok(snapshot.summaries.every(row => row.status === 'pending' && !row.collectedAt));
});
test('failed dispatch rolls back both queue and marker; cancellation spends no provider request', async () => {
  const io = fixture(); const job = { id: 'research-a', input: input() };
  const write = io.db.write;
  io.db.write = async (name, value) => {
    if (name.includes(':research:')) throw new Error('disk unavailable');
    await write(name, value);
  };
  await assert.rejects(dispatchResearchTrends(io, job, [word], now), /disk unavailable/);
  assert.equal(io.values.size, 0);
  io.db.write = write;
  await dispatchResearchTrends(io, job, [word], now);
  io.researchActive = async () => false;
  await advanceTrendQueue(io);
  const run = await io.db.read(`keyword-trends:run:${trendDay(now)}`);
  assert.equal(run.work[0].status, 'skipped');
  assert.equal((await io.db.list('keyword-trends:request:')).length, 0);
});
test('research dispatches canonical words before metrics and Google; busy queue resumes without rediscovery', async () => {
  let busy = true; let cp = {}; let submissions = 0;
  const order = [];
  const job = { id: 'runner-qa', input: input({ sources: ['semrush'] }), checkpoint: cp };
  const io = {
    now: () => now, checkCancelled: async () => {}, usage: async () => ({ confirmed: 0, reserved: 0 }),
    saveKeyword: async record => ({ ...record, id: word.id }),
    saveCheckpoint: async (_job, value) => { cp = structuredClone(value); },
    patchCollection: async () => {},
    collect: async () => { order.push('metrics'); return { message: 'synthetic' }; },
    submitResearchTrends: async (_job, words) => {
      submissions++; assert.equal(words[0].id, word.id);
      if (busy) return null;
      order.push('social'); return { accepted: 3, reused: 0 };
    },
  };
  await runJob(job, io);
  assert.equal(cp.waitReason, 'social_queue');
  assert.equal(cp.discoveryComplete, true);
  assert.equal(order.length, 0);
  busy = false;
  await runJob({ ...job, checkpoint: { ...cp, nextRunAt: 0 } }, io);
  assert.deepEqual(order, ['social', 'metrics']);
  assert.equal(cp.trendQueueVersion, 1);
  assert.equal(submissions, 2);
  await runJob({ ...job, checkpoint: cp }, io);
  assert.equal(submissions, 2);
});
