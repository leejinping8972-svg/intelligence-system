import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pool } from './database.mjs';
import {
  submitSemrushSites,
  runSemrushSitesJob,
  saveSemrushSite,
} from './semrush-sites-store.mjs';
import { advertiserSites } from './semrush-sites.mjs';
import { collect } from './store.mjs';

test('isolated SQL: idempotent submit, source-only merge, market links, cancellation and journal recovery', async () => {
  const db = new PGlite();
  const originalQuery = pool.query,
    originalConnect = pool.connect;
  const at = new Date().toISOString();
  const input = {
    requestId: '00000000-0000-4000-8000-000000000001',
    terms: 'magnesium',
    market: 'US',
    perPage: 2,
    maxPages: 2,
    maxSites: 10,
    semrushUnitLimit: 100,
  };
  pool.query = async (statement, params = []) => {
    if (/pg_try_advisory_lock/.test(statement))
      return { rows: [{ locked: true }] };
    if (/pg_advisory_unlock/.test(statement)) return { rows: [] };
    return db.query(
      statement,
      params.map((p) => (p && typeof p === 'object' ? JSON.stringify(p) : p)),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  try {
    await db.exec(`CREATE TABLE research_jobs(id uuid PRIMARY KEY,request_id uuid UNIQUE,input jsonb,checkpoint jsonb,status text DEFAULT 'queued',cancelled boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
      CREATE TABLE research_requests(job_id uuid,step text,paid_allowance integer DEFAULT 0,status text,response jsonb,error text,PRIMARY KEY(job_id,step));
      CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb);
      CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1);
      CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now());`);
    await pool.query('INSERT INTO provider_configs VALUES($1,$2)', [
      'provider:semrush:mcp:v1',
      { synthetic: true },
    ]);
    for (const market of ['US', 'VN'])
      await pool.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        [
          `${market}|magnesium`,
          { id: market, term: 'magnesium', market, siteIds: ['preserved'] },
        ],
      );
    const old = {
      id: 'US-brand.com',
      domain: 'brand.com',
      market: 'US',
      brand: 'Verified brand',
      platform: 'Shopify',
      type: '独立电商',
      sources: ['Brave Search'],
      sourceEvidence: [],
      favorite: true,
      metrics: { paidTraffic: 123 },
    };
    await pool.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
      ['business:sites:US-brand.com', old],
    );
    const first = await submitSemrushSites(input);
    const duplicate = await submitSemrushSites(input);
    assert.equal(first.id, duplicate.id);
    await assert.rejects(
      submitSemrushSites({
        ...input,
        requestId: '00000000-0000-4000-8000-000000000002',
      }),
      /已有/,
    );
    let calls = 0;
    await runSemrushSitesJob(first, {
      collect: async () => {
        calls++;
        return {
          rows: [{ domain: 'brand.com' }],
          apiUnits: 20,
          collectedAt: at,
        };
      },
    });
    const stored = (
      await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
        'business:sites:US-brand.com',
      ])
    ).rows[0].value;
    assert.equal(stored.brand, old.brand);
    assert.equal(stored.type, old.type);
    assert.equal(stored.favorite, true);
    assert.equal(stored.metrics.paidTraffic, 123);
    assert.ok(stored.sources.includes('Semrush phrase_adwords'));
    assert.equal(stored.sourceEvidence.length, 1);
    await saveSemrushSite(
      advertiserSites([{ domain: 'brand.com' }], 'magnesium', 'US', at)[0],
    );
    assert.equal(
      (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          ['business:sites:US-brand.com'],
        )
      ).rows[0].value.sourceEvidence.length,
      1,
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT data FROM research_keywords WHERE natural_key=$1',
          ['US|magnesium'],
        )
      ).rows[0].data.siteIds,
      ['preserved', 'US-brand.com'],
    );
    assert.deepEqual(
      (
        await pool.query(
          'SELECT data FROM research_keywords WHERE natural_key=$1',
          ['VN|magnesium'],
        )
      ).rows[0].data.siteIds,
      ['preserved'],
    );
    const finished = (
      await pool.query('SELECT * FROM research_jobs WHERE id=$1', [first.id])
    ).rows[0];
    assert.equal(finished.status, 'completed');
    assert.equal(finished.checkpoint.semrushUnits, 20);
    assert.equal(calls, 1);
    const cancelled = await submitSemrushSites({
      ...input,
      requestId: '00000000-0000-4000-8000-000000000003',
      market: 'VN',
    });
    await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [
      cancelled.id,
    ]);
    await runSemrushSitesJob(cancelled, {
      collect: async () => {
        throw new Error('cancelled job must not call provider');
      },
    });
    assert.equal(
      (
        await pool.query('SELECT status FROM research_jobs WHERE id=$1', [
          cancelled.id,
        ])
      ).rows[0].status,
      'cancelled',
    );
    await pool.query(
      'INSERT INTO research_requests(job_id,step,status,response) VALUES($1,$2,$3,$4)',
      [
        first.id,
        'sem-sites:0:0',
        'done',
        {
          rows: [{ domain: 'brand.com' }],
          apiUnits: 20,
          semrushKeyId: 'synthetic-key-id',
          collectedAt: at,
        },
      ],
    );
    const cached = await collect(first, 'sem-sites:0:0', {
      sources: ['semrush_sites'],
    });
    assert.equal(cached.apiUnits, 20);
    assert.equal(cached.semrushKeyId, undefined);
    await pool.query(
      'INSERT INTO research_requests(job_id,step,status) VALUES($1,$2,$3)',
      [first.id, 'sem-sites:0:1', 'started'],
    );
    await assert.rejects(
      collect(first, 'sem-sites:0:1', { sources: ['semrush_sites'] }),
      /不自动重复请求/,
    );
    assert.equal(
      (await pool.query('SELECT count(*) AS count FROM research_requests'))
        .rows[0].count,
      2,
    );
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
    await pool.end();
  }
});
