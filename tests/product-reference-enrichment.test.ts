import type { Product } from '../apps/web-antd/src/views/intelligence/data';

import { describe, expect, it } from 'vitest';

import { metricText, productMetrics } from '../apps/web-antd/src/views/intelligence/core-list-metrics';
const at = new Date().toISOString();
const p = (patch: Partial<Product> = {}): Product => ({ id:'qa',title:'DHEA Supplement',brand:'QA',market:'US',category:'功能性营养',form:'胶囊',size:'60 ct',price:20,currency:'USD',ingredient:'',dose:'',claim:'',benefits:[],benefitEvidence:'',ingredientInsights:[],siteId:'qa-site',color:'#eee',reviewed:false,favorite:false,evidenceUrl:'https://qa.example/products/dhea',...patch });
const evidence = (reason: string) => ({checkedAt:at,evidenceUrl:'https://qa.example/products/dhea',requests:1,listing:{status:'missing' as const,reason,evidenceUrl:'https://qa.example/products/dhea'},sold:{status:'missing' as const,reason,evidenceUrl:'https://qa.example/products/dhea'}});
describe('official product completion metrics',()=>{
  it('uses precise public sources and source field names for listing and cumulative sales including zero',()=>{
    const metrics=productMetrics(p({decisionData:{listing:{date:'2020-01-01',provider:'官网公开商品数据',platform:'Shopify',market:'US',collectedAt:at,evidenceUrl:'https://qa.example/products/dhea.js',sourceField:'Shopify.published_at'}},sourceMetrics:{soldCount:0,soldPrecision:'exact',soldCollectedAt:at,soldProvider:'官网公开商品数据',soldPlatform:'Shopify',soldEvidenceUrl:'https://qa.example/products/dhea.js',soldSourceField:'Product.soldCount'}}),30);
    const listing=metrics.find(m=>m.key==='listingDate')!;const sold=metrics.find(m=>m.key==='cumulativeSold')!;
    expect(listing.value).toBe('2020-01-01');expect(listing.reason).toContain('Shopify.published_at');
    expect(sold.value).toBe(0);expect(sold.status).toBe('available');expect(sold.source).toBe('官网公开商品数据');expect(sold.platform).toBe('Shopify');expect(sold.evidenceUrl).toContain('.js');expect(sold.reason).toContain('Product.soldCount');
    expect(metrics.find(m=>m.key==='sales')?.value).toBeNull();
  });
  it.each([['not_publicly_provided','not_disclosed','未公开'],['request_failed','failed','失败'],['request_limit','budget_limited','预算截断'],['conflicting_public_values','unverified','待验证']])('reports %s without inventing a zero', (reason,status,label)=>{
    const metrics=productMetrics(p({publicDataEvidence:evidence(reason)}),30);
    for(const key of ['listingDate','cumulativeSold']){const metric=metrics.find(m=>m.key===key)!;expect(metric.value).toBeNull();expect(metric.status).toBe(status);expect(metricText(metric)).toBe(label);expect(metric.reason).not.toContain(reason);}
  });
  it('reports missing official destinations as unsupported with the saved reason',()=>{
    const metrics=productMetrics(p({dataCompletion:{public_detail:{status:'unsupported',message:'缺少可核验的官网商品链接',at}}}),30);
    for(const key of ['listingDate','cumulativeSold']){const value=metrics.find(m=>m.key===key)!;expect(value.status).toBe('unsupported');expect(value.reason).toContain('官网商品链接');}
  });
  it('a later budget failure takes precedence over older missing evidence while existing values remain available',()=>{
    const product=p({publicDataEvidence:evidence('not_publicly_provided'),dataCompletion:{public_detail:{status:'failed',message:'达到手动设置的请求预算，本步骤未执行',at}},sourceMetrics:{soldCount:12,soldCollectedAt:at}});
    const metrics=productMetrics(product,30);expect(metrics.find(m=>m.key==='listingDate')?.status).toBe('budget_limited');expect(metrics.find(m=>m.key==='cumulativeSold')?.value).toBe(12);
  });
});
