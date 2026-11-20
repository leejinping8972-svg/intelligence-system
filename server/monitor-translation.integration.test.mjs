/* oxlint-disable vitest/no-import-node-test -- Server regressions use the Node test runner. */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

test('real monitor persistence completes despite invalid model translations and machine outages', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/monitor-translation-no-config.json',
  );
  process.env.DATABASE_URL = 'postgres://synthetic@127.0.0.1:1/not-used';
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString(
    'base64',
  );
  const memory = new PGlite();
  const fetchBefore = globalThis.fetch;
  let machineDown = false;
  let machineCalls = 0;
  let modelCalls = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      'https://transmart.qq.com/api/imt',
      'no research-provider request is permitted',
    );
    machineCalls++;
    if (machineDown) return new Response('', { status: 429 });
    const body = JSON.parse(options.body);
    return Response.json({
      header: { ret_code: 'succ' },
      tgt_lang: 'zh',
      auto_translation: body.source.text_list.map((text) => `机翻${text}`),
    });
  };
  globalThis.__monitorTranslationModel = async (_prompt, sample) => {
    modelCalls++;
    return {
      result: {
        items: sample.items.map((item) => ({ id: item.id, text: item.text })),
      },
      model: 'synthetic',
      usage: { modelCalls: 1, modelTokens: 10 },
    };
  };
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (
        context.parentURL?.endsWith('/collection-translation.mjs') &&
        specifier === './discovery-ai.mjs'
      )
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const configuredJson = (...args) => globalThis.__monitorTranslationModel(...args);')}`,
        };
      return next(specifier, context);
    },
  });
  const { pool } = await import('./database.mjs');
  const oldQuery = pool.query;
  const oldConnect = pool.connect;
  pool.query = async (statement, params = []) => {
    if (/pg_try_advisory_lock/.test(statement))
      return { rows: [{ locked: true }] };
    if (/pg_advisory_unlock/.test(statement)) return { rows: [] };
    if (params.length === 0) {
      const results = await memory.exec(statement);
      return results.at(-1) || { rows: [] };
    }
    return memory.query(
      statement,
      params.map((value) =>
        value && typeof value === 'object' ? JSON.stringify(value) : value,
      ),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  t.after(async () => {
    pool.query = oldQuery;
    pool.connect = oldConnect;
    hook.deregister();
    globalThis.fetch = fetchBefore;
    delete globalThis.__monitorTranslationModel;
    await memory.close();
    await pool.end();
  });
  const { migrate } = await import('./store.mjs');
  const { sealAdsKey } = await import('./ads-provider.mjs');
  const {
    competitorAction,
    competitorTick,
    createMonitorStore,
    persistObservation,
  } = await import('./competitor-monitor-store.mjs');
  const { translationKey } =
    await import('./collection-translation-domain.mjs');
  const { machineTranslationKey } = await import('./machine-translation.mjs');
  await migrate();
  await pool.query('INSERT INTO provider_configs(name,value) VALUES($1,$2)', [
    'provider:analysis:v1',
    sealAdsKey(
      JSON.stringify({
        baseUrl: 'https://example.com/v1',
        model: 'synthetic',
        apiKey: 'synthetic-only',
      }),
    ),
  ]);
  const c = await pool.connect();
  const db = createMonitorStore(c);
  const at = new Date().toISOString();
  const site = {
    id: 'test-site',
    market: 'US',
    domain: 'example.com',
    platform: 'Shopify',
    brand: 'Synthetic',
  };
  await db.write('business:sites:test-site', site);
  const { target } = await competitorAction(
    {
      action: 'server_competitor_save',
      kind: 'site',
      siteId: site.id,
      enabled: true,
      hour: 0,
    },
    { role: 'admin' },
  );
  let sourceCalls = 0;
  const product = {
    id: 'test-product',
    title: 'Magnesium capsules',
    market: 'US',
    siteId: site.id,
    evidenceUrl: 'https://example.com/products/one',
  };
  await competitorTick(
    c,
    {
      scanSite: async (_site, request) => {
        await request('public-products', async () => {
          sourceCalls++;
          return { html: 'synthetic public catalog' };
        });
        return { items: [product], complete: true, errors: [] };
      },
      scanAdvertiser: async () => {
        throw new Error('advertisement provider must not run');
      },
    },
    { name: `competitor:target:${target.id}` },
  );
  const saved = await db.read('business:products:test-product');
  assert.equal(saved.title, product.title);
  assert.equal(saved.evidenceUrl, product.evidenceUrl);
  assert.equal(saved.titleZh, `机翻${product.title}`);
  assert.equal(saved.collectionTranslation.status, 'complete');
  const run = await db.read(`competitor:run:${target.id}`);
  assert.equal(run.status, 'completed');
  assert.ok(await db.read(`competitor:baseline:${target.id}:products`));
  const modelCache = await db.read(translationKey(product.title));
  assert.equal(modelCache.status, 'invalid');
  const machineCache = await db.read(
    machineTranslationKey(translationKey(product.title)),
  );
  assert.equal(machineCache.provider, 'transmart');
  const paidBefore = modelCalls;
  const machineBefore = machineCalls;
  await persistObservation(c, target, 'products', product, null, at);
  assert.equal(modelCalls, paidBefore);
  assert.equal(machineCalls, machineBefore);
  assert.equal(sourceCalls, 1);
  const keywordProduct = {
    ...product,
    id: 'keyword-product',
    title: 'Creatine gummies',
  };
  await persistObservation(
    c,
    target,
    'products',
    keywordProduct,
    {
      id: 'keyword-event',
      targetId: target.id,
      kind: 'products',
      itemId: keywordProduct.id,
      market: 'US',
      terms: ['creatine gummies'],
    },
    at,
  );
  const keywordRows = await pool.query(
    'SELECT data FROM research_keywords WHERE natural_key=$1',
    ['US|creatine gummies'],
  );
  const keyword = keywordRows.rows[0].data;
  assert.equal(keyword.termZh, '机翻creatine gummies');
  assert.ok(keyword.productIds.includes(keywordProduct.id));
  machineDown = true;
  const unavailable = {
    ...product,
    id: 'unavailable-product',
    title: 'Another product',
  };
  await persistObservation(c, target, 'products', unavailable, null, at);
  const raw = await db.read('business:products:unavailable-product');
  assert.equal(raw.title, unavailable.title);
  assert.equal(raw.titleZh, undefined);
  assert.equal(raw.collectionTranslation.status, 'partial');
  assert.match(raw.collectionTranslation.message, /429/);
  const { digest } = await import('./competitor-monitor-domain.mjs');
  assert.ok(
    await db.read(
      `competitor:seen:${target.id}:products:${digest(unavailable.id)}`,
    ),
  );
  c.release();
});
