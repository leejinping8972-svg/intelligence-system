// Run only with an explicitly supplied isolated in-memory PostgreSQL runtime.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
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
  if (params.length === 0)
    return (await memory.exec(sql)).at(-1) || { rows: [] };
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
const admin = { role: 'admin' };
const db = createMonitorStore(c);
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
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_batch_save', siteIds: [site.id] },
      { role: 'researcher' },
    ),
  /管理员/,
);
const oldTarget = await db.read(`competitor:target:${target.id}`);
for (const market of ['MX', 'VN'])
  await db.write(`business:sites:batch-${market}`, {
    id: `batch-${market}`,
    market,
    domain: `${market}.example.test`,
  });
const batchInput = {
  action: 'server_competitor_batch_save',
  siteIds: [site.id, 'batch-MX', 'batch-VN', 'batch-VN'],
  enabled: false,
  hour: 9,
  maxRequests: 3,
};
const batch = await competitorAction(batchInput, admin);
assert.equal(batch.created, 2);
assert.equal(batch.preserved, 1);
assert.deepEqual(await db.read(`competitor:target:${target.id}`), oldTarget);
assert.equal((await competitorAction(batchInput, admin)).created, 0);
const beforeInvalid = await db.list('competitor:target:');
await assert.rejects(
  () => competitorAction({ ...batchInput, siteIds: ['invalid-site'] }, admin),
  /不存在/,
);
assert.deepEqual(await db.list('competitor:target:'), beforeInvalid);
const { saveSiteBatch } = await import('./competitor-batch.mjs');
for (const id of ['rollback-1', 'rollback-2'])
  await db.write(`business:sites:${id}`, {
    id,
    market: 'US',
    domain: `${id}.example.test`,
  });
let batchWrites = 0;
await assert.rejects(
  () =>
    saveSiteBatch(
      { siteIds: ['rollback-1', 'rollback-2'] },
      {
        ...db,
        write: async (name, value) => {
          if (++batchWrites === 2) throw new Error('synthetic batch failure');
          await db.write(name, value);
        },
      },
      c,
    ),
  /synthetic batch failure/,
);
assert.deepEqual(await db.list('competitor:target:'), beforeInvalid);
console.log(
  'Batch configuration integration passed: mixed markets, admin permission, idempotency, preserving paused targets and real transaction rollback.',
);
console.log(
  'Isolated monitor integration passed: baseline, daily dedup, permissions, launch links/tags, rollback, crash protection and hotword import; zero external calls.',
);
// Saved Chinese names are human metadata and survive recollection/richer imports.
const namedKeyword = {
  id: 'qa-named-keyword',
  term: 'creatine gummies qa translation',
  market: 'US',
  dataNature: 'collected',
  termZh: '人工校对肌酸软糖',
};
await saveKeyword(namedKeyword);
await saveKeyword({
  ...namedKeyword,
  termZh: undefined,
  series: [1, 2, 3],
  source: '重新采集',
});
let named = (
  await query('SELECT data FROM research_keywords WHERE natural_key=$1', [
    'US|creatine gummies qa translation',
  ])
).rows[0].data;
assert.equal(named.termZh, '人工校对肌酸软糖');
await saveKeyword(
  { ...namedKeyword, termZh: '不应覆盖的导入译名', series: [1, 2, 3, 4] },
  true,
);
named = (
  await query('SELECT data FROM research_keywords WHERE natural_key=$1', [
    'US|creatine gummies qa translation',
  ])
).rows[0].data;
assert.equal(named.termZh, '人工校对肌酸软糖');
assert.equal(named.id, namedKeyword.id);
console.log(
  'Chinese name persistence passed: recollection and duplicate import preserve saved names.',
);
// Advertiser bulk submission shares existing capacity/lock and preserves stored schedules.
const advertiserInput = {
  action: 'server_competitor_advertiser_batch_save',
  adIds: ['qa-ad', 'qa-ad-same', 'qa-ad-vn'],
  enabled: false,
  hour: 11,
  maxRequests: 4,
};
await db.write('business:ads:qa-ad-same', {
  id: 'qa-ad-same',
  pageId: '123',
  market: 'US',
  brand: 'QA',
});
await db.write('business:ads:qa-ad-vn', {
  id: 'qa-ad-vn',
  pageId: '123',
  market: 'VN',
  brand: 'QA VN',
});
await assert.rejects(
  () => competitorAction(advertiserInput, { role: 'researcher' }),
  /管理员/,
);
const advertiserBatch = await competitorAction(advertiserInput, admin);
assert.equal(advertiserBatch.created, 2);
const overview = await competitorAction(
  { action: 'server_competitor_overview' },
  { role: 'researcher' },
);
assert.equal(overview.targets.filter((t) => t.kind === 'advertiser').length, 2);
assert.equal(overview.rankings, undefined);
const advertiserTarget = overview.targets.find(
  (t) => t.kind === 'advertiser' && t.market === 'US',
);
await db.write(`competitor:target:${advertiserTarget.id}`, {
  ...advertiserTarget,
  siteId: site.id,
  requested: true,
});
await competitorAction(
  {
    action: 'server_competitor_update',
    id: advertiserTarget.id,
    enabled: false,
    hour: 15,
    maxRequests: 6,
  },
  admin,
);
const updatedAdvertiser = await db.read(
  `competitor:target:${advertiserTarget.id}`,
);
assert.equal(updatedAdvertiser.siteId, site.id);
assert.equal(updatedAdvertiser.requested, false);
assert.equal(updatedAdvertiser.hour, 15);
assert.equal((await competitorAction(advertiserInput, admin)).created, 0);
assert.deepEqual(
  await db.read(`competitor:target:${advertiserTarget.id}`),
  updatedAdvertiser,
);
await competitorAction(
  {
    action: 'server_competitor_update',
    id: advertiserTarget.id,
    enabled: true,
  },
  admin,
);
const switchedAdvertiser = await db.read(
  `competitor:target:${advertiserTarget.id}`,
);
assert.equal(switchedAdvertiser.hour, 15);
assert.equal(switchedAdvertiser.maxRequests, 6);
assert.equal(switchedAdvertiser.enabled, true);
await assert.rejects(
  () =>
    competitorAction(
      {
        action: 'server_competitor_update',
        id: advertiserTarget.id,
        enabled: true,
        hour: 30,
      },
      admin,
    ),
  /0～23/,
);
assert.deepEqual(
  await db.read(`competitor:target:${advertiserTarget.id}`),
  switchedAdvertiser,
);
const { saveAdvertiserBatch } = await import('./advertiser-monitor-batch.mjs');
for (const id of ['ad-r1', 'ad-r2'])
  await db.write(`business:ads:${id}`, {
    id,
    pageId: id === 'ad-r1' ? '345' : '678',
    market: 'US',
  });
