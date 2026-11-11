import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advanceRelatedDaily,
  buildRelatedRun,
  RELATED_RUN,
  relatedSubmission,
} from './keyword-related-daily.mjs';
import {
  currentTrendPlan,
  defaultTrendPlan,
  trendDay,
  validateTrendPlan,
} from './keyword-trends-domain.mjs';

const now = Date.parse('2026-11-11T02:00:00Z');
const word = {
  id: 'qa-us',
  term: 'synthetic fiber',
  market: 'US',
  reviewStatus: 'selected',
  dataNature: 'imported',
};
const plan = (extra = {}) =>
  validateTrendPlan({
    ...defaultTrendPlan,
    enabled: true,
    relatedSources: ['products', 'ads', 'sites'],
    budgetAcknowledged: true,
    ...extra,
  });
function fixture(extra = {}) {
  const calls = [];
  const jobs = new Map();
  const values = new Map([['keyword-trends:plan', plan()]]);
  const words = [word];
  const io = {
    now,
    values,
    jobs,
    calls,
    words,
    db: {
      read: async (name) => structuredClone(values.get(name)),
      write: async (name, value) => values.set(name, structuredClone(value)),
    },
    latestRelatedRun: async () =>
      structuredClone(
        [...values]
          .filter(([name]) => name.startsWith(RELATED_RUN))
          .sort(([a], [b]) => b.localeCompare(a))[0]?.[1],
      ),
    keywords: async () => structuredClone(words),
    relatedKeyword: async (id) =>
      structuredClone(words.find((k) => k.id === id)),
    relatedJob: async (id) =>
      structuredClone([...jobs.values()].find((j) => j.id === id)),
    findRelatedRequest: async (id) => structuredClone(jobs.get(id)),
    submitRelated: async (kind, input) => {
      calls.push({ kind, input });
      const job = {
        id: `job-${calls.length}`,
        status: 'queued',
        checkpoint: {},
      };
      jobs.set(input.requestId, job);
      return job;
    },
    ...extra,
  };
  io.run = () => io.latestRelatedRun();
  io.finish = (patch = {}) => {
    for (const job of jobs.values())
      Object.assign(job, { status: 'completed', ...patch });
  };
  return io;
}

test('old plans preserve trend monitoring without enabling new related calls; limits are validated', () => {
  assert.deepEqual(
    currentTrendPlan({ enabled: true, comparisonVersion: 2 }).relatedSources,
    [],
  );
  assert.equal(
    currentTrendPlan({ enabled: true, comparisonVersion: 2 }).enabled,
    true,
  );
  assert.equal(currentTrendPlan({ enabled: true }).enabled, false);
  for (const invalid of [
    { relatedSources: ['bad'] },
    { productProviders: [] },
    { relatedProducts: 101 },
    { relatedAdPages: 0 },
    { relatedAds: 1.5 },
    { relatedSites: 11 },
  ])
    assert.throws(() => plan(invalid));
  assert.throws(
    () => validateTrendPlan({ ...plan(), budgetAcknowledged: false }),
    /确认/,
  );
});

test('daily list includes selected supported markets only and filters unsupported Sorftime VN without substitution', () => {
  const words = [
    word,
    { ...word, id: 'qa-vn', market: 'VN' },
    { ...word, id: 'demo', dataNature: 'demo' },
    { ...word, id: 'pending', reviewStatus: 'pending' },
    { ...word, id: 'mx', market: 'MX' },
  ];
  const run = buildRelatedRun(plan({ markets: ['US', 'VN'] }), words, now);
  assert.equal(run.selectedCount, 2);
  assert.equal(run.work.length, 6);
  assert.deepEqual(
    run.work.find((e) => e.market === 'VN' && e.kind === 'products').providers,
    ['semrush'],
  );
  const unsupported = buildRelatedRun(
    plan({ markets: ['VN'], productProviders: ['sorftime'] }),
    words,
    now,
  );
  assert.equal(
    unsupported.work.find((e) => e.kind === 'products').status,
    'skipped',
  );
  assert.equal(new Set(run.work.map((e) => e.requestId)).size, 6);
  const p = relatedSubmission(
    run,
    run.work.find((e) => e.kind === 'products' && e.market === 'US'),
  );
  assert.equal(p.discoveryDay, '2026-11-11');
  assert.equal(p.perKeyword, 10);
  assert.equal(p.maxProducts, 20);
});

test('three independent child queues submit once, persist IDs, and expose actual completion states', async () => {
  const io = fixture();
  await advanceRelatedDaily({ ...io, now: now - 2 * 3600_000 });
  assert.equal(io.calls.length, 0);
  for (let i = 0; i < 3; i++) {
    await advanceRelatedDaily(io);
    await advanceRelatedDaily(io);
    assert.equal(io.calls.length, i + 1);
    io.finish();
  }
  await advanceRelatedDaily(io);
  await advanceRelatedDaily(io);
  assert.deepEqual(
    io.calls.map((c) => c.kind),
    ['products', 'ads', 'sites'],
  );
  assert.ok((await io.run()).work.every((e) => e.status === 'completed'));
  assert.equal(io.calls[1].input.includeSearchSites, false);
  assert.deepEqual(io.calls[2].input.keywordIds, [word.id]);
});

