/* eslint-disable unicorn/no-await-expression-member -- SQL assertions match server convention. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

// Explicitly gated to a disposable container/database; never read the production config.
if (process.env.PRODUCT_COMPLETION_QA !== 'disposable-only')
  throw new Error(
    'Use an isolated disposable database and PRODUCT_COMPLETION_QA=disposable-only',
  );
process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.DATABASE_CONFIG_FILE = '/tmp/product-completion-qa-config.json';
const mysql = process.env.QA_MYSQL_HOST;
if (mysql) {
  if (mysql !== 'product-completion-qa-db')
    throw new Error('Unexpected QA host');
  const { encryptConfig } = await import('./secrets.mjs');
  await writeFile(
    process.env.DATABASE_CONFIG_FILE,
    JSON.stringify(
      encryptConfig({
        host: mysql,
        port: 3306,
        database: 'product_completion_qa',
        user: 'qa',
        password: 'disposable-qa-only',
        tlsMode: 'plain',
      }),
    ),
    { mode: 0o600 },
  );
} else if (
  !/^postgres:\/\/qa:disposable-qa-only@product-completion-qa-db:5432\/product_completion_qa$/.test(
    process.env.DATABASE_URL || '',
  )
) {
  throw new Error('Unexpected QA database URL');
}
const { pool, putDocument, engine } = await import('./database.mjs');
const { migrate } = await import('./store.mjs');
const { migrateCredentials } = await import('./local-provider.mjs');
const { submitPlatformProducts, submitPlatformProductEnrichment, runPlatformProducts,
  readProduct, upsertProduct, cancelPlatformCompletion } = await import('./platform-products-jobs.mjs');
const { normalizeAmazon, normalizeAmazonTrend } = await import('./platform-product-data.mjs');
const { jobTasks } = await import('./runner.mjs');
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('External access forbidden in QA'); };
const readJob = async id => (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
const p = (i, market = 'US') => normalizeAmazon({asin: `B0T${String(i).padStart(7,'0')}`, title: `Synthetic QA fiber ${i}`, price: 20}, market, new Date().toISOString());
const cancel = async j => {
  await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [j.id]);
  await cancelPlatformCompletion(await readJob(j.id));
};
try {
  await migrate();
  assert.equal((await pool.query('SELECT name FROM provider_configs')).rows.length, 0, 'Fresh disposable DB required');
  await migrateCredentials({ RESEARCH_ACCESS_KEY: 'qa-not-live', SORFTIME_MCP_TOKEN: 'qa-not-live' });
  const a = {...p(1), favorite: true, keywordIds: ['qa-keyword']}, b = p(2, 'MX');
  for (const product of [a,b]) await putDocument('workspace_documents', `business:products:${product.id}`, product);
  const request = {requestId: randomUUID(), productIds: [a.id,b.id]};
  const job = await submitPlatformProductEnrichment(request);
  assert.equal(job.input.initialWork.length, 10);
  assert.equal(jobTasks(job)[0].researchProgress.total, 10);
  assert.equal((await submitPlatformProductEnrichment(request)).id, job.id);
  await assert.rejects(submitPlatformProductEnrichment({...request,requestId: randomUUID()}), /仍有平台采集任务/);
  await assert.rejects(submitPlatformProducts({requestId: randomUUID(), terms: 'qa fiber', market: 'MX', providers:['sorftime']}), /已有平台商品任务/);
  assert.ok(Object.values((await readProduct(a.id)).dataCompletion).every(x => x.status === 'queued'));
  const calls = [];
  const collect = async (_j,_step,r) => {
    calls.push(r);
    if (r.op === 'detail') return { product: {...r.product, brand: 'Synthetic QA'} };
    if (r.op === 'content') return { patch: { ingredient: 'Synthetic QA fiber', imageUrl: 'https://example.com/qa.jpg' } };
    return { series: normalizeAmazonTrend({data:{asin:r.product.sourceProductId,type:r.trendType,data:['202608',100,'202609',140]}}, r.product, new Date().toISOString(),r.trendType) };
  };
  for (let i=0;i<12;i++) {
    const current=await readJob(job.id);
    if (['completed','partial'].includes(current.status)) break;
    await runPlatformProducts(current,{collect});
  }
  assert.equal((await readJob(job.id)).status,'completed');
  assert.equal(calls.length,10);
  assert.ok(calls.filter(r=>r.product.id===b.id).every(r=>r.market==='MX'));
  const saved=await readProduct(a.id);
  assert.equal(saved.favorite,true);
  assert.deepEqual(saved.keywordIds,['qa-keyword']);
  assert.equal(saved.decisionData.series.length,3);
  assert.equal(saved.ingredient,'Synthetic QA fiber');
  const reused=await submitPlatformProductEnrichment({requestId:randomUUID(),productIds:[a.id]});
  assert.equal(reused.input.initialWork.length,0,'fresh successful steps reused');
  await runPlatformProducts(reused,{collect});
  assert.equal(calls.length,10);
  const c=p(3); await upsertProduct(c);
  const countBefore=(await pool.query('SELECT id FROM research_jobs')).rows.length;
  await assert.rejects(submitPlatformProductEnrichment({requestId:randomUUID(),productIds:[c.id,'missing']}), /不存在/);
  assert.equal((await pool.query('SELECT id FROM research_jobs')).rows.length,countBefore);
  assert.equal((await readProduct(c.id)).dataCompletion,undefined,'transaction rollback has no partial metadata');
  const parallel=await Promise.allSettled([1,2].map(()=>submitPlatformProductEnrichment({requestId:randomUUID(),productIds:[c.id]})));
  assert.equal(parallel.filter(x=>x.status==='fulfilled').length,1);
  const active=parallel.find(x=>x.status==='fulfilled').value;
  await cancel(active);
  assert.ok(Object.values((await readProduct(c.id)).dataCompletion).every(x=>x.status==='cancelled'));
  const discovery=await submitPlatformProducts({requestId:randomUUID(),terms:'qa fiber',market:'US',providers:['sorftime']});
  await assert.rejects(submitPlatformProductEnrichment({requestId:randomUUID(),productIds:[c.id]}), /仍有平台采集任务/);
  await cancel(discovery);
  const website={id:'qa-website',title:'Synthetic website product',market:'US'};
  await upsertProduct(website);
  const unsupported=await submitPlatformProductEnrichment({requestId:randomUUID(),productIds:[website.id]});
  assert.equal(unsupported.input.initialWork.length,0);
  assert.equal((await readProduct(website.id)).dataCompletion.trend.status,'unsupported');
  await runPlatformProducts(unsupported,{collect});
  assert.equal(calls.length,10,'unsupported source never queries a same-name ASIN');
  await pool.query('DELETE FROM workspace_documents WHERE name=$1',[`business:products:${c.id}`]);
  await upsertProduct({id:c.id,dataCompletion:{detail:{status:'completed'}}});
  assert.equal(await readProduct(c.id),undefined,'deleted product is not resurrected by metadata writes');
  assert.equal(externalCalls,0);
  console.warn(`PASS ${engine}: full completion submission, mixed markets, atomic save/rollback, duplicate/concurrent submission, bidirectional discovery locks, cached success, cancellation, unsupported source, deleted products; zero external calls`);
} finally {
  await pool.end();
  if(mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
}
