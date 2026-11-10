import assert from 'node:assert/strict';
// oxlint-disable-next-line vitest/no-import-node-test -- this Worker package uses Node's test runner
import test from 'node:test';
import { fetchGoogleTrendsBatch } from './src/index.js';
import { sourceLane } from './src/source-scheduler.js';

for (const sessionStatus of [200, 429]) {
  test(`Cookie-page ${sessionStatus} cookies reach both data endpoints without a host cooldown`, async () => {
    const original = globalThis.fetch;
    const calls = [],
      events = [];
    globalThis.fetch = async (url, init) => {
      init.signal.throwIfAborted();
      calls.push(new URL(url).pathname);
      if (!String(url).includes('/api/'))
        return new Response('', {
          status: sessionStatus,
          headers: { 'set-cookie': 'NID=fixture; Path=/; Secure' },
        });
      assert.equal(init.headers.cookie, 'NID=fixture');
      if (String(url).includes('/api/explore'))
        return Response.json({
          widgets: [{ id: 'TIMESERIES', token: 'fixture-token', request: {} }],
        });
      return Response.json({
        default: {
          timelineData: [
            { time: '1794009600', value: [40] },
            { time: '1794096000', value: [50] },
          ],
        },
      });
    };
    try {
      const [row] = await fetchGoogleTrendsBatch(
        ['fixture'],
        'US',
        'today 3-m',
        {
          includeInsights: false,
          onEvent: (event) => events.push(event),
        },
      );
      assert.equal(row.points.length, 2);
      assert.equal(row.resolution, 'day');
      assert.equal(calls.length, 3);
      assert.ok(sourceLane('site:trends.google.com').nextAt <= Date.now());
      assert.ok(
        events.some(
          (event) =>
            event.stage === 'session' && event.httpStatus === sessionStatus,
        ),
      );
      assert.ok(!JSON.stringify(events).includes('NID=fixture'));
    } finally {
      globalThis.fetch = original;
    }
  });
}

test('a data 429 stops at that endpoint and preserves its Retry-After', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return String(url).includes('/api/')
      ? new Response('', { status: 429, headers: { 'retry-after': '7' } })
      : new Response('', {
          status: 429,
          headers: { 'set-cookie': 'NID=fixture' },
        });
  };
  try {
    await assert.rejects(fetchGoogleTrendsBatch(['fixture'], 'US'), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 7);
      return true;
    });
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test('an explicitly service-wide Cookie-page limit stops the chain', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response('', {
      status: 429,
      headers: { 'ratelimit-scope': 'service', 'retry-after': '20' },
    });
  };
  try {
    await assert.rejects(fetchGoogleTrendsBatch(['fixture'], 'US'), (error) => {
      assert.equal(error.serviceLimited, true);
      assert.equal(error.retryAfterSeconds, 20);
      return true;
    });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
