import assert from 'node:assert/strict';
import test from 'node:test';

import { monitorWorkspace } from './monitor-workspace.mjs';

test('monitor reads are scoped and skip unchanged revisions without a business snapshot', async () => {
  const statements = [];
  const pool = { query: async (text, params) => {
    statements.push(text);
    if (text.includes('workspace_read_versions')) return {rows:[{revision:5}]};
    if (text.includes('business:monitors:')) return {rows:[{name:'business:monitors:m1',value:{id:'m1',productId:'p1'}}]};
    if (text.includes('WHERE name IN')) {
      assert.deepEqual(params, ['business:products:p1']);
      return {rows:[{value:{id:'p1',title:'title',brand:'brand',market:'US',sourceContent:{huge:'excluded'}}}]};
    }
    return {rows:[]};
  }};
  const result = await monitorWorkspace({}, {pool,sql:(pg)=>pg});
  assert.equal(result.entries.length, 1);
  assert.equal(result.products[0].sourceContent, undefined);
  assert(!statements.some(s => s.includes("LIKE 'business:%'")));
  statements.length=0;
  assert.deepEqual(await monitorWorkspace({revision:'5'}, {pool,sql:(pg)=>pg}), {revision:'5'});
  assert.equal(statements.length, 1);
});
