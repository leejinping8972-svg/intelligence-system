import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordPolicy } from './password-policy.mjs';
test('new and reset passwords accept 8 characters; shorter or oversized values fail', () => {
  assert.doesNotThrow(() => passwordPolicy('12345678'));
  assert.doesNotThrow(() => passwordPolicy('old-long-password-123'));
  for (const value of ['1234567', '', null, 'a'.repeat(129)])
    assert.throws(() => passwordPolicy(value), /8～128/);
});
