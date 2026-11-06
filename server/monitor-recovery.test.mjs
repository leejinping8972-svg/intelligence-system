import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { configuredJson } from './discovery-ai.mjs';
import { jobProgress } from './job-progress.mjs';
import { mcpPayload, reportRows } from './semrush-reports.mjs';
import { taskOverview } from './task-overview.mjs';
import {
  createDirtyBatchReader,
  isolateProjectionWrites,
} from './workspace-projection-writes.mjs';

test('one list per transaction, with rotation even when an earlier list keeps failing', async () => {
  const queue = [
    { kind: 'business', source_key: 'business:ads:bad', revision: 1 },
    { kind: 'keywords', source_key: 'keyword', revision: 1 },
    { kind: 'business', source_key: 'business:products:product', revision: 1 },
    { kind: 'business', source_key: 'business:sites:site', revision: 1 },
  ];
  const connection = {
    query: async (_statement, params) => ({
      rows:
        params.length === 0
          ? queue.filter((r) => r.kind === 'keywords')
          : params.length === 1
            ? queue.filter((r) =>
                r.source_key.startsWith(params[0].slice(0, -1)),
              )
            : [],
    }),
  };
  const read = createDirtyBatchReader();
  const seen = [];
  for (let i = 0; i < 8; i++) seen.push((await read(connection))[0].source_key);
  assert.deepEqual(seen.slice(0, 4), [
    'keyword',
    'business:products:product',
    'business:sites:site',
    'business:ads:bad',
  ]);
  assert.deepEqual(
    seen.slice(4),
    seen.slice(0, 4),
    'an unremoved bad row does not starve the other lists',
  );
});

test('SQL row failure rolls back only that row and retains its previous index', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE TABLE workspace_read_rows(collection text,id text,source_key text,payload varchar(12),PRIMARY KEY(collection,id)); CREATE TABLE workspace_read_links(collection text,id text); INSERT INTO workspace_read_rows VALUES('ads','bad','bad','old');",
    );
    const projected = [
      {
        collection: 'ads',
        sourceKey: 'bad',
        id: 'bad',
        value: 'too long for this column',
      },
      { collection: 'ads', sourceKey: 'good', id: 'good', value: 'new' },
    ];
    const failed = [];
    const write = async (connection, rows) => {
      for (const row of rows)
        await connection.query(
          'INSERT INTO workspace_read_rows VALUES($1,$2,$3,$4)',
          [row.collection, row.id, row.sourceKey, row.value],
        );
    };
    await db.query('BEGIN');
    const succeeded = await isolateProjectionWrites(
      db,
      projected,
      projected.map((p) => [p.collection, p.sourceKey]),
      write,
      async ([, key], error) => failed.push({ key, code: error.code }),
    );
    await db.query('COMMIT');
    assert.deepEqual(succeeded, [['ads', 'good']]);
    assert.deepEqual(failed, [{ key: 'bad', code: '22001' }]);
    assert.deepEqual(
      (await db.query('SELECT id,payload FROM workspace_read_rows ORDER BY id'))
        .rows,
      [
        { id: 'bad', payload: 'old' },
        { id: 'good', payload: 'new' },
      ],
    );
  } finally {
    await db.close();
  }
});

test('discovery and watch summaries show saved failures, including a fully attempted unsuccessful watch', () => {
  const discovery = taskOverview(
    {
      input: { kind: 'discovery_monitor' },
      status: 'partial',
      checkpoint: {
        failures: ['amazon: 采集翻译未包含中文，原文已保留'],
        logs: ['来源0条'],
      },
    },
    {},
  );
  assert.equal(discovery.failed, 1);
  assert.match(discovery.reason, /翻译未包含中文/);
  const watch = taskOverview(
    {
      input: { kind: 'product_watch' },
      status: 'partial',
      checkpoint: {
        total: 19,
        index: 19,
        succeeded: 0,
        failures: Array.from(
          { length: 19 },
          (_, i) => `p${i}：此前翻译结果尚未确认`,
        ),
        logs: [],
      },
    },
    {},
  );
  assert.equal(watch.failed, 19);
  assert.equal(watch.succeeded, 0);
  assert.match(watch.reason, /尚未确认/);
});

