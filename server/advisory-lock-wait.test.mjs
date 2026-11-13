import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForAdvisoryLock } from './advisory-lock-wait.mjs';

test('MySQL registers one bounded waiter and returns the server grant', async () => {
  const ready = Promise.withResolvers();
  const grant = Promise.withResolvers();
  const calls = [];
  const connection = {
    query(statement, values) {
      calls.push([statement, values]);
      ready.resolve();
      return grant.promise;
    },
  };
  const result = waitForAdvisoryLock(connection, 'mysql', 'qa:lock', 90_000);
  await ready.promise;
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    'SELECT GET_LOCK($1,$2) AS locked',
    ['qa:lock', 90],
  ]);
  grant.resolve({ rows: [{ locked: 1 }] });
  assert.equal(await result, true);
});

test('MySQL timeout or null grant fails without retrying for another 90 seconds', async () => {
  for (const locked of [0, null]) {
    let attempts = 0;
    const result = await waitForAdvisoryLock(
      { query: async () => { attempts++; return { rows: [{ locked }] }; } },
      'mysql', 'qa:lock', 90_000,
    );
    assert.equal(result, false);
    assert.equal(attempts, 1);
  }
});

test('lock connection errors propagate without another attempt', async () => {
  let attempts = 0;
  await assert.rejects(() => waitForAdvisoryLock(
    { query: async () => { attempts++; throw Error('synthetic connection loss'); } },
    'mysql', 'qa:lock', 90_000,
  ), /synthetic connection loss/);
  assert.equal(attempts, 1);
});

test('PostgreSQL waits within a deadline and only succeeds after a grant', async () => {
  let attempts = 0;
  assert.equal(await waitForAdvisoryLock({ query: async (statement, values) => {
    assert.equal(statement, 'SELECT pg_try_advisory_lock($1) AS locked');
    assert.deepEqual(values, [1234]);
    return { rows: [{ locked: ++attempts >= 2 }] };
  } }, 'postgres', 1234, 1000), true);
  assert.equal(attempts, 2);
  assert.equal(await waitForAdvisoryLock({ query: async () => ({ rows: [{ locked: false }] }) }, 'postgres', 1234, 1), false);
});

test('invalid waits do not open a query', async () => {
  for (const waitMs of [0, -1, NaN, Infinity, 90_001])
    await assert.rejects(() => waitForAdvisoryLock({ query: () => assert.fail('invalid wait queried') }, 'mysql', 'qa:lock', waitMs), RangeError);
});
