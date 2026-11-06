import assert from 'node:assert/strict';
import test from 'node:test';
import {mcpPayload,reportRows} from './semrush-reports.mjs';

test('Semrush v2 no_data is an empty result, so a missing word does not block the following words', () => {
 const payload={code:'no_data',message:'No data found for this request.',retryable:false,hint:'upstream guidance',trace_id:'synthetic'};
 for(const isError of [false,true]) assert.deepEqual(reportRows(mcpPayload({isError,content:[{type:'text',text:JSON.stringify(payload)}]})),[]);
 assert.deepEqual(reportRows({error:{code:'no_data'}}),[]);
 assert.throws(()=>reportRows({code:'quota_exceeded',message:'Balance unavailable',retryable:false}),/quota_exceeded/);
 assert.throws(()=>reportRows({code:'invalid_params',message:'Unknown parameter'}),/invalid_params/);
 assert.throws(()=>reportRows({data:null}),/报告未返回可识别/);
});
