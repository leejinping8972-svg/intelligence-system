/* oxlint-disable vitest/no-import-node-test -- Server regressions use the Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  translationHash,
  translationKey,
} from './collection-translation-domain.mjs';
import { translationBatchKey } from './collection-translation-recovery.mjs';
import { executeMonitor } from './competitor-monitor-engine.mjs';
import {
  machineTranslationKey,
  requestMachineTranslation,
  translateMachineItems,
} from './machine-translation.mjs';
import { translateMonitorRecords } from './monitor-translation.mjs';

function harness() {
  const stored = new Map();
  const cache = new Map();
  const modelCalls = [];
  const machineCalls = [];
  const model = {
    read: async (items) =>
      new Map(items.map((item) => [item.key, stored.get(item.key)])),
    readBatch: async (owner) => stored.get(translationBatchKey(owner)),
    write: async (key, value) => stored.set(key, value),
    claim: async (items, owner) => {
      for (const item of items) {
        assert.equal(
          stored.has(item.key),
          false,
          'never reclaim invalid/unknown model requests',
        );
        stored.set(item.key, { status: 'started', owner });
      }
      return model.read(items);
    },
    request: async (items) => {
      modelCalls.push(items);
      return {
        result: {
          items: items.map((item) => ({ id: item.key, text: item.text })),
        },
      };
    },
  };
  const machine = {
    read: async (key) => cache.get(key),
    write: async (key, value) => cache.set(key, value),
    request: async (items) => {
      machineCalls.push(items);
      return {
        items: items.map((item) => ({
          id: item.key,
          text: `机翻${item.text}`,
        })),
      };
    },
  };
  const translate = (kind, records) =>
    translateMonitorRecords(kind, records, { model, machine });
  return { stored, cache, modelCalls, machineCalls, model, machine, translate };
}

test('invalid model members use machine translation, keeping valid/model/manual values and source evidence', async () => {
  const h = harness();
  h.model.request = async (items) => {
    h.modelCalls.push(items);
    return {
      result: {
        items: items.map((item) => ({
          id: item.key,
          text: item.text === 'Sleep support' ? '支持睡眠' : item.text,
        })),
      },
    };
  };
  const source = {
    title: 'Magnesium',
    claim: 'Sleep support',
    brand: 'Known brand',
    category: 'Supplements',
    categoryZh: '人工品类',
    evidenceUrl: 'https://example.com/product',
    price: 10,
  };
  const [result] = await h.translate('products', [source]);
  assert.equal(result.titleZh, '机翻Magnesium');
  assert.equal(result.claimZh, '支持睡眠');
  assert.equal(result.brandZh, source.brand);
  assert.equal(result.categoryZh, '人工品类');
  assert.equal(result.evidenceUrl, source.evidenceUrl);
  assert.equal(result.price, 10);
  assert.equal(result.collectionTranslation.status, 'complete');
  assert.equal(source.titleZh, undefined);
  assert.deepEqual(
    h.machineCalls[0].map((item) => item.text),
    ['Magnesium'],
  );
  assert.equal(h.stored.get(translationKey('Magnesium')).status, 'invalid');
  assert.equal(
    h.cache.get(machineTranslationKey(translationKey('Magnesium'))).provider,
    'transmart',
  );
  assert.deepEqual(await h.translate('products', [source]), [result]);
  assert.equal(h.modelCalls.length, 1);
  assert.equal(h.machineCalls.length, 1);
});

test('historical invalid batches are recovered without repeating the model', async () => {
  const h = harness();
  const key = translationKey('Old title');
  h.stored.set(key, { status: 'invalid', owner: 'old', error: '未包含中文' });
  const batch = {
    status: 'received',
    items: [{ key, text: 'Old title' }],
    result: { items: [{ id: key, text: 'Old title' }] },
  };
  h.stored.set(translationBatchKey('old'), batch);
  const [result] = await h.translate('products', [{ title: 'Old title' }]);
  assert.equal(result.titleZh, '机翻Old title');
  assert.equal(h.modelCalls.length, 0);
  assert.deepEqual(h.stored.get(translationBatchKey('old')), batch);
});

test('model timeout leaves unknown ownership intact while machine translation uses its own cache', async () => {
  const h = harness();
  let calls = 0;
  h.model.request = async () => {
    calls++;
    throw new Error('synthetic timeout');
  };
  const source = [{ title: 'Unknown title' }];
  const first = await h.translate('products', source);
  const claim = structuredClone(h.stored.get(translationKey('Unknown title')));
  assert.equal(first[0].titleZh, '机翻Unknown title');
  assert.equal(claim.status, 'started');
  assert.deepEqual(await h.translate('products', source), first);
  assert.deepEqual(h.stored.get(translationKey('Unknown title')), claim);
  assert.equal(calls, 1);
  assert.equal(h.machineCalls.length, 1);
});

test('missing model configuration falls back to machine translation and preserves brand spelling', async () => {
  const h = harness();
  h.model.prepareRequest = async () => {
    throw new Error('no model configuration');
  };
  const [result] = await h.translate('products', [
    { title: 'Fresh title', brand: 'Garden of Life' },
  ]);
  assert.equal(result.titleZh, '机翻Fresh title');
  assert.equal(result.brandZh, 'Garden of Life');
  assert.deepEqual(
    h.machineCalls[0].map((item) => item.text),
    ['Fresh title'],
  );
  assert.equal(h.stored.size, 0);
});

test('malformed model JSON can use machine translation without editing its original response', async () => {
  const h = harness();
  h.model.request = async (items, owner) => {
    h.stored.set(translationBatchKey(owner), {
      status: 'received',
      raw: '{broken',
      items,
    });
    throw new SyntaxError('invalid JSON');
  };
  const [result] = await h.translate('products', [
    { title: 'Malformed title' },
  ]);
  assert.equal(result.collectionTranslation.status, 'complete');
  assert.equal(result.titleZh, '机翻Malformed title');
  assert.equal(
    [...h.stored.values()].find((value) => value.raw)?.raw,
    '{broken',
  );
});

test('only the failed chunk of a long field is machine translated', async () => {
  const h = harness();
  const first = 'a'.repeat(1200);
  const last = 'b'.repeat(30);
  h.model.request = async (items) => ({
    result: {
      items: items.map((item) => ({
        id: item.key,
        text: item.text === first ? '模型前半' : item.text,
      })),
    },
  });
  const [result] = await h.translate('products', [{ title: first + last }]);
  assert.equal(result.titleZh, `模型前半机翻${last}`);
  assert.deepEqual(
    h.machineCalls[0].map((item) => item.text),
    [last],
  );
  assert.equal(
    result.collectionTranslation.fields.title,
    translationHash(JSON.stringify(first + last)),
  );
});

test('machine outage preserves records, cools down across different products and later recovers', async () => {
  const h = harness();
  let now = 1000;
  let calls = 0;
  h.machine.now = () => now;
  h.machine.request = async () => {
    calls++;
    throw new Error('machine HTTP 429');
  };
  const [first] = await h.translate('products', [
    { title: 'Unavailable first' },
  ]);
  const [next] = await h.translate('products', [
    { title: 'Unavailable second' },
  ]);
  assert.equal(first.title, 'Unavailable first');
  assert.equal(first.titleZh, undefined);
  assert.equal(first.collectionTranslation.status, 'partial');
  assert.match(next.collectionTranslation.message, /429/);
  assert.equal(
    calls,
    1,
    'one outage must not cause a request for every next product',
  );
  now += 5 * 60_000 + 1;
  h.machine.request = async (items) => {
    calls++;
    return { items: items.map((item) => ({ id: item.key, text: '恢复机翻' })) };
  };
  const [recovered] = await h.translate('products', [
    { title: 'Unavailable first' },
  ]);
  assert.equal(recovered.titleZh, '恢复机翻');
  assert.equal(calls, 2);
});

test('unchanged non-Chinese machine results remain warnings and do not retry on each observation', async () => {
  const h = harness();
  h.machine.request = async (items) => {
    h.machineCalls.push(items);
    return { items: items.map((item) => ({ id: item.key, text: item.text })) };
  };
  const [result] = await h.translate('products', [{ title: 'ProductCodeXYZ' }]);
  assert.equal(result.titleZh, undefined);
  assert.equal(result.collectionTranslation.status, 'partial');
  await h.translate('products', [{ title: 'ProductCodeXYZ' }]);
  assert.equal(h.machineCalls.length, 1);
});

test('simultaneous translations of shared text issue only one machine request', async () => {
  const h = harness();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  h.machine.request = async (items) => {
    h.machineCalls.push(items);
    await gate;
    return { items: items.map((item) => ({ id: item.key, text: '共享中文' })) };
  };
  const items = [
    { key: translationKey('Concurrent title'), text: 'Concurrent title' },
  ];
  const first = translateMachineItems(items, h.machine);
  const second = translateMachineItems(items, h.machine);
  release();
  const results = await Promise.all([first, second]);
  assert.equal(h.machineCalls.length, 1);
  assert.equal(results[1].values.get(items[0].key), '共享中文');
});

test('large fallback collections retain bounded machine batches', async () => {
  const h = harness();
  const source = Array.from({ length: 35 }, (_, index) => ({
    title: `Batch title ${index}`,
  }));
  const records = await h.translate('products', source);
  assert.equal(h.machineCalls.length, 2);
  for (const batch of h.machineCalls) {
    assert.ok(batch.length <= 32);
    assert.ok(batch.reduce((sum, item) => sum + item.text.length, 0) <= 2400);
  }
  assert.ok(
    records.every(
      (record) => record.collectionTranslation.status === 'complete',
    ),
  );
});

test('cancelled translation never starts machine fallback', async () => {
  const h = harness();
  h.model.isCancelled = async () => true;
  await assert.rejects(
    h.translate('products', [{ title: 'Cancelled title' }]),
    /已取消/,
  );
  assert.equal(h.machineCalls.length, 0);
});

test('translation outage does not prevent saving observations or establishing a complete baseline', async () => {
  const h = harness();
  h.machine.request = async () => {
    throw new Error('synthetic machine outage');
  };
  const saved = [];
  const baselines = [];
  const run = await executeMonitor(
    { siteId: 'site', maxPages: 10 },
    {
      day: '2026-11-13',
      at: '2026-11-13T00:00:00Z',
      saveRun: async () => {},
      baseline: async () => null,
      seen: async () => null,
      setBaseline: async (kind) => baselines.push(kind),
      scan: async () => ({
        items: [{ title: 'Still collected' }],
        complete: true,
        errors: [],
      }),
      persist: async (kind, item) =>
        saved.push(...(await h.translate(kind, [item]))),
    },
  );
  assert.equal(run.status, 'completed');
  assert.deepEqual(baselines, ['products']);
  assert.equal(saved[0].title, 'Still collected');
  assert.equal(saved[0].collectionTranslation.status, 'partial');
});

test('machine HTTP adapter sends only texts with auto language detection and maps ordered results', async () => {
  const items = [
    { key: 'a', text: 'Magnesium 120 capsules' },
    { key: 'b', text: 'No sugar' },
  ];
  const result = await requestMachineTranslation(
    items,
    async (url, options) => {
      assert.equal(url, 'https://transmart.qq.com/api/imt');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.authorization, undefined);
      const body = JSON.parse(options.body);
      assert.deepEqual(body.source, {
        lang: 'auto',
        text_list: items.map((item) => item.text),
      });
      assert.equal(body.target.lang, 'zh');
      assert.ok(options.signal instanceof AbortSignal);
      return Response.json({
        header: { ret_code: 'succ' },
        tgt_lang: 'zh',
        auto_translation: ['镁120粒', '无糖'],
      });
    },
  );
  assert.deepEqual(result.items, [
    { id: 'a', text: '镁120粒' },
    { id: 'b', text: '无糖' },
  ]);
});

test('machine HTTP/format/language failures are rejected rather than accepted as translations', async () => {
  for (const response of [
    new Response('', { status: 429 }),
    new Response('<html>captcha</html>'),
    Response.json({
      header: { ret_code: 'succ' },
      tgt_lang: 'en',
      auto_translation: ['original'],
    }),
    Response.json({
      header: { ret_code: 'succ' },
      tgt_lang: 'zh',
      auto_translation: [],
    }),
    Response.json({
      header: { ret_code: 'failed' },
      tgt_lang: 'zh',
      auto_translation: ['中文'],
    }),
  ])
    await assert.rejects(
      requestMachineTranslation(
        [{ key: 'a', text: 'source' }],
        async () => response,
      ),
      /机翻/,
    );
  await assert.rejects(
    requestMachineTranslation([{ key: 'a', text: 'source' }], async () => {
      throw new Error('private transport details');
    }),
    /机翻服务连接失败或超时/,
  );
});
