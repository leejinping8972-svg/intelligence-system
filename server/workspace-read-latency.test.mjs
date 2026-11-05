import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceReads } from './workspace-reads.mjs';

test('list requests share in-flight status and overlap independent keyword reads', async () => {
  const pending = [];
  const statements = [];
  const pool = {
    query(statement) {
      statements.push(statement);
      return new Promise((resolve) => pending.push({ statement, resolve }));
    },
  };
  const reads = createWorkspaceReads({
    pool,
    sql: (pg) => pg,
    loadPublic: async () => ({}),
  });
  const a = reads.list({ collection: 'keywords', pageSize: 10 });
  const b = reads.list({ collection: 'keywords', market: 'US', pageSize: 10 });
  const release = (match, rows) => {
    for (const item of pending.filter((item) => match.test(item.statement))) {
      pending.splice(pending.indexOf(item), 1);
      item.resolve({ rows });
    }
  };
  assert.equal(
    statements.filter((s) => s.includes('FROM workspace_read_versions')).length,
    1,
  );
  assert.equal(
    statements.filter((s) => s.includes('FROM workspace_read_dirty')).length,
    1,
  );
  assert.equal(statements.filter((s) => s.includes('COUNT(*)')).length, 2);
  release(/COUNT\(\*\)/, [{ total: 1 }]);
  release(/FROM workspace_read_versions/, [
    { collection: 'published', revision: 1 },
  ]);
  release(/FROM workspace_read_dirty/, []);
  await new Promise((resolve) => setImmediate(resolve));
  release(/SELECT r.payload,/, [
    {
      payload: {
        id: 'k',
        term: 'creatine',
        market: 'US',
        coreSummary: { retained: true },
      },
    },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    pending.filter((item) => /SELECT k.data/.test(item.statement)).length,
    2,
  );
  assert.equal(
    pending.filter((item) => /FROM workspace_read_links/.test(item.statement))
      .length,
    2,
  );
  release(/SELECT k.data/, [
    { data: { id: 'k', trendStatus: 'completed', trendPoints: [] } },
  ]);
  release(/FROM workspace_read_links/, [
    {
      market: 'US',
      target: 'creatine',
      term: 'creatine gummies',
      source: 'saved',
    },
  ]);
  const results = await Promise.all([a, b]);
  for (const result of results) {
    assert.equal(result.total, 1);
    assert.equal(result.rows[0].trendStatus, 'completed');
    assert.equal(result.rows[0].coreSummary.retained, true);
    assert.equal(
      result.rows[0].coreSummary.related.expansions[0].term,
      'creatine gummies',
    );
  }
  // A later request must reread revisions; no stale completed status is cached.
  const status = reads.status();
  assert.equal(
    statements.filter((s) => s.includes('FROM workspace_read_versions')).length,
    2,
  );
  release(/FROM workspace_read_versions/, [
    { collection: 'published', revision: 2 },
  ]);
  release(/FROM workspace_read_dirty/, []);
  assert.equal((await status).revisions.published, '2');
});
