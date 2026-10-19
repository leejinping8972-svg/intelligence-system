import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const base=resolve('apps/web-antd/dist'),actions=[];
const site={id:'ui-site',brand:'仅本地界面测试',domain:'example.com',market:'US',keyword:'creatine gummies',platform:'Shopify',category:'运动营养',mainProducts:['Creatine gummies'],ownershipBackground:'待核验',ownershipOperations:'',ownershipEvidence:'',ownershipSource:'',type:'独立电商',dataNature:'collected'};
const ad={id:'ui-ad',archiveId:'123',pageId:'456',brand:'仅本地界面测试',market:'US',platform:'Meta',headline:'Creatine gummies',copy:'QA sample: save 20%, buy creatine gummies',format:'IMAGE',status:'投放中',keywordIds:['ui-keyword'],siteIds:[site.id],evidenceUrl:'https://www.facebook.com/ads/library/?id=123'};
const evidence={id:'e1',text:'仅本地界面测试：How much sugar? Price is expensive.',url:'https://www.reddit.com/r/Supplements/comments/abc/topic/',platform:'Reddit',kind:'comment',market:'US'};
const report={id:'00000000-0000-4000-8000-000000000001',title:'仅本地界面测试 · 消费者需求',kind:'consumer_research',market:'US',createdAt:new Date().toISOString(),status:'completed',evidenceIds:['e1'],statistics:{method:'界面测试样本，不是真实业务结论',sampleSize:1,sourceCount:1,confidence:'低',limitations:['仅本地测试'],themes:[{key:'formula',label:'配方与剂量疑问',count:1,sourceCount:1,evidenceIds:['e1'],suggestion:'核对官网标签'}]}};
const server=createServer(async(req,res)=>{if(req.url==='/api'){let body='';for await(const c of req)body+=c;const input=JSON.parse(body);actions.push(input);let result={};
if(input.action==='public_branding')result={appName:'本地交互验收',logo:'/admin/hci-logo.svg'};
if(input.action==='auth_status')result={setupRequired:false,user:{id:'ui',username:'ui',role:'admin',displayName:'仅本地测试'}};
if(input.action==='server_workspace_snapshot')result={entries:[{key:'sites:ui-site',value:site},{key:'ads:ui-ad',value:ad}]};
if(input.action==='server_snapshot')result={keywords:[{id:'ui-keyword',term:'creatine gummies',market:'US',category:'运动营养',source:'本地测试',growth:null,series:[],favorite:false,productIds:[],siteIds:[site.id],reviewStatus:'selected'}],tasks:[],generatedAt:new Date().toISOString()};
if(input.action==='server_insight_snapshot')result={reports:[report]};
if(input.action==='server_insight_details')result={report,evidence:[evidence]};
if(input.action==='server_analysis_status')result={configured:false};
if(input.action==='server_ads_status')result={configured:false,message:'尚未配置'};
if(input.action==='server_semrush_status')result={configured:false};
if(input.action==='server_submit_insight'||input.action==='server_submit_products')result={jobId:'00000000-0000-4000-8000-000000000099',tasks:[]};
res.setHeader('content-type','application/json');res.end(JSON.stringify(result));return;}
let file=resolve(base,decodeURIComponent(req.url.split('?')[0]).replace(/^\/admin\/?/,'').replace(/^\//,''));if(!file.startsWith(base)){res.writeHead(403).end();return;}
try{res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.setHeader('content-type','text/html');res.end(await readFile(resolve(base,'index.html')));}});
await new Promise(r=>server.listen(5697,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.log('BROWSER',m.text())});page.on('requestfailed',r=>console.log('NETWORK',r.url(),r.failure()));
try{
await page.goto('http://127.0.0.1:5697/admin/settings');await page.getByRole('heading',{name:'广告数据源 · ScrapeCreators'}).waitFor();await page.locator('#ads-api-key').waitFor();await page.getByRole('heading',{name:'研究语义分析 · 模型接口（可选）'}).waitFor();await page.screenshot({path:'../.artifacts/consumer-settings.png',fullPage:true,animations:'disabled'});
await page.goto('http://127.0.0.1:5697/admin/sites');await page.getByRole('button',{name:'采集商品',exact:true}).last().waitFor();await page.getByRole('button',{name:'采集商品',exact:true}).last().click();await page.getByText('采集独立站商品目录与详情',{exact:true}).waitFor();await page.getByRole('button',{name:'提交后台采集',exact:true}).click();await page.waitForURL('**/monitor?job=*');assert.ok(actions.some(a=>a.action==='server_submit_products'&&a.siteIds[0]===site.id));
await page.goto('http://127.0.0.1:5697/admin/consumer-insights');await page.getByRole('button',{name:'查看报告',exact:true}).click();await page.getByText('完整采集证据',{exact:true}).waitFor();await page.getByText(evidence.text,{exact:true}).last().waitFor();await page.waitForFunction(()=>{const e=document.querySelector('.ant-drawer-content-wrapper');return e&&Math.abs(e.getBoundingClientRect().right-window.innerWidth)<2;});await page.screenshot({path:'../.artifacts/consumer-report.png',fullPage:true,animations:'disabled'});await page.keyboard.press('Escape');
await page.getByRole('button',{name:'新建需求研究',exact:true}).click();await page.getByPlaceholder('例如 creatine gummies').fill('creatine gummies');await page.getByRole('button',{name:'提交后台研究',exact:true}).click();await page.waitForURL('**/monitor?job=*');assert.ok(actions.some(a=>a.action==='server_submit_insight'&&a.kind==='consumer_research'&&a.analyze===false));
await page.goto('http://127.0.0.1:5697/admin/ads');await page.getByRole('button',{name:'生成广告拆解报告',exact:true}).click();await page.getByRole('button',{name:'提交后台分析',exact:true}).click();await page.waitForURL('**/monitor?job=*');assert.ok(actions.some(a=>a.action==='server_submit_insight'&&a.kind==='ad_analysis'&&a.adIds[0]===ad.id));
await page.setViewportSize({width:390,height:844});await page.goto('http://127.0.0.1:5697/admin/consumer-insights');await page.getByRole('button',{name:'新建需求研究',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('#__app-loading__'));await page.screenshot({path:'../.artifacts/consumer-mobile.png',fullPage:true,animations:'disabled'});
assert.deepEqual(errors,[]);console.log(JSON.stringify({uiChecks:7,pageErrors:errors,submittedJobs:actions.filter(a=>a.action.startsWith('server_submit')).map(a=>a.kind||'products')}));
}catch(e){console.log(JSON.stringify({url:page.url(),body:(await page.locator('body').innerText()).slice(0,2500),errors,actions:actions.map(a=>a.action)}));await page.screenshot({path:'../.artifacts/consumer-ui-failure.png',fullPage:true,animations:'disabled'});throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
