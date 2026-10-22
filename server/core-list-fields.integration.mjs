import assert from 'node:assert/strict';
import { normalizeTikTokShopSearch } from './tiktok-shop-provider.mjs';

export async function verifyCoreListFields({
  pool,
  upsertProduct,
  mergeBusiness,
  engine,
}) {
  const raw = {
    id: 'core-qa-123',
    title: 'Synthetic collagen gummies',
    product_price_info: { sale_price_decimal: '250.000', currency_name: 'VND' },
    sold_info: { sold_count: 100 },
    seo_url: { canonical_url: 'https://core-qa.example/products/gummy' },
  };
  const p = normalizeTikTokShopSearch(
    { products: [raw] },
    'VN',
    '2026-09-22T01:00:00Z',
  ).products[0];
  const first = await upsertProduct({ ...p, siteId: 'core-qa-site' });
  assert.equal(first.price, 250000);
  const second = normalizeTikTokShopSearch(
    { data: { products: [{ ...raw, sold_info: { sold_count: 190 } }] } },
    'VN',
    '2026-10-22T01:00:00Z',
  ).products[0];
  await upsertProduct(second);
  const saved = (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:products:${p.id}`,
    ])
  ).rows[0].value;
  assert.equal(saved.coreEvidence.history.length, 2);
  assert.equal(saved.coreEvidence.history[0].sold, 100);
  assert.equal(saved.coreEvidence.history[1].sold, 190);
  assert.equal(
    saved.siteId,
    'core-qa-site',
    'platform refresh preserves verified site association',
  );
  const archives = await pool.query(
    'SELECT value FROM workspace_documents WHERE name LIKE $1',
    [`core:observation:products:${p.id}:%`],
  );
  assert.equal(archives.rows.length, 2);
  await upsertProduct(second);
  assert.equal(
    (
      await pool.query(
        'SELECT value FROM workspace_documents WHERE name LIKE $1',
        [`core:observation:products:${p.id}:%`],
      )
    ).rows.length,
    2,
  );
  const site = {
    id: 'core-qa-site',
    market: 'VN',
    domain: 'core-qa.example',
    lastCollectedAt: '2026-10-22T01:00:00Z',
    metrics: {
      source: 'Semrush QA',
      market: 'VN',
      organicTraffic: 100,
      paidTraffic: 0,
      collectedAt: '2026-09-22T01:00:00Z',
    },
  };
  await mergeBusiness(`sites:${site.id}`, site);
  await mergeBusiness(`sites:${site.id}`, {
    metrics: {
      ...site.metrics,
      organicTraffic: 125,
      collectedAt: '2026-10-22T01:00:00Z',
    },
  });
  const s = (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:sites:${site.id}`,
    ])
  ).rows[0].value;
  assert.equal(s.coreEvidence.history.length, 2);
  const ad = {
    id: 'core-qa-ad',
    archiveId: '123',
    market: 'VN',
    platform: 'Meta',
    source: 'Meta QA',
    status: '投放中',
    firstSeenAt: '2026-09-01T00:00:00Z',
    lastCollectedAt: '2026-10-22T01:00:00Z',
    siteIds: [site.id],
    landingUrls: ['https://core-qa.example/products/gummy?utm_source=meta'],
    headline: 'Synthetic creative',
  };
  const a = await mergeBusiness(`ads:${ad.id}`, ad);
  assert.equal(a.productId, p.id);
  const next = await mergeBusiness(`ads:${ad.id}`, {
    ...ad,
    firstSeenAt: '2026-10-23T01:00:00Z',
    lastCollectedAt: '2026-10-23T01:00:00Z',
    headline: 'Changed creative',
  });
  assert.equal(next.firstSeenAt, a.firstSeenAt);
  assert.equal(next.coreEvidence.history.length, 2);
  assert.notEqual(
    next.coreEvidence.history[0].creative,
    next.coreEvidence.history[1].creative,
  );
  return {
    engine,
    productId: p.id,
    productSnapshots: 2,
    siteSnapshots: 2,
    adSnapshots: 2,
    exactLandingAssociation: true,
  };
}
