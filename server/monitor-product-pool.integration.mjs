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
const { migrate } = await import('./store.mjs');
const { createMonitorStore, persistObservation } =
  await import('./competitor-monitor-store.mjs');
const c = await pool.connect();
const db = createMonitorStore(c);
await migrate();

// Verify admission is committed by the real monitor transaction even without a launch event.
try {
  const at = new Date().toISOString();
  const runStartedAt = new Date(Date.now() - 300000).toISOString();
  const listingDate = new Date(Date.now() + 8 * 3600000 - 2 * 86400000)
    .toISOString()
    .slice(0, 10);
  const target = { id: 'pool-proof', market: 'US', siteId: 'pool-proof-site' };
  const item = {
    id: 'pool-proof-product',
    market: 'US',
    title: 'Synthetic collagen',
    brand: 'Synthetic',
    category: '运动营养',
    benefits: [],
    ingredientInsights: [],
    sourcePlatform: '独立站',
    firstSeenAt: at,
    decisionData: {
      listing: {
        date: listingDate,
        provider: 'Synthetic public source',
        platform: 'Shopify',
        market: 'US',
        collectedAt: at,
        evidenceUrl: 'https://shop.test/products/proof',
      },
    },
    sourceMetrics: {
      soldCount: 5,
      collectedAt: at,
      soldCollectedAt: at,
      soldProvider: 'Synthetic public source',
      soldPlatform: 'Shopify',
      soldSourceField: 'soldCount',
      soldEvidenceUrl: 'https://shop.test/products/proof',
    },
  };
  await persistObservation(
    c,
    target,
    'products',
    item,
    null,
    runStartedAt,
    async (_kind, rows) => rows,
  );
  const saved = await db.read('business:products:pool-proof-product');
  assert.equal(saved.newProductClassifications.length, 1);
  assert.equal(saved.newProductClassifications[0].type, 'new_listing');
  assert.equal(saved.newProductClassifications[0].salesEvidence.value, 5);
  assert.equal((await db.list('competitor:event:')).length, 0);
  await persistObservation(
    c,
    target,
    'products',
    item,
    null,
    runStartedAt,
    async (_kind, rows) => rows,
  );
  assert.equal(
    (await db.read('business:products:pool-proof-product'))
      .newProductClassifications.length,
    1,
  );
  const unknown = {
    ...item,
    id: 'pool-proof-missing-sales',
    sourceMetrics: undefined,
  };
  await persistObservation(
    c,
    target,
    'products',
    unknown,
    null,
    at,
    async (_kind, rows) => rows,
  );
  assert.equal(
    (await db.read('business:products:pool-proof-missing-sales'))
      .newProductClassifications,
    undefined,
  );
  console.log(
    'Monitor pool persistence passed: baseline capture admitted, repeat capture idempotent, missing sales excluded, zero external requests.',
  );
} finally {
  c.release();
  await memory?.close();
  await pool.end();
  if (mysql) await unlink(process.env.DATABASE_CONFIG_FILE);
}
