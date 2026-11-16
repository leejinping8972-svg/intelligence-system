import assert from 'node:assert/strict';
import test from 'node:test';

import { calculatedSemrushQuota } from './semrush-quota.mjs';
import { validateQuota } from './source-usage-domain.mjs';
import { sourceUsageAction } from './source-usage.mjs';

const manual = { total: 50_000, remaining: 12, expiresAt: '2026-11-23', updatedAt: '2026-11-16T08:00:00Z' };
const usage = {
  currentKeyAvailable: true,
  keyConfigured: true,
  currentKey: { confirmedUnits: 680, unknownRecords: 19 },
  otherKeys: { confirmedUnits: 6_240 },
  unassigned: { confirmedUnits: 9_000 },
  checkedAt: '2026-11-16T08:02:00Z',
};

test('remaining uses total minus confirmed usage on the current key and preserves expiry', () => {
  assert.deepEqual(calculatedSemrushQuota(manual, usage), {
    total: 50_000, remaining: 49_320, expiresAt: '2026-11-23',
    updatedAt: usage.checkedAt, origin: 'calculated',
  });
  assert.equal(calculatedSemrushQuota(manual, { ...usage, currentKey: { confirmedUnits: 1_000 } }).remaining, 49_000);
});

test('zero usage and exhausted allowances remain real zeroes', () => {
  assert.equal(calculatedSemrushQuota({ total: 0 }, usage).remaining, 0);
  assert.equal(calculatedSemrushQuota({ total: 10 }, usage).remaining, 0);
  assert.equal(calculatedSemrushQuota(manual, { ...usage, currentKey: { confirmedUnits: 0 } }).remaining, 50_000);
});

test('missing allowance or unavailable current-key usage never becomes a guessed balance', () => {
  assert.equal(calculatedSemrushQuota({ remaining: 99 }, usage).remaining, null);
  assert.equal(calculatedSemrushQuota(manual).remaining, null);
  for (const unavailable of [
    { ...usage, currentKeyAvailable: false },
    { ...usage, keyConfigured: false },
    { ...usage, currentKey: undefined },
    { ...usage, currentKey: { confirmedUnits: -1 } },
  ]) assert.equal(calculatedSemrushQuota(manual, unavailable).remaining, null);
});

test('key rotation only deducts the newly selected key usage', () => {
  const rotated = { ...usage, currentKey: { confirmedUnits: 120 }, otherKeys: usage.currentKey };
  assert.equal(calculatedSemrushQuota(manual, rotated).remaining, 49_880);
});

test('manual Semrush remaining values are discarded while other source validation stays intact', () => {
  assert.equal(validateQuota({ sourceId: 'semrush', total: 50_000, remaining: 99_999 }).remaining, null);
  assert.equal(validateQuota({ sourceId: 'semrush', total: 50_000 }).remaining, null);
  assert.equal(validateQuota({ sourceId: 'firecrawl', total: 100, remaining: 10 }).remaining, 10);
  assert.throws(() => validateQuota({ sourceId: 'semrush', total: -1 }));
});

function ioFor(summary = usage) {
  return {
    pool: { query: async () => ({ rows: [
      { name: 'provider:semrush:mcp:v1', value: { ciphertext: 'synthetic-only' } },
      { name: 'source-usage:quota:semrush', value: { manual, automatic: { remaining: 8 } } },
    ] }) },
    readEvents: async () => [],
    credentialStatus: async () => ({}),
    semrush: async (input) => {
      assert.deepEqual(input, { action: 'server_semrush_usage' });
      return summary;
    },
  };
}
const admin = { id: 'qa', role: 'admin' };

test('source usage API calculates from saved key usage, not filtered generic totals or old snapshots', async () => {
  const result = await sourceUsageAction({ action: 'server_source_usage', sourceId: 'firecrawl', days: 7 }, admin, ioFor());
  const semrush = result.sources.find((source) => source.id === 'semrush');
  assert.equal(semrush.quota.remaining, 49_320);
  assert.equal(semrush.quota.origin, 'calculated');
  assert.match(semrush.quotaMessage, /实际剩余额度可能更低/);
  assert.equal(JSON.stringify(result).includes('synthetic-only'), false);
});

test('source usage remains readable with an unknown balance when saved Semrush usage fails', async () => {
  const io = ioFor();
  io.semrush = async () => { throw new Error('synthetic saved summary outage'); };
  const result = await sourceUsageAction({ action: 'server_source_usage' }, admin, io);
  const semrush = result.sources.find((source) => source.id === 'semrush');
  assert.equal(semrush.quota.remaining, null);
  assert.equal(semrush.quota.total, 50_000);
  assert.match(semrush.quotaMessage, /暂不可用/);
});

test('saving the allowance clears legacy manual remaining without any usage or provider query', async () => {
  let saved;
  const io = ioFor();
  io.semrush = async () => { assert.fail('saving quota must not fetch usage or contact Semrush'); };
  io.write = async (_name, value) => { saved = value; };
  await sourceUsageAction({ action: 'server_source_quota_save', sourceId: 'semrush', ...manual, remaining: 49_999 }, admin, io);
  assert.equal(saved.manual.total, 50_000);
  assert.equal(saved.manual.remaining, null);
});
