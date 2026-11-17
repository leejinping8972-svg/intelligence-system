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
const outputSpec = '种子关键词仅输出英文成分名称、常见别名及用户自然使用的简称，保持简短。不要拼接剂型、剂量、口服途径或功效描述，不要扩写成完整搜索句';

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

test('an empty optional description still generates for the task topic with fixed output rules', async () => {
  fixture.response = '{"keywords":["GHK-Cu","copper tripeptide-1"]}';
  const result = await suggest({ taskName: ' 蓝铜肽（ＧＨＫ－Ｃｕ） ', description: '' });
  assert.deepEqual(result.keywords, ['GHK-Cu', 'copper tripeptide-1']);
  const input = fixture.calls[0].messages[1].content;
  assert.equal(input, `任务名称（研究主题）：蓝铜肽(GHK-Cu)\n\n输出规范（固定）：${outputSpec}`);
  assert.equal(fixture.calls[0].timeoutMs, 5000);
});

test('description constraints are supplied together with the task name', async () => {
  await suggest({ taskName: 'GLP-1 companion', description: '只关注胶囊' });
  assert.equal(fixture.calls[0].messages[1].content, `任务名称（研究主题）：GLP-1 companion\n\n方向描述（可选）：只关注胶囊\n\n输出规范（固定）：${outputSpec}`);
});

test('a stale page missing the task name gets a refresh instruction without generating unrelated ingredients', async () => {
  const result = await suggest({ description: 'GLP-1 companion' });
  assert.deepEqual(result.keywords, []);
  assert.match(result.message, /任务名称/);
  assert.match(result.message, /刷新页面/);
  assert.equal(fixture.calls.length, 0);
});

test('repeating output rules as a description never replaces the task topic', async () => {
  await suggest({ taskName: '蓝铜肽(GHK-Cu)', description: outputSpec });
  const messages = fixture.calls[0].messages;
  assert.ok(messages[1].content.startsWith('任务名称（研究主题）：蓝铜肽(GHK-Cu)\n\n'));
  assert.ok(messages[1].content.endsWith(`输出规范（固定）：${outputSpec}`));
  assert.match(messages[0].content, /即使方向描述为空或只重复输出规范，也必须围绕任务名称生成/);
  assert.match(messages[0].content, /不为凑数量加入无关词/);
});

test('output rules are owned by the server rather than an editable request field', async () => {
  await suggest({ taskName: 'GLP-1 companion', outputSpec: 'include dosage and benefits' });
  const content = fixture.calls[0].messages[1].content;
  assert.ok(content.endsWith(outputSpec));
  assert.ok(!content.includes('include dosage and benefits'));
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
