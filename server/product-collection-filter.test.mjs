import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { matchesCollectionRange } from './collection-time.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';

test('first capture filter uses indexed Shanghai dates while latest capture follows monitoring updates', async () => {
  const db = new PGlite();
  const pool = { query: (s, p = []) => db.query(s, p.map(v => v && typeof v === 'object' ? JSON.stringify(v) : v)) };
  try {
    await db.exec("CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb); CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false)");
    await migrateWorkspaceReads(pool, 'postgres');
    const records = [
      { id: 'first-start', firstSeenAt: '2026-11-08T16:00:00Z' },
      { id: 'first-end', firstSeenAt: '2026-11-15T15:59:59.999Z' },
      { id: 'first-before', firstSeenAt: '2026-11-08T15:59:59.999Z' },
      { id: 'first-after', firstSeenAt: '2026-11-15T16:00:00Z' },
      { id: 'first-discovery', discovery: { firstSeenAt: '2026-11-12T00:00:00Z' } },
      { id: 'missing-first' },
    ].map(r => ({ ...r, market: 'US', title: r.id, sourceContent: { collectedAt: '2026-11-16T01:00:00Z' }, newProductClassifications: [{ type: 'regular_new' }] }));
    for (const record of records) {
      const p = projectRecord('products', record);
      await pool.query('INSERT INTO workspace_read_rows(collection,id,source_key,market,category,score,grade,rating_status,review_status,collection_status,favorite,collected_at,source_label,platform,ownership,site_id,newness,recent_discovery,search_text,payload) VALUES(' + Array.from({length:20},(_,i)=>'$'+(i+1)).join(',') + ')', ['products',record.id,'business:products:'+record.id,...p.columns,p.data]);
      for (const [relation,target] of p.links) await pool.query('INSERT INTO workspace_read_links VALUES($1,$2,$3,$4)', ['products',record.id,relation,target]);
    }
    const reads = createWorkspaceReads({ pool, sql: pg => pg, putDocument: (_table,name,value) => pool.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)',[name,value]) });
    const query = { collection: 'products', market: 'US', productPool: 'pool', collectedFrom: '2026-11-09', collectedTo: '2026-11-15', collectionBasis: 'first', pageSize: 100 };
    const first = await reads.list(query);
    assert.deepEqual(first.rows.map(r=>r.id).sort(), ['first-discovery','first-end','first-start']);
    assert.equal(first.total,3);
    assert.deepEqual(records.filter(r=>matchesCollectionRange('products',r,query.collectedFrom,query.collectedTo,'first')).map(r=>r.id).sort(), first.rows.map(r=>r.id).sort());
    assert.equal((await reads.selection(query)).count,3);
    assert.equal((await reads.list({...query,page:99,pageSize:1})).page,3);
    assert.equal((await reads.list({...query,collectionBasis:'latest'})).total,0);
    assert.equal((await reads.list({...query,collectionBasis:undefined})).total,0);
    assert.equal((await reads.list({...query,collectionBasis:'latest',collectedFrom:'2026-11-16',collectedTo:'2026-11-16'})).total,6);
    assert.equal((await reads.list({...query,productPool:'existing'})).total,0);
    assert.equal((await reads.list({...query,market:'MX'})).total,0);
    await assert.rejects(()=>reads.list({...query,collectedFrom:'2026-11-31'}),/采集日期/);
    await assert.rejects(()=>reads.list({...query,collectedFrom:'2026-11-16'}),/开始日期/);
    assert.equal(matchesCollectionRange('ads',{lastCollectedAt:'2026-11-16T01:00:00Z',firstSeenAt:'2026-11-12T00:00:00Z'},query.collectedFrom,query.collectedTo,'first'),false);
  } finally { await db.close(); }
});
