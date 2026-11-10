/* oxlint-disable vitest/no-import-node-test -- Server tests use Node's test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeDiscoveryProduct } from './discovery-sorftime.mjs';
import {
  mergePlatformProduct,
  normalizeAmazon,
  normalizeAmazonContent,
} from './platform-product-data.mjs';
import { normalizeSorftimeProduct } from './product-resource-sorftime.mjs';
import { productSellerName, sourceSellerName } from './product-seller.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';
import { parseOfficialDetail } from './official-new-releases.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';

const at = '2026-11-10T02:00:00Z';
const row = {
  asin: 'B000000001',
  title: 'Synthetic product',
  brand: 'Brand A',
};

test('seller aliases survive all Amazon collection paths and list projection', () => {
  for (const seller of [
    { seller_name: ' Store B ' },
    { SellerName: 'Store B' },
    { seller: { name: 'Store B' } },
    { seller_info: { seller_name: 'Store B' } },
    { shop_info: { shop_name: 'Store B' } },
    { soldBy: 'Store B' },
  ]) {
    for (const product of [
      normalizeAmazon({ ...row, ...seller }, 'US', at),
      normalizeSorftimeProduct(
        { ...row, ...seller },
        { platform: 'amazon', market: 'US', op: 'search' },
        at,
      ),
      normalizeDiscoveryProduct(
        { product_info: { ...row, ...seller } },
        { channel: 'amazon', market: 'US' },
        at,
      ),
    ]) {
      assert.equal(product.sellerName, 'Store B');
      assert.equal(product.brand, 'Brand A');
      assert.ok(product.collectionFields.includes('sellerName'));
      assert.equal(
        projectRecord('products', product).data.sellerName,
        'Store B',
      );
    }
  }
});

test('content captures sellers, rejects other ASINs and keeps seller on partial refresh', () => {
  const product = normalizeAmazon(row, 'US', at);
  const patch = normalizeAmazonContent(
    { asin: row.asin, seller_name: 'New seller' },
    product,
    at,
  );
  assert.equal(patch.sellerName, 'New seller');
  assert.ok(patch.collectionFields.includes('sellerName'));
  const saved = mergePlatformProduct(
    { ...product, resourceRaw: { shopName: 'Saved seller' } },
    { ...product, resourceRaw: { shopName: '' } },
  );
  assert.equal(saved.sellerName, 'Saved seller');
  assert.equal(mergePlatformProduct(saved, patch).sellerName, 'New seller');
  assert.throws(
    () =>
      normalizeAmazonContent(
        { asin: 'B000000002', seller_name: 'Wrong seller' },
        product,
        at,
      ),
    /ASIN/,
  );
});

test('saved seller evidence works without refetch and never falls back to brand or shipper', () => {
  for (const legacy of [
    { resourceRaw: { shopName: 'Saved seller' } },
    { resourceRaw: { soldBy: 'Saved seller' } },
    { sourceMetrics: { shopName: 'Saved seller' } },
    { resourceEvidence: { identity: { shopName: 'Saved seller' } } },
  ]) {
    assert.equal(productSellerName(legacy), 'Saved seller');
    assert.equal(
      projectRecord('products', { ...row, ...legacy, id: 'p' }).data.sellerName,
      'Saved seller',
    );
  }
  assert.equal(
    sourceSellerName({
      ...row,
      manufacturer: 'Factory',
      shipsFrom: 'Amazon',
      seller: { id: 'seller-123' },
    }),
    '',
  );
  assert.equal(productSellerName(row), '');
});

test('official Amazon detail preserves sold-by independently of fulfillment', () => {
  const result = parseOfficialDetail(
    `<input id="ASIN" value="${row.asin}"><span id="productTitle">Synthetic product</span><div id="fulfillerInfoFeature_feature_div"><span class="offer-display-feature-text-message">Amazon.com</span></div><div id="merchantInfoFeature_feature_div"><span class="offer-display-feature-text-message">Seller B</span></div>`,
    {
      asin: row.asin,
      market: 'US',
      sourceMarket: 'US',
      now: Date.parse(at),
      ranking: { rank: 1 },
    },
  );
  assert.equal(result.product.sellerName, 'Seller B');
  assert.equal(result.product.resourceRaw.fulfillment, 'FBA');
});

test('existing list summaries read saved seller names by page without rewriting data or rebuilding the index', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const queries = [];
  const connection = {
    query: (statement, values = []) => {
      queries.push(statement);
      return db.query(
        statement,
        values.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
      );
    },
  };
  const pool = {
    ...connection,
    connect: async () => ({ ...connection, release() {} }),
  };
  const putDocument = (_table, name, value, _flag, conn = connection) =>
    conn.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=$2,revision=workspace_documents.revision+1',
      [name, value],
    );
  try {
    await db.exec(
      'CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false);',
    );
    await migrateWorkspaceReads(pool, 'postgres');
    const products = [
      { id: 'p1', sellerName: 'Direct seller' },
      { id: 'p2', resourceRaw: { shopName: 'Legacy shop' } },
      { id: 'p3', resourceRaw: { soldBy: 'Official seller' } },
      { id: 'p4', sourceMetrics: { shopName: 'Metric shop' } },
      {
        id: 'p5',
        resourceEvidence: { identity: { shopName: 'Evidence shop' } },
      },
      { id: 'p6' },
    ].map((p) => ({ ...normalizeAmazon(row, 'US', at), ...p }));
    for (const product of products)
      await putDocument('', `business:products:${product.id}`, product);
    const reads = createWorkspaceReads({
      pool,
      sql: (pg) => pg,
      lock: async () => true,
      unlock: async () => {},
      putDocument,
      isWorkspaceSyncKey: () => true,
      loadPublic: async () => ({}),
    });
    for (let i = 0; i < 20; i++) if (!(await reads.refresh())) break;
    // Simulate summaries generated before the seller field existed.
    await pool.query(
      "UPDATE workspace_read_rows SET payload=payload-'sellerName'-'sourceMetrics' WHERE collection='products'",
    );
    queries.length = 0;
    const list = await reads.list({ collection: 'products', pageSize: 50 });
    const names = new Map(list.rows.map((p) => [p.id, p.sellerName]));
    assert.deepEqual(
      products.map((p) => names.get(p.id)),
      [
        'Direct seller',
        'Legacy shop',
        'Official seller',
        'Metric shop',
        'Evidence shop',
        undefined,
      ],
    );
    assert.equal(
      queries.filter((q) => /SELECT name,.*sellername/.test(q)).length,
      1,
    );
    assert.ok(queries.every((q) => !/\b(?:UPDATE|INSERT|DELETE)\b/i.test(q)));
    const detail = await reads.details({ collection: 'products', id: 'p2' });
    assert.equal(detail.record.sellerName, 'Legacy shop');
    const exported = await reads.exportRecords({
      collection: 'products',
      ids: ['p3'],
    });
    assert.equal(exported.rows[0].sellerName, 'Official seller');
  } finally {
    await db.close();
  }
});
