/* eslint-disable vitest/no-import-node-test -- This suite runs with node --test. */
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';

const fixture = { stored: null, calls: [], response: null, error: null };
globalThis.__conceptSeedFixture = fixture;
const modules = {
  './database.mjs': `export const pool={query:async()=>({rows:globalThis.__conceptSeedFixture.stored?[{value:globalThis.__conceptSeedFixture.stored}]:[]})}; export const putDocument=async()=>{throw Error('Unexpected write');};`,
  './auth.mjs': `export const requireAdmin=()=>{throw Error('Unexpected configuration change');};`,
  './ads-provider.mjs': `export const openAdsKey=value=>JSON.stringify(value); export const sealAdsKey=()=>{throw Error('Unexpected configuration change');};`,
  './model-provider.mjs': `export const modelEndpoint=()=>{}; export const modelReportText=value=>value; export const postModel=async(config,messages,timeoutMs)=>{const f=globalThis.__conceptSeedFixture; f.calls.push({config,messages,timeoutMs}); if(f.error) throw f.error; return f.response;};`,
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/concept-seed-provider.mjs') && modules[specifier])
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(modules[specifier])}` };
    return next(specifier, context);
  },
});
const { conceptSeedAction } = await import('./concept-seed-provider.mjs');
hooks.deregister();
const suggest = input => conceptSeedAction({ action: 'server_concept_seed_suggest', ...input });

beforeEach(() => {
  fixture.stored = { baseUrl: 'https://synthetic.example/v1', model: 'synthetic-fast', apiKey: 'synthetic-key', maxTokens: 600 };
  fixture.calls = [];
  fixture.response = '{"keywords":["protein","creatine"]}';
  fixture.error = null;
});

test('unconfigured model returns actionable status without a paid call', async () => {
  fixture.stored = null;
  const result = await suggest({ taskName: 'GLP-1 companion' });
  assert.equal(result.configured, false);
  assert.match(result.message, /AI 配置/);
  assert.deepEqual(result.keywords, []);
  assert.equal(fixture.calls.length, 0);
});

test('task name supplies the concept when direction description is omitted', async () => {
  const result = await suggest({ taskName: ' GLP-1 companion ' });
  assert.deepEqual(result.keywords, ['protein', 'creatine']);
  const input = JSON.parse(fixture.calls[0].messages[1].content);
  assert.deepEqual(input, { taskName: 'GLP-1 companion', directionDescription: 'GLP-1 companion' });
  assert.equal(fixture.calls[0].timeoutMs, 5000);
});

test('description constraints are supplied together with the task name', async () => {
  await suggest({ taskName: 'GLP-1 companion', description: '只关注胶囊' });
  assert.deepEqual(JSON.parse(fixture.calls[0].messages[1].content), { taskName: 'GLP-1 companion', directionDescription: '只关注胶囊' });
});

test('legacy description-only requests remain supported', async () => {
  const result = await suggest({ description: 'GLP-1 companion' });
  assert.equal(result.keywords.length, 2);
});

test('empty model output is reported as a generation failure', async () => {
  fixture.response = '{"keywords":["",null,123]}';
  await assert.rejects(suggest({ taskName: 'GLP-1 companion' }), /未返回有效种子关键词/);
});

test('timeouts are propagated without retry or exposing credentials', async () => {
  fixture.error = new Error('模型接口超时');
  await assert.rejects(suggest({ taskName: 'GLP-1 companion' }), /模型接口超时/);
  assert.equal(fixture.calls.length, 1);
  fixture.error = null;
  assert.equal(JSON.stringify(await suggest({ taskName: 'GLP-1 companion' })).includes('synthetic-key'), false);
});

test('missing concept context does not call the model', async () => {
  const result = await suggest({ taskName: '  ', description: '' });
  assert.match(result.message, /任务名称/);
  assert.equal(fixture.calls.length, 0);
});
