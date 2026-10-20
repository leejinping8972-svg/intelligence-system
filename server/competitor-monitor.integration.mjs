// Run only with an explicitly supplied isolated in-memory PostgreSQL runtime.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { writeFile, unlink } from 'node:fs/promises';
if (
  process.env.COMPETITOR_MONITOR_QA !== 'disposable-only' ||
  (!process.env.PGLITE_RUNTIME &&
    process.env.QA_MYSQL_HOST !== 'competitor-monitor-qa-db')
)
  throw new Error(
    'Set COMPETITOR_MONITOR_QA=disposable-only and PGLITE_RUNTIME to an isolated test runtime',
  );
const mysql = process.env.QA_MYSQL_HOST;
process.env.DATABASE_CONFIG_FILE = mysql
  ? '/tmp/competitor-monitor-qa-config.json'
  : `${process.cwd()}/.artifacts/nonexistent-monitor-qa-config.json`;
process.env.DATABASE_URL = 'postgres://disposable-only@127.0.0.1:1/not-used';
if (mysql) {
  if (mysql !== 'competitor-monitor-qa-db')
    throw new Error('Unexpected QA host');
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY =
    randomBytes(32).toString('base64');
  const { encryptConfig } = await import('./secrets.mjs');
  await writeFile(
    process.env.DATABASE_CONFIG_FILE,
    JSON.stringify(
      encryptConfig({
        host: mysql,
        port: 3306,
        database: 'competitor_monitor_qa',
        user: 'qa',
        password: 'disposable-qa-only',
        tlsMode: 'plain',
      }),
    ),
    { mode: 0o600 },
  );
}
const memory = mysql
  ? null
  : new (await import(pathToFileURL(process.env.PGLITE_RUNTIME).href)).PGlite();
const { pool } = await import('./database.mjs');
globalThis.fetch = async () => {
  throw new Error('External network is disabled in monitor QA');
};
const originalPoolQuery = pool.query.bind(pool);
const query = async (sql, params = []) => {
  if (!memory) return originalPoolQuery(sql, params);
  if (/pg_try_advisory_lock/.test(sql)) return { rows: [{ locked: true }] };
  if (/pg_advisory_unlock/.test(sql)) return { rows: [] };
  if (!params.length) return (await memory.exec(sql)).at(-1) || { rows: [] };
  return memory.query(sql, params);
};
if (memory) {
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
}
const { migrate, saveKeyword } = await import('./store.mjs');
const {
  competitorAction,
  competitorTick,
  createMonitorStore,
  persistObservation,
} = await import('./competitor-monitor-store.mjs');
const { dayKey } = await import('./competitor-monitor-domain.mjs');
const c = await pool.connect();
const db = createMonitorStore(c),
  admin = { role: 'admin' };
await migrate();
const site = {
  id: 'qa-site',
  market: 'US',
  domain: 'example.com',
  platform: 'Shopify',
  brand: 'QA',
};
await db.write('business:sites:qa-site', site);
await db.write('business:ads:qa-ad', {
  id: 'qa-ad',
  market: 'US',
  pageId: '123',
  brand: 'QA',
});
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_save' },
      { role: 'researcher' },
    ),
  /管理员/,
);
const saved = await competitorAction(
  {
    action: 'server_competitor_save',
    kind: 'site',
    siteId: site.id,
    pageId: '123',
    maxRequests: 4,
    hour: 0,
    enabled: true,
  },
  admin,
);
const target = saved.target;
assert.ok(target.id);
let calls = 0;
const providers = {
  scanSite: async (_site, request) => {
    await request('site-page', async () => {
      calls++;
      return { html: 'synthetic' };
    });
    return {
      items: [
        { id: 'old-product', title: 'Collagen', market: 'US', siteId: site.id },
      ],
      complete: true,
      errors: [],
    };
  },
  scanAdvertiser: async (_target, request) => {
    await request('ad-page', async () => {
      calls++;
      return {};
    });
    return { items: [], complete: true, errors: [] };
  },
};
await competitorTick(c, providers);
assert.equal(calls, 2);
assert.equal((await db.list('competitor:event:')).length, 0);
assert.ok(await db.read(`competitor:baseline:${target.id}:products`));
await competitorTick(c, providers);
assert.equal(calls, 2, 'same day must not call providers again');
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_check', id: target.id },
      admin,
    ),
  /本日/,
);

