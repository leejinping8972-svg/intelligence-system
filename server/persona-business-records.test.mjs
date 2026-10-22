import assert from 'node:assert/strict';
import test from 'node:test';
import { materializePersonaBusiness } from './persona-business-records.mjs';
import { naturalKey } from './domain.mjs';
import { personaEvidence, personaQueries, validatePersonaPlan } from './persona-research-domain.mjs';
import { executePersonaStudy } from './persona-research-engine.mjs';

const plan = validatePersonaPlan({ market:'VN',groups:[{label:'A',minAge:28,maxAge:35,lifeStage:'照护',familyRole:'待核实'}],startDate:'2026-07-01',endDate:'2026-10-22',researchQuestion:'测试',sources:['content'],budget:{requests:1,credits:1,perQuery:1,commentVideos:0} });
const q=personaQueries(plan)[0], at='2026-08-01T00:00:00Z';
function memory() {
  const documents=new Map(),keywords=new Map();
  return {documents,keywords,list:async prefix=>[...documents].filter(([n])=>n.startsWith(prefix)).map(([,v])=>v),update:async(n,fn)=>{const value=fn(documents.get(n));documents.set(n,value);return value;},keyword:async r=>{const key=naturalKey(r);if(!keywords.has(key))keywords.set(key,r);return keywords.get(key);}};
}
const item=(raw)=>personaEvidence(raw,q,plan);
const video=item({id:'12345678901234',sourceId:'12345678901234',kind:'content',text:'mệt ngủ',url:'https://www.tiktok.com/@synthetic/video/12345678901234',platform:'TikTok',collectedAt:at,postedAt:at,language:'vi'});
const comment=item({id:'synthetic-comment',kind:'comment',text:'tôi mệt',sourceUrl:video.sourceUrl,platform:'TikTok',collectedAt:at,postedAt:at,likes:3});
const product=item({id:'synthetic-product',kind:'product',title:'synthetic product',sourceUrl:'https://synthetic.example/products/one',platform:'品牌官网',market:'VN',price:120000,currency:'VND',collectedAt:at});
const study=(evidence)=>({id:'11111111-1111-4111-8111-111111111111',plan,queries:[q],journal:[],evidence,createdAt:at,status:'partial'});

test('business materialization saves linked keywords, full comments, products and source sites idempotently',async()=>{
  const io=memory(),s=study([video,comment,product]);
  const first=await materializePersonaBusiness(s,io);
  assert.equal(io.keywords.size,1);assert.equal(first.contentIds.length,1);assert.equal(first.commentIds.length,1);assert.equal(first.productIds.length,1);assert.equal(first.siteIds.length,1);
  const saved=io.documents.get(`content:item:${first.contentIds[0]}`);
  assert.equal(saved.comments.items[0].text,comment.text);assert.equal(Date.parse(saved.publishedAt),Date.parse(at));assert.equal(saved.authorCountry,'unknown');assert.equal(saved.favorite,false);
  assert.equal(saved.keywordIds[0],first.keywords[0].id);
  const again=await materializePersonaBusiness(s,io);
  assert.deepEqual(again.created,{});assert.equal(io.documents.get(`content:item:${saved.id}`).comments.items.length,1);
  assert.equal(io.documents.get(`content:job:${s.id}`).requests,0);
});

test('existing records keep manual fields, metrics, dates and IDs while adding research associations',async()=>{
  const io=memory(),old={id:'existing-video',url:video.sourceUrl,title:'manual title',summary:'richer summary',publishedAt:at,collectedAt:at,favorite:true,ai:{summaryZh:'manual'},keywordIds:['old'],matchedQueries:['old']};
  io.documents.set('content:item:existing-video',old);
  io.documents.set('business:products:synthetic-product',{id:'synthetic-product',market:'VN',sourceUrl:product.sourceUrl,title:'manual product',price:999,favorite:true,sourceMetrics:{reportedSales:12},siteId:'old-site'});
  const result=await materializePersonaBusiness(study([video,product]),io);
  const saved=io.documents.get('content:item:existing-video');
  assert.equal(saved.title,old.title);assert.equal(saved.favorite,true);assert.deepEqual(saved.ai,old.ai);assert.equal(saved.collectedAt,at);assert.equal(result.contentIds[0],old.id);
  const p=io.documents.get('business:products:synthetic-product');assert.equal(p.price,999);assert.deepEqual(p.sourceMetrics,{reportedSales:12});assert.equal(p.siteId,'old-site');
});

test('all acquired rows remain available for business lists even when report sampling keeps one',async()=>{
  const s=study([]);s.queries=[q];let calls=0;
  await executePersonaStudy(s,{existing:async()=>[],cancelled:async()=>false,save:async()=>{},publish:async()=>{},collect:async()=>{calls++;return {credits:1,records:[video.sourceRecord,{...video.sourceRecord,id:'22345678901234',sourceId:'22345678901234',url:'https://www.tiktok.com/@synthetic/video/22345678901234'}]};}});
  assert.equal(calls,1);assert.equal(s.evidence.length,1);assert.equal(s.acquiredEvidence.length,2);
  const result=await materializePersonaBusiness(s,memory());assert.equal(result.contentIds.length,2);
});

test('reused comments with a missing original ID reuse an exact source and full-text match',async()=>{
  const io=memory(),r=personaEvidence({...comment.sourceRecord,id:'legacy-missing-id'},{...q,reused:true},plan);
  io.documents.set('business:researchEvidence:original',{id:'original',kind:'comment',text:r.text,sourceUrl:r.sourceUrl,market:'VN',collectedAt:at});
  const result=await materializePersonaBusiness(study([r]),io);
  assert.deepEqual(result.commentIds,['original']);assert.equal(result.created.comment,undefined);
});
