import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import {
  BATCH_SETTINGS,
  batchRecord,
  canonicalBatch,
  mergeBatchAliases,
} from './collection-batch-domain.mjs';
import { batchMergeTask, createCollectionBatchJobs } from './collection-batch-jobs.mjs';
import { createCollectionBatchAction } from './collection-batches.mjs';
import { createConceptMonitor } from './concept-monitor.mjs';
import { decorateTaskContexts } from './task-context.mjs';
import { taskOverview } from './task-overview.mjs';
import { projectJobTasks } from './task-projection.mjs';
import { migrateWorkspaceReads } from './workspace-read-schema.mjs';
import { createWorkspaceReads, projectRecord } from './workspace-reads.mjs';

test('canonical identities flatten chained merges, deduplicate ads and safely handle object-key names', () => {
  const first = mergeBatchAliases({}, ['A', 'B'], 'C');
  const second = mergeBatchAliases(first.aliases, ['C', 'D'], 'E');
  assert.equal(canonicalBatch('Ａ', second.aliases), 'E');
  assert.equal(canonicalBatch('B', second.aliases), 'E');
  assert.deepEqual(
    batchRecord(
      'ads',
      { collectionBatches: ['A', 'B', 'C', 'X'] },
      second.aliases,
    ).collectionBatches,
    ['E', 'X'],
  );
  const special = mergeBatchAliases({}, ['__proto__', 'constructor'], '目标');
  assert.equal(canonicalBatch('__proto__', special.aliases), '目标');
  assert.equal(Object.getPrototypeOf(special.aliases), Object.prototype);
});

