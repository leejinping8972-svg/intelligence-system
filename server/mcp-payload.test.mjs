import assert from 'node:assert/strict';
import test from 'node:test';

import { payload, summarizeMcpResult } from './platform-product-data.mjs';

test('payload unwraps fenced, nested and text envelopes and keeps mcpPreview on failure', () => {
  assert.deepEqual(
    payload({
      content: [
        {
          type: 'text',
          text: '```json\n{"data":[{"asin":"B0EXAMPLE1"}]}\n```',
        },
      ],
    }),
    { data: [{ asin: 'B0EXAMPLE1' }] },
  );
  assert.deepEqual(
    payload({
      content: [
        {
          type: 'text',
          text: JSON.stringify(JSON.stringify({ Items: [1] })),
        },
      ],
    }),
    { Items: [1] },
  );
  assert.deepEqual(payload({ structuredContent: '{"products":[{"id":"1"}]}' }), {
    products: [{ id: '1' }],
  });
  assert.equal(summarizeMcpResult(null).kind, 'empty');
  try {
    payload({ content: [{ type: 'text', text: 'not-json' }] });
    assert.fail('expected throw');
  } catch (error) {
    assert.match(error.message, /格式无法识别/);
    assert.equal(error.mcpPreview?.kind, 'mcp');
    assert.equal(error.mcpPreview?.contentLen, 1);
  }
});
