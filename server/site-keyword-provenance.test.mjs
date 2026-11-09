import assert from 'node:assert/strict';
import test from 'node:test';
import { siteKeywordProvenance } from './site-keyword-provenance.mjs';
import { associationTerms } from './keyword-associations.mjs';
import { repairSiteKeywordAssociations } from './site-keyword-repair.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';

const title =
  'Rescue Drops / Hydration Drops / Ocean & Rainforest Essentials / Buoy | Liquid Electrolytes & Wild Superfoods';
const competitor = '保健品付费搜索竞品 liquid-iv.com';
const site = {
  id: 'US-buoy.test',
  domain: 'buoy.test',
  market: 'US',
  keyword: 'Rescue Drops',
  mainProducts: ['Rescue Drops', 'Hydration Drops'],
  sourceEvidence: [
    { source: '官网保健品类目核验', keyword: title, url: 'https://buoy.test' },
    { source: 'Semrush MCP · domain_adwords_adwords', keyword: competitor },
    {
      source: 'Semrush MCP · domain_rank',
      keyword: '付费搜索占比 80%；Semrush估算',
    },
    { source: 'Semrush phrase_adwords', keyword: 'electrolyte drops' },
  ],
};

test('website names and competitor descriptions remain evidence rather than search terms', () => {
  const result = siteKeywordProvenance(site);
  assert.deepEqual(result.queryTerms, ['electrolyte drops']);
  assert.ok(result.nonSearchTerms.includes(title));
  assert.ok(result.nonSearchTerms.includes('Rescue Drops'));
  assert.equal(
    result.discoveries[0].text,
    '与 liquid-iv.com 竞争搜索广告关键词的站点',
  );
  assert.equal(result.evidence[0].text, title);
  assert.deepEqual(associationTerms(site), ['electrolyte drops']);
  assert.equal(
    projectRecord('sites', site).data.sourceEvidence[0].keyword,
    title,
  );
});

test('actual product-name queries and punctuation are preserved when search evidence exists', () => {
  const result = siteKeywordProvenance({
    ...site,
    sourceEvidence: [
      ...site.sourceEvidence,
      { source: 'Semrush phrase_adwords', keyword: 'Rescue Drops' },
      { source: 'Semrush phrase_adwords', keyword: 'vitamin D / K2' },
    ],
  });
  assert.ok(result.queryTerms.includes('Rescue Drops'));
  assert.ok(result.queryTerms.includes('vitamin D / K2'));
  assert.ok(!result.nonSearchTerms.includes('Rescue Drops'));
  assert.deepEqual(
    siteKeywordProvenance({ keyword: 'legacy search', mainProducts: [] })
      .queryTerms,
    ['legacy search'],
  );
});

test('repair removes proven historical site links in both directions, preserving manual links and raw records', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const connection = {
    query: (statement, params = []) =>
      db.query(
        statement,
        params.map((value) =>
          value && typeof value === 'object' ? JSON.stringify(value) : value,
        ),
      ),
  };
  const putDocument = async (_table, name, value, _flag, conn = connection) =>
    conn.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=$2,revision=workspace_documents.revision+1',
      [name, value],
    );
  try {
    await db.exec(
      'CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false);',
    );
    const pool = {
      ...connection,
      connect: async () => ({ ...connection, release() {} }),
    };
    await migrateWorkspaceReads(pool, 'postgres');
    const records = [
      ['product', 'Rescue Drops', '历史业务关联补齐'],
      ['title', title, '历史业务关联补齐'],
      ['competitor', competitor, '历史业务关联补齐'],
      ['query', 'electrolyte drops', '历史业务关联补齐'],
      ['manual', 'Rescue Drops', '直接检索'],
    ];
    for (const [id, term, source] of records)
      await connection.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        [
          id,
          {
            id,
            term,
            source,
            market: 'US',
            siteIds: [site.id, 'another-site'],
          },
        ],
      );
    const original = { ...site, keywordIds: records.map(([id]) => id) };
    await connection.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
      ['business:sites:' + site.id, original],
    );
    const repaired = await repairSiteKeywordAssociations({
      connection,
      putDocument,
    });
    assert.deepEqual(repaired, {
      removed: 3,
      updatedSites: 1,
      updatedKeywords: 3,
    });
    const updated = (await db.query('SELECT value FROM workspace_documents'))
      .rows[0].value;
    assert.deepEqual(updated.keywordIds, ['query', 'manual']);
    assert.deepEqual(updated.sourceEvidence, original.sourceEvidence);
    const keywords = (
      await db.query('SELECT data FROM research_keywords ORDER BY natural_key')
    ).rows.map(({ data }) => data);
    assert.equal(keywords.length, 5);
    assert.deepEqual(keywords.find(({ id }) => id === 'product').siteIds, [
      'another-site',
    ]);
    assert.deepEqual(keywords.find(({ id }) => id === 'manual').siteIds, [
      site.id,
      'another-site',
    ]);
    assert.deepEqual(
      await repairSiteKeywordAssociations({ connection, putDocument }),
      { removed: 0, updatedSites: 0, updatedKeywords: 0 },
    );
    const reads = createWorkspaceReads({
      pool,
      sql: (pg) => pg,
      lock: async () => true,
      unlock: async () => {},
      putDocument,
      isWorkspaceSyncKey: () => true,
      loadPublic: async () => ({}),
    });
    for (let count = 0; count < 20; count++)
      if (!(await reads.refresh())) break;
    for (const market of ['US', 'ALL']) {
      const facets = (await reads.facets({ collection: 'sites', market }))
        .facets;
      assert.deepEqual(facets.keywords.map(({ value }) => value).sort(), [
        'manual',
        'query',
      ]);
      assert.equal(
        (await reads.list({ collection: 'sites', market, keywordId: 'title' }))
          .total,
        0,
      );
      const list = await reads.list({
        collection: 'sites',
        market,
        keywordId: 'query',
      });
      assert.equal(list.total, 1);
      assert.equal(list.rows[0].sourceEvidence[0].keyword, title);
    }
  } finally {
    await db.close();
  }
});
