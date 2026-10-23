import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

test('resource workflow isolated SQL: receipts, journal recovery, storage, reads, archive and resume', { skip: !process.env.HCI_TEST_PGLITE_MODULE }, async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve('.artifacts/resource-qa-no-config.json');
  process.env.DATABASE_URL = 'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const { PGlite } = await import(pathToFileURL(resolve(process.env.HCI_TEST_PGLITE_MODULE)).href);
  const db = new PGlite();
  const previousFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('External requests disabled in resource integration'); };
  const hook = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.endsWith('/store.mjs') && specifier === './platform-products-provider.mjs') return {
      shortCircuit: true,
      url: `data:text/javascript,${encodeURIComponent('export const platformProductRequest = request => globalThis.__resourceIntegrationProvider(request);')}`,
    };
    return next(specifier, context);
  } });
  const { pool, sql, lock, unlock, putDocument } = await import('./database.mjs');
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (!params.length && statement.trim().split(';').filter((s) => s.trim()).length > 1) return (await db.exec(statement)).at(-1);
    return db.query(statement, params.map((value) => value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) ? JSON.stringify(value) : value));
  };
  pool.connect = async () => ({ query: (...args) => pool.query(...args), release() {} });
  try {
    const { migrate, collect } = await import('./store.mjs');
    const { submitPlatformProducts, runPlatformProducts, upsertProduct, readProduct } = await import('./platform-products-jobs.mjs');
    const { queryResourceCategories, resumeResourceJob, productResourceAction } = await import('./product-resource-service.mjs');
    const { productResourceRequest } = await import('./product-resource-provider.mjs');
    const { createWorkspaceReads } = await import('./workspace-reads.mjs');
    await migrate();
    await putDocument('provider_configs', 'provider:sorftime:mcp:v1', { synthetic: true });
    await putDocument('provider_configs', 'provider:scrapecreators:v1', { synthetic: true });
    const calls = [];
    const at = '2026-10-22T06:00:00.000Z';
    globalThis.__resourceIntegrationProvider = async (request) => {
      calls.push(request);
      if (request.op === 'categories') return {
        categories: [{ id: request.parentId ? 'digestive' : 'health', path: [...(request.parentPath || []), request.parentId ? 'Digestive' : 'Health'], rawPath: { native: true } }],
        collectedAt: at, providerCalls: 1, usage: { requests: 4, providerCalls: 1, sorftimeCalls: 1 },
      };
      if (request.provider === 'sorftime') return {
        products: [{ id: 'resource-qa-amazon', title: 'Synthetic probiotic', brand: 'Synthetic', market: 'US', sourceProvider: 'Sorftime', sourcePlatform: 'Amazon', sourceProductId: 'B000000001', sourceMetrics: { monthlySales: 123 }, collectionFields: ['price'], price: 20.5, currency: 'USD', resourceRaw: { priceRaw: '20.50' } }],
        collectedAt: at, providerCalls: 1, usage: { requests: 4, providerCalls: 1, sorftimeCalls: 1 },
      };
      return productResourceRequest(request, {
        cache: false, key: 'synthetic-only',
        scrapeRequest: async () => request.platform === 'instagram' ? {
          credits_charged: 1,
          reels: [{ id: 'qa-reel', url: 'https://www.instagram.com/reel/qa/', caption: 'Synthetic probiotic content', owner: { username: 'synthetic' } }],
        } : {
          credits_charged: 1,
          products: [{ product_id: `qa-${request.term}`, title: `Synthetic probiotic ${request.term}`, sale_region: request.market, sold_info: { sold_count: 100 }, product_price_info: { sale_price_decimal: '250.000', currency_name: 'VND' }, seller_info: { shop_id: 'qa-shop' }, seo_url: { canonical_url: 'https://www.tiktok.com/shop/pdp/123' } }],
        },
      });
    };
    const input = (patch = {}) => ({ requestId: randomUUID(), resourceDiscovery: true, routeId: 'tiktok-scrapecreators', market: 'VN', mode: 'keyword', terms: 'probiotic', salesWindowDays: 90, maxProducts: 100, ranking: 'sample', ...patch });
    const getJob = async (id) => (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
    const drain = async (id) => {
      for (let step = 0; step < 30; step++) {
        const job = await getJob(id);
        if (!['queued', 'running'].includes(job.status)) return job;
        await runPlatformProducts(job, { now: () => Date.now() + step * 5000 });
      }
      throw new Error('Synthetic job did not finish in bounded steps');
    };

    await t.test('category receipt is durable, idempotent and restores trusted ancestry', async () => {
      const q = { requestId: randomUUID(), routeId: 'amazon-sorftime', market: 'US', query: 'health', budget: { requests: 5, sorftimeCalls: 1 } };
      const result = await queryResourceCategories(q);
      assert.equal(result.requests, 4);
      assert.deepEqual(await queryResourceCategories(q), result);
      assert.equal(calls.length, 1);
      await assert.rejects(queryResourceCategories({ ...q, query: 'different' }), /提交编号/);
      const child = await queryResourceCategories({ ...q, requestId: randomUUID(), parentId: 'health', parentReceiptId: result.receiptId });
      assert.deepEqual(child.categories[0].path, ['Health', 'Digestive']);
      const categoryInput = input({ routeId: 'amazon-sorftime', market: 'US', mode: 'category', category: result.categories[0] });
      await assert.rejects(submitPlatformProducts({ ...categoryInput, category: { ...categoryInput.category, path: ['Invented'] } }), /拼造/);
      await assert.rejects(submitPlatformProducts({ ...categoryInput, category: { ...categoryInput.category, receiptId: randomUUID() } }), /凭证无效/);
      const job = await submitPlatformProducts(categoryInput);
      assert.deepEqual(job.input.resourcePlan.category.rawPath, { native: true });
      const done = await drain(job.id);
      assert.equal(done.status, 'completed');
      const saved = await readProduct(done.checkpoint.productIds[0]);
      assert.equal(saved.resourceEvidence.category.receiptId, result.receiptId);
      assert.equal(saved.resourceEvidence.metric.originalWindow.kind, 'source_month_unspecified');
    });

    let productId;
    await t.test('real nested normalization saves the product once across a lost checkpoint replay', async () => {
      const job = await submitPlatformProducts(input());
      assert.equal((await submitPlatformProducts({ ...input(), requestId: job.request_id })).id, job.id);
      const before = calls.length;
      await runPlatformProducts(job);
      const completed = await getJob(job.id);
      productId = completed.checkpoint.productIds[0];
      assert.equal(completed.status, 'completed');
      await runPlatformProducts(job);
      assert.equal(calls.length, before + 1, 'journal replays the stored response without a provider call');
      const saved = await readProduct(productId);
      assert.equal(saved.price, 250000);
      assert.equal(saved.resourceEvidence.price.raw, '250.000');
      assert.equal(saved.resourceEvidence.identity.shopId, 'qa-shop');
      assert.equal(saved.resourceEvidence.metric.kind, 'cumulative_units');
      assert.equal(saved.resourceEvidence.requestedWindow.days, 90);
      assert.equal((await pool.query('SELECT status FROM research_requests WHERE job_id=$1', [job.id])).rows[0].status, 'done');
    });

    await t.test('list, detail and full export preserve evidence; archive retries do not overwrite observations', async () => {
      const saved = await readProduct(productId);
      const before = (await pool.query('SELECT name FROM workspace_documents WHERE name LIKE $1', [`resource:observation:products:${productId}:%`])).rows;
      const update = { ...saved, resourceEvidence: { ...saved.resourceEvidence, collectedAt: '2026-10-23T06:00:00.000Z', requestedWindow: { ...saved.resourceEvidence.requestedWindow, days: 180 } } };
      await upsertProduct(update);
      await upsertProduct(update);
      const after = (await pool.query('SELECT name FROM workspace_documents WHERE name LIKE $1', [`resource:observation:products:${productId}:%`])).rows;
      assert.equal(after.length, before.length + 1);
      assert.ok(before.every((row) => after.some((next) => next.name === row.name)));
      const reads = createWorkspaceReads({ pool, sql, lock, unlock, putDocument, isWorkspaceSyncKey: () => true, loadPublic: async () => ({ collector: null, free: null }) });
      for (let i = 0; i < 30; i++) if (!(await reads.refresh())) break;
      assert.equal((await reads.status()).indexing, false);
      const listed = await reads.list({ collection: 'products', market: 'VN', pageSize: 20 });
      assert.equal(listed.total, 1);
      assert.equal(listed.rows[0].resourceEvidence.requestedWindow.days, 180);
      assert.equal(listed.rows[0].resourceHistory, undefined, 'list does not download the full history');
      const detail = await reads.details({ collection: 'products', id: productId });
      assert.ok(detail.record.resourceHistory.length > 1);
      const exported = await reads.exportRecords({ collection: 'products', ids: [productId] });
      assert.equal(exported.rows[0].resourceEvidence.identity.shopId, 'qa-shop');
      assert.equal(exported.rows[0].resourceEvidence.price.raw, '250.000');
      assert.ok(exported.rows[0].resourceHistory.length > 1);
      await putDocument('workspace_documents', 'resource:observation:products:qa_a:one', { only: 'underscore' }, true);
      await putDocument('workspace_documents', 'resource:observation:products:qaxa:one', { only: 'other-product' }, true);
      const observations = await productResourceAction({ action: 'server_product_resource_observations', productId: 'qa_a' });
      assert.deepEqual(observations.observations, [{ only: 'underscore' }]);
    });

    await t.test('Instagram saves content without inventing transactional products', async () => {
      const job = await submitPlatformProducts(input({ routeId: 'instagram-scrapecreators', market: 'US' }));
      const done = await drain(job.id);
      assert.equal(done.checkpoint.productIds.length, 0);
      assert.equal(done.checkpoint.contentIds.length, 1);
      const contents = (await pool.query("SELECT value FROM workspace_documents WHERE name LIKE 'content:item:%'")).rows;
      assert.equal(contents.length, 1);
      assert.equal(contents[0].value.authorCountry, 'unknown');
    });

    await t.test('cancel and resume retain consumed budget and never repeat completed requests', async () => {
      const job = await submitPlatformProducts(input({ terms: 'first probiotic\nsecond probiotic' }));
      const before = calls.length;
      await runPlatformProducts(job);
      await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [job.id]);
      await runPlatformProducts(await getJob(job.id));
      const cancelled = await getJob(job.id);
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(cancelled.checkpoint.index, 1);
      const reserved = cancelled.checkpoint.reserved.requests;
      await resumeResourceJob({ jobId: job.id });
      const done = await drain(job.id);
      assert.equal(done.status, 'completed');
      assert.equal(done.checkpoint.reserved.requests, reserved + 1);
      assert.equal(calls.length, before + 2);
      await assert.rejects(resumeResourceJob({ jobId: job.id }), /不可恢复/);
    });

    await t.test('an unknown started journal is not sent again or made resumable', async () => {
      const job = await submitPlatformProducts(input({ terms: 'unknown probiotic' }));
      await pool.query("INSERT INTO research_requests(job_id,step,paid_allowance,status) VALUES($1,'unknown',1,'started')", [job.id]);
      const before = calls.length;
      await assert.rejects(collect(job, 'unknown', { sources: ['platform_products'], provider: 'tiktok_shop' }), /结果未知/);
      assert.equal(calls.length, before);
      await pool.query("UPDATE research_jobs SET status='cancelled',cancelled=true,checkpoint=$2 WHERE id=$1", [job.id, { unknownCharges: 1, finishedAt: at }]);
      await assert.rejects(resumeResourceJob({ jobId: job.id }), /不可恢复/);
    });
    assert.equal(externalCalls, 0);
  } finally {
    hook.deregister();
    delete globalThis.__resourceIntegrationProvider;
    globalThis.fetch = previousFetch;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await db.close();
    await pool.end();
  }
});
