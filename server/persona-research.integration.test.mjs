import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('persona API isolated SQL: permission, idempotence, reuse, review revision and publication', { skip: !process.env.HCI_TEST_PGLITE_MODULE }, async () => {
  const { PGlite } = await import(pathToFileURL(process.env.HCI_TEST_PGLITE_MODULE).href);
  const db = new PGlite();
  await db.exec('CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer DEFAULT 1); CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb NOT NULL); CREATE TABLE research_jobs(id uuid PRIMARY KEY,request_id uuid UNIQUE,input jsonb,checkpoint jsonb,status text DEFAULT \'queued\',cancelled boolean DEFAULT false,updated_at timestamptz DEFAULT now());');
  globalThis.__personaTestDb = db;
  const mod = s => `data:text/javascript,${encodeURIComponent(s)}`;
  const fakeDb = mod(`const db=globalThis.__personaTestDb; const c={query:(q,p)=>db.query(q,p),release(){}}; export const pool={query:(q,p)=>db.query(q,p),connect:async()=>c}; export const lock=async()=>true;export const unlock=async()=>{};export async function putDocument(t,n,v,_ignore=false,c=pool){await c.query('INSERT INTO '+t+'(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',[n,v]);}`);
  const hook = registerHooks({ resolve(specifier,context,next) {
    if(specifier==='./database.mjs')return {url:fakeDb,shortCircuit:true};
    if(specifier==='./ads-provider.mjs')return {url:mod('export const openAdsKey=()=>{throw new Error("No credentials")};export const scrapeRequest=()=>{throw new Error("No paid requests")};'),shortCircuit:true};
    if(context.parentURL?.endsWith('/persona-research-store.mjs')) {
      if(specifier==='./database.mjs')return {url:fakeDb,shortCircuit:true};
      if(specifier==='./auth.mjs')return {url:mod('export function requireAdmin(u){if(u?.role!=="admin")throw new Error("admin required");}'),shortCircuit:true};
      if(specifier==='./ads-provider.mjs')return {url:mod('export const openAdsKey=()=>{throw new Error("No credentials")};export const scrapeRequest=()=>{throw new Error("No paid requests")};'),shortCircuit:true};
    }
    return next(specifier,context);
  }});
  try {
    const {personaResearchAction:api,runPersonaResearch}=await import('./persona-research-store.mjs');
    const plan={market:'VN',title:'synthetic',groups:[{label:'A',minAge:28,maxAge:35,lifeStage:'unknown independently',familyRole:'target only',localContext:'mẹ'}],startDate:'2026-07-01',endDate:'2026-10-22',researchQuestion:'qa',sources:['content'],budget:{requests:0,credits:0,perQuery:5,commentVideos:0}};
    const input={action:'server_persona_submit',requestId:'1bfb6000-a617-434a-b042-886375fa0ba3',plan};
    await assert.rejects(()=>api(input,{role:'researcher'}),/admin/);
    const admin={role:'admin',username:'qa'};
    const first=await api(input,admin); assert.equal((await api(input,admin)).id,first.id);
    await db.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)',['business:researchEvidence:qa',{id:'original',kind:'comment',text:'mệt ngủ Tôi 32 tuổi.',url:'https://www.tiktok.com/@synthetic/video/12345678901234',platform:'TikTok',market:'VN',collectedAt:'2026-10-01T00:00:00Z'}]);
    await runPersonaResearch({id:first.id});
    let detail=await api({action:'server_persona_detail',id:first.id},admin);
    assert.equal(detail.study.evidence.length,1);assert.equal(detail.study.journal.length,0);assert.equal(detail.study.status,'partial');
    const r=detail.study.evidence[0];
    await api({action:'server_persona_review',id:first.id,revision:1,evidenceId:r.id,patch:{status:'accepted',evidenceClass:'explicit_self_report',assertions:{age:{value:32,quote:'32 tuổi'}}}},admin);
    await assert.rejects(()=>api({action:'server_persona_review',id:first.id,revision:1,evidenceId:r.id,patch:{status:'rejected'}},admin),/已更新/);
    detail=await api({action:'server_persona_detail',id:first.id},admin);
    assert.equal(detail.study.evidence[0].assertions.age.value,'32');
    const published=(await db.query('SELECT value FROM workspace_documents WHERE name=$1',[`business:insightReports:${first.id}`])).rows[0].value;
    assert.equal(published.reportType,'persona');assert.equal(published.evidenceIds[0],`${first.id}:${r.id}`);
    assert.equal((await db.query('SELECT value FROM workspace_documents WHERE name=$1',['business:researchEvidence:qa'])).rows[0].value.assertions,undefined);
    await assert.rejects(()=>api({action:'server_persona_finalize',id:first.id,revision:2,findings:[],complete:true},admin),/逐项/);
    await api({action:'server_persona_finalize',id:first.id,revision:2,findings:[{section:'needs',label:'synthetic finding',interpretation:'synthetic only',verdict:'partial',evidenceIds:[r.id]}],complete:false},admin);
    const cited=(await db.query('SELECT value FROM workspace_documents WHERE name=$1',[`business:insightReports:${first.id}`])).rows[0].value;
    assert.equal(cited.personaResearch.findings[0].evidenceIds[0],cited.evidenceIds[0]);
    const queued=await api({...input,requestId:'2bfb6000-a617-434a-b042-886375fa0ba3'},admin);
    await api({action:'server_persona_cancel',id:queued.id},admin);
    assert.equal((await api({action:'server_persona_detail',id:queued.id},admin)).study.status,'cancelled');
  } finally {hook.deregister();delete globalThis.__personaTestDb;await db.close();}
});
