/* eslint-disable unicorn/no-await-expression-member -- SQL assertions match server convention. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';

// Explicitly gated to a disposable container/database; never read the production config.
if (process.env.PLATFORM_PRODUCTS_QA !== 'disposable-only')
  throw new Error(
    'Use an isolated disposable database and PLATFORM_PRODUCTS_QA=disposable-only',
  );
process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.DATABASE_CONFIG_FILE = '/tmp/platform-products-qa-config.json';
const mysql = process.env.QA_MYSQL_HOST;
if (mysql) {
  if (mysql !== 'platform-products-qa-db')
    throw new Error('Unexpected QA host');
  const { encryptConfig } = await import('./secrets.mjs');
  await writeFile(
    process.env.DATABASE_CONFIG_FILE,
    JSON.stringify(
      encryptConfig({
        host: mysql,
        port: 3306,
        database: 'platform_products_qa',
        user: 'qa',
        password: 'disposable-qa-only',
        tlsMode: 'plain',
      }),
    ),
    { mode: 0o600 },
  );
} else if (
  !/^postgres:\/\/qa:disposable-qa-only@platform-products-qa-db:5432\/platform_products_qa$/.test(
    process.env.DATABASE_URL || '',
  )
) {
  throw new Error('Unexpected QA database URL');
}
const { pool, putDocument, engine } = await import('./database.mjs');
const {
  migrate,
  saveKeyword,
  collect: journalCollect,
} = await import('./store.mjs');
const { migrateCredentials } = await import('./local-provider.mjs');
const { submitPlatformProducts, runPlatformProducts } =
  await import('./platform-products-jobs.mjs');
const { normalizeAmazon, normalizeShopping, protectPlatformClientEdit } =
  await import('./platform-product-data.mjs');
const { jobTasks } = await import('./runner.mjs');
try {
  await migrate();
  assert.equal(
    (await pool.query('SELECT name FROM provider_configs')).rows.length,
    0,
    'QA database must be fresh for each run',
  );
  await migrateCredentials({
    RESEARCH_ACCESS_KEY: 'qa-not-a-live-key',
    SORFTIME_MCP_TOKEN: 'qa-not-live',
  });
  await putDocument('provider_configs', 'provider:semrush:mcp:v1', {
    qa: true,
  });
  await saveKeyword({
    id: 'qa-keyword',
    term: 'creatine gummies',
    market: 'US',
    dataNature: 'collected',
    productIds: [],
  });
  const request = {
    requestId: randomUUID(),
    terms: 'creatine gummies',
    market: 'US',
    providers: ['sorftime', 'semrush'],
    maxRequests: 10,
    perKeyword: 2,
    maxProducts: 5,
    maxDomains: 1,
    semrushUnitLimit: 200,
    enrich: false,
    trend: false,
  };
  const job = await submitPlatformProducts(request);
  assert.equal(
    (await submitPlatformProducts(request)).id,
    job.id,
    'duplicate submission is idempotent',
  );
  await assert.rejects(
    submitPlatformProducts({ ...request, requestId: randomUUID() }),
    /已有平台商品任务/,
  );
  assert.equal(job.input.keywordRecords[0].id, 'qa-keyword');
  const at = new Date().toISOString();
  const amazon = normalizeAmazon(
    { asin: 'B0EXAMPLE1', title: 'Creatine Gummies', price: 25 },
    'US',
    at,
  );
  const shopping = normalizeShopping(
    {
      ad_title: 'Creatine Gummies 60 Count',
      url: 'https://shop.example.com/',
      price: 30,
    },
    'US',
    at,
  );
  const readJob = async (id) =>
    (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id])).rows[0];
  const readProduct = async (id) =>
    (
      await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
        `business:products:${id}`,
      ])
    ).rows[0].value;
  const calls = [];
  const collect = async (_job, step, r) => {
    calls.push(step);
    if (r.op === 'search') return { products: [amazon] };
    if (r.op === 'domains')
      return { domains: ['shop.example.com'], apiUnits: 20 };
    return { products: [shopping], apiUnits: 30 };
  };
  for (let i = 0; i < 10; i++) {
    const current = await readJob(job.id);
    if (['completed', 'partial'].includes(current.status)) break;
    await runPlatformProducts(current, { collect });
  }
  const finished = await readJob(job.id);
  assert.equal(finished.status, 'completed');
  assert.equal(finished.checkpoint.products, 2);
  assert.equal(finished.checkpoint.semrushUnits, 50);
  assert.equal(jobTasks(finished)[0].researchProgress.products, 2);
  const keyword = (
    await pool.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1',
      ['US|creatine gummies'],
    )
  ).rows[0].data;
  assert.deepEqual(
    new Set(keyword.productIds),
    new Set([amazon.id, shopping.id]),
  );
  await saveKeyword({ ...keyword, productIds: [] });
  const rescored = (
    await pool.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1',
      ['US|creatine gummies'],
    )
  ).rows[0].data;
  assert.deepEqual(
    new Set(rescored.productIds),
    new Set(keyword.productIds),
    'keyword rescoring cannot erase product links',
  );
  await saveKeyword({ ...keyword, productIds: [], series: [1, 2] }, true);
  const imported = (
    await pool.query(
      'SELECT data FROM research_keywords WHERE natural_key=$1',
      ['US|creatine gummies'],
    )
  ).rows[0].data;
  assert.deepEqual(
    new Set(imported.productIds),
    new Set(keyword.productIds),
    'richer client import cannot erase product links',
  );
  assert.equal(
    (await readProduct(amazon.id)).queryTerms[0],
    'creatine gummies',
  );
  const edited = {
    ...(await readProduct(amazon.id)),
    favorite: true,
    reviewed: true,
    ingredient: 'Creatine',
    decisionData: {
      series: [
        {
          provider: 'Sorftime',
          platform: 'Amazon',
          market: 'US',
          productId: 'B0EXAMPLE1',
          metric: 'sales_volume',
          period: 'month',
          collectedAt: at,
          points: [{ start: '2026-08-01', end: '2026-08-31', value: 100 }],
        },
      ],
    },
  };
  await putDocument(
    'workspace_documents',
    `business:products:${amazon.id}`,
    edited,
  );
  const refresh = await submitPlatformProducts({
    ...request,
    requestId: randomUUID(),
    providers: ['sorftime'],
  });
  await runPlatformProducts(refresh, { collect });
  const refreshed = await readProduct(amazon.id);
  assert.equal(refreshed.favorite, true);
  assert.equal(refreshed.reviewed, true);
  assert.equal(refreshed.ingredient, 'Creatine');
  assert.equal(refreshed.decisionData.series[0].points.length, 1);
  assert.deepEqual(
    protectPlatformClientEdit(refreshed, { ...amazon, favorite: false })
      .decisionData,
    refreshed.decisionData,
  );
  const cancelled = await submitPlatformProducts({
    ...request,
    requestId: randomUUID(),
    providers: ['sorftime'],
  });
  await pool.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [
    cancelled.id,
  ]);
  const before = calls.length;
  await pool.query(
    "INSERT INTO research_requests(job_id,step,status,response) VALUES($1,$2,'done',$3)",
    [cancelled.id, 'qa:done', { products: [amazon] }],
  );
  assert.equal(
    (await journalCollect(cancelled, 'qa:done', {})).products[0].id,
    amazon.id,
  );
  await pool.query(
    "INSERT INTO research_requests(job_id,step,status) VALUES($1,$2,'started')",
    [cancelled.id, 'qa:uncertain'],
  );
  await assert.rejects(
    journalCollect(cancelled, 'qa:uncertain', {}),
    /上次请求结果未知/,
  );

  await runPlatformProducts(cancelled, { collect });
  assert.equal((await readJob(cancelled.id)).status, 'cancelled');
  assert.equal(calls.length, before);
  // Cross-feature SQL and namespace checks use the same isolated database.
  const { publicContentAction: contentApi, withPublicContentIdle } =
    await import('./public-content-store.mjs');
  const user = { id: 'qa-researcher', role: 'researcher' };
  const contentRequest = {
    action: 'server_content_submit',
    requestId: randomUUID(),
    input: {
      query: 'creatine',
      market: 'US',
      language: 'en',
      sources: ['youtube'],
      limit: 10,
    },
  };
  const content = await contentApi(contentRequest, user);
  assert.equal((await contentApi(contentRequest, user)).job.id, content.job.id);
  await assert.rejects(
    contentApi(
      { ...contentRequest, input: { ...contentRequest.input, query: 'other' } },
      user,
    ),
    /其他搜索/,
  );
  const contentId = `pc-${'a'.repeat(24)}`;
  await putDocument('workspace_documents', `content:item:${contentId}`, {
    id: contentId,
    source: 'youtube',
    title: 'QA creatine',
    videoId: 'abcdefghijk',
    collectedAt: at,
    searchMarket: 'US',
    searchLanguage: 'en',
    favorite: false,
    keywordIds: [],
    productIds: [],
  });
  await contentApi(
    {
      action: 'server_content_save',
      itemId: contentId,
      favorite: true,
      productIds: [amazon.id],
    },
    user,
  );
  const favorites = await contentApi(
    { action: 'server_content_snapshot', favorites: true },
    user,
  );
  assert.deepEqual(favorites.items[0].productIds, [amazon.id]);
  assert.equal(
    (await readProduct(amazon.id)).favorite,
    true,
    'content save cannot overwrite product state',
  );
  await assert.rejects(
    withPublicContentIdle(async () => true),
    /公共内容任务尚未结束/,
  );
  await contentApi(
    { action: 'server_content_cancel', jobId: content.job.id },
    user,
  );
  assert.equal(await withPublicContentIdle(async () => true), true);
  const transcript = await contentApi(
    {
      action: 'server_content_transcript',
      requestId: randomUUID(),
      itemId: contentId,
    },
    user,
  );
  assert.equal(transcript.job.mode, 'transcript');
  await contentApi(
    { action: 'server_content_cancel', jobId: transcript.job.id },
    user,
  );
  console.warn(
    `PASS ${engine}: product queue/links/refresh/journal/cancel and content API/idempotency/favorites/product links/idle locks/transcript queue; zero external calls`,
  );
} finally {
  await pool.end();
  if (mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
}
