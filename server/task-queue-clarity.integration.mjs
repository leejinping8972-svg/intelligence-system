import assert from 'node:assert/strict';

import {
  competitorAction,
  competitorTick,
  createMonitorStore,
} from './competitor-monitor-store.mjs';
import { advanceTrendQueue } from './keyword-trends-engine.mjs';
import {
  drainTrendInbox,
  keywordTrendIO,
  keywordTrendsAction,
} from './keyword-trends-store.mjs';
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
export async function verifyQueueClarity(c) {
  const admin = { role: 'admin' };
  const db = createMonitorStore(c);
  await db.write('business:sites:queue-qa', {
    id: 'queue-qa',
    market: 'VN',
    domain: 'queue.example.test',
  });
  const { target } = await competitorAction(
    {
      action: 'server_competitor_save',
      kind: 'site',
      siteId: 'queue-qa',
      hour: 0,
      maxRequests: 4,
      enabled: true,
    },
    admin,
  );
  const entered = deferred();
  const hold = deferred();
  let calls = 0;
  const work = competitorTick(
    c,
    {
      scanSite: async (_site, request) => {
        await request('first', async () => {
          calls++;
          entered.resolve();
          await hold.promise;
          return {};
        });
        await assert.rejects(
          request('second', async () => {
            calls++;
            return {};
          }),
          /暂停/,
        );
        return { items: [], complete: false, errors: ['用户已暂停'] };
      },
    },
    { name: 'competitor:target:' + target.id },
  );
  await entered.promise;
  await competitorAction(
    {
      action: 'server_competitor_update',
      id: target.id,
      hour: 7,
      maxRequests: 6,
      enabled: true,
    },
    admin,
  );
  await competitorAction(
    { action: 'server_competitor_pause', id: target.id },
    admin,
  );
  assert.equal((await db.read('competitor:target:' + target.id)).hour, 7);
  hold.resolve();
  await work;
  assert.equal(calls, 1);
  assert.equal(
    (await db.read('competitor:target:' + target.id)).enabled,
    false,
  );
  const word = {
    id: 'queue-trend-qa',
    term: 'queue synthetic',
    market: 'VN',
    dataNature: 'collected',
    reviewStatus: 'selected',
  };
  await c.query(
    'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
    ['queue-trend-qa', word],
  );
  const submit = (source) =>
    keywordTrendsAction(
      {
        action: 'server_keyword_trends_collect',
        keywordIds: [word.id],
        plan: { sources: [source], maxRequests: 20, maxPages: 2 },
        budgetAcknowledged: true,
      },
      admin,
    );
  await submit('facebook');
  const sourceEntered = deferred();
  const sourceHold = deferred();
  const io = keywordTrendIO(c, {
    key: async () => 'synthetic',
    fetch: async () => {
      sourceEntered.resolve();
      await sourceHold.promise;
      return { items: [], exhausted: true, hasMore: false, creditsCharged: 1 };
    },
  });
  await drainTrendInbox(c, io);
  const running = advanceTrendQueue(io);
  await sourceEntered.promise;
  await submit('instagram');
  await keywordTrendsAction(
    {
      action: 'server_keyword_trends_save',
      plan: {
        enabled: false,
        sources: ['facebook', 'instagram'],
        maxRequests: 20,
        maxPages: 2,
      },
    },
    admin,
  );
  assert.equal((await io.db.list('keyword-trends:inbox:')).length, 1);
  sourceHold.resolve();
  await running;
  assert.equal(
    (await io.db.list('keyword-trends:inbox:')).length,
    1,
    'provider completion must not overwrite new submission',
  );
  await drainTrendInbox(c, io);
  const snapshot = await keywordTrendsAction(
    { action: 'server_keyword_trends_snapshot' },
    admin,
  );
  assert.ok(
    snapshot.run.work.some(
      (w) =>
        w.keywordId === word.id &&
        w.source === 'instagram' &&
        w.status === 'pending',
    ),
  );
  const old = Date.now() - 86400000;
  await io.db.write('keyword-trends:inbox:expired-qa', {
    words: [word],
    plan: { sources: ['tiktok'], maxRequests: 20, maxPages: 2 },
    now: old,
    submittedAt: old,
    trigger: 'manual',
  });
  await drainTrendInbox(c, io);
  assert.equal(
    (await io.db.read('keyword-trends:submission:expired-qa')).status,
    'expired',
  );
  const ordering = [];
  const now = Date.now();
  for (const [name, time, budget] of [
    ['z-first', now - 2, 18],
    ['a-last', now - 1, 19],
  ])
    await io.db.write('keyword-trends:inbox:' + name, {
      words: [],
      plan: { sources: [], maxRequests: budget, maxPages: 2 },
      now,
      submittedAt: time,
      trigger: 'manual',
    });
  const wrapped = {
    ...io,
    db: {
      ...io.db,
      write: async (name, value) => {
        if (name.startsWith('keyword-trends:run:')) ordering.push(value);
        return io.db.write(name, value);
      },
    },
  };
  await drainTrendInbox(c, wrapped);
  assert.deepEqual(
    ordering.map((r) => r.maxRequests),
    [18, 19],
  );
  assert.equal((await io.db.list('keyword-trends:inbox:')).length, 0);
  console.log(
    'Queue clarity SQL integration passed: save/pause during source wait, queued submissions survive running result, FIFO inbox drain, explicit cross-day expiry; no external calls.',
  );
}