test('restart after child insertion and before scheduler checkpoint recovers the stable request without a second submit', async () => {
  const io = fixture();
  await advanceRelatedDaily(io);
  const run = await io.run();
  delete run.work[0].jobId;
  run.work[0].status = 'pending';
  await io.db.write(RELATED_RUN + run.day, run);
  await advanceRelatedDaily(io);
  assert.equal(io.calls.length, 1);
  assert.equal((await io.run()).work[0].jobId, 'job-1');
});

test('submission response lost after commit recovers existing job immediately', async () => {
  const io = fixture();
  const submit = io.submitRelated;
  io.submitRelated = async (...args) => {
    await submit(...args);
    throw new Error('response lost');
  };
  await advanceRelatedDaily(io);
  assert.equal((await io.run()).work[0].jobId, 'job-1');
  await advanceRelatedDaily(io);
  assert.equal(io.calls.length, 1);
});

test('pause stops unsubmitted steps and preserves already queued child', async () => {
  const io = fixture();
  await advanceRelatedDaily(io);
  io.values.set('keyword-trends:plan', plan({ enabled: false }));
  await advanceRelatedDaily(io);
  const run = await io.run();
  assert.equal(run.work[0].status, 'queued');
  assert.ok(run.work.slice(1).every((e) => e.status === 'skipped'));
  io.finish();
  await advanceRelatedDaily(io);
  assert.equal(io.calls.length, 1);
});

test('next day skips old pending work and creates a fresh same-day plan after prior child finishes', async () => {
  const io = fixture();
  await advanceRelatedDaily(io);
  const tomorrow = { ...io, now: now + 86400_000 };
  await advanceRelatedDaily(tomorrow);
  assert.equal(io.calls.length, 1);
  assert.ok(
    (await io.run()).work.slice(1).every((e) => e.status === 'skipped'),
  );
  io.finish();
  await advanceRelatedDaily(tomorrow);
  assert.equal(io.calls.length, 2);
  assert.equal((await io.run()).day, trendDay(tomorrow.now));
  assert.notEqual(io.calls[0].input.requestId, io.calls[1].input.requestId);
});

test('removed, edited, demo or deselected keywords and removed markets are rechecked before submission', async () => {
  for (const patch of [
    { reviewStatus: 'pending' },
    { term: 'edited' },
    { market: 'VN' },
    { dataNature: 'demo' },
  ]) {
    const io = fixture();
    await io.db.write(
      RELATED_RUN + trendDay(now),
      buildRelatedRun(plan(), [word], now),
    );
    Object.assign((io.words[0] = { ...word }), patch);
    await advanceRelatedDaily(io);
    assert.equal(io.calls.length, 0);
    assert.equal((await io.run()).work[0].status, 'skipped');
  }
  const io = fixture();
  await io.db.write(
    RELATED_RUN + trendDay(now),
    buildRelatedRun(plan(), [word], now),
  );
  io.values.set('keyword-trends:plan', plan({ markets: ['MX'] }));
  await advanceRelatedDaily(io);
  assert.equal(io.calls.length, 0);
});

test('busy submission waits a minute while another independent kind can proceed; deterministic config failure stays visible', async () => {
  const io = fixture();
  const submit = io.submitRelated;
  io.submitRelated = async (kind, input) => {
    if (kind === 'products') throw new Error('已有任务，请等待');
    return submit(kind, input);
  };
  await advanceRelatedDaily(io);
  assert.equal((await io.run()).work[0].retryAt, now + 60000);
  await advanceRelatedDaily(io);
  assert.equal(io.calls[0].kind, 'ads');
  io.finish();
  io.submitRelated = async () => {
    throw new Error('请先配置来源');
  };
  await advanceRelatedDaily({ ...io, now: now + 61000 });
  assert.equal((await io.run()).work[0].status, 'failed');
});

test('unknown charges stop the remaining same-channel work while preserving independent types', async () => {
  const io = fixture();
  io.words.push({ ...word, id: 'qa-other', term: 'synthetic other' });
  await advanceRelatedDaily(io);
  const first = (await io.run()).work[0];
  io.finish({
    status: 'partial',
    checkpoint: { unknownCharges: 1, logs: ['结果未知'] },
  });
  await advanceRelatedDaily(io);
  const run = await io.run();
  assert.ok(
    run.work
      .filter((e) => e.kind === first.kind && e.key !== first.key)
      .every((e) => e.status === 'skipped'),
  );
  assert.equal(io.calls[1].kind, 'ads');
});

test('disabled types stop pending steps and missing child jobs are not automatically resubmitted', async () => {
  const io = fixture();
  await advanceRelatedDaily(io);
  io.values.set(
    'keyword-trends:plan',
    plan({ relatedSources: ['products', 'sites'] }),
  );
  io.jobs.clear();
  await advanceRelatedDaily(io);
  const run = await io.run();
  assert.equal(run.work[0].status, 'failed');
  assert.equal(run.work[1].status, 'skipped');
  assert.equal(io.calls[1].kind, 'sites');
});
