import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspaceSyncKey } from './workspace-sync-keys.mjs';
test('workspace snapshot and sync keep server-owned reports and evidence out of the editable workspace', () => {
  assert.equal(isWorkspaceSyncKey('insightReports:r'), false);
  assert.equal(isWorkspaceSyncKey('researchEvidence:e'), false);
  assert.equal(isWorkspaceSyncKey(null), false);
  assert.equal(isWorkspaceSyncKey('sites:s'), true);
  assert.equal(isWorkspaceSyncKey('products:p'), true);
});
