import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRelease } from './release-history.mjs';
test('registers an immutable release snapshot with insert-only semantics', async () => {
  const data = {
      id: '20261018-test',
      changes: ['change'],
      files: ['server/auth.mjs'],
    },
    calls = [];
  await registerRelease({
    read: async () => JSON.stringify(data),
    write: async (...args) => calls.push(args),
  });
  assert.equal(calls[0][0], 'system:release:20261018-test');
  assert.equal(calls[0][1].id, data.id);
  assert.ok(calls[0][1].startedAt);
  await assert.rejects(
    registerRelease({
      read: async () => JSON.stringify({ ...data, id: 'bad/id' }),
      write: async () => {},
    }),
    /格式/,
  );
});
