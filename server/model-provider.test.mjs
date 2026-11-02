import assert from 'node:assert/strict';
import test from 'node:test';
import { modelRequestBody, modelReportText } from './model-provider.mjs';

test('Bailian Qwen report uses non-thinking JSON output and the configured budget', () => {
  const body = modelRequestBody(
    {
      baseUrl:
        'https://workspace.us-east-1.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.7-plus',
      maxTokens: 4000,
    },
    [{ role: 'user', content: 'JSON' }],
  );
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_tokens, 4000);
  assert.equal(body.model, 'qwen3.7-plus');
});
test('vendor parameters are not sent to other services or thinking-only models', () => {
  for (const [baseUrl, model] of [
    ['https://other.example/v1', 'qwen3.7-plus'],
    ['https://maas.aliyuncs.com.evil.example/v1', 'qwen3.7-plus'],
    [
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
      'qwen3-thinking-preview',
    ],
  ]) {
    const body = modelRequestBody({ baseUrl, model, maxTokens: 2000 }, []);
    assert.equal(body.enable_thinking, undefined);
    assert.equal(body.response_format, undefined);
  }
});
test('truncated reports are rejected before parsing even if the returned JSON is valid', () => {
  assert.throws(
    () =>
      modelReportText({
        choices: [{ finish_reason: 'length', message: { content: '{}' } }],
      }),
    /达到输出token上限/,
  );
  assert.equal(
    modelReportText({
      choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    }),
    '{}',
  );
  assert.throws(() => modelReportText({ choices: [] }), /未返回文本/);
});
