import assert from 'node:assert/strict';
import test from 'node:test';
import { mergePersonaEvidence, personaEvidence, personaQueries, personaReport, reviewPersonaEvidence, validatePersonaFindings, validatePersonaPlan } from './persona-research-domain.mjs';
import { executePersonaStudy } from './persona-research-engine.mjs';
const plan = (patch = {}) => validatePersonaPlan({ market:'VN', title:'synthetic', groups:[{label:'A',minAge:28,maxAge:35,lifeStage:'independent stage',familyRole:'independent role',localContext:'mẹ con nhỏ'},{label:'B',minAge:36,maxAge:45,lifeStage:'independent stage',familyRole:'independent role',localContext:'mẹ con đi học'}], startDate:'2026-07-22',endDate:'2026-10-22',researchQuestion:'test research',sources:['content'],budget:{requests:3,credits:3,perQuery:5,commentVideos:1},...patch });
const raw = {id:'x',kind:'comment',text:'Tôi 32 tuổi, mua cho con.',platform:'TikTok',url:'https://www.tiktok.com/@synthetic/video/12345678901234',collectedAt:'2026-10-22T00:00:00Z'};
const evidence = () => personaEvidence(raw,personaQueries(plan())[0],plan());
test('validates independent profile, date and finite budget',()=>{
 assert.throws(()=>plan({groups:[{label:'a',minAge:35,maxAge:28}]}));
 assert.throws(()=>plan({startDate:'2026-02-30'}));
 assert.throws(()=>plan({budget:{perQuery:0}}));
 assert.throws(()=>plan({sources:['unconfigured']}));
 assert.equal(plan().groups[0].lifeStage,'independent stage');
});
test('local queries cover all roles for both groups in balanced order',()=>{
 const q=personaQueries(plan());assert.equal(q.length,10);
 assert.deepEqual(q.slice(0,2).map(r=>r.groupId),['g1','g2']);
 for(const g of ['g1','g2'])assert.deepEqual(q.filter(r=>r.groupId===g).map(r=>r.role),['self','child','partner','elder','household']);
 assert.ok(q.every(r=>r.query!== 'mẹ'&&r.identityQuery.includes('tuổi')));
});
test('profile stages and research questions compile into the selected local language',()=>{
 const p=plan({market:'US',researchQuestion:'验证睡眠和赠品',groups:[{label:'大童照护者',minAge:36,maxAge:45,lifeStage:'学龄阶段',familyRole:'母亲'}]});
 const q=personaQueries(p);assert.ok(q[0].query.includes('school age children'));assert.ok(q[0].query.includes('sleep free gift'));assert.ok(!q[0].query.includes('mẹ'));
});
test('local context uses the stated family role rather than inferring motherhood from age',()=>{
 const p=plan({groups:[{label:'父亲',minAge:28,maxAge:35,lifeStage:'幼儿照护',familyRole:'父亲'}]});
 assert.equal(p.groups[0].localContext,'bố chăm con nhỏ');
 const neutral=plan({groups:[{label:'参与者',minAge:28,maxAge:35,lifeStage:'未知，待招募核实',familyRole:'未知，待核实'}]});
 assert.ok(!neutral.groups[0].localContext.startsWith('mẹ'));
});
test('profile membership leaves actual identity unknown',()=>{
 const e=evidence();assert.equal(e.assertions.age.value,'unknown');assert.equal(e.assertions.familyRole.value,'unknown');assert.equal(e.timeScope,'unknown');
});
test('duplicates preserve all strata and original acquisition times',()=>{
 const a=evidence(),b=personaEvidence(raw,personaQueries(plan())[1],plan());
 const merged=mergePersonaEvidence([a],[b]);assert.equal(merged.length,1);assert.equal(merged[0].memberships.length,2);assert.equal(merged[0].collectedAt,raw.collectedAt);
});
test('self reports require exact source quotes and valid class',()=>{
 assert.throws(()=>reviewPersonaEvidence(evidence(),{status:'accepted',assertions:{age:{value:32,quote:'32 tuổi'}}},'qa'));
 assert.throws(()=>reviewPersonaEvidence(evidence(),{status:'accepted',evidenceClass:'explicit_self_report',assertions:{age:{value:32,quote:'not in source'}}},'qa'));
 const r=reviewPersonaEvidence(evidence(),{status:'accepted',evidenceClass:'purchase_usage_report',assertions:{age:{value:32,quote:'32 tuổi'},purchaseUsage:{value:'购买给孩子',quote:'mua cho con'}}},'qa');
 assert.equal(r.assertions.age.value,'32');assert.equal(r.assertions.familyRole.value,'unknown');
});
test('brand positioning cannot acquire a consumer identity',()=>{
 assert.throws(()=>reviewPersonaEvidence(evidence(),{status:'accepted',evidenceClass:'brand_positioning',assertions:{age:{value:32,quote:'32 tuổi'}}},'qa'));
});
test('findings reject unreviewed citations and retain unverified hypotheses',()=>{
 assert.throws(()=>validatePersonaFindings([{section:'needs',label:'x',interpretation:'x',verdict:'supported',evidenceIds:[evidence().id]}],[evidence()]));
 assert.equal(validatePersonaFindings([{section:'hypotheses',label:'gift',interpretation:'unknown',verdict:'unverified',evidenceIds:[]}],[])[0].verdict,'unverified');
});
test('report denominators include accepted priced products only',()=>{
 const p=plan(),q=personaQueries(p)[0];
 const r=[100000,300000,null].map((price,i)=>reviewPersonaEvidence(personaEvidence({...raw,id:String(i),text:`product${i}`,kind:'product',price,currency:'VND'},q,p),{status:'accepted',evidenceClass:'brand_positioning'},'qa'));
 const out=personaReport({id:'qa',plan:p,queries:personaQueries(p),journal:[],findings:[],createdAt:'now',status:'partial'},r).personaResearch;
 assert.equal(out.consumption.priced,2);assert.equal(out.consumption.products,3);assert.equal(out.sampling.ageAndRoleSelfReports,0);assert.equal(out.consumption.priceBands.reduce((n,b)=>n+b.count,0),2);
 assert.equal(out.missingSections.length,8);
});
test('historical timestamps remain historical after reuse',()=>assert.equal(personaEvidence({...raw,postedAt:'2023-10-01'},null,plan()).timeScope,'historical_context'));
const study = p => ({id:'qa',plan:p,queries:personaQueries(p),evidence:[],journal:[],findings:[],status:'queued',createdAt:'now'});
function io(extra={}) {return {existing:async()=>[],cancelled:async()=>false,save:async()=>{},publish:async r=>r,collect:async()=>({records:[raw],credits:1}),...extra};}
test('collection completes every query beyond legacy request and credit caps',async()=>{
 const s=study(plan());let calls=0;await executePersonaStudy(s,io({collect:async()=>{calls++;return {records:[raw],credits:1};}}));assert.equal(calls,10);assert.equal(s.journal.length,10);
});
test('zero request reuse never calls provider',async()=>{
 const s=study(plan({budget:{requests:0,credits:0,perQuery:10,commentVideos:0}}));await executePersonaStudy(s,io({existing:async()=>[{...raw,text:'mệt ngủ'}],collect:async()=>{throw new Error('must not call');}}));assert.equal(s.journal.length,0);assert.equal(s.evidence.length,1);
});
test('reserved journal survives restart without charge replay',async()=>{
 const s=study(plan());s.journal=[{key:'g1-self:content',status:'reserved',stratumId:'g1-self'}];let calls=0;await executePersonaStudy(s,io({collect:async()=>{calls++;}}));assert.equal(calls,0);assert.equal(s.status,'partial');
});
test('unknown charge stops all remaining paid requests and retains evidence',async()=>{
 const s=study(plan());let calls=0;await executePersonaStudy(s,io({collect:async()=>{calls++;return {records:[raw],credits:null};}}));assert.equal(calls,1);assert.equal(s.journal[0].status,'unknown');assert.equal(s.evidence.length,1);
});
test('cancellation stops provider calls',async()=>{
 const s=study(plan());let calls=0;await executePersonaStudy(s,io({cancelled:async()=>true,collect:async()=>{calls++;}}));assert.equal(calls,0);assert.equal(s.status,'cancelled');
});
test('provider failure is persisted as uncertain and never retried',async()=>{
 const s=study(plan());let calls=0;const impl=io({collect:async()=>{calls++;throw new Error('timeout');}});await executePersonaStudy(s,impl);await executePersonaStudy(s,impl);assert.equal(calls,1);assert.equal(s.journal[0].status,'unknown');
});
