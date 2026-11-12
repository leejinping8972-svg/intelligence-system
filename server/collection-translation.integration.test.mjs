import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

test('translation failures preserve collection and restarts never replay source or unknown model calls', async (t) => {
  process.env.DATABASE_CONFIG_FILE = resolve(
    '.artifacts/collection-translation-no-config.json',
  );
  process.env.DATABASE_URL =
    'postgres://synthetic:synthetic@127.0.0.1:1/synthetic';
  process.env.PROVIDER_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    'base64',
  );
  const db = new PGlite();
  await db.exec(
    'CREATE TABLE provider_configs(name text PRIMARY KEY,value jsonb); CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer DEFAULT 1); CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,cancelled boolean DEFAULT false); CREATE TABLE research_requests(job_id text,step text,status text,response jsonb,PRIMARY KEY(job_id,step));',
  );
  let calls = 0;
  let fail = true;
  const prompts = [];
  globalThis.__collectionTranslationModel = async (prompt, sample) => {
    prompts.push(prompt);
    calls++;
    if (fail) throw Error('synthetic timeout; provider outcome unknown');
    return {
      result: {
        items: sample.items.map((item) => ({
          id: item.id,
          text: `中文${item.text}`,
        })),
      },
      model: 'synthetic',
      usage: { modelTokens: 10, modelCalls: 1 },
    };
  };
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (
        context.parentURL?.endsWith('/collection-translation.mjs') &&
        specifier === './discovery-ai.mjs'
      )
        return {
          shortCircuit: true,
          url: `data:text/javascript,${encodeURIComponent('export const configuredJson = (...args) => globalThis.__collectionTranslationModel(...args);')}`,
        };
      return next(specifier, context);
    },
  });
  const { pool } = await import('./database.mjs');
  const previousConnect = pool.connect;
  const previousQuery = pool.query;
  pool.query = (statement, args = []) =>
    db.query(
      statement,
      args.map((value) =>
        value && typeof value === 'object' ? JSON.stringify(value) : value,
      ),
    );
  pool.connect = async () => ({
    query: (...args) => pool.query(...args),
    release() {},
  });
  t.after(async () => {
    pool.query = previousQuery;
    pool.connect = previousConnect;
    hook.deregister();
    delete globalThis.__collectionTranslationModel;
    await db.close();
    await pool.end();
  });
  const { collect } = await import('./store.mjs');
  const raw = {
    ads: [{ id: 'a', brand: 'Unknown brand', headline: 'Unknown headline' }],
    creditsCharged: 1,
  };
  await pool.query(
    "INSERT INTO research_requests VALUES('job','ads:0','done',$1)",
    [raw],
  );
  const unconfigured = await collect({ id: 'job' }, 'ads:0', {
    sources: ['ads'],
  });
  assert.equal(unconfigured.ads[0].headline, 'Unknown headline');
  assert.match(unconfigured.ads[0].collectionTranslation.message, /请先配置/);
  assert.equal(
    (await pool.query('SELECT count(*)::int AS n FROM workspace_documents'))
      .rows[0].n,
    0,
    'missing configuration leaves no unknown model claim',
  );
  const { sealAdsKey } = await import('./ads-provider.mjs');
  await pool.query('INSERT INTO provider_configs VALUES($1,$2)', [
    'provider:analysis:v1',
    sealAdsKey(
      JSON.stringify({
        baseUrl: 'https://example.com/v1',
        model: 'synthetic',
        apiKey: 'synthetic-only',
      }),
    ),
  ]);
  const timedOut = await collect({ id: 'job' }, 'ads:0', { sources: ['ads'] });
  assert.match(
    timedOut.ads[0].collectionTranslation.message,
    /synthetic timeout/,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT status FROM research_requests WHERE job_id='job'",
      )
    ).rows[0].status,
    'done',
  );
  const resumed = await collect({ id: 'job' }, 'ads:0', { sources: ['ads'] });
  assert.match(resumed.ads[0].collectionTranslation.message, /未确认/);
  assert.equal(
    calls,
    1,
    'unknown paid translation is not automatically repeated',
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT response FROM research_requests WHERE job_id='job'",
      )
    ).rows[0].response,
    raw,
  );
  fail = false;
  const known = {
    ads: [{ id: 'b', brand: 'New brand', headline: 'New headline' }],
    creditsCharged: 1,
  };
  await pool.query(
    "INSERT INTO research_requests VALUES('second','ads:0','done',$1)",
    [known],
  );
  const translated = await collect({ id: 'second' }, 'ads:0', {
    sources: ['ads'],
  });
  assert.equal(translated.ads[0].headlineZh, '中文New headline');
  assert.equal(translated.creditsCharged, 1);
  assert.deepEqual(
    await collect({ id: 'second' }, 'ads:0', { sources: ['ads'] }),
    translated,
  );
  assert.equal(calls, 2, 'later reads reuse saved translations');
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM workspace_documents WHERE name LIKE 'source-usage:event:%'",
      )
    ).rows[0].n,
    2,
  );
  await pool.query('INSERT INTO provider_configs VALUES($1,$2)', [
    'provider:ai-prompt:keyword_translation:v1',
    { text: '自定义术语规则：保留配方缩写和剂量，忠实翻译其他内容。' },
  ]);
  await pool.query(
    "INSERT INTO research_requests VALUES('keyword','related','done',$1)",
    [{ keywords: [{ term: 'synthetic seed', seedTerm: 'synthetic seed' }] }],
  );
  const keywords = await collect({ id: 'keyword' }, 'related', {
    sources: ['synthetic'],
  });
  assert.equal(keywords.keywords[0].seedTermZh, '中文synthetic seed');
  assert.match(prompts.at(-1), /自定义术语规则/);
  assert.equal(calls, 3, 'same term and seed share one translation');
  const { translationHash } =
    await import('./collection-translation-domain.mjs');
  await pool.query(
    'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
    [
      `keyword:translation:v1:${translationHash('legacy seed')}`,
      { termZh: '历史种子' },
    ],
  );
  await pool.query(
    "INSERT INTO research_requests VALUES('legacy','related','done',$1)",
    [{ keywords: [{ term: 'legacy seed', seedTerm: 'legacy seed' }] }],
  );
  const legacy = await collect({ id: 'legacy' }, 'related', {
    sources: ['synthetic'],
  });
  assert.equal(legacy.keywords[0].seedTermZh, '历史种子');
  assert.equal(
    calls,
    3,
    'legacy keyword cache is reused without charging again',
  );
  await pool.query(
    'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
    [
      `collection:translation:v1:${translationHash('Legacy Unknown Brand')}`,
      { status: 'started', owner: 'legacy-unconfirmed' },
    ],
  );
  await pool.query(
    "INSERT INTO research_requests VALUES('old-brand','ads:0','done',$1)",
    [{ ads: [{ id: 'old-brand-ad', brand: 'Legacy Unknown Brand' }] }],
  );
  const oldBrand = await collect({ id: 'old-brand' }, 'ads:0', {
    sources: ['synthetic'],
  });
  assert.match(oldBrand.ads[0].collectionTranslation.message, /尚未确认/);
  assert.equal(
    calls,
    3,
    'a new brand cache namespace must not bypass the old unknown paid request',
  );

  await db.exec(
    'CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb,updated_at timestamp DEFAULT now())',
  );
  const { saveKeyword } = await import('./store.mjs');
  const { runJob } = await import('./runner.mjs');
  const { jobProgress } = await import('./job-progress.mjs');
  const { taskOverview } = await import('./task-overview.mjs');
  globalThis.__collectionTranslationModel = async (_prompt, sample) => {
    calls++;
    return {
      result: { items: sample.items },
      model: 'synthetic',
      usage: { modelCalls: 1 },
    };
  };
  const keyword = {
    id: 'seed',
    term: 'elahring',
    market: 'US',
    source: '用户种子词',
  };
  const job = {
    id: 'init-fallback',
    status: 'running',
    input: {
      seeds: ['elahring', 'elah', 'Elah'],
      markets: ['US'],
      sources: ['semrush', 'sorftime'],
      expansionOnly: true,
      limit: 0,
    },
    checkpoint: {
      keywords: [keyword],
      logs: ['采集翻译未包含中文，原文已保留'],
      failures: 0,
      discoveryIndex: 0,
      metricIndex: 0,
    },
  };
  const sourceSteps = [];
  await runJob(job, {
    saveKeyword,
    collect: async (_job, step) => {
      sourceSteps.push(step);
      return step.startsWith('sem-metric:')
        ? {
            metrics: { market: 'US', monthlySearchVolume: 5 },
            message: 'synthetic metric saved',
          }
        : { suggestions: [] };
    },
    saveCheckpoint: async (_job, cp, status) => {
      Object.assign(job.checkpoint, cp);
      if (status) job.status = status;
    },
    patchCollection: async () => {},
    usage: async () => ({ confirmed: 0, reserved: 0 }),
    checkCancelled: async () => {},
    now: () => Date.parse('2026-11-12T03:00:00Z'),
  });
  assert.equal(job.status, 'awaiting_review');
  assert.equal(job.checkpoint.discoveryComplete, true);
  assert.ok(sourceSteps.includes('sem-discover:2'));
  assert.ok(sourceSteps.includes('discover:2'));
  assert.equal(job.checkpoint.metricIndex, job.checkpoint.keywords.length);
  assert.ok(sourceSteps.some((step) => step.startsWith('sem-metric:')));
  const saved = (await db.query('SELECT data FROM research_keywords')).rows.map(
    (row) => row.data,
  );
  assert.equal(saved.length, 2);
  assert.ok(
    saved.every((row) => row.collectionTranslation.status === 'partial'),
  );
  assert.ok(saved.some((row) => row.term === 'elahring' && !row.termZh));
  const callsBeforeReuse = calls;
  await saveKeyword(keyword);
  assert.equal(
    calls,
    callsBeforeReuse,
    'invalid translation cache must not replay model calls',
  );
  const overview = taskOverview(job, { progress: jobProgress(job) });
  assert.equal(overview.outcome, '本次采集目标完成');
  assert.match(overview.reason, /中文翻译未完成/);
  await saveKeyword({ ...keyword, termZh: '人工中文名' });
  const preserved = await saveKeyword(keyword);
  assert.equal(preserved.termZh, '人工中文名');
  assert.equal(preserved.collectionTranslation.status, 'complete');
  assert.equal(
    calls,
    callsBeforeReuse,
    'retaining a known Chinese name must not retry its failed model request',
  );

  // The same invalid cached text must not discard a successfully extracted ad
  // patch or make its parent collection look unfinished.
  await db.exec(
    "ALTER TABLE research_jobs ADD COLUMN status text DEFAULT 'queued', ADD COLUMN checkpoint jsonb DEFAULT '{}', ADD COLUMN updated_at timestamp DEFAULT now()",
  );
  await pool.query(
    'INSERT INTO research_jobs(id,input,status) VALUES($1,$2,$3)',
    [
      'ad-parent',
      { kind: 'ads', sourceAnalysis: { total: 1, running: 1 } },
      'completed',
    ],
  );
  const childInput = {
    kind: 'source_fields',
    targetKind: 'ads',
    targetId: 'ad-extracted',
    sample: { fingerprint: 'ad-version', sources: [] },
    parentJobIds: ['ad-parent'],
    parentRecordedStatus: 'running',
  };
  await pool.query(
    'INSERT INTO research_jobs(id,input,status) VALUES($1,$2,$3)',
    ['ad-analysis', childInput, 'running'],
  );
  await pool.query(
    'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
    [
      'business:ads:ad-extracted',
      {
        headline: 'elahring',
        copyZh: '已有人工译文',
        fieldAnalysis: { fingerprint: 'ad-version', status: 'pending' },
      },
    ],
  );
  const { runSourceFields } = await import('./source-field-store.mjs');
  await runSourceFields(
    { id: 'ad-analysis', input: childInput, checkpoint: { logs: [] } },
    {
      collect: async () => ({
        patch: { headline: 'elahring', claim: '中文分析结论' },
        analysis: { fingerprint: 'ad-version', status: 'analyzed' },
        model: 'synthetic',
      }),
      putDocument: async (_table, name, value, _importOnly, connection) =>
        connection.query(
          'UPDATE workspace_documents SET value=$2 WHERE name=$1',
          [name, value],
        ),
    },
  );
  const child = (
    await pool.query(
      "SELECT status,checkpoint FROM research_jobs WHERE id='ad-analysis'",
    )
  ).rows[0];
  const parent = (
    await pool.query(
      "SELECT status,input FROM research_jobs WHERE id='ad-parent'",
    )
  ).rows[0];
  const ad = (
    await pool.query(
      "SELECT value FROM workspace_documents WHERE name='business:ads:ad-extracted'",
    )
  ).rows[0].value;
  assert.equal(child.status, 'completed');
  assert.ok(
    child.checkpoint.logs.some((line) => line.includes('中文翻译未完成')),
  );
  assert.equal(parent.status, 'completed');
  assert.equal(parent.input.sourceAnalysis.completed, 1);
  assert.equal(parent.input.sourceAnalysis.failed || 0, 0);
  assert.equal(ad.claim, '中文分析结论');
  assert.equal(ad.headline, 'elahring');
  assert.equal(ad.headlineZh, undefined);
  assert.equal(ad.copyZh, '已有人工译文');
  assert.equal(ad.fieldAnalysis.status, 'analyzed');
  assert.equal(
    calls,
    callsBeforeReuse,
    'the failed cached ad translation is not replayed',
  );

  await db.exec('ALTER TABLE research_jobs ADD COLUMN request_id text UNIQUE');
  const { upsertProduct } = await import('./platform-products-jobs.mjs');
  const { mergeBusiness } = await import('./market-jobs.mjs');
  await upsertProduct({
    id: 'direct-product',
    title: 'elahring',
    market: 'US',
    sourceUrl: 'https://example.test/product',
  });
  await mergeBusiness('ads:direct-ad', {
    id: 'direct-ad',
    headline: 'elahring',
    market: 'US',
  });
  for (const [name, field] of [
    ['business:products:direct-product', 'title'],
    ['business:ads:direct-ad', 'headline'],
  ]) {
    const saved = (
      await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
        name,
      ])
    ).rows[0].value;
    assert.equal(saved[field], 'elahring');
    assert.equal(saved.collectionTranslation.status, 'partial');
    assert.equal(saved.fieldAnalysis.status, 'pending');
  }
  assert.equal(
    calls,
    callsBeforeReuse,
    'direct product/ad saves do not replay invalid translations',
  );
});
