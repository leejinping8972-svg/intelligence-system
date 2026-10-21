/* oxlint-disable vitest/no-import-node-test -- Node server tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consumerTopics,
  consumerModelInput,
  insightSummary,
} from './consumer-topics.mjs';
import {
  aiPromptSnapshot,
  aiSystemText,
  AI_PROMPTS,
} from './ai-prompt-defaults.mjs';
import { aiPromptAction } from './ai-prompt-config.mjs';
import { normalizeEvidence, evidenceReport } from './research-evidence.mjs';
import { runInsightJob, validateInsight } from './insight-jobs.mjs';
const url = 'https://www.reddit.com/r/Supplements/comments/abc/topic/';
const records = [
  {
    id: 'a',
    text: 'expensive price',
    platform: 'Reddit',
    kind: 'post',
    url,
    sourceUrl: url,
    likes: 10,
  },
  {
    id: 'b',
    text: 'sugar dose?',
    platform: 'Reddit',
    kind: 'comment',
    url: `${url}b`,
    sourceUrl: url,
    likes: -5,
  },
];
test('topic counts, source pages and heat are computed from actual cited records', () => {
  const r = {
    modelAnalysis: {
      inputEvidenceCount: 2,
      findings: [
        {
          label: '配方',
          evidenceIds: ['a', 'a', 'b', 'invented'],
          count: 999,
          share: 99,
        },
      ],
    },
  };
  const [t] = consumerTopics(r, records);
  assert.equal(t.count, 2);
  assert.equal(t.sourceCount, 1);
  assert.equal(t.share, 100);
  assert.equal(t.engagement, 10);
  assert.deepEqual(t.evidenceIds, ['a', 'b']);
  assert.deepEqual(t.platforms, ['Reddit']);
});
test('legacy report summaries retain keyword links and rule topics without raw-text payloads', () => {
  const r = insightSummary({
    id: 'r',
    keywordIds: ['k'],
    statistics: evidenceReport(records),
    evidenceIds: ['a', 'b'],
  });
  assert.deepEqual(r.keywordIds, ['k']);
  assert.ok(r.topicSummary.some((t) => t.label === '价格与性价比'));
  assert.equal(r.topicSummary[0].share, 50);
  assert.ok(!JSON.stringify(r).includes('expensive'));
});
test('model sample gives different discussions a turn and favors comments over post text', () => {
  const all = [
    ...Array.from({ length: 150 }, (_, i) => ({ ...records[0], id: `p${i}` })),
    ...Array.from({ length: 100 }, (_, i) => ({ ...records[1], id: `c${i}` })),
    {
      ...records[1],
      id: 'other',
      sourceUrl: 'https://www.youtube.com/watch?v=test',
    },
  ];
  const sample = consumerModelInput(all);
  assert.equal(sample.length, 80);
  assert.equal(sample[0].kind, 'comment');
  assert.ok(sample.some((r) => r.id === 'other'));
  assert.equal(new Set(sample.map((r) => r.id)).size, 80);
});
test('all current model tasks have editable defaults and mandatory output contracts', () => {
  assert.deepEqual(Object.keys(AI_PROMPTS).toSorted(), [
    'ad_report',
    'consumer_report',
    'keyword_translation',
    'public_content',
  ]);
  const a = aiPromptSnapshot('consumer_report'),
    b = aiPromptSnapshot('consumer_report', {
      text: '新业务重点，关注消费者在标签和配方上的问题以及内容建议。',
    });
  assert.notEqual(a.version, b.version);
  assert.equal(a.systemContract, b.systemContract);
  assert.match(aiSystemText(b), /不得编造/);
  assert.throws(() => aiPromptSnapshot('bogus'));
});
test('prompt saves require admin and current version, serialize writers and never call a model', async () => {
  let stored = {},
    writes = 0,
    released = 0;
  const io = {
    current: async (key) => aiPromptSnapshot(key, stored),
    connect: async () => ({
      release() {
        released++;
      },
    }),
    lock: async () => true,
    unlock: async () => {},
    put: async (_t, _n, v) => {
      writes++;
      stored = v;
    },
  };
  const input = {
    action: 'server_ai_prompt_save',
    key: 'consumer_report',
    text: '请重点归纳消费者的配方剂量疑问与购买顾虑，并给出简短的验证建议。',
    version: aiPromptSnapshot('consumer_report').version,
  };
  await assert.rejects(
    () => aiPromptAction(input, { role: 'researcher' }, io),
    /管理员/,
  );
  await aiPromptAction(input, { role: 'admin' }, io);
  assert.equal(writes, 1);
  assert.equal(released, 1);
  await assert.rejects(
    () => aiPromptAction(input, { role: 'admin' }, io),
    /已更新/,
  );
  assert.equal(writes, 1);
  assert.equal(released, 2);
  await assert.rejects(
    () => aiPromptAction({ ...input, key: '__proto__' }, { role: 'admin' }, io),
    /未知/,
  );
});
test('Facebook public post comments keep original text, parent source, reaction count and ISO date', () => {
  const u = 'https://www.facebook.com/posts/123';
  const r = normalizeEvidence(
    {
      comments: [
        {
          id: 'fb1',
          text: 'Dose?',
          reaction_count: 7,
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    },
    { kind: 'facebook_comments', url: u, market: 'US' },
  ).records[0];
  assert.equal(r.platform, 'Facebook');
  assert.equal(r.likes, 7);
  assert.equal(r.sourceUrl, u);
  assert.equal(r.postedAt, '2026-10-01T00:00:00Z');
  assert.throws(
    () =>
      validateInsight({
        kind: 'consumer_research',
        market: 'US',
        sourceKind: 'facebook_comments',
        urls: 'https://news.example/article',
      }),
    /HTTPS/,
  );
});
function jobIO() {
  const store = new Map();
  const calls = [];
  const saves = [];
  return {
    store,
    calls,
    saves,
    io: {
      cancelled: async () => false,
      read: async (key) => store.get(key),
      put: async (key, v) => store.set(key, structuredClone(v)),
      saveCheckpoint: async (_job, cp, status) =>
        saves.push({ cp: structuredClone(cp), status }),
      collect: async (_j, step, request) => {
        calls.push({ step, request });
        return {
          records: [request.kind === 'reddit_search' ? records[0] : records[1]],
          cursor: '',
          creditsCharged: 1,
        };
      },
    },
  };
}
test('new opted-in research discovers Reddit posts then samples comments within the same request cap', async () => {
  const { io, calls, store } = jobIO();
  const input = validateInsight({
    kind: 'consumer_research',
    market: 'US',
    sourceKind: 'reddit_search',
    query: 'creatine',
    keywordIds: ['k'],
    autoComments: true,
    maxPages: 1,
    maxRequests: 2,
  });
  await runInsightJob({ id: 'sample', input }, io);
  assert.deepEqual(
    calls.map((c) => c.request.kind),
    ['reddit_search', 'reddit_comments'],
  );
  const report = store.get('insightReports:sample');
  assert.equal(report.evidenceIds.length, 2);
  assert.equal(report.requests, 2);
  assert.ok(report.topicSummary.length);
  assert.deepEqual(report.keywordIds, ['k']);
});
test('legacy jobs never expand scope; budget exhaustion and cancellation prevent added requests', async () => {
  for (const [autoComments, maxRequests, expected] of [
    [false, 10, 1],
    [true, 1, 1],
  ]) {
    const { io, calls, store } = jobIO();
    const input = validateInsight({
      kind: 'consumer_research',
      market: 'US',
      sourceKind: 'reddit_search',
      query: 'x',
      autoComments,
      maxRequests,
      maxPages: 1,
    });
    await runInsightJob({ id: 'sample', input }, io);
    assert.equal(calls.length, expected);
    if (autoComments)
      assert.equal(store.get('insightReports:sample').status, 'partial');
  }
});
test('resuming completed comment sampling reuses checkpoints without provider calls', async () => {
  const { io, store, calls } = jobIO();
  records.forEach((r) => store.set(`researchEvidence:${r.id}`, r));
  const input = validateInsight({
    kind: 'consumer_research',
    market: 'US',
    sourceKind: 'reddit_search',
    query: 'x',
    autoComments: true,
    maxPages: 1,
  });
  await runInsightJob(
    {
      id: 'resumed',
      input,
      checkpoint: {
        index: 1,
        commentTargets: [url],
        commentIndex: 1,
        commentPage: 0,
        requests: 2,
        evidenceIds: ['a', 'b'],
      },
    },
    io,
  );
  assert.equal(calls.length, 0);
  assert.equal(store.get('insightReports:resumed').evidenceIds.length, 2);
});
