/* oxlint-disable vitest/no-import-node-test -- Node server tests run without Vitest. */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { SEMRUSH_BALANCE_URL, semrushBalance } from './semrush-balance.mjs';
import { encryptSemrushKey, semrushAction } from './semrush-config.mjs';

const key = 'synthetic-qa-key-not-real';
test('official balance uses HTTPS, a free account call and parses numeric zero correctly', async () => {
  for (const [body, expected] of [
    ['1,234', 1234],
    ['0', 0],
    ['ERROR 132 :: API UNITS BALANCE IS ZERO', 0],
  ]) {
    let calls = 0;
    const result = await semrushBalance(key, async (url, options) => {
      calls++;
      assert.equal(`${url.origin}${url.pathname}`, SEMRUSH_BALANCE_URL);
      assert.equal(url.searchParams.get('key'), key);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.method, 'GET');
      return new Response(body);
    });
    assert.equal(result.units, expected);
    assert.equal(calls, 1);
    assert.ok(!JSON.stringify(result).includes(key));
  }
});
test('redirects, permission errors, HTML and malformed responses are unknown, not zero', async () => {
  for (const response of [
    new Response('', { status: 302 }),
    new Response('', { status: 403 }),
    new Response('<html>sign in</html>'),
    new Response('ERROR 120 :: WRONG KEY'),
    new Response('1,23'),
  ]) {
    const result = await semrushBalance(key, async () => response);
    assert.equal(result.units, null);
    assert.equal(result.status, 'unavailable');
  }
  const failed = await semrushBalance(key, async () => {
    throw new Error(`failed ${key}`);
  });
  assert.ok(!JSON.stringify(failed).includes(key));
});
test('admin refresh caches balance; normal status reads only the cache without external requests', async () => {
  const secret = randomBytes(32).toString('base64');
  let stored = { ...encryptSemrushKey(key, secret), updatedAt: 'qa' };
  let calls = 0;
  const io = {
    secret,
    read: async () => stored,
    write: async (value) => {
      stored = value;
    },
    balance: async () => {
      calls++;
      return {
        units: 4321,
        status: 'available',
        checkedAt: '2026-10-20T00:00:00Z',
      };
    },
  };
  await assert.rejects(
    () =>
      semrushAction(
        { action: 'server_semrush_balance' },
        { role: 'researcher' },
        io,
      ),
    /管理员/,
  );
  const result = await semrushAction(
    { action: 'server_semrush_balance' },
    { role: 'admin' },
    io,
  );
  assert.equal(result.balance.units, 4321);
  const cached = await semrushAction(
    { action: 'server_semrush_status' },
    { role: 'researcher' },
    io,
  );
  assert.equal(cached.balance.units, 4321);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(stored).includes(key));
});
test('refresh cannot overwrite a key saved while the request was pending', async () => {
  const secret = randomBytes(32).toString('base64');
  let stored = encryptSemrushKey(key, secret);
  const next = encryptSemrushKey('different-synthetic-key', secret);
  const io = {
    secret,
    read: async () => stored,
    write: async () => {
      throw new Error('must not write');
    },
    balance: async () => {
      stored = next;
      return { units: 12 };
    },
  };
  await assert.rejects(
    () =>
      semrushAction(
        { action: 'server_semrush_balance' },
        { role: 'admin' },
        io,
      ),
    /Key 已更换/,
  );
  assert.deepEqual(stored, next);
});
