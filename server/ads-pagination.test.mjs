import assert from 'node:assert/strict';
import test from 'node:test';

import { runMarketJob, validateMarketJob } from './market-jobs.mjs';
import { estimateTask } from './task-estimate.mjs';
import { researchDraft } from './task-research.mjs';

function fixture(input = {}) {
  const job = {
    id: 'synthetic-ads-pagination',
    input: {
      ...validateMarketJob({ kind: 'ads', keywordIds: ['k'], adPagination: 'until_target', ...input }),
      records: [{ id: 'k', term: 'synthetic', market: 'US' }],
    },
    checkpoint: {},
  };
  const docs = new Map();
  const states = [];
  const calls = [];
  let keyword = { reviewStatus: 'selected', adCollection: { jobId: job.id, status: 'queued' } };
  const io = {
    isCancelled: async () => false,
    readKeyword: async () => structuredClone(keyword),
    patchCollection: async (_id, field, patch) => { keyword[field] = structuredClone(patch); },
    readDoc: async (key) => docs.get(key),
    mergeBusiness: async (key, value) => docs.set(key, structuredClone(value)),
    collect: async (_job, step, request) => {
      calls.push({ step, cursor: request.cursor });
      const page = Number(request.cursor || 0);
      return { ads: Array.from({ length: 24 }, (_, i) => ({ id: `ad-${page * 24 + i}`, landingUrls: [] })), cursor: String(page + 1), creditsCharged: 1 };
    },
    saveCheckpoint: async (_job, cp, status) => { states.push({ cp: structuredClone(cp), status }); },
  };
  return { job, io, docs, states, calls, keyword: () => keyword };
}

test('manual pagination defaults to 1000 and removes maxPages; frozen bounded jobs retain defaults', () => {
  const manual = validateMarketJob({ kind: 'ads', terms: ['synthetic'], market: 'US', adPagination: 'until_target', maxPages: 1 });
  assert.equal(manual.maxAds, 1000);
  assert.equal(manual.maxPages, undefined);
  assert.equal(manual.adStatus, 'ACTIVE');
  const bounded = validateMarketJob({ kind: 'ads', keywordIds: ['k'], maxPages: 1, maxAds: 20 });
  assert.equal(bounded.maxPages, 1);
  assert.equal(bounded.maxAds, 20);
  assert.equal(bounded.adPagination, undefined);
  assert.equal(validateMarketJob({ kind: 'ads', keywordIds: ['k'] }).maxPages, 3);
  for (const maxAds of [0, 1001, 1.5, '1000']) {
    assert.throws(() => validateMarketJob({ kind: 'ads', keywordIds: ['k'], adPagination: 'until_target', maxAds }));
  }
  assert.throws(() => validateMarketJob({ kind: 'ads', keywordIds: ['k'], adPagination: 'other' }));
});

test('collects 1000 unique ads beyond ten pages and truncates the final page without another request', async () => {
  const h = fixture();
  h.job.input.maxRequests = 1; // Retired request limits must not truncate a manual job either.
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls.length, 42);
  assert.equal(h.calls.at(-1).step, 'ads:0:41');
  assert.equal(h.docs.size, 1000);
  assert.equal(h.states.at(-1).cp.ads, 1000);
  assert.equal(h.states.at(-1).cp.requests, 42);
  assert.equal(h.states.at(-1).status, 'completed');
  assert.match(h.keyword().adCollection.message, /达到本词广告数量上限/);
});

test('empty pages and duplicates do not count toward the quantity target or impose a hidden page cap', async () => {
  const h = fixture({ maxAds: 3 });
  h.io.collect = async (_job, step, request) => {
    h.calls.push({ step, cursor: request.cursor });
    const page = Number(request.cursor || 0);
    const ids = page < 12 ? [] : page === 12 ? ['a', 'a', 'b'] : ['a', 'c', 'd'];
    return { ads: ids.map((id) => ({ id, landingUrls: [] })), cursor: String(page + 1), creditsCharged: 1 };
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls.length, 14);
  assert.deepEqual([...h.docs.keys()], ['ads:a', 'ads:b', 'ads:c']);
  assert.equal(h.states.at(-1).cp.ads, 3);
});

test('source exhaustion preserves the actual count and survives a restart at the last page checkpoint', async () => {
  const h = fixture();
  h.io.collect = async () => ({ ads: [{ id: 'only', landingUrls: [] }], cursor: '', creditsCharged: 1 });
  await runMarketJob(h.job, h.io);
  assert.equal(h.states.at(-1).cp.ads, 1);
  assert.match(h.keyword().adCollection.message, /来源分页已结束/);
  h.job.checkpoint = h.states.find((state) => state.cp.recordSourceEnded).cp;
  h.io.collect = async () => { throw new Error('must not restart the first page'); };
  await runMarketJob(h.job, h.io);
  assert.equal(h.states.at(-1).status, 'completed');
  assert.equal(h.states.at(-1).cp.requests, 1);
});

