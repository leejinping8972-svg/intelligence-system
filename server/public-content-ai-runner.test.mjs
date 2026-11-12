import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
/* oxlint-disable vitest/no-import-node-test -- Backend tests use node --test. */
import test from 'node:test';

import { executeContentJob, newContentJob } from './public-content-engine.mjs';

const result = (sample) => ({
  parsed: {
    items: sample.map((item) => ({
      id: item.id,
      titleZh: '中文标题',
      summaryZh: '中文摘要',
      quote: item.title,
      duplicateOf: '',
    })),
  },
  model: 'synthetic-model',
  promptVersion: 3,
  usage: { total_tokens: sample.length * 10, prompt_tokens: sample.length * 7 },
});
function fixture(count = 27, reused = 0) {
  let job = newContentJob(
    {
      query: 'creatine',
      market: 'US',
      language: 'en',
      sources: ['youtube'],
      scopes: ['local'],
      limit: 100,
      organize: true,
    },
    randomUUID(),
    'qa',
  );
  job.steps = [];
  const items = new Map(
    Array.from({ length: count }, (_, index) => {
      const id = `item-${index}`;
      return [
        id,
        {
          id,
          title: `Creatine ${index}`,
          summary: 'Original text',
          category: index % 2 ? 'health' : 'social',
          sourceLabel: 'Synthetic source',
          ...(index < reused
            ? { ai: { titleZh: '已有译文', summaryZh: '已有摘要' } }
            : {}),
        },
      ];
    }),
  );
  job.itemIds = [...items.keys()];
  let saved = structuredClone(job);
  const calls = [];
  const io = {
    getItem: async (id) => structuredClone(items.get(id)),
    getJob: async () => structuredClone(saved),
    saveJob: async (value) => {
      saved = structuredClone(value);
    },
    updateItem: async (id, transform) => {
      items.set(id, transform(items.get(id)));
    },
    organize: async (sample) => {
      calls.push(sample.map((item) => item.id));
      assert.equal(saved.aiStatus, 'running');
      assert.ok(saved.aiBatches.some((batch) => batch.status === 'running'));
      return result(sample);
    },
  };
  return {
    io,
    items,
    calls,
    get job() {
      return job;
    },
    get saved() {
      return saved;
    },
    run: () => executeContentJob(job, io),
    restart() {
      job = structuredClone(saved);
    },
  };
}

test('all 27 results are translated over multiple batches with cumulative usage', async () => {
  const f = fixture();
  await f.run();
  assert.deepEqual(
    f.calls.map((batch) => batch.length),
    [10, 10, 7],
  );
  assert.equal(new Set(f.calls.flat()).size, 27);
  assert.equal([...f.items.values()].filter((item) => item.ai).length, 27);
  assert.equal(f.job.aiCount, 27);
  assert.equal(f.job.aiTotal, 27);
  assert.equal(f.job.aiRequests, 3);
  assert.deepEqual(f.job.aiUsage, { total_tokens: 270, prompt_tokens: 189 });
  assert.equal(f.job.aiStatus, 'completed');
  assert.equal(f.job.status, 'completed');
});

test('batch processing has no overall AI count cap and reuses existing translations', async () => {
  const f = fixture(137, 12);
  await f.run();
  assert.equal(f.job.aiCount, 137);
  assert.equal(f.calls.flat().length, 125);
  assert.equal(f.calls.length, 13);
  assert.equal(f.items.get('item-0').ai.titleZh, '已有译文');
  assert.equal(f.job.aiUsage.total_tokens, 1250);
});

test('a failed middle batch retains successful translations and continues later batches', async () => {
  const f = fixture();
  const organize = f.io.organize;
  f.io.organize = async (sample) => {
    const response = await organize(sample);
    if (f.calls.length === 2) response.parsed.items[0].quote = 'invented quote';
    return response;
  };
  await f.run();
  assert.equal(f.calls.length, 3);
  assert.equal(f.job.aiCount, 17);
  assert.equal(f.job.aiStatus, 'partial');
  assert.equal(f.job.status, 'partial');
  assert.equal(f.job.aiUsage.total_tokens, 270);
  assert.match(f.job.aiMessage, /原文片段/);
  assert.equal(f.job.aiBatches[1].result.parsed.items.length, 10);
});

