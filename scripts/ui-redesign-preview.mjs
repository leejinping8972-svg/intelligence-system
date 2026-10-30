// Local UI acceptance fixture. Synthetic records only; never calls providers or production.
import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createKeywordViewsAction } from '../server/keyword-views.mjs';
import { SOURCE_CATALOG } from '../server/source-usage-domain.mjs';
import { buildRadarFindings, radarStatistics, RADAR_RULES_VERSION, groupAdvertisers } from '../server/model.js';
import { keywordTrendList } from '../server/keyword-trend-list.mjs';
import { productSortKeys, productSortValue, compareProductValues } from '../server/product-list-sort.mjs';
import { projectRecord } from '../server/workspace-reads.mjs';
const now = '2026-10-29T08:00:00Z';
const { PGlite } = createRequire(new URL('../server/package.json', import.meta.url))('@electric-sql/pglite');
const dataDir = fileURLToPath(new URL('../output/ui-redesign-2026-10-30/local-only/keyword-views-db', import.meta.url));
await mkdir(dataDir, { recursive: true });
const db = new PGlite(dataDir);
await db.exec('CREATE TABLE IF NOT EXISTS workspace_documents(name varchar(180) PRIMARY KEY,value jsonb NOT NULL,revision integer DEFAULT 1)');
const keywordViewsAction = createKeywordViewsAction({ pool: { query: async (query, params = []) => {
  const result = await db.query(query, params.map(value => value && typeof value === 'object' ? JSON.stringify(value) : value));
  return { ...result, rowCount: result.affectedRows ?? result.rows.length };
} } });
const products = Array.from({length: 12}, (_, i) => ({ id: 'qa-p' + i, title: ['Women Probiotic 30 Capsules', 'Magnesium Glycinate 90 Tablets', 'Collagen Peptides Powder'][i % 3], titleZh: ['女性益生菌30粒', '甘氨酸镁90片', '胶原蛋白粉'][i % 3], brand: 'QA Nutrition', market: ['US', 'VN', 'MX'][i % 3], category: '营养保健', form: '胶囊', size: '30粒', price: 19.9 + i, currency: ['USD', 'VND', 'MXN'][i % 3], ingredient: 'Lactobacillus 10 billion CFU', dose: '每日1粒', claim: 'Digestive support', benefits: ['消化支持'], benefitEvidence: '标签陈述，合成测试数据', ingredientInsights: [{ name: '益生菌', amount: '100亿CFU', role: '配方成分' }], siteId: i % 2 ? '' : 'qa-s1', sourceProvider: i % 2 ? 'Sorftime' : 'ScrapeCreators', sourcePlatform: i % 2 ? 'Amazon' : 'TikTok Shop', sourceProductId: 'QA-' + i, lastCollectedAt: now, firstSeenAt: now, evidenceUrl: 'https://example.test/product', dataNature: 'imported', reviewed: false, favorite: false, collectionFields: ['title','price','ingredient'], sourceMetrics: { soldRaw: (100 + i * 25) + '+', collectedAt: now }, color: '#39705c' }));
const keywords = Array.from({ length: 6 }, (_, i) => ({ id: 'qa-k' + i, term: ['women probiotics','magnesium glycinate','collagen peptides'][i % 3], termZh: ['女性益生菌','甘氨酸镁','胶原蛋白肽'][i % 3], market: ['US','VN','MX'][i % 3], category: '营养保健', source: 'Google Trends', reviewStatus: i % 2 ? 'selected' : 'pending', siteIds: ['qa-s1'], productIds: ['qa-p' + i], series: [], trendPoints: Array.from({length:110}, (_, n) => ({ date: new Date(Date.parse(now) - (110 - n) * 7 * 86400000).toISOString().slice(0,10), value: 35 + (n % 40) })), trendResolution: 'week', trendCollectedAt: now, trendHistoryCollectedAt: now, trendHistoryResolution: 'week', favorite: false, dataNature: 'imported', updatedAt: now, tasks: [] }));
const sites = [{ id: 'qa-s1', brand: 'QA Nutrition', domain: 'nutrition.example.test', market: 'US', category: '营养保健', platform: 'Shopify', sources: ['Brave Search', '官网'], dataNature: 'imported', productIds: ['qa-p0'], score: 60, favorite: false, lastCollectedAt: now, traffic: 2000, trafficHistory: [], tags: [], mainProducts: ['益生菌', '镁补充剂'], type: '品牌官网', keyword: 'women probiotics', ownershipSource: 'https://example.test/about', ownershipOperations: '未知', ownershipEvidence: '合成验收样本', ownershipBackground: '未知', benefits: [] }];
const ads = [{ id:'qa-a1',brand:'QA Nutrition',headline:'Daily digestive support',copy:'Synthetic preview content',market:'US',platform:'Meta',source:'ScrapeCreators',status:'投放中',dataNature:'imported',siteIds:['qa-s1'],keywordIds:['qa-k0'],productIds:['qa-p0'],firstSeenAt:now,lastCollectedAt:now,imageUrls:[],videoUrls:[],benefits:[] }];
const reports = [{ id: 'qa-report', title: '女性益生菌 · 消费者需求研究', market: 'US', kind: 'consumer_research', reportType: 'consumer', createdAt: now, status: 'completed', keywordIds: ['qa-k0'], productIds: ['qa-p0'], siteIds: ['qa-s1'], evidenceIds: [], sourceCount: 0, topicSummary: [], reviewStatus: 'pending' }];
const rows = { products, keywords, sites, ads };
ads[0].productId = 'qa-p0';
ads[0].pageId = '123456';
rows.advertisers = groupAdvertisers(ads, sites);
const saved = new Set(); const calls = [];
const status = () => ({ configured: saved.has('semrush'), ready: false, message: '本地验收接口；连接未向外部供应商验证。' });
const usage = () => ({ sources: SOURCE_CATALOG.map(s => ({...s, configured: saved.has(s.id), today:0,cumulative:0,unknown:0,todayUnknown:0,cached:0,undated:0,records:0,quota:null,manualQuota:null,preferManual:false, automatic:false,quotaMessage:'本地合成数据'})),entries:[],daily:[],total:0,page:1,pageSize:25,start:'2026-10-28',end:'2026-10-29',today:'2026-10-29',checkedAt:now,undated:0,unattributed:0,coverage:'UI 验收 · 合成数据' });
function filtered(input) { return (rows[input.collection] || []).filter(r =>
  (!input.market || input.market === 'ALL' || r.market === input.market) &&
  (!input.search || [r.title,r.brand,r.term,r.headline,r.copy,r.domain,r.pageId].filter(Boolean).join(' ').toLowerCase().includes(input.search.toLowerCase())) &&
  (!input.productPlatform || input.productPlatform === 'ALL' || r.sourcePlatform === input.productPlatform) &&
  (!input.platform || input.platform === 'ALL' || r.platform === input.platform) &&
  (!input.source || input.source === 'ALL' || r.source === input.source) &&
  (!input.status || input.status === 'ALL' || r.status === input.status) &&
  (!input.provider || input.provider === 'ALL' || r.sourceProvider === input.provider) &&
  (!input.siteLinked || input.siteLinked === 'ALL' || Boolean(r.siteId) === (input.siteLinked === 'linked')) &&
  (!input.linkedSite || r.siteIds?.includes(input.linkedSite)) &&
  (!input.linkedProduct || r.productId === input.linkedProduct || r.productIds?.includes(input.linkedProduct)) &&
  (!input.review || input.review === 'ALL' || r.reviewStatus === input.review)); }