test('a restart continues the saved cursor, count and journal step past the old page limit', async () => {
  const h = fixture();
  // Cancel between pages instead of during page persistence.
  let cancel = false;
  h.io.isCancelled = async () => cancel;
  const normalSave = h.io.saveCheckpoint;
  h.io.saveCheckpoint = async (job, cp, status) => {
    await normalSave(job, cp, status);
    if (cp.page === 11) cancel = true;
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.states.at(-1).status, 'cancelled');
  assert.equal(h.states.at(-1).cp.ads, 264);
  h.job.checkpoint = h.states.at(-1).cp;
  cancel = false;
  await runMarketJob(h.job, h.io);
  assert.equal(h.calls[11].cursor, '11');
  assert.equal(h.calls[11].step, 'ads:0:11');
  assert.equal(h.calls.length, 42);
  assert.equal(h.states.at(-1).cp.ads, 1000);
});

test('each keyword gets its own quantity target and starts with a fresh cursor', async () => {
  const h = fixture({ maxAds: 25 });
  h.job.input.records.push({ id: 'k2', term: 'second synthetic', market: 'US' });
  h.io.collect = async (_job, step, request) => {
    h.calls.push({ step, cursor: request.cursor });
    const page = Number(request.cursor || 0);
    return { ads: Array.from({ length: 24 }, (_, i) => ({ id: `${request.record.id}-${page * 24 + i}`, landingUrls: [] })), cursor: String(page + 1), creditsCharged: 1 };
  };
  await runMarketJob(h.job, h.io);
  assert.equal(h.states.at(-1).status, 'completed');
  assert.equal(h.states.at(-1).cp.ads, 50);
  assert.equal(h.docs.size, 50);
  assert.equal(h.calls[2].step, 'ads:1:0');
  assert.equal(h.calls[2].cursor, '');
});

for (const cycle of [['a', 'a'], ['a', 'b', 'a']]) {
  test(`repeated/cyclic cursors stop as partial and cannot be replayed after restart: ${cycle.join(' > ')}`, async () => {
    const h = fixture();
    h.io.collect = async (_job, step) => {
      const index = h.calls.length;
      h.calls.push({ step });
      return { ads: [{ id: `ad-${index}`, landingUrls: [] }], cursor: cycle[index], creditsCharged: 1 };
    };
    await runMarketJob(h.job, h.io);
    assert.equal(h.calls.length, cycle.length);
    assert.equal(h.states.at(-1).status, 'partial');
    assert.equal(h.states.at(-1).cp.ads, cycle.length);
    assert.equal(h.keyword().adCollection.status, 'partial');
    assert.match(h.states.at(-1).cp.logs.at(-1), /分页游标重复/);
    h.job.checkpoint = h.states.at(-1).cp;
    await runMarketJob(h.job, h.io);
    assert.equal(h.calls.length, cycle.length);
    assert.equal(h.states.at(-1).status, 'partial');
  });
}

test('quota/unknown request errors preserve the checkpoint without automatic retries', async () => {
  for (const message of ['429 额度不足', '请求结果未知，禁止自动重放']) {
    const h = fixture();
    const collect = h.io.collect;
    h.io.collect = async (...args) => {
      if (h.calls.length === 1) throw new Error(message);
      return collect(...args);
    };
    await runMarketJob(h.job, h.io);
    assert.equal(h.calls.length, 1);
    assert.equal(h.states.at(-1).status, 'partial');
    assert.equal(h.states.at(-1).cp.page, 1);
    assert.equal(h.states.at(-1).cp.cursor, '1');
    assert.equal(h.states.at(-1).cp.ads, 24);
  }
});

test('repeat research preserves unlimited pagination and estimates do not invent a fixed request/time cap', () => {
  const h = fixture();
  const draft = researchDraft(h.job);
  const validated = validateMarketJob({ ...draft.input, keywordIds: ['k'] });
  assert.equal(validated.adPagination, 'until_target');
  assert.equal(validated.maxPages, undefined);
  assert.equal(validated.maxAds, 1000);
  const estimate = estimateTask(validated, [], [{ input: { kind: 'ads' }, status: 'running' }]);
  assert.equal(estimate.estimatedCalls, null);
  assert.equal(estimate.minSeconds, null);
  assert.equal(estimate.maxSeconds, null);
  assert.equal(estimate.ahead, 1);
  assert.match(estimate.note, /1000/);
  assert.equal(estimateTask({ kind: 'ads', keywordIds: ['k'], maxPages: 2 }).estimatedCalls, 2);
});
