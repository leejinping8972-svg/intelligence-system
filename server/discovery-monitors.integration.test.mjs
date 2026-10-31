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
    const { discoveryAction, tickDiscoveryMonitors, submitDiscovery } =
      await import('./discovery-monitor-store.mjs');
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
          channels: ['amazon', 'shopee'],
          sourceMarkets: { amazon: 'US', shopee: 'VN' },
          topics: ['dietary supplements', 'vitamins'],
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
        await tickDiscoveryMonitors(Date.parse('2026-10-30T01:00:00Z'));
        await tickDiscoveryMonitors(Date.parse('2026-10-30T01:05:00Z'));
        const jobs = (await pool.query('SELECT * FROM research_jobs')).rows;
        assert.equal(jobs.length, 1);
        assert.deepEqual(jobs[0].input.plan.topics, []);
        assert.equal(jobs[0].input.plan.sourceMarkets.shopee, 'VN');
        assert.match(jobTasks(jobs[0])[0].title, /常规新品/);
        await discoveryAction(
          {
            action: 'server_discovery_save',
            id: saved.id,
            plan: { ...input, topics: 'changed' },
          },
          admin,
        );
        await tickDiscoveryMonitors(Date.parse('2026-10-30T02:00:00Z'));
        assert.equal(
          (await pool.query('SELECT * FROM research_jobs')).rows.length,
          1,
        );
        const storedJob = await getJob(jobs[0].id);
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
        assert.doesNotMatch(pending.ingredient, /Coconut/);
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
        assert.doesNotMatch(
          (await readProduct('qa-inulin')).ingredient,
          /^Inulin$/,
        );
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
          await putDocument(
            'workspace_documents',
            `business:${kind}:${value.id}`,
            value,
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
  } finally {
    hook.deregister();
    globalThis.fetch = originalFetch;
    delete globalThis.__discoveryTestModel;
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await pool.end();
    await db.close();
  }
});
