import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { addManualSite, manualSiteProfile, validateManualSite } from './manual-site.mjs';

const input = (patch = {}) => ({ url: 'www.example.com/shop?utm_source=test', market: 'VN', requestId: randomUUID(), ...patch });
const html = '<html><head><title>Example Store</title><meta name="description" content="Nutrition shop"><meta property="og:site_name" content="Example"></head><body><script type="application/ld+json">{"@type":"Product","name":"Magnesium tablets","offers":{"price":"12","priceCurrency":"USD"}}</script></body></html>';
test('normalizes a public URL and rejects private, credential and platform addresses', () => {
  assert.equal(validateManualSite(input()).url, 'https://www.example.com/shop');
  for (const url of ['http://localhost', 'http://127.0.0.1', 'https://user:pass@example.com', 'https://example.com:1234', 'https://amazon.com/test', 'javascript:alert(1)'])
    assert.throws(() => validateManualSite(input({ url })));
  assert.throws(() => validateManualSite(input({ market: 'ALL' })));
});
test('profile keeps actual public evidence and does not infer company ownership', () => {
  const profile = manualSiteProfile({ html, url: 'https://www.example.com/shop' }, validateManualSite(input()), '2026-10-27T00:00:00.000Z');
  assert.equal(profile.brand, 'Example');
  assert.deepEqual(profile.mainProducts, ['Magnesium tablets']);
  assert.equal(profile.ownershipBackground, '待从官网核验');
  assert.equal(profile.lastCollectedAt, '2026-10-27T00:00:00.000Z');
  assert.throws(() => manualSiteProfile({ html: '<title>Just a moment</title>', url: 'https://example.com' }, validateManualSite(input())));
});
async function harness(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb); CREATE TABLE research_jobs(id uuid PRIMARY KEY,request_id uuid UNIQUE,input jsonb,checkpoint jsonb,status text DEFAULT \'queued\',cancelled boolean DEFAULT false);');
  let fetched = 0;
  const c = { query: (...args) => db.query(...args), release() {} };
  const io = {
    pool: { query: c.query, connect: async () => c }, lock: async () => true, unlock: async () => {},
    fetchPage: async (_url, _depth, _types, options) => { fetched++; assert.equal(options.allowedDomain, 'example.com'); return { html, url: 'https://www.example.com/shop' }; },
    putDocument: async (_table, name, value) => db.query('INSERT INTO workspace_documents VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=$2', [name, value]),
    now: () => '2026-10-27T00:00:00.000Z',
  };
  return { db, io, fetched: () => fetched };
}
test('adds site and bounded free product job atomically; retry does not fetch or enqueue again', async (t) => {
  const h = await harness(t); const request = input();
  const first = await addManualSite(request, h.io);
  assert.ok(first.jobId);
  assert.equal(first.reused, false);
  assert.deepEqual(await addManualSite(request, h.io), first);
  assert.equal(h.fetched(), 1);
  const allJobs = (await h.db.query('SELECT input FROM research_jobs')).rows;
  assert.equal(allJobs.filter((j) => j.input.kind === 'source_fields').length, 1);
  const jobs = allJobs.filter((j) => j.input.kind === 'products');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].input.maxPaidRequests, 0);
  assert.equal(jobs[0].input.maxProducts, 30);
  assert.equal(jobs[0].input.maxRequests, 20);
  assert.deepEqual(jobs[0].input.siteIds, [first.siteId]);
  await assert.rejects(addManualSite({ ...request, market: 'US' }, h.io), /提交编号/);
});
test('reuses an existing domain ID, manual decisions and active job', async (t) => {
  const h = await harness(t);
  const old = { id: 'existing', domain: 'www.example.com', market: 'VN', brand: 'Reviewed brand', favorite: true, keywordIds: ['keep'], mainProducts: ['old'], platform: '其他' };
  await h.io.putDocument('', 'business:sites:existing', old);
  const first = await addManualSite(input(), h.io);
  const second = await addManualSite(input(), h.io);
  assert.equal(first.siteId, old.id);
  assert.equal(second.jobId, first.jobId);
  const site = (await h.db.query("SELECT value FROM workspace_documents WHERE name='business:sites:existing'")).rows[0].value;
  assert.equal(site.favorite, true);
  assert.equal(site.brand, old.brand);
  assert.deepEqual(site.keywordIds, ['keep']);
  const jobs = (await h.db.query('SELECT * FROM research_jobs')).rows;
  assert.equal(jobs.filter((j) => j.input.kind === 'products').length, 1);
  assert.equal(jobs.filter((j) => j.input.kind === 'source_fields').length, 1);
  assert.ok(site.sourceContent.rawMainProducts.includes('Magnesium tablets'));
});
test('site-only mode skips product collection, retains AI analysis and a full queue rolls back a new site', async (t) => {
  const h = await harness(t);
  const saved = await addManualSite(input({ collectProducts: false }), h.io);
  assert.equal(saved.jobId, '');
  for (let i = 0; i < 20; i++) await h.db.query('INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)', [randomUUID(), randomUUID(), {}, {}]);
  await assert.rejects(addManualSite(input({ market: 'US' }), h.io), /20个任务/);
  assert.equal((await h.db.query("SELECT * FROM workspace_documents WHERE name='business:sites:US-example.com'")).rows.length, 0);
});
