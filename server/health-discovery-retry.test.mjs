/* oxlint-disable vitest/no-import-node-test -- Server tests run with Node's native test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { futureHealthPlan, healthCategoryWork, healthCategoryKey, HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';
import { healthProductSample } from './health-product-domain.mjs';
import { sourceFieldSample, validateSourceFields } from './source-field-domain.mjs';
import { discoveryPlan, stableId } from './discovery-monitor-domain.mjs';
import { resumePartialTask } from './task-resume.mjs';
import { runHealthDiscovery } from './health-discovery-runner.mjs';

const digest = s => createHash('sha256').update(s).digest('hex').slice(0, 24);
const id = '1fd767a0-3dfb-42d8-8299-2ab030cc4bbb';
const now = Date.parse('2026-11-10T02:00:00Z');
const p = name => ({ id: name, title: 'Dietary supplement capsules; swallow for nutrition.', market: 'US',
  decisionData: { listing: { date: '2026-11-09' } }, resourceRaw: { salesEvidence: { value: 2 } } });

test('only failed category/seller and invalid review analysis retry; success, counts, frozen date and receipts survive', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE research_jobs(id text primary key,status text,cancelled boolean,input jsonb,checkpoint jsonb,updated_at timestamptz); CREATE TABLE research_requests(job_id text,step text,status text,response jsonb,error text); CREATE TABLE workspace_documents(name text primary key,value jsonb);');
    const plan = discoveryPlan(futureHealthPlan({ kind: 'regular_new', market: 'US', channels: ['amazon'], completeDays: true, maxProducts: 500, maxPages: 5 }));
    const work = healthCategoryWork(plan), sourceStep = w => `source:${stableId(JSON.stringify(w))}`;
    const accepted = { ...p('saved'), sourcePlatform: 'Amazon', sourceProvider: 'Amazon Official', sellerName: '店铺甲', sellerId: 'A1234567890123', sourceProductId: 'B000000001', fieldAnalysis: { version: 2, status: 'analyzed', marker: 'keep' } };
    const review = p('review');
    const sample = healthProductSample(sourceFieldSample('products', review), HEALTH_PRODUCT_POLICY);
    const fieldStep = `intake:${digest(review.id)}:fields:${sample.fingerprint.slice(0,24)}`;
    const sellerStep = `intake:${digest(accepted.id)}:seller_detail:${digest('US|店铺甲|A1234567890123')}`;
    const cp = { asOf: now, work: [], pending: [], products: 1, accepted: ['saved'], seen: ['review:health','saved:health'],
      healthCoverage: Object.fromEntries(work.map((w,i) => [healthCategoryKey(w), {firstPage:i ? 'done':'failed', pages:i?1:0, ...(i?{}:{error:'timeout'})}])),
      healthReviewIds: ['review'], healthReviewCount: 1, failures: ['timeout','seller failure'], logs: [] };
    await db.query('INSERT INTO research_jobs VALUES($1,$2,false,$3,$4,now())',[id,'partial',{kind:'discovery_monitor',plan},cp]);
    const receipts = [
      {step:sourceStep(work[0]),status:'failed',error:'timeout'},
      {step:sourceStep(work[1]),status:'done',response:{products:[accepted,review],sourceRows:2}},
      {step:sellerStep,status:'failed',error:'seller failed'},
      {step:fieldStep,status:'done',response:{analysis:{status:'analyzed',healthProduct:{status:'pending'}}}},
    ];
    for(const r of receipts) await db.query('INSERT INTO research_requests VALUES($1,$2,$3,$4,$5)',[id,r.step,r.status,r.response||{},r.error||null]);
    for(const [name,value] of [[`business:products:saved`,accepted],[`discovery:health-candidate:${id}:review`,{product:review,status:'pending',decision:{reason:'classification_evidence_missing_or_invalid'}}]])
      await db.query('INSERT INTO workspace_documents VALUES($1,$2)',[name,value]);
    const pool = {connect:async()=>({query:db.query.bind(db),release(){}})};
    await db.query("INSERT INTO research_requests VALUES($1,'unknown','started','{}',null)",[id]);
    await assert.rejects(resumePartialTask(id,pool,{retryFailures:true}), /结果未确认/);
    const blockedJob = await db.query('SELECT status FROM research_jobs');
    assert.equal(blockedJob.rows[0].status,'partial');
    await db.query("DELETE FROM research_requests WHERE step='unknown'");
    await resumePartialTask(id,pool,{retryFailures:true});
    const jobResult=await db.query('SELECT * FROM research_jobs');
    const job=jobResult.rows[0];
    assert.equal(job.checkpoint.work.length,1);
    assert.equal(job.checkpoint.pending.length,2);
    assert.equal(job.checkpoint.asOf,now);
    assert.deepEqual(job.checkpoint.accepted,['saved']);
    assert.equal(job.checkpoint.healthFailureHistory[0].failures.length,2);
    const again=await resumePartialTask(id,pool,{retryFailures:true});
    const duplicate=await db.query('SELECT checkpoint FROM research_jobs');
    assert.equal(again.reused,true);
    assert.deepEqual(duplicate.rows[0].checkpoint,job.checkpoint);
    const calls=[], writes=[], docs=[]; let status;
    const io={now:()=>now,pool:{query:async()=>({rows:[{cancelled:false}]})},
      collect:async(_j,step,request)=>{
        calls.push(step);
        assert.ok(!receipts.some(r=>r.step===step),'no original request is replayed');
        if(request.sources[0]==='discovery_sorftime') return {products:[],sourceRows:0};
        if(request.op==='seller_detail') return {patch:{sellerDetails:{status:'available',sellerName:'店铺甲',sellerId:'A1234567890123',market:'US',businessName:'中文企业',businessAddress:['广东省','佛山市'],collectedAt:new Date(now).toISOString()}}};
        assert.equal(request.sources[0],'field_analysis');
        const proof={sourceId:'title',quote:request.sample.sources[0].text};
        return validateSourceFields({fields:[],healthProduct:{kind:'oral_supplement',route:'oral',evidence:proof,usage:proof,purpose:proof}},request.sample);
      },upsertProduct:async value=>writes.push(value), putDocument:async(_t,name,value)=>docs.push({name,value}),
      saveCheckpoint:async(_j,value,s)=>{job.checkpoint=structuredClone(value);status=s;}};
    for(let i=0;i<8 && !['partial','completed'].includes(status);i++) await runHealthDiscovery(job,io);
    assert.equal(status,'completed', JSON.stringify({failures:job.checkpoint.failures,reviews:docs}));
    assert.equal(calls.length,3);
    assert.equal(calls.filter(s=>s.startsWith('retry:1:')).length,2);
    assert.ok(calls.some(s=>s.includes(`intake:${digest(review.id)}:fields:`)));
    assert.equal(job.checkpoint.products,2);
    assert.equal(job.checkpoint.healthReviewCount,0);
    assert.equal(job.checkpoint.healthCoverage[healthCategoryKey(work[0])].error,undefined);
    assert.equal(job.checkpoint.healthCoverage[healthCategoryKey(work[1])].pages,1);
    assert.equal(writes.find(v=>v.id==='saved').fieldAnalysis.marker,'keep');
    assert.equal(docs[0].value.status,'accepted');
    const keptRequests=await db.query('SELECT * FROM research_requests');
    assert.equal(keptRequests.rows.length,4);
  } finally {await db.close();}
});