const oldKeyword = {
  id: randomUUID(),
  market: 'US',
  term: 'creatine gummies',
  favorite: true,
  reviewStatus: 'selected',
  productIds: ['keep'],
  siteIds: [],
  source: '人工导入',
};
await saveKeyword(oldKeyword);
const item = {
  id: 'new-product',
  title: 'Creatine gummies',
  market: 'US',
  siteId: site.id,
  favorite: false,
};
const event = {
  id: 'event1',
  targetId: target.id,
  market: 'US',
  itemId: item.id,
  terms: ['creatine gummies'],
};
await persistObservation(
  c,
  target,
  'products',
  item,
  event,
  new Date().toISOString(),
);
let keyword = (
  await query('SELECT data FROM research_keywords WHERE natural_key=$1', [
    'US|creatine gummies',
  ])
).rows[0].data;
assert.equal(keyword.id, oldKeyword.id);
assert.equal(keyword.reviewStatus, 'selected');
assert.equal(keyword.favorite, true);
assert.deepEqual(keyword.productIds, ['keep', 'new-product']);
assert.ok(keyword.source.includes('竞品上新'));
await saveKeyword({ ...oldKeyword, source: '再次研究' });
keyword = (
  await query('SELECT data FROM research_keywords WHERE natural_key=$1', [
    'US|creatine gummies',
  ])
).rows[0].data;
assert.ok(
  keyword.source.includes('竞品上新'),
  'regular research must retain launch tag',
);

const originalQuery = c.query;
c.query = async (text, params) => {
  if (text.startsWith('UPDATE research_keywords'))
    throw new Error('synthetic write failure');
  return originalQuery(text, params);
};
await assert.rejects(
  () =>
    persistObservation(
      c,
      target,
      'ads',
      { id: 'rollback-ad' },
      { ...event, id: 'rollback-event' },
      'rollback-time',
    ),
  /synthetic/,
);
c.query = originalQuery;
assert.equal(await db.read('business:ads:rollback-ad'), undefined);
assert.equal(
  await db.read('competitor:event:rollback-time:rollback-event'),
  undefined,
);

await db.write(`competitor:run:${target.id}`, {
  day: dayKey(),
  status: 'running',
  errors: [],
});
await competitorTick(c, providers);
assert.equal(
  (await db.read(`competitor:run:${target.id}`)).status,
  'interrupted',
);
assert.equal(calls, 2);
await competitorAction(
  { action: 'server_competitor_pause', id: target.id },
  admin,
);
assert.equal((await db.read(`competitor:target:${target.id}`)).enabled, false);
await competitorAction(
  {
    action: 'server_competitor_hot_save',
    market: 'US',
    seeds: ['collagen'],
    hour: 0,
    enabled: true,
  },
  admin,
);
await competitorTick(c, {
  fetchHotwordSeed: async (_config, seed, request) =>
    request(seed, async () => ({
      rows: [
        {
          term: 'collagen',
          volume: 700,
          seed,
          metrics: {
            market: 'US',
            source: 'Semrush',
            collectedAt: new Date().toISOString(),
            monthlySearchVolume: 700,
          },
        },
      ],
      apiUnits: 20,
    })),
});
const ranking = await db.read('competitor:ranking:US');
assert.equal(ranking.rows[0].term, 'collagen');
const hotKeyword = (
  await query('SELECT data FROM research_keywords WHERE natural_key=$1', [
    'US|collagen',
  ])
).rows[0].data;
assert.ok(hotKeyword.source.includes('Semrush热词'));
assert.equal(hotKeyword.metrics.monthlySearchVolume, 700);
assert.equal((await db.list('competitor:history:US:')).length, 1);
// Batch configuration uses the real store and transaction, with external fetch disabled.
await assert.rejects(() => competitorAction({ action: 'server_competitor_batch_save', siteIds: [site.id] }, { role: 'researcher' }), /管理员/);
const oldTarget = await db.read(`competitor:target:${target.id}`);
for (const market of ['MX', 'VN']) await db.write(`business:sites:batch-${market}`, { id: `batch-${market}`, market, domain: `${market}.example.test` });
const batchInput = { action: 'server_competitor_batch_save', siteIds: [site.id, 'batch-MX', 'batch-VN', 'batch-VN'], enabled: false, hour: 9, maxRequests: 3 };
const batch = await competitorAction(batchInput, admin);
assert.equal(batch.created, 2);
assert.equal(batch.preserved, 1);
assert.deepEqual(await db.read(`competitor:target:${target.id}`), oldTarget);
assert.equal((await competitorAction(batchInput, admin)).created, 0);
const beforeInvalid = await db.list('competitor:target:');
await assert.rejects(() => competitorAction({ ...batchInput, siteIds: ['invalid-site'] }, admin), /不存在/);
assert.deepEqual(await db.list('competitor:target:'), beforeInvalid);
const { saveSiteBatch } = await import('./competitor-batch.mjs');
for (const id of ['rollback-1', 'rollback-2']) await db.write(`business:sites:${id}`, { id, market: 'US', domain: `${id}.example.test` });
let batchWrites = 0;
await assert.rejects(() => saveSiteBatch({ siteIds: ['rollback-1', 'rollback-2'] }, { ...db, write: async (name, value) => { if (++batchWrites === 2) throw new Error('synthetic batch failure'); await db.write(name, value); } }, c), /synthetic batch failure/);
assert.deepEqual(await db.list('competitor:target:'), beforeInvalid);
console.log('Batch configuration integration passed: mixed markets, admin permission, idempotency, preserving paused targets and real transaction rollback.');
console.log(
  'Isolated monitor integration passed: baseline, daily dedup, permissions, launch links/tags, rollback, crash protection and hotword import; zero external calls.',
);
c.release();
await memory?.close();
await pool.end();
if (mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
