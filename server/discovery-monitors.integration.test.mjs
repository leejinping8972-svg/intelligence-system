import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

test('discovery SQL workflow: schedules, source evidence, cancellation and paid request recovery', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/discovery-test-no-config.json',
  );
  process.env.DATABASE_URL =
    'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  const db = new PGlite();
  const originalFetch = globalThis.fetch;
  let externalCalls = 0;
  let modelCalls = 0;
  globalThis.fetch = async () => {
    externalCalls++;
    throw new Error('External calls disabled in isolated discovery tests');
  };
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (specifier === './collection-translation.mjs')
        return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export const translateCollectionRecords = async (_kind, records) => records; export const translateCollectedResult = async result => result;')}` };
      if (context.parentURL?.endsWith('/store.mjs') && specifier === './product-intake-sorftime.mjs')
        return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent('export const productIntakeSource = () => ({empty:true,providerCalls:0,usage:{requests:0,sorftimeCalls:0}});')}` };
      if (
        context.parentURL?.endsWith('/store.mjs') &&
        specifier === './official-new-releases.mjs'
      )
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const officialNewReleases = request => globalThis.__officialTestProvider(request);')}`,
        };
      if (
        context.parentURL?.endsWith('/store.mjs') &&
        specifier === './discovery-ai.mjs'
      )
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const fieldAnalysisRequest = request => globalThis.__discoveryTestModel(request);')}`,
        };
      return next(specifier, context);
    },
  });
  const { pool, putDocument } = await import('./database.mjs');
  const originalConnect = pool.connect;
  const originalQuery = pool.query;
  pool.query = async (statement, params = []) => {
    if (statement.startsWith('SELECT pg_try_advisory_lock'))
      return { rows: [{ locked: true }] };
    if (statement.startsWith('SELECT pg_advisory_unlock')) return { rows: [] };
    if (
      params.length === 0 &&
      statement
        .trim()
        .split(';')
        .filter((s) => s.trim()).length > 1
    )
      return (await db.exec(statement)).at(-1);
    return db.query(
      statement,
      params.map((v) =>
        v && typeof v === 'object' && !(v instanceof Date)
          ? JSON.stringify(v)
          : v,
      ),
    );
  };
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  try {
    const { migrate, collect } = await import('./store.mjs');
    const {
      discoveryAction,
      tickDiscoveryMonitors,
      submitDiscovery,
      runDiscoveryMonitor,
    } = await import('./discovery-monitor-store.mjs');
    const { queueSourceFields, runSourceFields, sourceFieldsAction } =
      await import('./source-field-store.mjs');
    const { gateSourceFields } = await import('./source-field-domain.mjs');
    const { upsertProduct, readProduct } =
      await import('./platform-products-jobs.mjs');
    const { jobTasks } = await import('./runner.mjs');
    await migrate();
    const admin = { role: 'admin', id: 'synthetic-admin' };
    const getJob = async (id) =>
      (await pool.query('SELECT * FROM research_jobs WHERE id=$1', [id]))
        .rows[0];
    const read = async (name) =>
      (
        await pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [name],
        )
      ).rows[0]?.value;
    globalThis.__discoveryTestModel = async ({ sample }) => {
      modelCalls++;
      return {
        patch: { ingredient: 'Inulin', category: 'Dietary Supplement' },
        analysis: {
          fingerprint: sample.fingerprint,
          status: 'analyzed',
          fields: {
            ingredient: {
              sourceId: 'raw:ingredients',
              quote: 'ingredients: Inulin',
            },
          },
          supplement: true,
        },
        model: 'synthetic-only',
        usage: { modelTokens: 20, modelCalls: 1 },
      };
    };

    await t.test(
      'saved topics and per-channel source markets survive scheduling; edits do not duplicate same-day jobs',
      async () => {
        const input = {
          kind: 'regular_new',
          market: 'US',
          channels: ['amazon'],
          sourceMarkets: { amazon: 'US' },
          topics: ['dietary supplements', 'vitamins'],
          days: 30,
          frequency: 'weekly',
          weekday: 5,
          time: '09:00',
          enabled: true,
        };
        const saved = (
          await discoveryAction(
            { action: 'server_discovery_save', plan: input },
            admin,
          )
        ).plan;
        assert.equal(saved.days, 30);
        assert.equal(saved.frequency, 'weekly');
        assert.equal(saved.time, '09:00');
        assert.equal(saved.scheduleConfigVersion, 1);
        const snapshot = await discoveryAction({ action: 'server_discovery_snapshot' }, admin);
        assert.deepEqual(snapshot.plans.find(p => p.id === saved.id), { ...saved, categories: {} });
        await tickDiscoveryMonitors(Date.parse('2026-10-29T01:00:00Z'));
        await tickDiscoveryMonitors(Date.parse('2026-10-30T00:59:00Z'));
        assert.equal((await pool.query('SELECT * FROM research_jobs')).rows.length, 0);
        await tickDiscoveryMonitors(Date.parse('2026-10-30T01:00:00Z'));
        await tickDiscoveryMonitors(Date.parse('2026-10-30T01:05:00Z'));
        const jobs = (await pool.query('SELECT * FROM research_jobs')).rows;
        assert.equal(jobs.length, 1);
        assert.equal(jobs[0].input.plan.days, 30);
        assert.equal(jobs[0].input.plan.completeDays, true);
        assert.deepEqual(jobs[0].input.plan.topics, []);
        assert.equal(jobs[0].input.plan.sourceMarkets.amazon, 'US');
        assert.equal(jobs[0].input.plan.sourceMode, 'sorftime');
        assert.match(jobTasks(jobs[0])[0].title, /常规新品/);
        await discoveryAction(
          {
            action: 'server_discovery_save',
            id: saved.id,
            plan: { ...input, days: 60, topics: 'changed' },
          },
          admin,
        );
        await tickDiscoveryMonitors(Date.parse('2026-10-30T02:00:00Z'));
        assert.equal(
          (await pool.query('SELECT * FROM research_jobs')).rows.length,
          1,
        );
        const storedJob = await getJob(jobs[0].id);
        assert.equal(storedJob.input.plan.days, 30, 'saving new settings must not rewrite a frozen job');
        assert.equal((await read(`discovery:monitor:${saved.id}`)).days, 60);
        const reordered = {
          ...storedJob.input,
          plan: Object.fromEntries(
            Object.entries(storedJob.input.plan).reverse(),
          ),
        };
        await pool.query('UPDATE research_jobs SET input=$2 WHERE id=$1', [
          storedJob.id,
          reordered,
        ]);
        assert.equal(
          (
            await submitDiscovery({
              requestId: storedJob.request_id,
              monitorId: storedJob.input.monitorId,
              plan: storedJob.input.plan,
            })
          ).id,
          storedJob.id,
        );
        await discoveryAction(
          { action: 'server_discovery_delete', id: saved.id },
          admin,
        );
        await tickDiscoveryMonitors(Date.parse('2026-11-06T01:00:00Z'));
        assert.equal(
          (await pool.query('SELECT * FROM research_jobs')).rows.length,
          1,
        );
        assert.equal(await read(`discovery:monitor:${saved.id}`), undefined);
      },
    );

    await t.test('FBM monthly schedule persists its day and time and produces the selected window', async () => {
      const saved = (await discoveryAction({action:'server_discovery_save',plan:{kind:'fbm_new',market:'US',channels:['amazon'],days:90,frequency:'monthly',monthDay:12,time:'15:30',enabled:true}},admin)).plan;
      assert.equal(saved.days,90);
      const snapshot=await discoveryAction({action:'server_discovery_snapshot'},admin);
      assert.deepEqual(snapshot.plans.find(p=>p.id===saved.id),{...saved,categories:{}});
      const count=async()=>(await pool.query("SELECT * FROM research_jobs WHERE input->>'monitorId'=$1",[saved.id])).rows;
      await tickDiscoveryMonitors(Date.parse('2026-11-11T15:30:00+08:00'));
      await tickDiscoveryMonitors(Date.parse('2026-11-12T15:29:00+08:00'));
      assert.equal((await count()).length,0);
      await tickDiscoveryMonitors(Date.parse('2026-11-12T15:30:00+08:00'));
      await tickDiscoveryMonitors(Date.parse('2026-11-12T16:00:00+08:00'));
      const jobs=await count();assert.equal(jobs.length,1);assert.equal(jobs[0].input.plan.days,90);
      await discoveryAction({action:'server_discovery_delete',id:saved.id},admin);
    });

    await t.test(
      'capture clears guessed formula, queues exactly once, applies cited analysis and reuses journal after restart',
      async () => {
        const product = {
          id: 'qa-inulin',
          market: 'US',
          title: 'Dietary Supplement Inulin Gummies',
          ingredient: 'Coconut Oil',
          dose: '2 gummies',
          sourceContent: {
            attributes: { 'Special Ingredients': 'Coconut Oil' },
            rawFields: { ingredients: 'Inulin' },
          },
          sourceProvider: 'Sorftime',
          sourcePlatform: 'Amazon',
          sourceUrl: 'https://www.amazon.com/dp/B000000001',
          dataNature: 'collected',
        };
        await upsertProduct(product);
        const pending = await readProduct(product.id);
        assert.equal(pending.fieldAnalysis.status, 'pending');
        assert.equal(pending.ingredient, 'Coconut Oil');
        const id = await queueSourceFields('products', pending);
        assert.equal(await queueSourceFields('products', pending), id);
        await runSourceFields(await getJob(id));
        assert.equal((await readProduct(product.id)).ingredient, 'Inulin');
        assert.equal((await getJob(id)).status, 'completed');
        assert.match(jobTasks(await getJob(id))[0].title, /AI分析/);
        assert.equal(modelCalls, 1);
        await runSourceFields(await getJob(id));
        assert.equal(modelCalls, 1);
        const request = (
          await pool.query('SELECT * FROM research_requests WHERE job_id=$1', [
            id,
          ])
        ).rows[0];
        assert.equal(request.status, 'done');
      },
    );

    await t.test(
      'stale result and cancellation during analysis cannot overwrite current source data',
      async () => {
        const product = await readProduct('qa-inulin');
        const pending = gateSourceFields(
          'products',
          product,
          {
            ...product,
            title: 'New source Dietary Supplement',
            sourceContent: { rawFields: { ingredients: 'Vitamin C' } },
          },
          { title: 'New source Dietary Supplement' },
        );
        await putDocument(
          'workspace_documents',
          'business:products:qa-inulin',
          pending,
        );
        const oldJob = (
          await pool.query(
            "SELECT * FROM research_jobs WHERE input->>'kind'='source_fields' LIMIT 1",
          )
        ).rows[0];
        await runSourceFields(oldJob);
        assert.equal(
          (await readProduct('qa-inulin')).fieldAnalysis.status,
          'pending',
        );
        assert.equal((await readProduct('qa-inulin')).ingredient, 'Inulin');
        const id = await queueSourceFields('products', pending);
        await runSourceFields(await getJob(id), {
          collect: async () => {
            await pool.query(
              'UPDATE research_jobs SET cancelled=true WHERE id=$1',
              [id],
            );
            return {
              patch: { ingredient: 'Must not apply' },
              analysis: {
                status: 'analyzed',
                fingerprint: pending.fieldAnalysis.fingerprint,
              },
            };
          },
        });
        assert.equal((await getJob(id)).status, 'cancelled');
        assert.equal(
          (await readProduct('qa-inulin')).fieldAnalysis.status,
          'pending',
        );
      },
    );

    await t.test(
      'sites and ads retain raw text and manual retry is idempotent; unknown paid journal never replays',
      async () => {
        for (const kind of ['sites', 'ads']) {
          const value = gateSourceFields(
            kind,
            {},
            {
              id: `qa-${kind}`,
              market: 'US',
              description: 'Dietary supplement company',
              copy: 'Inulin supplement',
              dataNature: 'collected',
            },
            { description: 'Dietary supplement company' },
          );
          const saved =
            kind === 'ads'
              ? {
                  ...value,
                  brand: 'Health Shop',
                  brandZh: '健康商店',
                  headline: 'Better sleep',
                  headlineZh: '睡得更好',
                  copyZh: '菊粉补充剂',
                  sellingPointZh: '每日补充菊粉',
                }
              : value;
          await putDocument(
            'workspace_documents',
            `business:${kind}:${value.id}`,
            saved,
          );
          const input = {
            action: 'server_source_fields_submit',
            requestId: randomUUID(),
            kind,
            ids: [value.id],
          };
          const first = await sourceFieldsAction(input, admin);
          assert.deepEqual(
            (await sourceFieldsAction(input, admin)).jobIds,
            first.jobIds,
          );
          assert.equal(
            (await read(`business:${kind}:${value.id}`)).sourceContent
              .rawDescription,
            'Dietary supplement company',
          );
          if (kind === 'ads') {
            const pendingAd = await read(`business:ads:${value.id}`);
            assert.deepEqual(
              ['brandZh', 'headlineZh', 'copyZh', 'sellingPointZh'].map(
                (key) => pendingAd[key],
              ),
              ['健康商店', '睡得更好', '菊粉补充剂', '每日补充菊粉'],
            );
            await runSourceFields(await getJob(first.jobIds[0]), {
              collect: async () => ({
                patch: {
                  brandZh: '',
                  headlineZh: '',
                  copyZh: '',
                  sellingPointZh: '',
                },
                analysis: {
                  status: 'analyzed',
                  fingerprint: pendingAd.fieldAnalysis.fingerprint,
                },
                model: 'test',
              }),
            });
            const analyzedAd = await read(`business:ads:${value.id}`);
            assert.deepEqual(
              ['brandZh', 'headlineZh', 'copyZh', 'sellingPointZh'].map(
                (key) => analyzedAd[key],
              ),
              ['健康商店', '睡得更好', '菊粉补充剂', '每日补充菊粉'],
            );
          }
        }
        const job = await submitDiscovery({
          requestId: randomUUID(),
          plan: { kind: 'regular_new', market: 'US', channels: ['amazon'] },
        });
        await pool.query(
          "INSERT INTO research_requests(job_id,step,status) VALUES($1,'unknown','started')",
          [job.id],
        );
        await assert.rejects(
          collect(job, 'unknown', { sources: ['field_analysis'] }),
          /未知/,
        );
        assert.equal(modelCalls, 1);
        assert.equal(externalCalls, 0);
      },
    );
    await t.test(
      'manual monitor runs retain edited 5000-post settings and task linkage with idempotent retries',
      async () => {
        const plan = (
          await discoveryAction(
            {
              action: 'server_discovery_save',
              plan: {
                kind: 'ingredients',
                market: 'US',
                channels: ['reddit'],
                topics: 'Synthetic ingredient',
                maxProducts: 5000,
                frequency: 'daily',
                time: '09:00',
                enabled: false,
              },
            },
            admin,
          )
        ).plan;
        const input = {
          action: 'server_discovery_submit',
          monitorId: plan.id,
          requestId: randomUUID(),
          plan: { ...plan, maxPages: 25 },
        };
        const first = await discoveryAction(input, admin);
        const second = await discoveryAction(input, admin);
        assert.equal(first.jobId, second.jobId);
        const job = await getJob(first.jobId);
        assert.equal(job.input.plan.maxProducts, 5000);
        assert.equal(job.input.plan.maxPages, 25);
        assert.equal(job.input.monitorId, plan.id);
        assert.equal(
          (await read(`discovery:monitor:${plan.id}`)).lastJobId,
          job.id,
        );
        assert.equal((await read(`discovery:monitor:${plan.id}`)).maxPages, 20);
        const next = await discoveryAction(
          { ...input, requestId: randomUUID() },
          admin,
        );
        assert.equal(next.jobId, first.jobId); // Same active ingredient run is reused across tabs/request IDs.
      },
    );
    await t.test(
      'an unsupported old product monitor does not block the daily ingredient schedule',
      async () => {
        const bad = {
          id: randomUUID(),
          kind: 'regular_new',
          market: 'US',
          channels: ['unsupported_platform'],
          enabled: true,
          frequency: 'daily',
          time: '09:00',
          days: 7,
          maxProducts: 100,
        };
        const good = {
          ...bad,
          id: randomUUID(),
          kind: 'ingredients',
          channels: ['reddit'],
          topics: ['Synthetic supplement'],
        };
        await putDocument(
          'workspace_documents',
          `discovery:monitor:${bad.id}`,
          bad,
        );
        await putDocument(
          'workspace_documents',
          `discovery:monitor:${good.id}`,
          good,
        );
        await tickDiscoveryMonitors(Date.parse('2026-11-05T01:00:00Z'));
        assert.match(
          (await read(`discovery:monitor:${bad.id}`)).lastScheduleError,
          /新品支持/,
        );
        assert.ok((await read(`discovery:monitor:${good.id}`)).lastJobId);
      },
    );
    await t.test(
      'official runner uses persistent request journal and resumes a cached board without refetching',
      async () => {
        let publicCalls = 0;
        globalThis.__officialTestProvider = async (request) => {
          publicCalls++;
          const { parseOfficialBoard } =
            await import('./official-new-releases.mjs');
          return parseOfficialBoard(
            '<title>Amazon.com New Releases</title><div id="gridItemRoot"><span class="zg-bdg-text">#1</span><div data-asin="B000000009"><div class="p13n-sc-css-line-clamp-3">Synthetic dietary supplement</div></div></div>',
            request,
          );
        };
        const job = await submitDiscovery({
          requestId: randomUUID(),
          plan: {
            kind: 'regular_new',
            sourceMode: 'official_new_releases',
            market: 'US',
            channels: ['amazon'],
            maxProducts: 1000,
          },
        });
        await runDiscoveryMonitor(job);
        // Simulate loss of the checkpoint after the request journal was committed.
        await runDiscoveryMonitor(job);
        assert.equal(publicCalls, 1);
        let saved = await getJob(job.id);
        for (
          let i = 0;
          i < 5 && !['completed', 'partial'].includes(saved.status);
          i++
        ) {
          await runDiscoveryMonitor(saved);
          saved = await getJob(job.id);
        }
        assert.equal(saved.status, 'completed');
        assert.equal(saved.checkpoint.products, 1);
        const journal = (
          await pool.query('SELECT * FROM research_requests WHERE job_id=$1', [
            job.id,
          ])
        ).rows;
        assert.equal(journal.length, 2);
        const board = journal.find((row) =>
          row.step.startsWith('official-board:'),
        );
        assert.equal(board.status, 'done');
        assert.equal(board.paid_allowance, 0);
        assert.equal(board.response.items[0].ranking.rank, 1);
        assert.equal(externalCalls, 0);
        globalThis.__officialTestProvider = async () => {
          publicCalls++;
          throw Error('synthetic source failure');
        };
        await assert.rejects(
          collect(job, 'official-failed', {
            sources: ['official_new_releases'],
          }),
          /synthetic source failure/,
        );
        await assert.rejects(
          collect(job, 'official-failed', {
            sources: ['official_new_releases'],
          }),
          /synthetic source failure/,
        );
        assert.equal(publicCalls, 2);
      },
    );
  } finally {
    hook.deregister();
    globalThis.fetch = originalFetch;
    delete globalThis.__discoveryTestModel;
    delete globalThis.__officialTestProvider;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await pool.end();
    await db.close();
  }
});