test('advertising summary recognizes latest unconfirmed translation and English lock timeout', () => {
  const job = {
    input: { kind: 'ads' },
    status: 'partial',
    checkpoint: {
      failures: 2,
      logs: [
        'Lock wait timeout exceeded; try restarting transaction',
        '此前翻译结果尚未确认，已保留原始响应，不自动重复调用模型',
      ],
    },
  };
  assert.match(taskOverview(job, {}).reason, /尚未确认/);
  job.checkpoint.logs.pop();
  assert.match(taskOverview(job, {}).reason, /数据库写入等待超时/);
});

test('current Semrush block evidence wins over historical quota errors', () => {
  const job = {
    input: {
      expansionOnly: true,
      sources: ['semrush'],
      seeds: [],
      markets: ['US'],
    },
    status: 'partial',
    checkpoint: {
      logs: ['ERROR 132 :: API UNITS BALANCE IS ZERO'],
      semBlocked: '已停止',
      semBlockedError: 'Semrush 报告未返回可识别的数据行',
      keywords: [],
    },
  };
  assert.equal(
    jobProgress(job).metricBlockReason,
    job.checkpoint.semBlockedError,
  );
  delete job.checkpoint.semBlockedError;
  delete job.checkpoint.semBlocked;
  assert.equal(
    jobProgress(job).metricBlockReason,
    '',
    'a historical quota response does not assert the current balance',
  );
  job.checkpoint.semBlockedError = 'ERROR 132 :: API UNITS BALANCE IS ZERO';
  assert.match(jobProgress(job).metricBlockReason, /本次请求/);
});

test('explicit Semrush no-data responses stay distinct from malformed or unauthorized reports', () => {
  assert.deepEqual(
    reportRows(
      mcpPayload({
        isError: true,
        content: [{ type: 'text', text: 'ERROR 50 :: NOTHING FOUND' }],
      }),
    ),
    [],
  );
  assert.deepEqual(
    reportRows({ error: { code: 50, message: 'NO DATA FOUND' } }),
    [],
  );
  assert.deepEqual(reportRows({ rows: [{ Keyword: 'example' }] }), [
    { Keyword: 'example' },
  ]);
  assert.throws(
    () => reportRows({ data: null, credential: 'do-not-store-this-value' }),
    (error) =>
      error.code === 'SEMRUSH_REPORT_FORMAT' &&
      !error.mcpPreview.includes('do-not-store-this-value'),
  );
  assert.throws(
    () =>
      mcpPayload({
        isError: true,
        content: [
          { type: 'text', text: 'ERROR 132 :: API UNITS BALANCE IS ZERO' },
        ],
      }),
    /ERROR 132/,
  );
  assert.throws(
    () =>
      mcpPayload({
        isError: true,
        content: [{ type: 'text', text: 'HTTP 403' }],
      }),
    /403/,
  );
});

test('raw model response is persisted before JSON parsing and before rejecting truncated output', async () => {
  const saved = [];
  const options = {
    pool: { query: async () => ({ rows: [] }) },
    config: { model: 'synthetic' },
    onResponse: async (raw, metadata) => saved.push({ raw, metadata }),
    postModel: async () => ({
      choices: [
        { message: { content: 'invalid JSON' }, finish_reason: 'stop' },
      ],
      usage: { total_tokens: 1 },
    }),
  };
  await assert.rejects(
    configuredJson('synthetic prompt', {}, options),
    SyntaxError,
  );
  assert.equal(saved[0].raw, 'invalid JSON');
  options.postModel = async () => ({
    choices: [{ message: { content: '{"items":[' }, finish_reason: 'length' }],
  });
  await assert.rejects(
    configuredJson('synthetic prompt', {}, options),
    /token上限/,
  );
  assert.equal(saved[1].raw, '{"items":[');
  assert.equal(saved[1].metadata.finishReason, 'length');
});
