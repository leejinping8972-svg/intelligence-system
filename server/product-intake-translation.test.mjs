/* oxlint-disable vitest/no-import-node-test -- Server regression uses the Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { prepareProductIntake } from './product-intake.mjs';
import { runSourceFields } from './source-field-store.mjs';
import { runHealthDiscovery } from './health-discovery-runner.mjs';
import { HEALTH_PRODUCT_POLICY } from './health-category-domain.mjs';
import { healthProductSample } from './health-product-domain.mjs';
import {
  sourceFieldSample,
  validateSourceFields,
} from './source-field-domain.mjs';
import { saveCheckpoint } from './store.mjs';

const product = () => ({
  id: 'synthetic-translation-product',
  market: 'US',
  title: 'Dietary supplement capsules; swallow for nutritional support.',
  sourceUrl: 'https://example.test/supplement',
  decisionData: { listing: { date: '2026-11-09' } },
  resourceRaw: { salesEvidence: { value: 2 } },
});
const translationError = () =>
  Object.assign(new Error('采集翻译未包含中文，原文已保留'), {
    code: 'COLLECTION_TRANSLATION_INVALID',
  });
function analysis(sample) {
  const evidence = {
    sourceId: 'title',
    quote: sample.sources.find((s) => s.id === 'title').text,
  };
  return {
    ...validateSourceFields(
      {
        fields: [],
        translations: [],
        healthProduct: {
          kind: 'oral_supplement',
          route: 'oral',
          evidence,
          usage: evidence,
          purpose: evidence,
        },
      },
      sample,
    ),
    patch: { titleZh: '营养补充胶囊' },
    model: 'synthetic',
  };
}

test('translation validation failure retains successful fields, classification and provenance', async () => {
  const p = product();
  const result = await prepareProductIntake(
    { id: 'synthetic' },
    p,
    {
      collect: async (_job, _step, request) => analysis(request.sample),
      translate: async () => {
        throw translationError();
      },
    },
    { sourceDetails: false, healthProductPolicy: HEALTH_PRODUCT_POLICY },
  );
  assert.equal(result.analysis.status, 'analyzed');
  assert.equal(result.analysis.healthProduct.status, 'accepted');
  assert.equal(result.product.titleZh, '营养补充胶囊');
  assert.equal(result.analysis.model, 'synthetic');
  assert.ok(result.analysis.sources.some((s) => s.text === p.title));
  assert.equal(result.analysis, result.product.fieldAnalysis);
  assert.deepEqual(result.errors, ['翻译：采集翻译未包含中文，原文已保留']);
  assert.equal(p.fieldAnalysis, undefined);
});

test('cached analysis survives translation errors without another field request', async () => {
  const p = product();
  const sample = healthProductSample(
    sourceFieldSample('products', p),
    HEALTH_PRODUCT_POLICY,
  );
  p.fieldAnalysis = {
    ...analysis(sample).analysis,
    version: 2,
    sources: sample.sources,
  };
  const result = await prepareProductIntake(
    { id: 'synthetic' },
    p,
    {
      collect: async () =>
        assert.fail('cached analysis must not request the model'),
      translate: async () => {
        throw new Error('此前翻译结果尚未确认');
      },
    },
    { sourceDetails: false, healthProductPolicy: HEALTH_PRODUCT_POLICY },
  );
  assert.equal(result.product, p);
  assert.equal(result.analysis.healthProduct.status, 'accepted');
  assert.deepEqual(result.errors, ['翻译：此前翻译结果尚未确认']);
});

test('field extraction errors remain pending and never start translation', async () => {
  const result = await prepareProductIntake(
    { id: 'synthetic' },
    product(),
    {
      collect: async () => {
        throw new Error('上次模型请求结果未知');
      },
      translate: async () =>
        assert.fail('unconfirmed analysis must not translate'),
    },
    { sourceDetails: false },
  );
  assert.equal(result.product.fieldAnalysis.status, 'pending');
  assert.equal(result.analysis, undefined);
  assert.deepEqual(result.errors, ['AI：上次模型请求结果未知']);
});

test('health discovery admits valid evidence despite translation gaps and reports partial', async () => {
  const job = {
    id: 'synthetic',
    input: {
      plan: {
        kind: 'regular_new',
        market: 'US',
        days: 7,
        maxProducts: 500,
        completeDays: true,
        requireSales: true,
      },
    },
    checkpoint: {
      work: [],
      pending: [{ product: product(), powderOnly: false }],
      healthCoverage: { synthetic: { firstPage: 'done' } },
    },
  };
  const writes = [];
  const reviews = [];
  let status;
  const io = {
    pool: { query: async () => ({ rows: [{ cancelled: false }] }) },
    now: () => Date.parse('2026-11-10T02:00:00Z'),
    collect: async (_job, _step, request) => analysis(request.sample),
    translate: async () => {
      throw translationError();
    },
    upsertProduct: async (value) => writes.push(value),
    putDocument: async (...args) => reviews.push(args),
    saveCheckpoint: async (_job, cp, next) => {
      job.checkpoint = cp;
      status = next;
    },
  };
  await runHealthDiscovery(job, io);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].fieldAnalysis.healthProduct.status, 'accepted');
  assert.equal(reviews.length, 0);
  assert.equal(job.checkpoint.products, 1);
  await runHealthDiscovery(job, io);
  assert.equal(status, 'partial');
  assert.match(job.checkpoint.failures[0], /^翻译：/);
});

test('product analysis worker writes extracted fields once and retains translation failure status', async () => {
  const db = new PGlite();
  const query = (q, p = []) =>
    db.query(
      q,
      p.map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : v)),
    );
  const pool = { query, connect: async () => ({ query, release() {} }) };
  await db.exec(
    `CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,status text,cancelled boolean DEFAULT false,checkpoint jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now()); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_requests(job_id text,step text,status text,error text);`,
  );
  try {
    for (const failed of [false, true]) {
      const p = product();
      p.id += failed ? '-failure' : '-success';
      const sample = sourceFieldSample('products', p);
      p.fieldAnalysis = { status: 'pending', fingerprint: sample.fingerprint };
      p.favorite = true;
      p.newProductClassifications = [{ type: 'regular_new' }];
      const input = {
        kind: 'source_fields',
        targetKind: 'products',
        targetId: p.id,
        productIntakeVersion: 2,
        sample,
      };
      await query(
        "INSERT INTO research_jobs(id,input,status) VALUES($1,$2,'running')",
        [p.id, input],
      );
      await query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)', [
        `business:products:${p.id}`,
        p,
      ]);
      let translations = 0;
      let modelCalls = 0;
      await runSourceFields(
        { id: p.id, input, checkpoint: {} },
        {
          pool,
          saveCheckpoint,
          collect: async (_job, _step, request) => {
            modelCalls++;
            return analysis(request.sample);
          },
          translate: async (_kind, rows) => {
            translations++;
            if (failed) throw translationError();
            return rows.map((row) => ({ ...row, categoryZh: '营养补充剂' }));
          },
          putDocument: async (_table, name, value, _importOnly, c) =>
            c.query('UPDATE workspace_documents SET value=$2 WHERE name=$1', [
              name,
              value,
            ]),
        },
      );
      const saved = await query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [`business:products:${p.id}`],
      );
      const stored = saved.rows[0].value;
      const jobs = await query(
        'SELECT status,checkpoint FROM research_jobs WHERE id=$1',
        [p.id],
      );
      const job = jobs.rows[0];
      assert.equal(translations, 1);
      assert.equal(modelCalls, 1);
      assert.equal(stored.fieldAnalysis.status, 'analyzed');
      assert.equal(stored.titleZh, '营养补充胶囊');
      assert.equal(stored.favorite, true);
      assert.deepEqual(
        stored.newProductClassifications,
        p.newProductClassifications,
      );
      assert.equal(job.status, failed ? 'partial' : 'completed');
      if (failed)
        assert.ok(job.checkpoint.logs.some((log) => log.startsWith('翻译：')));
      else assert.equal(stored.categoryZh, '营养补充剂');
    }
  } finally {
    await db.close();
  }
});
