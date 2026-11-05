import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { PGlite } from '@electric-sql/pglite';

import { pool, putDocument } from './database.mjs';
import { prepareSemrushSummary, selectSemrushSummary, semrushUsage } from './semrush-usage.mjs';
import { prepareUsageSummary, summarizeUsage } from './source-usage-domain.mjs';
import { encodeUsageSnapshot } from './source-usage-snapshot.mjs';
import { markUsageChanged, USAGE_DIRTY_NAME, USAGE_SUMMARY_NAME } from './usage-changes.mjs';
import { createSavedUsageReader, readSavedSourceUsage } from './usage-summary-store.mjs';
import { buildUsageSummary, createUsageSummaryWorker, updateUsageSummary } from './usage-summary-worker.mjs';

const stamp = '2026-11-05T10:00:00.000Z';
const event = (id, amount = 1) => ({ id, sourceId: 'semrush', task: 'fixture', jobId: 'fixture', step: `metrics:${id}`, at: stamp, day: '2026-11-05', billing: 'confirmed', amount });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
async function savedValue(events = [event('a')]) {
  const prepared = prepareUsageSummary(events);
  return { ...await encodeUsageSnapshot({ events: prepared.events, checkedAt: stamp }), summaryVersion: 1, aggregate: prepared.aggregate, semrush: prepareSemrushSummary([], []) };
}

test('cold and repeated page/refresh reads load saved totals once, never have a journal reader, and use new revisions', async () => {
  let loads = 0; let revision = 1;
  let value = await savedValue();
  const reader = createSavedUsageReader({ revision: async () => revision, load: async () => { loads++; return value; } });
  const connection = {};
  const [a, b] = await Promise.all([reader(connection, { events: true }), reader(connection, { events: true })]);
  assert.equal(a.events, b.events);
  // Distinct saved aggregates prove the read path does not recalculate from events.
  value.aggregate.sources[0][1].cumulative = 77;
  const result = summarizeUsage(a.events, {}, {}, {}, new Date(stamp));
  assert.equal(result.sources[0].cumulative, 77);
  assert.equal(result.sources[0].today, 1);
  await reader(connection, { events: true, refresh: true });
  assert.equal(loads, 1);
  value = await savedValue([event('b', 3)]);
  revision++;
  assert.equal((await reader(connection, { events: true })).events[0].id, 'b');
  assert.equal(loads, 2);
  const restarted = createSavedUsageReader({ revision: async () => revision, load: async () => value });
  assert.equal((await restarted(connection, { events: true })).checkedAt, stamp);
});

test('missing or damaged saved data returns an honest error without a rebuild or false zero', async () => {
  const read = createSavedUsageReader({ revision: async () => 1, load: async () => undefined });
  await assert.rejects(read({}), /尚未保存/);
  const value = { ...await savedValue(), body: 'damaged' };
  const damaged = createSavedUsageReader({ revision: async () => 1, load: async () => value });
  // Semrush only needs its precomputed header, never decodes event details.
  assert.equal((await damaged({})).semrush.cachedRecords, 0);
  await assert.rejects(damaged({}, { events: true }), /暂不可用/);
});

test('saved per-day totals retain real zero, partial charges, undated history and manual quotas across midnight', async () => {
  const value = await savedValue([
    event('zero', 0),
    { ...event('unknown'), amount: null, billing: 'unknown' },
    { ...event('partial', 7), billing: 'partial' },
    { ...event('cached', 999), billing: 'cached' },
    { ...event('old', 4), day: null, at: null },
  ]);
  const read = createSavedUsageReader({ revision: async () => 1, load: async () => value });
  const snapshot = await read({}, { events: true });
  const config = { semrush: { manual: { remaining: 0, total: 20 } } };
  const before = summarizeUsage(snapshot.events, {}, config, {}, new Date('2026-11-05T15:59:59Z'));
  const after = summarizeUsage(snapshot.events, {}, config, {}, new Date('2026-11-05T16:00:00Z'));
  assert.equal(before.sources[0].today, 7);
  assert.equal(before.sources[0].cumulative, 11);
  assert.equal(before.sources[0].unknown, 2);
  assert.equal(before.sources[0].quota.remaining, 0);
  assert.equal(after.sources[0].today, 0);
  assert.equal(after.sources[0].cumulative, 11);
  assert.equal(after.undated, 1);
});

function workerIO() {
  const state = { dirty: '1', saved: null };
  let held = false;
  const io = {
    connect: async () => ({ release() {} }),
    lock: async () => { if (held) return false; held = true; return true; },
    unlock: async () => { held = false; },
    state: async () => ({ ...state }),
    build: async () => savedValue(),
    save: async (value) => { state.saved = value; },
  };
  return { io, state };
}