const beforeAdvertiserFailure = await db.list('competitor:target:');
let adWrites = 0;
await assert.rejects(
  () =>
    saveAdvertiserBatch(
      { adIds: ['ad-r1', 'ad-r2'] },
      {
        ...db,
        write: async (name, value) => {
          if (++adWrites === 2)
            throw new Error('synthetic advertiser transaction failure');
          await db.write(name, value);
        },
      },
      c,
    ),
  /synthetic advertiser/,
);
assert.deepEqual(await db.list('competitor:target:'), beforeAdvertiserFailure);
console.log(
  'Advertiser integration passed: exact identity, market separation, researcher read/admin write, overview, schedule update, preservation and rollback.',
);
await (await import('./semrush-usage.integration.mjs')).verifySemrushUsage(c);
// Public recovery is same-day, budget preserving, and can never replay paid channels.
for (const row of [
  ...(await db.list('competitor:target:')),
  ...(await db.list('competitor:hot-config:')),
])
  await db.write(row.name, {
    ...row.value,
    enabled: false,
    requested: false,
    publicRetryRequested: false,
  });
const recoverySite = {
  id: 'recovery-site',
  domain: 'recovery.example.test',
  market: 'US',
};
await db.write(`business:sites:${recoverySite.id}`, recoverySite);
const recoveryTarget = (
  await competitorAction(
    {
      action: 'server_competitor_save',
      kind: 'site',
      siteId: recoverySite.id,
      pageId: '555',
      enabled: false,
      hour: 0,
      maxRequests: 10,
    },
    admin,
  )
).target;
const recoveryRunName = `competitor:run:${recoveryTarget.id}`;
const recoveryProgressName = `competitor:crawl:${recoveryTarget.id}:products`;
const recoveryLast = {
  id: recoveryTarget.id,
  day: dayKey(),
  status: 'failed',
  requests: 2,
  added: 0,
  errors: ['官网返回 HTTP 429'],
  finishedAt: new Date(Date.now() - 7200000).toISOString(),
  channels: [
    { kind: 'products', status: 'failed' },
    { kind: 'ads', status: 'completed' },
  ],
};
await db.write(recoveryRunName, recoveryLast);
await db.write(recoveryProgressName, {
  queue: ['https://recovery.example.test/sitemap.xml'],
  visited: [],
  nextRunAt: Date.now() - 1000,
});
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_retry_site', id: recoveryTarget.id },
      { role: 'researcher' },
    ),
  /管理员/,
);
await competitorAction(
  { action: 'server_competitor_retry_site', id: recoveryTarget.id },
  admin,
);
let paidCalls = 0;
let publicCalls = 0;
await competitorTick(c, {
  scanSite: async (_site, request, limit) => {
    assert.equal(limit, 8);
    await request('public-xml', async () => {
      publicCalls++;
      return { html: '<urlset/>' };
    });
    return { items: [], complete: true, errors: [] };
  },
  scanAdvertiser: async () => {
    paidCalls++;
    throw new Error('paid channel must never replay');
  },
  fetchHotwordSeed: async () => {
    paidCalls++;
    throw new Error('paid channel must never replay');
  },
});
assert.equal(publicCalls, 1);
assert.equal(paidCalls, 0);
const recovered = await db.read(recoveryRunName);
assert.equal(recovered.requests, 3);
assert.equal(recovered.publicRecoveryAttempts, 1);
assert.equal(
  recovered.channels.find((channel) => channel.kind === 'ads').status,
  'completed',
);
assert.equal(
  (await db.read(`competitor:target:${recoveryTarget.id}`)).enabled,
  false,
);
assert.equal(
  (await db.read(`competitor:target:${recoveryTarget.id}`))
    .publicRetryRequested,
  false,
);
const coolingUntil = Date.now() + 3600000;
await db.write(recoveryRunName, { ...recoveryLast, nextRunAt: coolingUntil });
await db.write(recoveryProgressName, {
  queue: ['https://recovery.example.test/sitemap.xml'],
  visited: [],
  nextRunAt: coolingUntil,
});
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_retry_site', id: recoveryTarget.id },
      admin,
    ),
  /冷却/,
);
const coolingOverview = await competitorAction(
  { action: 'server_competitor_overview' },
  admin,
);
assert.equal(
  coolingOverview.runs.find((run) => run.id === recoveryTarget.id)
    .publicRecovery.ready,
  false,
);
await db.write(recoveryRunName, { ...recoveryLast, requests: 10 });
await assert.rejects(
  () =>
    competitorAction(
      { action: 'server_competitor_retry_site', id: recoveryTarget.id },
      admin,
    ),
  /预算/,
);
// Enabled targets recover automatically and write a shared host cooldown on 429.
await db.write(`competitor:target:${recoveryTarget.id}`, {
  ...recoveryTarget,
  enabled: true,
});
await db.write(recoveryRunName, recoveryLast);
await db.write(recoveryProgressName, {
  queue: ['https://recovery.example.test/sitemap.xml'],
  visited: [],
  nextRunAt: Date.now() - 1000,
});
await competitorTick(c, {
  scanSite: async (_site, request, limit) => {
    assert.equal(limit, 8);
    await request('public-auto', async () => {
      publicCalls++;
      return {};
    });
    return {
      items: [],
      complete: false,
      errors: ['HTTP 429'],
      retryAt: coolingUntil,
      progress: {
        queue: ['https://recovery.example.test/sitemap.xml'],
        nextRunAt: coolingUntil,
      },
    };
  },
  scanAdvertiser: async () => {
    paidCalls++;
    throw new Error('paid replay');
  },
});
const autoRecovered = await db.read(recoveryRunName);
assert.equal(autoRecovered.requests, 3);
assert.equal(autoRecovered.status, 'retry_wait');
assert.equal(
  (await db.list('competitor:host:')).at(-1).value.nextRunAt,
  coolingUntil,
);
await competitorTick(c, {
  scanSite: async () => {
    throw new Error('cooldown must prevent scan');
  },
});
assert.deepEqual(await db.read(recoveryRunName), autoRecovered);
assert.equal(publicCalls, 2);
assert.equal(paidCalls, 0);
console.log(
  'Public recovery integration passed: same-day automatic/manual recovery, cumulative budget, shared host cooldown, admin scope, one-shot paused targets, zero advertisement/Semrush calls.',
);
await (
  await import('./consumer-reports.integration.mjs')
).consumerReportsIntegration();
const { verifyKeywordTrends } =
  await import('./keyword-trends.integration.mjs');
await verifyKeywordTrends(c);
await (
  await import('./task-queue-clarity.integration.mjs')
).verifyQueueClarity(c);
await (
  await import('./westmonth-market.integration.mjs')
).verifyWestmonthMarket(c);
c.release();
await memory?.close();
await pool.end();
if (mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
