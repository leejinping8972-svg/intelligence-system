import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- this Worker package uses Node's test runner
import test from 'node:test';
import { scheduledFetch, sourceLane } from './src/source-scheduler.js';

test('network timeout starts after lane wait; caller cancellation remains effective', async () => {
  const original = globalThis.fetch;
  const waits = [];
  const lane = sourceLane('site:scheduler-test.example');
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    init.signal.throwIfAborted();
    return new Response('ok');
  };
  try {
    lane.nextAt = Date.now() + 80;
    const response = await scheduledFetch(
      'https://scheduler-test.example/',
      {},
      {
        timeoutMs: 20,
        intervalMs: 0,
        onWait: (ms) => waits.push(ms),
      },
    );
    assert.equal(response.status, 200);
    assert.ok(waits[0] > 20);
    const controller = new AbortController();
    controller.abort(new Error('user cancelled'));
    await assert.rejects(
      scheduledFetch(
        'https://scheduler-test.example/',
        {
          signal: controller.signal,
        },
        { timeoutMs: 20, intervalMs: 0 },
      ),
      /user cancelled/,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('the new timeout still aborts a slow network request', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('late')), 100);
      init.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(init.signal.reason);
        },
        { once: true },
      );
    });
  try {
    await assert.rejects(
      scheduledFetch(
        'https://slow-test.example/',
        {},
        {
          timeoutMs: 20,
          intervalMs: 0,
        },
      ),
      { name: 'TimeoutError' },
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('other sources retain the existing default 429 cooldown', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 429 });
  try {
    await scheduledFetch('https://default-test.example/', {});
    assert.ok(
      sourceLane('site:default-test.example').nextAt >= Date.now() + 59_000,
    );
  } finally {
    globalThis.fetch = original;
  }
});