test('cross-process lease and same-process batching prevent concurrent builds; changes during a build survive and replayed completions do not double count', async () => {
  const { io, state } = workerIO();
  const gate = deferred();
  let builds = 0;
  io.build = async () => { builds++; await gate.promise; return savedValue(); };
  const first = createUsageSummaryWorker(io);
  const otherProcess = createUsageSummaryWorker(io);
  const running = first();
  assert.equal(first(), running);
  await setImmediate();
  assert.equal(await otherProcess(), false);
  state.dirty = '2';
  gate.resolve();
  await running;
  assert.equal(state.saved.generation, '1');
  await first();
  assert.equal(state.saved.generation, '2');
  assert.equal(builds, 2);
  assert.equal(await first(), false);
  state.dirty = '3';
  await first();
  assert.equal(state.saved.aggregate.sources[0][1].cumulative, 1);
});

test('failed persistence retains the previous snapshot, retries without losing dirty updates, and restart recovers a missed marker', async () => {
  const { io, state } = workerIO();
  const update = createUsageSummaryWorker(io);
  await update();
  const previous = state.saved;
  const save = io.save;
  io.save = async () => { throw new Error('synthetic disk error'); };
  state.dirty = '2';
  await assert.rejects(update(), /disk error/);
  assert.equal(state.saved, previous);
  io.save = save;
  assert.equal(await update(), true);
  assert.equal(state.saved.generation, '2');
  const restart = createUsageSummaryWorker(io);
  assert.equal(await restart(), true);
});

test('accounting marker failure cannot reject a paid result', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await markUsageChanged({ query: async () => { throw new Error('synthetic unavailable'); } }), false);
  } finally { console.warn = warn; }
});

test('isolated database builds saved summaries after writes, while both pages read only saved documents', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE workspace_documents(name text PRIMARY KEY,value jsonb,revision integer NOT NULL DEFAULT 1);
      CREATE TABLE research_jobs(id text PRIMARY KEY,input jsonb,checkpoint jsonb,created_at timestamptz);
      CREATE TABLE research_requests(job_id text,step text,status text,paid_allowance integer,response jsonb);`);
    await db.query('INSERT INTO research_jobs VALUES($1,$2,$3,$4)', ['j1', { kind: 'keyword_research', market: 'US' }, {}, stamp]);
    await db.query('INSERT INTO research_requests VALUES($1,$2,$3,$4,$5)', ['j1', 'metrics:0', 'done', 0, { apiUnits: 20, semrushKeyId: 'key-one', requestUsage: { startedAt: stamp } }]);
    await putDocument('workspace_documents', 'competitor:request:fixture', { status: 'completed', step: 'semrush:fixture', at: stamp, response: { apiUnits: 5, semrushKeyId: 'key-two' } }, false, db);
    assert.equal((await db.query('SELECT revision FROM workspace_documents WHERE name=$1', [USAGE_DIRTY_NAME])).rows[0].revision, 1);
    const value = await buildUsageSummary(db);
    await putDocument('workspace_documents', USAGE_SUMMARY_NAME, { ...value, summaryVersion: 1, generation: '1' }, false, db);
    const statements = [];
    const connection = { query: (sql, params) => { statements.push(sql); return db.query(sql, params); } };
    const semrush = await semrushUsage({ currentKeyId: 'key-one', keyConfigured: true }, connection);
    assert.equal(semrush.confirmedUnits, 20);
    assert.equal(semrush.otherKeys.confirmedUnits, 5);
    const snapshot = await readSavedSourceUsage(connection);
    const source = summarizeUsage(snapshot.events, {}, {}, {}, new Date(stamp)).sources[0];
    assert.equal(source.cumulative, 25);
    assert.equal(source.today, 25);
    assert(statements.every((sql) => /^SELECT .* FROM workspace_documents WHERE name=\$1$/.test(sql)));
    const rotated = selectSemrushSummary(value.semrush, value.checkedAt, { currentKeyId: 'key-two', keyConfigured: true });
    assert.equal(rotated.confirmedUnits, 5);
    await putDocument('workspace_documents', 'competitor:request:fixture', { status: 'completed', step: 'semrush:fixture', at: stamp, response: { apiUnits: 5, semrushKeyId: 'key-two' } }, false, db);
    const rebuilt = await buildUsageSummary(db);
    assert.equal(selectSemrushSummary(rebuilt.semrush, rebuilt.checkedAt, { currentKeyId: 'key-one' }).otherKeys.confirmedUnits, 5);
    assert.equal((await db.query('SELECT revision FROM workspace_documents WHERE name=$1', [USAGE_DIRTY_NAME])).rows[0].revision, 2);
    // Exercise the actual SQL state/lease adapter too. Only advisory-lock calls
    // are emulated; all projections and durable revision writes run in PGlite.
    const originalConnect = pool.connect;
    let scans = 0;
    pool.connect = async () => ({
      release() {},
      query: (statement, params) => {
        if (statement.includes('pg_try_advisory_lock')) {
          assert.equal(params[0], 89_761_045);
          return { rows: [{ locked: true }] };
        }
        if (statement.includes('pg_advisory_unlock')) return { rows: [] };
        if (statement.includes('FROM research_requests')) scans++;
        return db.query(statement, params);
      },
    });
    try {
      assert.equal(await updateUsageSummary(), true);
      const priorScans = scans;
      assert.equal(await updateUsageSummary(), false);
      assert.equal(scans, priorScans);
    } finally { pool.connect = originalConnect; }
  } finally { await db.close(); }
});
