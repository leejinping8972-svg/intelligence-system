import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import {
  decodeUsageSnapshot,
  encodeUsageSnapshot,
} from './source-usage-snapshot.mjs';
import { prepareUsageSummary } from './source-usage-domain.mjs';
import { sourceUsageAction } from './source-usage.mjs';
import { createSavedUsageReader } from './usage-summary-store.mjs';

const event = (id, amount = 1) => ({
  id,
  sourceId: 'sorftime',
  amount,
  billing: 'confirmed',
  at: new Date().toISOString(),
  day: new Date().toISOString().slice(0, 10),
  jobId: 'fixture',
  task: '商品研究',
  step: 'detail',
  market: 'US',
  request: {
    startedAt: new Date(Date.now() - 1000).toISOString(),
    host: 'fixture.test',
    path: '/product',
    outcome: 'success',
  },
});

test('saved codec preserves real zero and unknown charges, rejecting corruption and future dates', async () => {
  const initial = { events: [event('zero', 0), { ...event('unknown'), amount: null, billing: 'unknown' }], checkedAt: new Date().toISOString() };
  assert.deepEqual(await decodeUsageSnapshot(await encodeUsageSnapshot(initial)), initial);
  assert.equal(await decodeUsageSnapshot({ version: 1, codec: 'deflate-json-v1', body: 'broken', checkedAt: initial.checkedAt }), undefined);
  assert.equal(await decodeUsageSnapshot(await encodeUsageSnapshot({ ...initial, checkedAt: new Date(Date.now() + 600_000).toISOString() })), undefined);
});

test('history above 32 MiB reads both legacy and chunked saved totals and request logs without a rebuild', async () => {
  const base = event('fixture');
  base.request.path = `/fixture/${'中文\\"/'.repeat(120)}`;
  const events = Array.from({ length: 28_000 }, (_, index) => ({
    ...base,
    id: `fixture-${index}`,
    amount: index === 0 ? 0 : index === 1 ? null : 2,
    billing: index === 1 ? 'unknown' : 'confirmed',
  }));
  const prepared = prepareUsageSummary(events);
  const raw = Buffer.from(JSON.stringify(prepared.events));
  assert(raw.length > 32 * 1024 * 1024);
  const compressed = deflateRawSync(raw);
  assert.throws(() => inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 }), { code: 'ERR_BUFFER_TOO_LARGE' });
  const checkedAt = new Date().toISOString();
  const legacy = { version: 1, codec: 'deflate-json-v1', body: compressed.toString('base64'), checkedAt };
  const chunked = await encodeUsageSnapshot({ events: prepared.events, checkedAt });
  assert.equal(chunked.codec, 'deflate-json-chunks-v1');
  assert(chunked.chunks.length > 8);
  assert(chunked.chunks.every(chunk => chunk.bytes <= 4 * 1024 * 1024));
  for (const encoded of [legacy, chunked]) {
    let loads = 0;
    const read = createSavedUsageReader({
      revision: async () => 1,
      load: async () => { loads++; return { ...encoded, summaryVersion: 1, aggregate: prepared.aggregate, semrush: {} }; },
    });
    const connection = { query: async () => ({ rows: [] }) };
    const io = { pool: connection, readSnapshot: db => read(db, { events: true }), credentialStatus: async () => ({}) };
    const usage = await sourceUsageAction({ action: 'server_source_usage' }, { role: 'admin' }, io);
    const sorftime = usage.sources.find(source => source.id === 'sorftime');
    assert.equal(sorftime.records, events.length);
    assert.equal(sorftime.cumulative, (events.length - 2) * 2);
    assert.equal(sorftime.unknown, 1);
    const log = await sourceUsageAction({ action: 'server_source_request_log' }, { role: 'admin' }, io);
    assert.equal(log.total, events.length);
    assert.equal(loads, 1);
    const restored = await read(connection, { events: true });
    assert.equal(restored.events[0].id, prepared.events[0].id);
    assert.equal(restored.events.at(-1).id, prepared.events.at(-1).id);
    assert.equal(restored.events[0].request.path, base.request.path);
    assert.equal(restored.events.find(row => row.id === 'fixture-0').amount, 0);
  }
});

test('chunk corruption, omissions, reordering and inconsistent metadata reject the whole snapshot', async () => {
  const saved = await encodeUsageSnapshot({ events: [event('a'), event('b')], checkedAt: new Date().toISOString() });
  const second = { ...saved.chunks[0], index: 1 };
  const doubled = { ...saved, count: 4, chunks: [saved.chunks[0], second] };
  assert.equal((await decodeUsageSnapshot(doubled)).events.length, 4);
  const invalid = [
    { ...saved, count: 3 },
    { ...saved, chunks: [] },
    { ...doubled, chunks: [second, saved.chunks[0]] },
    ...[
      { body: 'broken' }, { bytes: saved.chunks[0].bytes + 1 },
      { bytes: 4 * 1024 * 1024 + 1 }, { count: 1 }, { index: 1 },
    ].map(change => ({ ...saved, chunks: [{ ...saved.chunks[0], ...change }] })),
  ];
  for (const value of invalid) assert.equal(await decodeUsageSnapshot(value), undefined);
  const empty = { events: [], checkedAt: saved.checkedAt };
  assert.deepEqual(await decodeUsageSnapshot(await encodeUsageSnapshot(empty)), empty);
  await assert.rejects(encodeUsageSnapshot({ ...empty, events: [{ id: 'missing-source' }] }), /Invalid usage/);
  await assert.rejects(encodeUsageSnapshot({ ...empty, events: [{ ...event('huge'), task: 'x'.repeat(4 * 1024 * 1024) }] }), /chunk size/);
});

test('usage and request log endpoints reuse one complete snapshot and log filters search beyond the former 5000 row cap', async () => {
  const events = Array.from({ length: 5010 }, (_, i) => ({
    ...event(String(i)),
    task: i === 5009 ? 'rare task' : 'common task',
  }));
  const checkedAt = new Date(Date.now() - 60_000).toISOString();
  const io = {
    pool: { query: async () => ({ rows: [] }) },
    credentialStatus: async () => ({}),
    readSnapshot: async () => ({ events, checkedAt, refreshing: true }),
  };
  const admin = { role: 'admin' };
  const usage = await sourceUsageAction(
    { action: 'server_source_usage' },
    admin,
    io,
  );
  const log = await sourceUsageAction(
    { action: 'server_source_request_log', query: 'rare task' },
    admin,
    io,
  );
  assert.equal(usage.sources.find((s) => s.id === 'sorftime').records, 5010);
  assert.equal(log.total, 1);
  assert.equal(log.entries[0].task, 'rare task');
  assert.equal(log.truncated, false);
  assert.equal(usage.checkedAt, checkedAt);
  assert.equal(log.checkedAt, checkedAt);
  assert.equal(usage.refreshing, true);
  assert.equal(log.refreshing, true);
});
