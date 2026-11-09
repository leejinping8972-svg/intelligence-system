/* oxlint-disable vitest/no-import-node-test -- Server tests run directly with Node's test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceSiteDomain } from './site-keyword-provenance.mjs';
import {
  sourceKeywordLinks,
  reconcileSourceKeywords,
} from './site-source-keywords.mjs';
import { createWorkspaceReads } from './workspace-reads.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { cleanKeyword } from './domain.mjs';

const source = {
  id: 'source',
  market: 'US',
  domain: 'liquid-iv.com',
  keywordIds: ['electrolytes'],
  mainProducts: [],
};
const target = {
  id: 'buoy',
  market: 'US',
  domain: 'buoy.test',
  mainProducts: [],
  keywordIds: ['manual'],
  sourceEvidence: [
    {
      source: 'Semrush domain_adwords_adwords',
      keyword: '保健品付费搜索竞品 liquid-iv.com',
    },
  ],
};
const keywords = [
  {
    id: 'electrolytes',
    term: 'electrolyte powder',
    market: 'US',
    siteIds: ['source'],
  },
];

test('source domains are strict and normalize URLs, case and www', () => {
  assert.equal(sourceSiteDomain('https://WWW.Liquid-IV.com/'), 'liquid-iv.com');
  for (const value of [
    'javascript:alert(1)',
    'liquid-iv.com/other',
    'a.com x.com',
    {},
    null,
  ])
    assert.equal(sourceSiteDomain(value), '');
});

test('fallback is one hop, market scoped, deduplicated and distinguishes real searches', () => {
  const links = sourceKeywordLinks(
    {
      ...target,
      sourceEvidence: [...target.sourceEvidence, ...target.sourceEvidence],
    },
    [source, { ...source, market: 'MX', keywordIds: ['wrong'] }],
    [...keywords, { id: 'wrong', term: 'wrong', market: 'MX' }],
  );
  assert.deepEqual(links, [
    {
      domain: 'liquid-iv.com',
      siteId: 'source',
      keywordIds: ['electrolytes'],
      terms: ['electrolyte powder'],
    },
  ]);
  assert.deepEqual(
    sourceKeywordLinks(
      { ...target, query: 'real overlap' },
      [source],
      keywords,
    ),
    [],
  );
  assert.deepEqual(
    sourceKeywordLinks(
      target,
      [{ ...source, sourceKeywordLinks: [{ keywordIds: ['electrolytes'] }] }],
      keywords,
    )[0].keywordIds,
    [],
  );
  assert.deepEqual(sourceKeywordLinks(target, [], keywords)[0].keywordIds, []);
  assert.deepEqual(
    sourceKeywordLinks(target, [{ ...source, keywordIds: [] }], keywords)[0]
      .keywordIds,
    ['electrolytes'],
  );
});

test('saved fallback links work in both directions and exact site filtering applies to paging, export selection and keyword facets', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const connection = {
    query: (statement, values = []) =>
      db.query(
        statement,
        values.map((value) =>
          value && typeof value === 'object' ? JSON.stringify(value) : value,
        ),
      ),
  };
  const putDocument = async (_table, name, value, _flag, conn = connection) =>
    conn.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=$2,revision=workspace_documents.revision+1',
      [name, value],
    );
  const pool = {
    ...connection,
    connect: async () => ({ ...connection, release() {} }),
  };
  try {
    await db.exec(
      'CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false);',
    );
    await migrateWorkspaceReads(pool, 'postgres');
    for (const site of [
      source,
      target,
      { ...source, id: 'other-market', market: 'MX' },
      { ...source, id: 'lookalike', domain: 'liquid-iv.com.evil.test' },
    ])
      await putDocument('', `business:sites:${site.id}`, site);
    for (const keyword of [
      ...keywords,
      { id: 'manual', term: 'manual term', market: 'US', siteIds: [target.id] },
    ])
      await connection.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        [keyword.id, cleanKeyword(keyword)],
      );
    const original = structuredClone(target);
    assert.deepEqual(
      await reconcileSourceKeywords({ connection, putDocument }),
      { updated: 1 },
    );
    assert.deepEqual(
      await reconcileSourceKeywords({ connection, putDocument }),
      { updated: 0 },
    );
    const savedResult = await connection.query(
      'SELECT value FROM workspace_documents WHERE name=$1',
      ['business:sites:buoy'],
    );
    const saved = savedResult.rows[0].value;
    assert.deepEqual(saved.keywordIds, ['manual', 'electrolytes']);
    assert.deepEqual(saved.sourceEvidence, original.sourceEvidence);
    const reverseResult = await db.query(
      "SELECT data FROM research_keywords WHERE natural_key='electrolytes'",
    );
    assert.deepEqual(reverseResult.rows[0].data.siteIds, ['source', 'buoy']);
    const reads = createWorkspaceReads({
      pool,
      sql: (pg) => pg,
      lock: async () => true,
      unlock: async () => {},
      putDocument,
      isWorkspaceSyncKey: () => true,
      loadPublic: async () => ({}),
    });
    for (let i = 0; i < 20; i++) if (!(await reads.refresh())) break;
    const query = {
      collection: 'sites',
      market: 'US',
      siteDomain: 'liquid-iv.com',
    };
    const list = await reads.list(query);
    assert.equal(list.total, 1);
    assert.equal(list.rows[0].id, 'source');
    const absentResult = await reads.list({
      ...query,
      siteDomain: 'absent.test',
    });
    const keywordList = await reads.list({
      collection: 'sites',
      market: 'US',
      keywordId: 'electrolytes',
    });
    assert.equal(absentResult.total, 0);
    assert.equal(
      keywordList.rows.some((row) => row.id === 'buoy'),
      true,
    );
    assert.deepEqual(saved.sourceKeywordLinks[0].terms, ['electrolyte powder']);
    const facets = await reads.facets({ collection: 'sites', market: 'US' });
    assert.ok(
      facets.facets.keywords.some((item) => item.value === 'electrolytes'),
    );
    const all = await reads.selection(query);
    assert.deepEqual(
      all.rows.map((row) => row.id),
      ['source'],
    );
    const exported = await reads.exportRecords({
      collection: 'sites',
      ids: all.rows.map((row) => row.id),
    });
    const canonical = await reads.list({
      ...query,
      siteDomain: 'https://WWW.LIQUID-IV.com/',
    });
    assert.deepEqual(
      exported.rows.map((row) => row.id),
      ['source'],
    );
    assert.deepEqual(
      canonical.rows.map((row) => row.id),
      ['source'],
    );
    await assert.rejects(
      reads.list({ ...query, siteDomain: 'liquid-iv.com x' }),
      /站点域名无效/,
    );
  } finally {
    await db.close();
  }
});
