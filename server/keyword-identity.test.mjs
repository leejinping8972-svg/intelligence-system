/* oxlint-disable vitest/no-import-node-test -- Standalone server tests. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { keywordIdentity, keywordIdentitySql } from './keyword-identity.mjs';
import { naturalKey } from './domain.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';

test('SQL legacy fallback and refreshed projections agree with JS; storage keys remain stable', async () => {
  const db = new PGlite();
  try {
    for (const term of [
      'copper peptides',
      ' COPPER--PEPTIDES ',
      'vitamins supplements',
      'peptides peptides',
      'gummies gummies',
      'diabetes',
      'GHK-Cu vs copper peptides',
    ]) {
      const payload = { term };
      const result = await db.query(
        `SELECT ${keywordIdentitySql((pg) => pg, 'r')} AS identity FROM (SELECT $1::jsonb AS payload) r`,
        [JSON.stringify(payload)],
      );
      assert.equal(result.rows[0].identity, keywordIdentity(term), term);
      payload.keywordIdentity = keywordIdentity(term);
      const cached = await db.query(
        `SELECT ${keywordIdentitySql((pg) => pg, 'r')} AS identity FROM (SELECT $1::jsonb AS payload) r`,
        [JSON.stringify(payload)],
      );
      assert.equal(cached.rows[0].identity, keywordIdentity(term));
    }
    assert.equal(
      naturalKey({ market: 'US', term: 'copper peptides' }),
      'US|copper peptides',
    );
  } finally {
    await db.close();
  }
});

test('plural list groups preserve human selection, sources and distinct relationships across pagination and selection', async () => {
  const db = new PGlite();
  const pool = {
    query: (text, values = []) =>
      db.query(
        text,
        values.map((value) =>
          value && typeof value === 'object' ? JSON.stringify(value) : value,
        ),
      ),
  };
  try {
    await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer DEFAULT 1);
      CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
      CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false);`);
    await migrateWorkspaceReads(pool, 'postgres');
    const add = async (collection, value, legacy = false) => {
      const projection = projectRecord(collection, {
        market: 'US',
        source: 'synthetic',
        series: [],
        ...value,
      });
      if (legacy) delete projection.data.keywordIdentity;
      const fields = [
        'collection',
        'id',
        'source_key',
        'market',
        'category',
        'score',
        'grade',
        'rating_status',
        'review_status',
        'collection_status',
        'favorite',
        'collected_at',
        'source_label',
        'platform',
        'ownership',
        'site_id',
        'newness',
        'recent_discovery',
        'search_text',
        'payload',
      ];
      const values = [
        collection,
        value.id,
        value.id,
        ...projection.columns,
        projection.data,
      ];
      await pool.query(
        `INSERT INTO workspace_read_rows(${fields.join(',')}) VALUES (${fields.map((_, i) => `$${i + 1}`).join(',')})`,
        values,
      );
      for (const [relation, target] of projection.links)
        await pool.query(
          'INSERT INTO workspace_read_links(collection,id,relation,target) VALUES($1,$2,$3,$4)',
          [collection, value.id, relation, target],
        );
    };
    await add(
      'keywords',
      {
        id: 'singular',
        term: 'Copper Peptide',
        source: 'seed',
        reviewStatus: 'selected',
        productIds: ['p1'],
        siteIds: [],
      },
      true,
    );
    await add('keywords', {
      id: 'plural',
      term: 'copper peptides',
      source: 'Amazon',
      reviewStatus: 'pending',
      favorite: true,
      productIds: ['p2'],
      siteIds: ['s1'],
    });
    await add('keywords', {
      id: 'excluded',
      term: 'copper peptides',
      reviewStatus: 'excluded',
    });
    await add('keywords', {
      id: 'foreign',
      term: 'copper peptides',
      market: 'MX',
    });
    await add('keywords', { id: 'distinct', term: 'copper tripeptide 1' });
    await add('products', {
      id: 'p1',
      title: 'synthetic 1',
      keywordIds: ['singular', 'plural'],
    });
    await add('products', {
      id: 'p2',
      title: 'synthetic 2',
      keywordIds: ['plural'],
    });
    await add('sites', {
      id: 's1',
      domain: 'synthetic.invalid',
      keywordIds: ['plural'],
    });
    const putDocument = async (_table, name, value) =>
      pool.query(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',
        [name, value],
      );
    const reads = createWorkspaceReads({ pool, sql: (pg) => pg, putDocument });
    const input = {
      collection: 'keywords',
      market: 'US',
      pageSize: 1,
      sort: 'score',
    };
    const first = await reads.list(input);
    const second = await reads.list({ ...input, page: 2 });
    assert.equal(first.total, 2);
    assert.equal(second.total, 2);
    const group = [...first.rows, ...second.rows].find(
      (row) => row.id === 'singular',
    );
    assert.ok(group);
    assert.equal(group.reviewStatus, 'selected');
    assert.equal(group.favorite, true);
    assert.match(group.source, /seed/);
    assert.match(group.source, /Amazon/);
    assert.deepEqual(group.productIds.toSorted(), ['p1', 'p2']);
    assert.deepEqual(group.siteIds, ['s1']);
    assert.deepEqual(group.relatedCounts, { ads: 0, products: 2, sites: 1 });
    const favorites = await reads.list({ ...input, favorite: true });
    assert.equal(favorites.total, 1);
    assert.equal(favorites.rows[0].id, 'singular');
    const pluralSearch = await reads.list({
      ...input,
      search: 'copper peptides',
    });
    assert.equal(pluralSearch.total, 1);
    const sorted = await reads.list({ ...input, sort: 'relatedProducts' });
    assert.equal(sorted.rows[0].id, 'singular');
    const selection = await reads.selection(input);
    assert.equal(selection.count, 2);
    const all = await reads.list({ collection: 'keywords', market: 'ALL' });
    assert.equal(all.total, 3);
    const direct = await reads.list({
      collection: 'keywords',
      keywordId: 'plural',
    });
    assert.equal(direct.rows[0].id, 'plural');
  } finally {
    await db.close();
  }
});
