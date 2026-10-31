/* eslint-disable vitest/no-import-node-test, unicorn/no-await-expression-member -- Optional isolated PostgreSQL integration. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

test(
  'daily plan, real submissions, observations, restart, pause and new day persist in isolated PostgreSQL',
  { skip: !process.env.HCI_TEST_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.HCI_TEST_PGLITE_MODULE).href
    );
    const db = new PGlite();
    await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer NOT NULL DEFAULT 1);
    CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb NOT NULL);
    CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
    CREATE TABLE research_jobs(id uuid PRIMARY KEY,request_id uuid UNIQUE,input jsonb NOT NULL,checkpoint jsonb NOT NULL DEFAULT '{}',status text DEFAULT 'queued',cancelled boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    CREATE TABLE research_requests(job_id uuid,step text,paid_allowance integer DEFAULT 0,status text,response jsonb,error text,PRIMARY KEY(job_id,step));`);
    globalThis.__dailyQaDatabase = db;
    const fake = `data:text/javascript,${encodeURIComponent(`
    const db=globalThis.__dailyQaDatabase;const held=new Set();
    export const engine='postgres';export const sql=p=>p;
    export const pool={query:(q,p=[])=>db.query(q,p),connect:async()=>({query:(q,p=[])=>db.query(q,p),release(){}})};
    export const lock=async(_c,n)=>{if(held.has(n))return false;held.add(n);return true};export const unlock=async(_c,n)=>held.delete(n);
    export const putDocument=async(t,n,v,only=false,c=pool)=>c.query('INSERT INTO '+t+'(name,value) VALUES($1,$2) ON CONFLICT(name) '+(only?'DO NOTHING':'DO UPDATE SET value=EXCLUDED.value'+(t==='workspace_documents'?',revision='+t+'.revision+1':'')),[n,v]);
    export const currentDatabase=()=>({engine:'postgres'});
  `)}`;
    const hook = registerHooks({
      resolve(s, c, next) {
        if (s === './database.mjs' && c.parentURL?.includes('/server/'))
          return { url: fake, shortCircuit: true };
        return next(s, c);
      },
    });
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('External network forbidden in isolated QA');
    };
    process.env.PROVIDER_CONFIG_ENCRYPTION_KEY =
      randomBytes(32).toString('base64');
    try {
      const { dailyDiscoveryAction: api, tickDailyDiscovery } =
        await import('./daily-discovery.mjs');
      const { migrateCredentials } = await import('./local-provider.mjs');
      const { upsertProduct } = await import('./platform-products-jobs.mjs');
      const { mergeBusiness } = await import('./market-jobs.mjs');
      const admin = { id: 'qa', role: 'admin' },
        researcher = { id: 'reader', role: 'researcher' };
      await assert.rejects(
        api({ action: 'server_daily_discovery_save', plan: {} }, researcher),
        /仅管理员/,
      );
      assert.equal(
        (await api({ action: 'server_daily_discovery_status' }, researcher))
          .plan.enabled,
        false,
      );
      await migrateCredentials({
        RESEARCH_ACCESS_KEY: 'synthetic-only-access',
        SORFTIME_MCP_TOKEN: 'synthetic-only-token',
      });
      await db.query('INSERT INTO provider_configs(name,value) VALUES($1,$2)', [
        'provider:scrapecreators:v1',
        { synthetic: true },
      ]);
      const word = {
        id: 'qa-word',
        term: 'qa fiber',
        market: 'US',
        reviewStatus: 'selected',
        productIds: [],
        siteIds: [],
        dataNature: 'collected',
      };
      await db.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        ['US:qa fiber', word],
      );
      const plan = {
        enabled: true,
        time: '09:00',
        markets: ['US'],
        providers: ['sorftime'],
        budgetAcknowledged: true,
      };
      await api({ action: 'server_daily_discovery_save', plan }, admin);
      const start = Date.now(),
        day = new Date(start + 8 * 3_600_000).toISOString().slice(0, 10);
      const noon = Math.max(start, Date.parse(`${day}T04:00:00Z`));
      await tickDailyDiscovery(noon);
      let jobs = (await db.query('SELECT * FROM research_jobs')).rows;
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].input.discoveryOnly, true);
      await tickDailyDiscovery(noon + 6000);
      assert.equal(
        (await db.query('SELECT * FROM research_jobs')).rows.length,
        1,
      );
      await db.query(
        "UPDATE research_jobs SET status='completed' WHERE id=$1",
        [jobs[0].id],
      );
      await tickDailyDiscovery(noon + 12_000);
      jobs = (await db.query('SELECT * FROM research_jobs ORDER BY created_at'))
        .rows;
      assert.equal(jobs.length, 2);
      assert.equal(jobs[1].input.completeAll, false);
      assert.equal(jobs[1].input.enrich, false);
      assert.equal(jobs[1].input.keywordRecords[0].id, word.id);
      // Simulate a crash after insertion and roll back only the saved run checkpoint.
      const saved = (
        await api({ action: 'server_daily_discovery_status' }, admin)
      ).runs[0];
      saved.work[1].jobId = undefined;
      saved.work[1].status = 'pending';
      await db.query('UPDATE workspace_documents SET value=$2 WHERE name=$1', [
        `discovery:daily:run:${day}`,
        saved,
      ]);
      await tickDailyDiscovery(noon + 18_000);
      assert.equal(
        (await db.query('SELECT * FROM research_jobs')).rows.length,
        2,
      );
      assert.equal(
        (await api({ action: 'server_daily_discovery_status' }, admin)).runs[0]
          .work[1].jobId,
        jobs[1].id,
      );
      const at = new Date(Math.min(Date.now(), noon)).toISOString();
      const p = {
        id: 'qa-product',
        title: 'Synthetic product',
        firstSeenAt: at,
        sourceMetrics: { collectedAt: at },
        market: 'US',
        favorite: true,
        reviewed: true,
        keywordIds: [word.id],
      };
      await upsertProduct(p);
      await upsertProduct({
        ...p,
        title: 'Updated synthetic product',
        favorite: false,
        reviewed: false,
      });
      const stored = (
        await db.query('SELECT value FROM workspace_documents WHERE name=$1', [
          'business:products:qa-product',
        ])
      ).rows[0].value;
      assert.equal(stored.favorite, true);
      assert.equal(stored.reviewed, true);
      assert.equal(stored.discovery.firstSeenAt, at);
      assert.equal(stored.discovery.observationDays.length, 1);
      const ad = {
        id: 'qa-ad',
        firstSeenAt: at,
        lastCollectedAt: at,
        source: 'Meta',
        market: 'US',
        keywordIds: ['old-word'],
      };
      await mergeBusiness('ads:qa-ad', ad);
      await mergeBusiness('ads:qa-ad', { ...ad, keywordIds: [word.id] });
      const storedAd = (
        await db.query('SELECT value FROM workspace_documents WHERE name=$1', [
          'business:ads:qa-ad',
        ])
      ).rows[0].value;
      assert.deepEqual(storedAd.keywordIds, ['old-word', word.id]);
      assert.equal(storedAd.discovery.observationDays.length, 1);
      await api(
        {
          action: 'server_daily_discovery_save',
          plan: { ...plan, enabled: false },
        },
        admin,
      );
      await db.query(
        "UPDATE research_jobs SET status='completed' WHERE id=$1",
        [jobs[1].id],
      );
      await tickDailyDiscovery(noon + 24_000);
      assert.equal(
        (await db.query('SELECT * FROM research_jobs')).rows.length,
        4,
      );
      assert.equal((await db.query('SELECT * FROM research_jobs')).rows.filter(j => j.input.kind === 'source_fields').length, 2);
      await api({ action: 'server_daily_discovery_save', plan }, admin);
      await tickDailyDiscovery(noon + 30_000);
      assert.equal(
        (await db.query('SELECT * FROM research_jobs')).rows.length,
        4,
      );
      await tickDailyDiscovery(noon + 86_400_000);
      assert.equal(
        (await db.query('SELECT * FROM research_jobs')).rows.length,
        5,
      );
      assert.equal(
        (await api({ action: 'server_daily_discovery_status' }, admin)).runs
          .length,
        2,
      );
    } finally {
      hook.deregister();
      globalThis.fetch = realFetch;
      await db.close();
      delete globalThis.__dailyQaDatabase;
    }
  },
);
