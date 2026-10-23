import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('official completion SQL submission, journal, budget and searchable evidence', { skip: !process.env.HCI_TEST_PGLITE_MODULE }, async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve('.artifacts/product-reference-no-config.json');
  process.env.DATABASE_URL = 'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const { PGlite } = await import(pathToFileURL(resolve(process.env.HCI_TEST_PGLITE_MODULE)).href);
  const db = new PGlite();
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('External requests forbidden'); };
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/store.mjs') && specifier === './platform-products-provider.mjs')
      return { shortCircuit: true, url: 'data:text/javascript,' + encodeURIComponent('export const platformProductRequest = request => globalThis.__productReferenceProvider(request);') };
    return next(specifier, context);
  } });
  const { pool, sql, lock, unlock, putDocument } = await import('./database.mjs');
  const originalQuery = pool.query, originalConnect = pool.connect;
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (!params.length && statement.trim().split(';').filter(s => s.trim()).length > 1) return (await db.exec(statement)).at(-1);
    return db.query(statement, params.map(value => value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) ? JSON.stringify(value) : value));
  };
  pool.connect = async () => ({ query: (...args) => pool.query(...args), release() {} });
  try {
    const { migrate } = await import('./store.mjs');
    const { submitPlatformProductEnrichment: submit, previewPlatformProductEnrichment: preview, runPlatformProducts, readProduct, upsertProduct, cancelPlatformCompletion } = await import('./platform-products-jobs.mjs');
    const { enrichPublicProduct } = await import('./product-public-enrichment.mjs');
    const { createWorkspaceReads } = await import('./workspace-reads.mjs');
    await migrate();
    const url = 'https://qa-brand.example/products/dhea';
    const a = { id: 'qa-dhea', title: 'DHEA Supplement', brand: 'Synthetic', market: 'US', siteId: 'qa-site', favorite: true, reviewed: true, keywordIds: ['qa-keyword'], price: 20, currency: 'USD', benefits: [], ingredientInsights: [], evidenceUrl: url, dataNature: 'collected' };
    const b = { ...a, id: 'qa-huperzine', title: 'Huperzine A Supplement', evidenceUrl: 'https://qa-brand.example/products/huperzine', favorite: false };
    await upsertProduct(a); await upsertProduct(b);
    let now = Date.now() - 3_600_000; let mode = 'observed';
    const calls = [];
    globalThis.__productReferenceProvider = async request => {
      calls.push(request);
      return enrichPublicProduct(request, { now: () => now, fetchPage: async requested => {
        if (mode === 'failure') throw Object.assign(new Error('synthetic HTTP failure'), { status: 429 });
        const node = { '@type': 'Product', name: request.product.title, url: request.product.evidenceUrl, ...(mode === 'observed' ? { datePublished: '2019-02-03T00:00:00Z', numberOfItemsSold: 123 } : { dateModified: '2026-10-22', reviewCount: 123, sales: 456 }) };
        return { url: requested, html: '<script type="application/ld+json">' + JSON.stringify(node) + '</script>' };
      } });
    };
    const getJob = async id => (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
    const drain = async id => {
      for (let step = 0; step < 10; step++) {
        now += 31_000;
        const job = await getJob(id);
        if (!['queued','running'].includes(job.status)) return job;
        await runPlatformProducts(job, { now: () => now });
      }
      throw new Error('Completion did not finish');
    };
    await t.test('preview counts all selected official products without credentials or requests', async () => {
      assert.deepEqual(await preview({ productIds: [a.id,b.id] }), { total: 2, sorftime: 0, public: 2, unsupported: 0, estimatedRequests: 4, defaultMaxRequests: 4 });
      assert.equal(calls.length,0);
    });
    await t.test('missing official destination records the actual unsupported reason without requests', async () => {
      const unsupported={...a,id:'qa-no-url',evidenceUrl:'https://qa-brand.example'};
      await upsertProduct(unsupported);
      const before=calls.length;
      const job=await submit({requestId:randomUUID(),productIds:[unsupported.id],maxRequests:1});
      assert.equal(job.input.initialWork.length,0);await drain(job.id);
      const saved=await readProduct(unsupported.id);
      assert.equal(saved.dataCompletion.public_detail.status,'unsupported');
      assert.match(saved.dataCompletion.public_detail.message,/官网商品链接/);
      assert.equal(calls.length,before);
    });
    await t.test('one request budget completes only one product and preserves exact evidence and manual state', async () => {
      const input = { requestId: randomUUID(), productIds: [a.id,b.id], maxRequests: 1 };
      const job = await submit(input);
      assert.equal((await submit(input)).id,job.id);
      assert.equal(job.input.initialWork.length,2);
      const done = await drain(job.id);
      assert.equal(done.status,'partial'); assert.equal(done.checkpoint.requests,1);
      assert.equal(calls.length,1); assert.equal(calls[0].publicRequestLimit,1);
      const saved = await readProduct(a.id);
      assert.equal(saved.sourceMetrics.soldCount,123); assert.equal(saved.decisionData.listing.date,'2019-02-03');
      assert.equal(saved.publicDataEvidence.listing.status,'observed');
      assert.equal(saved.favorite,true); assert.equal(saved.reviewed,true);
      assert.deepEqual(saved.keywordIds,['qa-keyword']); assert.equal(saved.siteId,'qa-site');
      assert.equal(saved.title,a.title); assert.equal(saved.sourceProvider,undefined);
      assert.equal((await readProduct(b.id)).sourceMetrics?.soldCount,undefined);
      assert.equal((await readProduct(b.id)).dataCompletion.public_detail.status,'failed');
      assert.match((await readProduct(b.id)).dataCompletion.public_detail.message,/请求预算/);
      await runPlatformProducts(job,{ now: () => now });
      await drain(job.id);
      assert.equal(calls.length,1,'durable journal reuses a lost-checkpoint request');
    });
    await t.test('Chinese search, listing range, list projection and export retain evidence', async () => {
      const reads = createWorkspaceReads({ pool,sql,lock,unlock,putDocument,isWorkspaceSyncKey:()=>true,loadPublic:async()=>({collector:null,free:null}) });
      for(let i=0;i<25;i++) if(!await reads.refresh()) break;
      const result = await reads.list({collection:'products',market:'US',search:'脱氢表雄酮',listedFrom:'2019-01-01',listedTo:'2019-12-31',pageSize:20});
      assert.equal(result.total,1); assert.equal(result.rows[0].id,a.id);
      assert.equal(result.rows[0].publicDataEvidence.sold.status,'observed');
      assert.equal(result.rows[0].sourceMetrics.soldEvidenceUrl,url);
      const exported = await reads.exportRecords({collection:'products',ids:[a.id]});
      assert.equal(exported.rows[0].sourceMetrics.soldCount,123);
      assert.equal((await reads.details({collection:'products',id:a.id})).record.decisionData.listing.date,'2019-02-03');
    });
    await t.test('successful recent public values are reused; forced empty refresh preserves prior dates and sales', async () => {
      const reused = await submit({requestId:randomUUID(),productIds:[a.id],maxRequests:2});
      assert.equal(reused.input.initialWork.length,0); await drain(reused.id);
      const before = calls.length; mode='missing';
      const refresh = await submit({requestId:randomUUID(),productIds:[a.id],maxRequests:2,refresh:true});
      await drain(refresh.id); assert.equal(calls.length,before+1);
      const saved=await readProduct(a.id);
      assert.equal(saved.sourceMetrics.soldCount,123); assert.equal(saved.decisionData.listing.date,'2019-02-03');
      assert.equal(saved.publicDataEvidence.sold.status,'preserved');
    });
    await t.test('cancelled official work never issues HTTP or revives a deleted product', async () => {
      const job = await submit({requestId:randomUUID(),productIds:[b.id],maxRequests:2});
      await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1',[job.id]);
      await cancelPlatformCompletion(await getJob(job.id));
      const before=calls.length; await drain(job.id); assert.equal(calls.length,before);
      assert.equal((await readProduct(b.id)).dataCompletion.public_detail.status,'cancelled');
      await pool.query('DELETE FROM workspace_documents WHERE name=$1',['business:products:'+b.id]);
      await upsertProduct({id:b.id,publicDataEvidence:{checkedAt:new Date(now).toISOString()},dataCompletion:{public_detail:{status:'completed'}}});
      assert.equal(await readProduct(b.id),undefined);
    });
    await t.test('429 marks source failure and skips other products on the same host', async () => {
      const c={...a,id:'qa-fail-c',evidenceUrl:'https://qa-fail.example/products/c'},d={...a,id:'qa-fail-d',evidenceUrl:'https://qa-fail.example/products/d'};
      await upsertProduct(c);await upsertProduct(d);mode='failure';
      const before=calls.length;const job=await submit({requestId:randomUUID(),productIds:[c.id,d.id],maxRequests:4});
      const done=await drain(job.id);assert.equal(done.status,'partial');assert.equal(calls.length,before+1);
      assert.equal((await readProduct(c.id)).publicDataEvidence.sold.reason,'rate_limited');
      assert.equal((await readProduct(d.id)).dataCompletion.public_detail.status,'failed');
    });
    assert.equal(externalCalls,0);
  } finally {
    hook.deregister(); delete globalThis.__productReferenceProvider; globalThis.fetch=originalFetch;
    pool.query=originalQuery;pool.connect=originalConnect;await db.close();await pool.end();
  }
});
