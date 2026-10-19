import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
// Optional isolated PostgreSQL integration: set HCI_TEST_PGLITE_MODULE to the
// installed @electric-sql/pglite entry file. No production DB or credentials.
/* oxlint-disable vitest/no-import-node-test -- Isolated PostgreSQL integration uses the native Node test runner. */
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test(
  'public content API persists jobs, deduplicates submissions, saves favorites and links in isolated PostgreSQL',
  { skip: !process.env.HCI_TEST_PGLITE_MODULE },
  async () => {
    const { PGlite } = await import(
      pathToFileURL(process.env.HCI_TEST_PGLITE_MODULE).href
    );
    const db = new PGlite();
    await db.exec(
      'CREATE TABLE workspace_documents (name text PRIMARY KEY, value jsonb NOT NULL, revision integer NOT NULL DEFAULT 1); CREATE TABLE provider_configs (name text PRIMARY KEY, value jsonb NOT NULL);',
    );
    globalThis.__publicContentTestDb = db;
    const moduleUrl = (source) =>
      `data:text/javascript,${encodeURIComponent(source)}`;
    const fakeDb = moduleUrl(`
    const db = globalThis.__publicContentTestDb;
    const connection = {query:(q,p)=>db.query(q,p),release(){}};
    export const pool = {query:(q,p)=>db.query(q,p),connect:async()=>connection};
    export const sql = (pg)=>pg;
    export async function putDocument(table,name,value,ignore=false,c=pool){
      await c.query('INSERT INTO '+table+'(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value,revision='+table+'.revision+1',[name,value]);
    }
  `);
    const hook = registerHooks({
      resolve(specifier, context, next) {
        if (context.parentURL?.endsWith('/public-content-store.mjs')) {
          if (specifier === './database.mjs')
            return { url: fakeDb, shortCircuit: true };
          if (specifier === './ads-provider.mjs')
            return {
              url: moduleUrl(
                'export const openAdsKey=()=>{throw new Error("No credentials in integration test")};',
              ),
              shortCircuit: true,
            };
          if (specifier === './youtube-config.mjs')
            return {
              url: moduleUrl('export const readYoutubeKey=async()=>"";'),
              shortCircuit: true,
            };
          if (specifier === './model-provider.mjs')
            return {
              url: moduleUrl(
                'export const postModel=()=>{throw new Error("No model calls in integration test")};export const modelReportText=()=>"";',
              ),
              shortCircuit: true,
            };
        }
        return next(specifier, context);
      },
    });
    try {
      const {
        publicContentAction: api,
        withPublicContentIdle,
        contentCacheName,
      } = await import('./public-content-store.mjs');
      const user = { id: 'qa', role: 'researcher' };
      const status = await api({ action: 'server_content_status' }, user);
      assert.equal(status.sources.length, 11);
      const cacheInput = {
        limit: 30,
        market: 'VN',
        language: 'vi',
        queries: ['creatine'],
        sources: ['web_articles'],
        scopes: ['local', 'global'],
        referenceQueries: ['creatine'],
        referenceLanguage: 'en',
      };
      const localCache = contentCacheName(
        {
          source: 'web_articles',
          query: 'creatine',
          scope: 'local',
          market: 'VN',
          language: 'vi',
        },
        cacheInput,
      );
      const globalCache = contentCacheName(
        {
          source: 'web_articles',
          query: 'creatine',
          scope: 'global',
          market: 'ALL',
          language: 'en',
        },
        cacheInput,
      );
      assert.notEqual(localCache, globalCache);
      assert.notEqual(
        localCache,
        contentCacheName(
          {
            source: 'web_articles',
            query: 'creatine',
            scope: 'local',
            market: 'US',
            language: 'en',
          },
          cacheInput,
        ),
      );
      assert.equal(
        status.sources.find((s) => s.id === 'reddit').configured,
        false,
      );
      const requestId = randomUUID();
      const submission = {
        action: 'server_content_submit',
        requestId,
        input: {
          query: 'creatine',
          market: 'US',
          language: 'en',
          sources: ['youtube'],
          limit: 10,
        },
      };
      const first = await api(submission, user);
      const second = await api(submission, user);
      assert.equal(first.job.id, second.job.id);
      await assert.rejects(
        api(
          { ...submission, input: { ...submission.input, query: 'other' } },
          user,
        ),
        /其他搜索/,
      );
      let snapshot = await api({ action: 'server_content_snapshot' }, user);
      assert.equal(snapshot.jobs.length, 1);
      assert.equal(snapshot.job.id, requestId);
      const itemId = `pc-${'a'.repeat(24)}`;
      await db.query(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
        [
          `content:item:${itemId}`,
          {
            id: itemId,
            source: 'youtube',
            title: 'QA creatine',
            videoId: 'abcdefghijk',
            collectedAt: new Date().toISOString(),
            favorite: false,
            keywordIds: [],
            productIds: [],
            searchMarket: 'US',
            searchLanguage: 'en',
          },
        ],
      );
      await api(
        {
          action: 'server_content_save',
          itemId,
          favorite: true,
          productIds: ['product-qa'],
          keywordIds: ['keyword-qa'],
        },
        user,
      );
      snapshot = await api(
        { action: 'server_content_snapshot', favorites: true },
        user,
      );
      assert.equal(snapshot.items.length, 1);
      assert.deepEqual(snapshot.items[0].productIds, ['product-qa']);
      await api({ action: 'server_content_cancel', jobId: requestId }, user);
      const cancelled = await api(
        { action: 'server_content_snapshot', jobId: requestId },
        user,
      );
      assert.equal(cancelled.job.status, 'cancelled');
      await assert.rejects(
        api({ action: 'server_content_save', itemId: 'bad' }, user),
        /编号/,
      );
      await assert.rejects(
        api(
          { action: 'server_content_save', itemId, productIds: ['bad/path'] },
          user,
        ),
        /关联/,
      );
      const transcript = await api(
        {
          action: 'server_content_transcript',
          requestId: randomUUID(),
          itemId,
        },
        user,
      );
      assert.equal(transcript.job.steps.length, 1);
      assert.equal(transcript.job.mode, 'transcript');
      await assert.rejects(
        withPublicContentIdle(async () => true),
        /公共内容任务尚未结束/,
      );
      await api(
        { action: 'server_content_cancel', jobId: transcript.job.id },
        user,
      );
      assert.equal(await withPublicContentIdle(async () => true), true);
      await api(
        { action: 'server_content_save', itemId, favorite: false },
        user,
      );
      const unfavorited = await api(
        { action: 'server_content_snapshot', favorites: true },
        user,
      );
      assert.equal(unfavorited.items.length, 0);
      const redditId = 'pc-123456789012345678901234';
      await db.query(
        'INSERT INTO workspace_documents(name,value) VALUES($1,$2)',
        [
          `content:item:${redditId}`,
          {
            id: redditId,
            source: 'reddit',
            title: 'Creatine discussion',
            url: 'https://www.reddit.com/r/test/comments/abc/creatine/',
            searchMarket: 'VN',
            searchLanguage: 'vi',
          },
        ],
      );
      const comments = await api(
        {
          action: 'server_content_comments',
          requestId: randomUUID(),
          itemId: redditId,
        },
        user,
      );
      assert.equal(comments.job.mode, 'comments');
      const sameComments = await api(
        {
          action: 'server_content_comments',
          requestId: randomUUID(),
          itemId: redditId,
        },
        user,
      );
      assert.equal(sameComments.job.id, comments.job.id);
      await api(
        { action: 'server_content_cancel', jobId: comments.job.id },
        user,
      );
      const referenceId = randomUUID();
      const referenceInput = {
        query: 'creatine',
        market: 'VN',
        language: 'vi',
        scopes: ['global'],
        sources: ['medlineplus'],
        referenceQuery: 'creatine safety',
        referenceLanguage: 'en',
      };
      const reference = await api(
        {
          action: 'server_content_submit',
          requestId: referenceId,
          input: referenceInput,
        },
        user,
      );
      assert.equal(reference.job.steps[0].language, 'en');
      assert.equal(reference.job.steps[0].market, 'ALL');
      const referenceAgain = await api(
        {
          action: 'server_content_submit',
          requestId: referenceId,
          input: referenceInput,
        },
        user,
      );
      assert.equal(referenceAgain.job.id, referenceId);
      await api({ action: 'server_content_cancel', jobId: referenceId }, user);
      await assert.rejects(
        api({ action: 'server_content_snapshot', jobId: "' OR 1=1" }, user),
        /编号/,
      );
      console.log(
        'Isolated PostgreSQL API verification: submit, history, cancel, favorites, associations, transcript queue; zero provider calls.',
      );
    } finally {
      hook.deregister();
      delete globalThis.__publicContentTestDb;
      await db.close();
    }
  },
);
