import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { productKeywordSample, validateProductKeywords } from './product-keywords-domain.mjs';
import { runProductKeywordJob } from './product-keywords-engine.mjs';

test('isolated product keyword queue, persistence and recovery preserve canonical records and paid receipts', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve('.artifacts/product-keywords-no-config.json');
  process.env.DATABASE_URL = 'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === './discovery-ai.mjs' && context.parentURL?.endsWith('/product-keywords-provider.mjs')) return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export const configuredJson=(...args)=>globalThis.__productKeywordModelQATest(...args);')}`,
      };
      if (specifier === './collection-translation.mjs') return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent('export const translateCollectionRecords=async(_kind,records)=>records; export const translateCollectedResult=async(result)=>result;')}`,
      };
      return next(specifier, context);
    },
  });
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb);
    CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1);
    CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now());
    CREATE TABLE research_jobs(id uuid PRIMARY KEY,request_id uuid UNIQUE,input jsonb,checkpoint jsonb,status text DEFAULT 'queued',cancelled boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE research_requests(job_id uuid,step text,status text,response jsonb,paid_allowance integer DEFAULT 0,error text,PRIMARY KEY(job_id,step));
  `);
  const { pool, putDocument, sql } = await import('./database.mjs');
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = (statement, args = []) => db.query(statement, args.map((arg) => arg && typeof arg === 'object' ? JSON.stringify(arg) : arg));
  pool.connect = async () => ({ query: (...args) => pool.query(...args), release() {} });
  t.after(async () => {
    pool.query = originalQuery; pool.connect = originalConnect;
    hook.deregister(); delete globalThis.__productKeywordModelQATest; await db.close(); await pool.end();
  });
  const { queueProductKeywords, submitProductKeywords, productKeywordIO } = await import('./product-keywords-store.mjs');
  const { upsertProduct } = await import('./platform-products-jobs.mjs');
  const { mergeBusiness } = await import('./market-jobs.mjs');
  const admin = { role: 'admin' };
  const p = { id: 'p1', title: 'Example Magnesium Glycinate capsules', brand: 'Example', market: 'US',
    sourceUrl: 'https://example.test/p1', dataNature: 'collected', fieldAnalysis: { status: 'analyzed' } };
  const readProduct = async (id = 'p1') => (await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [`business:products:${id}`])).rows[0]?.value;
  const jobFor = async (product) => (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [product.keywordDerivation.jobId])).rows[0];
  const saveCheckpoint = async (job, cp, status = 'running') => {
    await pool.query('UPDATE research_jobs SET checkpoint=$2,status=$3 WHERE id=$1', [job.id, cp, status]);
    job.checkpoint = structuredClone(cp); job.status = status;
  };

  await t.test('new platform and site products queue automatically, reruns and manual repeats reuse the exact job', async () => {
    await upsertProduct(p);
    const first = await readProduct();
    assert.equal(first.keywordDerivation.status, 'queued');
    await upsertProduct(p);
    await mergeBusiness('products:site-p', { ...p, id: 'site-p' });
    assert.ok((await readProduct('site-p')).keywordDerivation.jobId);
    const result = await submitProductKeywords({ ids: ['p1'] }, admin);
    assert.equal(result.reused, 1);
    assert.equal((await readProduct()).keywordDerivation.jobId, first.keywordDerivation.jobId);
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM research_jobs WHERE input->>'kind'='product_keywords'")).rows[0].n, 2);
    await assert.rejects(submitProductKeywords({ ids: ['p1'] }, { role: 'viewer' }), /权限|管理员/);
    await assert.rejects(submitProductKeywords({ ids: ['p1', 'missing'] }, admin), /未提交部分名单/);
    assert.equal((await pool.query('SELECT count(*)::integer AS n FROM research_jobs')).rows[0].n, 2);
  });

  await t.test('canonical keyword ID, review state, previous links and trends survive while both product directions and evidence are saved', async () => {
    const trend = { version: 1, status: 'collected', scale: 'relative_0_1', values: Array.from({ length: 12 }, () => 0.5), collectedAt: '2026-11-01T00:00:00Z' };
    const old = { id: 'canonical', term: 'magnesium glycinate', market: 'US', source: 'manual', favorite: true,
      reviewStatus: 'selected', productIds: ['older'], series: [1, 2], dataNature: 'collected',
      metrics: { source: 'Semrush MCP', market: 'US', collectedAt: '2026-11-01T00:00:00Z', monthlySearchVolume: 50, searchTrend: trend } };
    await pool.query('INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)', ['US|magnesium glycinate', old]);
    let modelCalls = 0;
    const collect = async (job, step, request) => {
      if (step === 'product-keywords') {
        modelCalls++;
        return { keywords: validateProductKeywords({ keywords: [{ term: 'Magnesium Glycinate', termZh: '甘氨酸镁', sourceId: 'title', quote: request.sample.sources[0].text, kind: 'ingredient' }] }, request.sample), model: 'synthetic' };
      }
      assert.equal(request.nonTrendOnly, true);
      return { complete: true, metrics: { source: 'Semrush MCP', market: 'US', collectedAt: '2026-11-13T00:00:00Z', monthlySearchVolume: 0, difficulty: 12, searchTrend: { invalid: true } } };
    };
    const io = { ...productKeywordIO({ pool, sql, putDocument, collect, saveCheckpoint }), hasConfig: async () => true };
    const job = await jobFor(await readProduct());
    await runProductKeywordJob(job, io);
    assert.equal(job.status, 'completed', job.checkpoint.logs.join('\n'));
    assert.deepEqual((await readProduct()).keywordIds, ['canonical']);
    const k = (await pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['US|magnesium glycinate'])).rows[0].data;
    assert.equal(k.favorite, true); assert.equal(k.reviewStatus, 'selected');
    assert.deepEqual(k.productIds, ['older', 'p1']);
    assert.deepEqual(k.metrics.searchTrend, trend); assert.equal(k.metrics.monthlySearchVolume, 0);
    assert.equal(k.productKeywordEvidence[0].productId, 'p1');
    assert.equal(k.productKeywordEvidence[0].basis, 'product_text_candidate');
    assert.deepEqual(k.series, [1, 2]);
    const repeat = await submitProductKeywords({ ids: ['p1'] }, admin);
    assert.equal(repeat.reused, 1);
    await runProductKeywordJob(await jobFor(await readProduct()), io);
    assert.equal(modelCalls, 1);
    const second = await jobFor(await readProduct('site-p'));
    await runProductKeywordJob(second, io);
    const merged = (await pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['US|magnesium glycinate'])).rows[0].data;
    assert.deepEqual(merged.productIds, ['older', 'p1', 'site-p']);
    assert.equal(merged.productKeywordEvidence.length, 2);
  });

  await t.test('configuration-only failures resume safely; failed or unknown provider receipts stay untouched', async () => {
    const value = { ...p, id: 'config-gap' };
    await putDocument('workspace_documents', `business:products:${value.id}`, value);
    await submitProductKeywords({ ids: [value.id] }, admin);
    let job = await jobFor(await readProduct(value.id));
    const io = productKeywordIO({ pool, sql, putDocument, saveCheckpoint });
    await runProductKeywordJob(job, io);
    assert.equal(job.status, 'failed');
    await submitProductKeywords({ ids: [value.id] }, admin);
    job = await jobFor(await readProduct(value.id));
    assert.equal(job.status, 'queued');
    await pool.query("INSERT INTO research_requests(job_id,step,status) VALUES($1,'product-keywords','started')", [job.id]);
    await pool.query("UPDATE research_jobs SET status='failed' WHERE id=$1", [job.id]);
    await submitProductKeywords({ ids: [value.id] }, admin);
    assert.equal((await jobFor(await readProduct(value.id))).status, 'failed');
    assert.equal((await pool.query('SELECT status FROM research_requests WHERE job_id=$1', [job.id])).rows[0].status, 'started');
  });

  await t.test('old queued snapshots cannot overwrite a newer derivation, and a new market remains separate', async () => {
    const original = await readProduct();
    const changed = { ...original, title: 'Example Vitamin C supplement' };
    await putDocument('workspace_documents', 'business:products:p1', changed);
    const result = await submitProductKeywords({ ids: ['p1'] }, admin);
    assert.notEqual(result.jobs[0].jobId, original.keywordDerivation.jobId);
    const pMx = { ...p, id: 'mx', market: 'MX' };
    await putDocument('workspace_documents', 'business:products:mx', pMx);
    await queueProductKeywords(pMx, pool);
    const io = productKeywordIO({ pool, sql, putDocument });
    const evidence = validateProductKeywords({ keywords: [{ term: 'Magnesium Glycinate', sourceId: 'title', quote: pMx.title, kind: 'ingredient' }] }, productKeywordSample(pMx));
    const mxJob = { id: randomUUID(), input: { targetId: 'mx', sample: productKeywordSample(pMx) } };
    await io.linkKeywords(mxJob, evidence, 'synthetic');
    const mx = (await pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['MX|magnesium glycinate'])).rows[0].data;
    assert.notEqual(mx.id, 'canonical');
    assert.deepEqual(mx.productIds, ['mx']);
    await io.updateProduct({ id: original.keywordDerivation.jobId, input: { targetId: 'p1' } }, { status: 'failed' });
    assert.equal((await readProduct()).keywordDerivation.jobId, result.jobs[0].jobId);
    assert.equal((await readProduct()).keywordDerivation.status, 'queued');
  });

  await t.test('the real request journal reuses successful model responses and never repeats failed or started requests', async () => {
    const { collect } = await import('./store.mjs');
    let calls = 0;
    let fail = false;
    globalThis.__productKeywordModelQATest = async (_prompt, sample) => {
      calls++;
      if (fail) throw Error('synthetic timeout; result unknown');
      return { result: { keywords: [{ term: 'Magnesium Glycinate', termZh: '甘氨酸镁', kind: 'ingredient', sourceId: 'title', quote: sample.sources[0].text }] },
        usage: { modelCalls: 1, modelTokens: 123 }, model: 'synthetic' };
    };
    const request = { sources: ['product_keywords'], sample: productKeywordSample(p) };
    const job = { id: randomUUID(), input: {} };
    const first = await collect(job, 'product-keywords', request);
    const repeated = await collect(job, 'product-keywords', request);
    assert.deepEqual(repeated, first); assert.equal(calls, 1);
    assert.equal(first.usage.modelTokens, 123);
    fail = true;
    const failed = { id: randomUUID(), input: {} };
    await assert.rejects(collect(failed, 'product-keywords', request), /unknown/);
    await assert.rejects(collect(failed, 'product-keywords', request));
    assert.equal(calls, 2);
    const unknown = { id: randomUUID(), input: {} };
    await pool.query("INSERT INTO research_requests(job_id,step,status) VALUES($1,'product-keywords','started')", [unknown.id]);
    await assert.rejects(collect(unknown, 'product-keywords', request));
    assert.equal(calls, 2);
  });
});
