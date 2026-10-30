import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createKeywordViewsAction } from './keyword-views.mjs';

test('keyword views persist across service instances, isolate accounts and detect concurrent edits', async () => {
  const db = new PGlite();
  await db.exec('CREATE TABLE workspace_documents(name varchar(180) PRIMARY KEY,value jsonb NOT NULL,revision integer DEFAULT 1)');
  const pool = { query: async (query, params = []) => {
    const result = await db.query(query, params.map(value => value && typeof value === 'object' ? JSON.stringify(value) : value));
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  } };
  const firstDevice = createKeywordViewsAction({ pool });
  const otherDevice = createKeywordViewsAction({ pool });
  const alice = { id: 'admin-a' }, bob = { id: 'admin-b' };
  const filters = {
    market: 'VN', search: 'magnesium', category: 'ALL', rating: 'ALL', ratingStatus: 'ALL',
    score: { min: 30, max: 90, status: 'scored' }, tags: ['测试'], timeRange: '90',
    review: 'excluded', favorite: false, sort: 'score', order: 'descend', pageSize: 50, period: 180,
  };
  try {
    const { view } = await firstDevice({ action: 'server_keyword_views_save', name: '越南高分词', filters }, alice);
    assert.equal(view.revision, 1);
    const secondRead = await otherDevice({ action: 'server_keyword_views_list' }, alice);
    assert.deepEqual(secondRead.views[0].filters, filters);
    assert.equal((await otherDevice({ action: 'server_keyword_views_list' }, bob)).views.length, 0);
    await assert.rejects(otherDevice({ action: 'server_keyword_views_save', ...view, filters, name: '盗用' }, bob), { status: 404 });
    await assert.rejects(otherDevice({ action: 'server_keyword_views_list', userId: alice.id }, bob), { status: 400 });
    await assert.rejects(firstDevice({ action: 'server_keyword_views_list' }, { id: null, role: 'admin' }), { status: 401 });
    const updated = await otherDevice({ action: 'server_keyword_views_save', ...view, name: '越南观察', filters: { ...filters, period: 90 } }, alice);
    assert.equal(updated.view.revision, 2);
    await assert.rejects(firstDevice({ action: 'server_keyword_views_save', ...view, filters }, alice), { status: 409 });
    await assert.rejects(firstDevice({ action: 'server_keyword_views_delete', ...view }, alice), { status: 409 });
    for (const invalid of [{ period: 4 }, { score: { min: 80, max: 30, status: 'all' } }, { apiKey: 'not-allowed' }, { review: 'made-up' }]) {
      await assert.rejects(firstDevice({ action: 'server_keyword_views_save', name: '非法', filters: { ...filters, ...invalid } }, alice), { status: 400 });
    }
    await otherDevice({ action: 'server_keyword_views_delete', id: view.id, revision: 2 }, alice);
    assert.equal((await firstDevice({ action: 'server_keyword_views_list' }, alice)).views.length, 0);
  } finally { await db.close(); }
});