async function action(input) {
  calls.push({action:input.action, fields:Object.keys(input), ...(input.apiKey ? { secretReceived:true } : {})});
  if (input.action?.startsWith('server_keyword_views_')) return keywordViewsAction(input, { id: 'local-qa' });
  switch(input.action) {
    case 'auth_status': return { user:{id:'local-qa',username:'local-qa',displayName:'本地验收',role:'admin',enabled:true},ssoEnabled:false,setupRequired:false };
    case 'public_branding': return {branding:{appName:'知衡情报',environmentLabel:'合成数据 · 本地',logo:'/hci-logo.svg'}};
    case 'auth_touch': return {ok:true};
    case 'server_workspace_bootstrap': return {entries:[{key:'branding:main',value:{appName:'知衡情报',workspaceName:'本地验收',businessName:'大健康跨境市场情报',environmentLabel:'合成数据 · 本地',logo:'/hci-logo.svg'}}],revisions:{published:'qa-1'},active:0,generatedAt:now,indexing:false};
    case 'server_workspace_delta': return {business:{entries:[...sites.map(value=>({key:'sites:'+value.id,value})),...products.map(value=>({key:'products:'+value.id,value})),...ads.map(value=>({key:'ads:'+value.id,value}))]},keywords,tasks:[],revisions:{published:'qa-1'},generatedAt:now};
    case 'server_workspace_sync': return {ok:true};
    case 'server_workspace_list': { const data=filtered(input); if(input.collection==='products' && productSortKeys.includes(input.sort)) data.sort((a,b)=>compareProductValues(productSortValue(a,input.sort),productSortValue(b,input.sort),input.order)||a.id.localeCompare(b.id));const page=input.page||1,size=input.pageSize||20;return {rows:data.slice((page-1)*size,page*size).map(r=>({...projectRecord(input.collection,r).data,...(input.collection==='keywords'?keywordTrendList(r):{})})),total:data.length,page,pageSize:size,revisions:{published:'qa-1'},indexing:false}; }
    case 'server_workspace_facets': return {facets:{category:['营养保健'],source:['Brave Search','官网','ScrapeCreators'],currency:input.market && input.market !== 'ALL' ? [({US:'USD',VN:'VND',MX:'MXN'})[input.market]] : ['USD','VND','MXN'],provider:['Sorftime','ScrapeCreators'],productPlatform:['Amazon','TikTok Shop'],platform:['Meta','Shopify'],benefit:['消化支持'],ingredient:['益生菌'],sites:sites.map(s=>({value:s.id,label:s.brand+' '+s.domain,...s})),keywords:keywords.map(k=>({value:k.id,label:k.term,...k}))}};
    case 'server_workspace_detail': return {record:rows[input.collection]?.find(r=>r.id===input.id)};
    case 'server_workspace_overview': return {snapshot:{counts:{keywords:6,products:12,sites:1,ads:1,reviews:0},keywords:{total:6,priority:0,pending:3,selected:3,completed:0,active:0},productMarkets:{US:4,VN:4,MX:4},topKeywords:keywords,generatedAt:now,revision:'qa-1'},indexing:false};
    case 'server_workspace_statistics': { const findings=buildRadarFindings({products,keywords,sites,ads,settings:{},monitors:[],reviews:[],tasks:[]},Number(input.days)||90,false).filter(r=>(!input.market||input.market==='ALL'||r.market===input.market)&&(!input.type||input.type==='all'||r.type===input.type)); return {rows:findings,total:findings.length,page:1,pageSize:20,snapshot:{generatedAt:now,revision:'qa-1',radarRulesVersion:RADAR_RULES_VERSION,coverage:[],summary:radarStatistics(findings)}}; }
    case 'server_source_usage': return usage();
    case 'server_westmonth_session_status': return {configured:false,enabled:false,status:'unchecked'};
    case 'server_semrush_status': return status();
    case 'server_semrush_usage': return {keyConfigured:saved.has('semrush'),currentKeyAvailable:true,currentKey:{confirmedUnits:0,confirmedRecords:0,unknownRecords:0,cachedRecords:0,breakdown:[]},otherKeys:{confirmedUnits:0,confirmedRecords:0,unknownRecords:0,cachedRecords:0,breakdown:[]},unassigned:{confirmedUnits:0,confirmedRecords:0,unknownRecords:0,cachedRecords:0,breakdown:[]},confirmedUnits:0,confirmedRecords:0,unknownRecords:0,cachedRecords:0,unclassifiedRecords:0,firstRecordedAt:null,checkedAt:now,breakdown:[]};
    case 'server_semrush_config': if (input.apiKey) saved.add('semrush'); return status();
    case 'server_source_credential_save': if (input.apiKey) saved.add(input.sourceId); return {ok:true};
    case 'server_analysis_status': return {configured:false};
    case 'server_competitor_overview': return {targets:[],runs:[],configs:[],rankings:[],events:[]};
    case 'server_keyword_trends_snapshot': return {summaries:[],run:null,plan:{comparisonVersion:2,enabled:false,time:'09:00',sources:[],markets:[],maxRequests:0,maxPages:1}};
    case 'keyword_sources_status': return {sorftime:{configured:false,ready:false,message:'本地验收'}};
    case 'server_site_fetch_status': return {configured:false,browserEnabled:true,paidEnabled:false,message:'本地验收'};
    case 'server_insight_snapshot': {const list=reports.filter(r=>(!input.kind||input.kind==='consumer')&&(!input.productId||r.productIds.includes(input.productId)));return {reports:list,total:list.length,topicOptions:[],keywordIds:['qa-k0']};}
    case 'server_core_rates': return null;
    default: return {error:'本地验收未提供此接口；不会执行真实调用',action:input.action};
  }
}
http.createServer(async(req,res)=>{if(req.url==='/qa-calls'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(calls));}let body='';for await(const chunk of req)body+=chunk;try{const result=await action(JSON.parse(body||'{}'));res.writeHead(result?.error?400:200,{'content-type':'application/json'});res.end(JSON.stringify(result));}catch(error){res.writeHead(error.status||500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}}).listen(5399,'127.0.0.1',()=>console.log('Synthetic UI fixture at 127.0.0.1:5399'));