async function fixture(overrides = {}) {
  const db = new PGlite();
  const sql = (pg) => pg;
  let fail = false;
  const pool = {
    query: (statement, values = []) => {
      if (
        fail &&
        statement.startsWith('INSERT INTO workspace_documents') &&
        values[0] === BATCH_SETTINGS
      )
        throw Error('synthetic rollback');
      return db.query(
        statement,
        values.map((value) =>
          value && typeof value === 'object' ? JSON.stringify(value) : value,
        ),
      );
    },
    connect: async () => ({
      query: (...args) => pool.query(...args),
      release() {},
    }),
  };
  await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb NOT NULL,revision integer NOT NULL DEFAULT 1);
    CREATE TABLE research_keywords(natural_key text PRIMARY KEY,data jsonb NOT NULL,updated_at timestamptz DEFAULT now());
    CREATE TABLE research_jobs(id text PRIMARY KEY,request_id text UNIQUE,input jsonb,checkpoint jsonb NOT NULL DEFAULT '{}',status text DEFAULT 'queued',cancelled boolean DEFAULT false,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());`);
  await migrateWorkspaceReads(pool, 'postgres');
  const putDocument = (_table, name, value, _importOnly, c = pool) =>
    c.query(
      'INSERT INTO workspace_documents(name,value) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET value=EXCLUDED.value',
      [name, value],
    );
  const options = {
    pool,
    sql,
    putDocument,
    lock: async () => true,
    unlock: async () => {},
    requireAdmin: (user) => {
      if (user?.role !== 'admin') throw Error('admin required');
    },
    ...overrides,
  };
  const reads = createWorkspaceReads({
    ...options,
    isWorkspaceSyncKey: () => true,
    loadPublic: async () => ({}),
  });
  const admin = { id: 'admin-qa', role: 'admin' };
  const merge = createCollectionBatchAction(options);
  const jobs = createCollectionBatchJobs({...options, saveCheckpoint: (job, cp, status) => pool.query("UPDATE research_jobs SET checkpoint=$2,status=CASE WHEN cancelled THEN 'cancelled' ELSE $3 END,updated_at=now() WHERE id=$1", [job.id,cp,status])});
  async function add(kind, record) {
    const sourceKey =
      kind === 'keywords' ? record.id : `business:${kind}:${record.id}`;
    if (kind === 'keywords')
      await pool.query(
        'INSERT INTO research_keywords(natural_key,data) VALUES($1,$2)',
        [sourceKey, record],
      );
    else await putDocument('', sourceKey, record);
    const projection = projectRecord(kind, record);
    await pool.query(
      'INSERT INTO workspace_read_rows(collection,id,source_key,market,category,score,grade,rating_status,review_status,collection_status,favorite,collected_at,source_label,platform,ownership,site_id,newness,recent_discovery,search_text,payload) VALUES(' +
        Array.from({ length: 20 }, (_, i) => '$' + (i + 1)).join(',') +
        ')',
      [kind, record.id, sourceKey, ...projection.columns, projection.data],
    );
    for (const [relation, target] of projection.links)
      await pool.query('INSERT INTO workspace_read_links VALUES($1,$2,$3,$4)', [
        kind,
        record.id,
        relation,
        target,
      ]);
  }
  async function publish() {
    const monitor = createConceptMonitor(options);
    await pool.query('BEGIN');
    try {
      await monitor.rebuild(pool, 'qa', true);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
    return monitor.read({ pageSize: 100 });
  }
  const now = new Date().toISOString();
  const old = '2020-01-01T00:00:00Z';
  const keyword = (id, batch, market = 'US') => ({
    id,
    term: id,
    termZh: '测试词',
    market,
    batch,
    siteIds: [],
    productIds: [],
    series: [],
    trendPoints: [],
    source: 'synthetic',
    reviewStatus: 'selected',
    collectedAt: now,
  });
  await add('keywords', {
    ...keyword('kA', 'A'),
    siteIds: ['s'],
    productIds: ['p-old'],
  });
  await add('keywords', keyword('kB', 'B'));
  await add('keywords', keyword('kMX', 'A', 'MX'));
  await add('sites', {
    id: 's',
    market: 'US',
    domain: 'synthetic.example',
    brand: 'Synthetic',
    keywordIds: ['kA'],
    sourceEvidence: [{ collectedAt: old }],
    collectedAt: now,
  });
  await add('ads', {
    id: 'a',
    market: 'US',
    brand: 'Synthetic',
    collectionBatches: ['A', 'B', 'C'],
    keywordIds: ['kA', 'kB'],
    siteIds: ['s'],
    firstSeenAt: now,
    collectedAt: now,
  });
  await add('products', {
    id: 'p-old',
    market: 'US',
    title: 'Old',
    siteId: 's',
    keywordIds: [],
    firstSeenAt: old,
    collectedAt: now,
  });
  for (let i = 0; i < 23; i++)
    await add('products', {
      id: 'p' + i,
      market: 'US',
      title: 'Product ' + i,
      siteId: 's',
      keywordIds: [],
      firstSeenAt: now,
      collectedAt: now,
    });
  await add('products', {
    id: 'foreign',
    market: 'VN',
    title: 'Foreign',
    keywordIds: ['kA'],
    collectedAt: now,
  });
  return {
    db,
    pool,
    reads,
    merge,
    jobs,
    loadJob: async id => (await pool.query('SELECT * FROM research_jobs WHERE id=$1',[id])).rows[0],
    admin,
    publish,
    fail: () => {
      fail = true;
    },
  };
}

test('stored batch members drive all eight list filters, exact batches, paging and market/date boundaries', async () => {
  const f = await fixture();
  try {
    const snapshot = await f.publish();
    const a = snapshot.rows.find((row) => row.batch === 'A');
    for (const collection of ['keywords', 'ads', 'sites', 'products']) {
      const all = await f.reads.list({
        collection,
        market: 'ALL',
        conceptBatch: 'A',
        pageSize: 100,
      });
      assert.equal(all.total, a[collection], collection);
      const recent = await f.reads.list({
        collection,
        market: 'ALL',
        conceptBatch: 'A',
        conceptDay: snapshot.snapshot.day,
        pageSize: 100,
      });
      assert.equal(recent.total, a[collection + 'Today'], collection + 'Today');
      assert.equal(
        (
          await f.reads.list({
            collection,
            conceptBatch: 'A',
            conceptDay: '2020-01-01',
          })
        ).total,
        0,
      );
    }
    assert.equal(
      (
        await f.reads.list({
          collection: 'keywords',
          market: 'MX',
          conceptBatch: 'A',
        })
      ).total,
      1,
    );
    assert.equal(
      (
        await f.reads.list({
          collection: 'products',
          market: 'VN',
          conceptBatch: 'A',
        })
      ).total,
      0,
    );
    assert.equal(
      (
        await f.reads.list({
          collection: 'products',
          conceptBatch: "A' OR 1=1 --",
        })
      ).total,
      0,
    );
    const page1 = await f.reads.list({
      collection: 'products',
      conceptBatch: 'A',
      pageSize: 10,
      page: 1,
    });
    const page2 = await f.reads.list({
      collection: 'products',
      conceptBatch: 'A',
      pageSize: 10,
      page: 2,
    });
    assert.equal(page1.total, 24);
    assert.equal(page2.rows.length, 10);
    assert.equal(
      new Set([...page1.rows, ...page2.rows].map((row) => row.id)).size,
      20,
    );
  } finally {
    await f.db.close();
  }
});

test('merge updates real affiliations across markets, retains all evidence, deduplicates shared records and rejects stale submissions', async () => {
  const f = await fixture();
  try {
    await f.publish();
    const old = (
      await f.pool.query(
        'SELECT data FROM research_keywords WHERE natural_key=$1',
        ['kA'],
      )
    ).rows[0].data;
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['A', 'B'], target: '目标', expectedRevision: 0 },
          { role: 'researcher' },
        ),
      /admin/,
    );
    const result = await f.merge(
      { batches: ['A', 'B'], target: '目标', expectedRevision: 0 },
      f.admin,
    );
    assert.equal(result.target, '目标');
    assert.equal(result.revision, 1);
    const updated = (
      await f.pool.query(
        'SELECT data FROM research_keywords WHERE natural_key=$1',
        ['kA'],
      )
    ).rows[0].data;
    assert.deepEqual(updated, { ...old, batch: '目标' });
    assert.equal(
      (
        await f.pool.query(
          'SELECT data FROM research_keywords WHERE natural_key=$1',
          ['kMX'],
        )
      ).rows[0].data.batch,
      '目标',
    );
    assert.deepEqual(
      (
        await f.pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          ['business:ads:a'],
        )
      ).rows[0].value.collectionBatches,
      ['目标', 'C'],
    );
    const next = await f.publish();
    assert.deepEqual(next.rows.map((row) => row.batch).sort(), ['C', '目标']);
    const merged = next.rows.find((row) => row.batch === '目标');
    assert.equal(merged.products, 24);
    assert.equal(merged.ads, 1);
    assert.equal(merged.keywords, 3);
    assert.equal(
      (
        await f.reads.list({ collection: 'keywords', conceptBatch: '目标' })
      ).rows.every((row) => row.batch === '目标'),
      true,
    );
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['目标', 'C'], target: '最终', expectedRevision: 0 },
          f.admin,
        ),
      /发生变化/,
    );
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['A', 'B'], target: '最终', expectedRevision: 1 },
          f.admin,
        ),
      /已经合并/,
    );
    await f.merge(
      { batches: ['目标', 'C'], target: '最终', expectedRevision: 1 },
      f.admin,
    );
    const aliases = (
      await f.pool.query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [BATCH_SETTINGS],
      )
    ).rows[0].value;
    assert.equal(canonicalBatch('A', aliases.aliases), '最终');
    assert.equal(aliases.history.length, 2);
    await f.publish();
    assert.equal(
      (await f.reads.list({ collection: 'ads', conceptBatch: '最终' })).rows[0]
        .collectionBatches[0],
      '最终',
    );
    // A late checkpoint may still carry its original batch; it must never resurrect that identity.
    await f.pool.query(
      'UPDATE research_keywords SET data=$2 WHERE natural_key=$1',
      ['kA', { ...old, batch: 'A' }],
    );
    assert.equal(
      (await f.reads.details({ collection: 'keywords', id: 'kA' })).record
        .batch,
      '最终',
    );
    await f.reads.refresh();
    assert.equal(
      (
        await f.reads.list({ collection: 'keywords', conceptBatch: '最终' })
      ).rows.every((row) => row.batch === '最终'),
      true,
    );
  } finally {
    await f.db.close();
  }
});

test('merge into an existing unselected target keeps one deduplicated batch', async () => {
  const f = await fixture();
  try {
    await f.publish();
    await f.merge(
      { batches: ['A', 'B'], target: 'C', expectedRevision: 0 },
      f.admin,
    );
    const snapshot = await f.publish();
    assert.equal(snapshot.rows.length, 1);
    assert.equal(snapshot.rows[0].batch, 'C');
    assert.equal(snapshot.rows[0].ads, 1);
    assert.equal(snapshot.rows[0].products, 24);
  } finally {
    await f.db.close();
  }
});

test('failed merge rolls back data, identity map and summary marker together', async () => {
  const f = await fixture();
  try {
    const initial = await f.publish();
    f.fail();
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['A', 'B'], target: '失败', expectedRevision: 0 },
          f.admin,
        ),
      /synthetic rollback/,
    );
    assert.equal(
      (
        await f.pool.query(
          'SELECT data FROM research_keywords WHERE natural_key=$1',
          ['kA'],
        )
      ).rows[0].data.batch,
      'A',
    );
    assert.equal(
      (
        await f.pool.query(
          'SELECT value FROM workspace_documents WHERE name=$1',
          [BATCH_SETTINGS],
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await f.pool.query(
          "SELECT value FROM workspace_documents WHERE name='read:concept-monitor-version'",
        )
      ).rows[0].value.version,
      initial.snapshot.version,
    );
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['A', 'B'], target: ' '.repeat(20), expectedRevision: 0 },
          f.admin,
        ),
      /2～50/,
    );
    await assert.rejects(
      () =>
        f.merge(
          { batches: ['A', 'missing'], target: '目标', expectedRevision: 0 },
          f.admin,
        ),
      /不存在/,
    );
  } finally {
    await f.db.close();
  }
});

test('merge waits for the current index batch before writing and then completes once', async () => {
  const ready = Promise.withResolvers();
  const grant = Promise.withResolvers();
  let attempts = 0;
  let unlocks = 0;
  const f = await fixture({
    lock: async (_c, name, options) => {
      assert.equal(name, 'workspace-reads');
      assert.deepEqual(options, { waitMs: 90_000 });
      attempts++;
      ready.resolve();
      return grant.promise;
    },
    unlock: async () => { unlocks++; },
  });
  try {
    await f.publish();
    const pending = f.merge({ batches: ['A', 'B'], target: '目标', expectedRevision: 0 }, f.admin);
    await ready.promise;
    assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['kA'])).rows[0].data.batch, 'A');
    assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1', [BATCH_SETTINGS])).rows.length, 0);
    grant.resolve(true);
    assert.equal((await pending).revision, 1);
    assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['kA'])).rows[0].data.batch, '目标');
    assert.equal(attempts, 1);
    assert.equal(unlocks, 1);
  } finally {
    grant.resolve(false);
    await f.db.close();
  }
});

test('expired index wait leaves affiliations, audit and snapshot untouched', async () => {
  let unlocks = 0;
  const f = await fixture({lock: async () => false, unlock: async () => { unlocks++; }});
  try {
    const before = await f.publish();
    await assert.rejects(() => f.merge({ batches: ['A', 'B'], target: '目标', expectedRevision: 0 }, f.admin), /等待后台索引/);
    assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1', ['kA'])).rows[0].data.batch, 'A');
    assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1', [BATCH_SETTINGS])).rows.length, 0);
    assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1', ['read:concept-monitor-version'])).rows[0].value.version, before.snapshot.version);
    assert.equal(unlocks, 0);
  } finally {
    await f.db.close();
  }
});

test('background submission returns without taking index lock, deduplicates and commits result atomically', async () => {
 let attempts=0;
 const f=await fixture({lock:async()=>{attempts++;return true;}});
 try{
  await f.publish();
  const input={batches:['A','B'],target:'后台目标',expectedRevision:0,market:'US'};
  const accepted=await f.jobs.submit(input,f.admin);
  assert.equal(accepted.status,'queued');assert.equal(attempts,0);
  const duplicate=await f.jobs.submit({...input,batches:['B','A']},f.admin);
  assert.equal(duplicate.jobId,accepted.jobId);
  assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1',['kA'])).rows[0].data.batch,'A');
  const job=await f.loadJob(accepted.jobId);
  await f.jobs.run(job);
  const completed=await f.loadJob(job.id);
  assert.equal(completed.status,'completed');assert.equal(completed.checkpoint.mergeResult.target,'后台目标');
  assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1',['kA'])).rows[0].data.batch,'后台目标');
  const settings=(await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows[0].value;
  assert.equal(settings.history[0].jobId,job.id);assert.equal(settings.history[0].actor,f.admin.id);
  await f.jobs.run(job);
  assert.equal(attempts,1);
  const replay=await f.merge(input,f.admin,{jobId:job.id});
  assert.equal(replay.revision,1);
  assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows[0].value.history.length,1);
 }finally{await f.db.close();}
});
test('background merge retries an occupied index without changing data, survives restart and respects cancellation',async()=>{
 let available=false;
 const f=await fixture({lock:async()=>available});
 try{
  await f.publish();
  const accepted=await f.jobs.submit({batches:['A','B'],target:'后台目标',expectedRevision:0},f.admin);
  await f.jobs.run(await f.loadJob(accepted.jobId));
  let job=await f.loadJob(accepted.jobId);
  assert.equal(job.status,'queued');assert.equal(job.checkpoint.phase,'waiting_index');assert.ok(job.checkpoint.nextRunAt>Date.now());
  assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1',['kA'])).rows[0].data.batch,'A');
  await f.pool.query("UPDATE research_jobs SET cancelled=true,status='cancelled' WHERE id=$1",[job.id]);
  available=true;await f.jobs.run(job);
  assert.equal((await f.loadJob(job.id)).status,'cancelled');
  assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows.length,0);
 }finally{await f.db.close();}
});
test('background failure rolls back affiliations and stores visible error without external calls',async()=>{
 const f=await fixture();
 try{
  await f.publish();f.fail();
  const accepted=await f.jobs.submit({batches:['A','B'],target:'后台目标',expectedRevision:0},f.admin);
  await f.jobs.run(await f.loadJob(accepted.jobId));
  const job=await f.loadJob(accepted.jobId);assert.equal(job.status,'failed');assert.match(job.checkpoint.error,/synthetic rollback/);
  assert.equal((await f.pool.query('SELECT data FROM research_keywords WHERE natural_key=$1',['kA'])).rows[0].data.batch,'A');
  assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows.length,0);
 }finally{await f.db.close();}
});
test('cancel during index wait stops before beginning affiliation changes',async()=>{
 const ready=Promise.withResolvers();const grant=Promise.withResolvers();
 const f=await fixture({lock:async()=>{ready.resolve();return grant.promise;}});
 try{
  await f.publish();
  const accepted=await f.jobs.submit({batches:['A','B'],target:'后台目标',expectedRevision:0},f.admin);
  const pending=f.jobs.run(await f.loadJob(accepted.jobId));await ready.promise;
  await f.pool.query("UPDATE research_jobs SET cancelled=true,status='cancelled' WHERE id=$1",[accepted.jobId]);
  grant.resolve(true);await pending;
  assert.equal((await f.loadJob(accepted.jobId)).status,'cancelled');
  assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows.length,0);
 }finally{grant.resolve(false);await f.db.close();}
});
test('background submission checks permissions and validation without acquiring locks',async()=>{
 const f=await fixture({lock:async()=>assert.fail('submission acquired lock')});
 try{
  await assert.rejects(()=>f.jobs.submit({batches:['A','B'],target:'目标',expectedRevision:0},{role:'researcher'}),/admin/);
  await assert.rejects(()=>f.jobs.submit({batches:['A','A'],target:'目标',expectedRevision:0},f.admin),/两个不同/);
  assert.equal((await f.pool.query('SELECT id FROM research_jobs')).rows.length,0);
 }finally{await f.db.close();}
});

test('completed commit survives a lost response without a second merge or false failure', async () => {
 const f=await fixture();
 try {
  await f.publish();
  const input={batches:['A','B'],target:'目标',expectedRevision:0,requestId:'7e5c3404-890d-4d2f-921b-7a45bdd9271a'};
  const accepted=await f.jobs.submit(input,f.admin);
  const original=f.pool.query;let lost=false;
  f.pool.query=async(...args)=>{const result=await original(...args);if(args[0]==='COMMIT'&&!lost){lost=true;throw Object.assign(Error('lost commit reply'),{code:'ECONNRESET'});}return result;};
  await f.jobs.run(await f.loadJob(accepted.jobId));
  const job=await f.loadJob(accepted.jobId);
  assert.equal(lost,true);assert.equal(job.status,'completed');assert.equal(job.checkpoint.mergeResult.revision,1);
  assert.equal((await f.jobs.submit(input,f.admin)).status,'completed');
  await f.jobs.run(job);
  assert.equal((await f.pool.query('SELECT value FROM workspace_documents WHERE name=$1',[BATCH_SETTINGS])).rows[0].value.history.length,1);
 } finally {await f.db.close();}
});

test('stale queued merge reports conflict, repeat submission is truthful and new confirmation has its own task', async () => {
 const f=await fixture();
 try {
  await f.publish();
  const input={batches:['A','B'],target:'目标',expectedRevision:0,requestId:'2aa7fb39-eec7-47e7-a038-772f621988dd'};
  const accepted=await f.jobs.submit(input,f.admin);
  await f.merge({...input,target:'已合并'},f.admin);
  await f.jobs.run(await f.loadJob(accepted.jobId));
  const job=await f.loadJob(accepted.jobId);assert.equal(job.status,'failed');assert.match(job.checkpoint.error,/批次已发生变化/);
  await assert.rejects(()=>f.jobs.submit(input,f.admin),/已失败/);
  const next=await f.jobs.submit({...input,requestId:'62787081-dad2-43c4-9849-64b841a3e385'},f.admin);
  assert.notEqual(next.jobId,accepted.jobId);assert.equal(next.status,'queued');
 } finally {await f.db.close();}
});

test('batch task projection displays waiting, result, failure and cancellation without resource lookups', async () => {
 const input={kind:'collection_batch_merge',market:'ALL',batches:['A','B'],target:'目标'};
 const base={id:'qa-batch-task',input,status:'queued',created_at:new Date(),checkpoint:{submittedAt:'2026-11-16T00:00:00Z',logs:[]}};
 for(const [status,checkpoint,expected] of [
  ['queued',{},/已排队/],['running',{phase:'waiting_index'},/等待索引/],
  ['completed',{mergeResult:{target:'目标'}},/合并完成/],['failed',{error:'批次已发生变化'},/合并失败/],['cancelled',{},/已取消/],
 ]) {
  const job={...base,status,checkpoint:{...base.checkpoint,...checkpoint}};
  const tasks=projectJobTasks(job,j=>[batchMergeTask(j)]);
  assert.equal(tasks.length,1);assert.equal(tasks[0].readOnly,undefined);
  const [task]=await decorateTaskContexts(tasks,[job],{query:()=>assert.fail('unexpected resource lookup')},{detail:true});
  assert.equal(task.context.objectCount,2);assert.equal(task.context.objects[0].label,'A');assert.equal(task.context.destination,undefined);
  const overview=taskOverview(job,task);assert.match(overview.outcome,expected);assert.equal(overview.total,2);
  if(status==='completed')assert.equal(overview.percent,100);
  if(status==='failed')assert.match(overview.reason,/批次已发生变化/);
 }
});
