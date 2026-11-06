import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

test('translation is awaited after durable collection; failures and restarts never replay source or unknown model calls', async (t) => {
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
  await assert.rejects(
    collect({ id: 'job' }, 'ads:0', { sources: ['ads'] }),
    /请先配置/,
  );
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
  await assert.rejects(
    collect({ id: 'job' }, 'ads:0', { sources: ['ads'] }),
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
  await assert.rejects(
    collect({ id: 'job' }, 'ads:0', { sources: ['ads'] }),
    /未确认/,
  );
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
  await pool.query('INSERT INTO workspace_documents(name,value) VALUES($1,$2)', [
    `collection:translation:v1:${translationHash('Legacy Unknown Brand')}`,
    { status: 'started', owner: 'legacy-unconfirmed' },
  ]);
  await pool.query("INSERT INTO research_requests VALUES('old-brand','ads:0','done',$1)", [{ ads: [{ id: 'old-brand-ad', brand: 'Legacy Unknown Brand' }] }]);
  await assert.rejects(collect({ id: 'old-brand' }, 'ads:0', { sources: ['synthetic'] }), /尚未确认/);
  assert.equal(calls, 3, 'a new brand cache namespace must not bypass the old unknown paid request');
});
