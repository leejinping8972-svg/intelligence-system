import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test(
  'selected daily monitoring persists configuration, submits three real child kinds, recovers a crash and reads progress in isolated SQL',
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
    export const configPath='synthetic-disabled';export const mysqlPool=()=>{throw new Error('External DB forbidden')};
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
      const { keywordTrendsAction: api, keywordTrendIO } =
        await import('./keyword-trends-store.mjs');
      const { advanceRelatedDaily, RELATED_RUN } =
        await import('./keyword-related-daily.mjs');
      const { trendDay } = await import('./keyword-trends-domain.mjs');
      const { pool } = await import('./database.mjs');
      const now = Date.parse('2026-11-11T02:00:00Z');
      const day = trendDay(now);
      const word = {
        id: 'qa-selected',
        term: 'synthetic fiber',
        market: 'US',
        reviewStatus: 'selected',
        dataNature: 'imported',
      };
      await db.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        ['US|synthetic fiber', word],
      );
      for (const name of [
        'provider:scrapecreators:v1',
        'provider:semrush:mcp:v1',
      ])
        await db.query(
          'INSERT INTO provider_configs(name,value) VALUES($1,$2)',
          [name, { synthetic: true }],
        );
      const admin = { role: 'admin' };
      const reader = { role: 'researcher' };
      await assert.rejects(
        api({ action: 'server_keyword_trends_save', plan: {} }, reader),
        /管理员/,
      );
      await api(
        {
          action: 'server_keyword_trends_save',
          plan: {
            comparisonVersion: 2,
            enabled: true,
            time: '09:00',
            sources: ['google'],
            markets: ['US'],
            relatedSources: ['products', 'ads', 'sites'],
            productProviders: ['semrush'],
            relatedProducts: 7,
            relatedAdPages: 2,
            relatedAds: 12,
            relatedSites: 4,
            budgetAcknowledged: true,
          },
        },
        admin,
      );
      const io = keywordTrendIO(pool, { now });
      for (let i = 0; i < 3; i++) {
        await advanceRelatedDaily(io);
        const jobs = (
          await db.query('SELECT * FROM research_jobs ORDER BY created_at')
        ).rows;
        assert.equal(jobs.length, i + 1);
        if (i === 0) {
          assert.equal(jobs[0].input.kind, 'platform_products');
          assert.equal(jobs[0].input.discoveryDay, day);
          assert.equal(jobs[0].input.perKeyword, 7);
          assert.equal(jobs[0].input.keywordRecords[0].id, word.id);
          const run = await io.latestRelatedRun();
          delete run.work[0].jobId;
          run.work[0].status = 'pending';
          await io.db.write(RELATED_RUN + day, run);
          await advanceRelatedDaily(io);
          assert.equal(
            (await db.query('SELECT * FROM research_jobs')).rows.length,
            1,
          );
          assert.equal((await io.latestRelatedRun()).work[0].jobId, jobs[0].id);
        }
        await db.query("UPDATE research_jobs SET status='completed'");
      }
      await advanceRelatedDaily(io);
      const jobs = (
        await db.query('SELECT * FROM research_jobs ORDER BY created_at')
      ).rows;
      assert.deepEqual(
        jobs.map((j) => j.input.kind),
        ['platform_products', 'ads', 'sites'],
      );
      assert.equal(jobs[1].input.maxAds, 12);
      assert.equal(jobs[1].input.maxPages, 2);
      assert.equal(jobs[1].input.includeSearchSites, false);
      assert.equal(jobs[2].input.maxSites, 4);
      assert.ok(jobs.slice(1).every((j) => j.input.records[0].id === word.id));
      const progress = await (
        await import('./keyword-trends-engine.mjs')
      ).trendAction({ action: 'server_keyword_trends_snapshot' }, reader, io);
      assert.equal(progress.relatedRun.total, 3);
      assert.equal(progress.relatedRun.pending, 0);
      assert.ok(
        progress.relatedRun.work.every(
          (w) => w.status === 'completed' && w.jobId,
        ),
      );
      assert.equal(progress.plan.relatedProducts, 7);
      const stored = (await db.query('SELECT data FROM research_keywords'))
        .rows[0].data;
      assert.equal(stored.reviewStatus, 'selected');
      assert.equal(stored.adCollection.jobId, jobs[1].id);
      assert.equal(stored.siteCollection.jobId, jobs[2].id);
      assert.equal(
        (await db.query('SELECT * FROM research_requests')).rows.length,
        0,
      );
    } finally {
      globalThis.fetch = realFetch;
      hook.deregister();
      delete globalThis.__dailyQaDatabase;
      await db.close();
    }
  },
);