test('missing model rows are reported as partial without an automatic repeat', async () => {
  const f = fixture(11);
  f.io.organize = async (sample) => {
    f.calls.push(sample.map((item) => item.id));
    const response = result(sample);
    if (sample.length === 10) response.parsed.items.pop();
    return response;
  };
  await f.run();
  assert.equal(f.job.aiCount, 10);
  assert.equal(f.job.aiStatus, 'partial');
  assert.equal(f.job.status, 'partial');
  assert.match(f.job.aiMessage, /仅返回9\/10/);
  assert.equal(f.calls.length, 2);
});

test('storage failure after a response resumes the saved result without another model call', async () => {
  const f = fixture(23);
  const update = f.io.updateItem;
  let updated = 0;
  f.io.updateItem = async (id, transform) => {
    assert.ok(f.saved.aiBatches.some((batch) => batch.status === 'returned'));
    if (++updated === 4) throw new Error('synthetic storage outage');
    await update(id, transform);
  };
  await assert.rejects(f.run(), /storage outage/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.saved.aiBatches[0].status, 'returned');
  f.restart();
  f.io.updateItem = update;
  await f.run();
  assert.deepEqual(
    f.calls.map((batch) => batch.length),
    [10, 10, 3],
  );
  assert.equal(f.job.aiCount, 23);
  assert.equal(f.job.aiUsage.total_tokens, 230);
  assert.equal(f.job.aiStatus, 'completed');
});

test('lease loss never replays an in-flight batch, while unattempted batches continue', async () => {
  const f = fixture(23);
  const controller = new AbortController();
  const organize = f.io.organize;
  f.io.leaseSignal = controller.signal;
  f.io.organize = async (sample) => {
    const response = await organize(sample);
    controller.abort();
    return response;
  };
  await f.run();
  assert.equal(f.saved.aiBatches[0].status, 'running');
  f.restart();
  delete f.io.leaseSignal;
  f.io.organize = organize;
  await f.run();
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.flat()).size, 23);
  assert.equal(f.job.aiBatches[0].status, 'unknown');
  assert.equal(f.job.aiStatus, 'unknown');
  assert.equal(f.job.aiCount, 13);
  assert.equal(f.job.status, 'partial');
  assert.match(f.job.aiMessage, /未自动重复计费/);
});

test('graceful shutdown saves the current batch and resumes only unattempted batches', async () => {
  const f = fixture(23);
  const controller = new AbortController();
  const organize = f.io.organize;
  f.io.signal = controller.signal;
  f.io.organize = async (sample) => {
    const response = await organize(sample);
    controller.abort();
    return response;
  };
  await f.run();
  assert.equal(f.saved.aiBatches[0].status, 'completed');
  assert.equal(f.saved.status, 'running');
  assert.equal(f.saved.aiCount, 10);
  f.restart();
  delete f.io.signal;
  f.io.organize = organize;
  await f.run();
  assert.equal(f.calls.length, 3);
  assert.equal(new Set(f.calls.flat()).size, 23);
  assert.equal(f.job.aiCount, 23);
  assert.equal(f.job.status, 'completed');
});

test('cancellation retains the returned batch and prevents later model calls', async () => {
  const f = fixture(23);
  const organize = f.io.organize;
  f.io.organize = async (sample) => {
    const response = await organize(sample);
    f.io.getJob = async () => ({ status: 'cancelled' });
    return response;
  };
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.saved.aiCount, 10);
  assert.equal(f.saved.aiBatches[0].status, 'completed');
});

test('all-reused and empty result sets make zero model calls', async () => {
  const reused = fixture(27, 27);
  await reused.run();
  assert.equal(reused.calls.length, 0);
  assert.equal(reused.job.aiCount, 27);
  assert.equal(reused.job.aiModel, '复用已有整理');
  const empty = fixture(0);
  await empty.run();
  assert.equal(empty.calls.length, 0);
  assert.equal(empty.job.aiStatus, 'skipped');
});
