/* oxlint-disable vitest/no-import-node-test -- Server regressions use the Node test runner. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { configuredJson } from './discovery-ai.mjs';
import { platformProductRequest } from './platform-products-provider.mjs';
import { taskCollections, taskOverview } from './task-overview.mjs';
import { decorateTaskStopEvidence } from './task-stop-evidence.mjs';
import { checkpointStopReason, safeTaskError } from './task-stop-reason.mjs';

test('saved source errors and failed/cancelled AI children explain every selected stopped parent', async () => {
  const db = new PGlite();
  await db.exec(
    'CREATE TABLE research_jobs(id text PRIMARY KEY,status text,cancelled boolean DEFAULT false,input jsonb,checkpoint jsonb); CREATE TABLE research_requests(job_id text,step text,status text,error text)',
  );
  const product = {
    id: 'product',
    status: 'partial',
    input: { kind: 'platform_products' },
    checkpoint: {},
  };
  const ads = {
    id: 'ads',
    status: 'completed',
    collection_status: 'completed',
    input: {
      kind: 'ads',
      sourceAnalysis: { total: 3, failed: 2, cancelled: 1 },
    },
    checkpoint: {},
  };
  const tasks = [product, ads].map((job) => ({
    cloudJobId: job.id,
    status: 'partial',
    steps: [],
    overview: { ...taskOverview(job, {}), status: 'partial' },
  }));
  try {
    await db.query(
      "INSERT INTO research_requests VALUES ('product','platform:0','failed','Sorftime 返回格式无法识别'),('product','platform:1','started',NULL)",
    );
    for (const [id, status, logs] of [
      ['one', 'partial', ['中文译文未通过校验']],
      ['two', 'failed', ['中文译文未通过校验']],
      ['three', 'cancelled', []],
    ])
      await db.query('INSERT INTO research_jobs VALUES($1,$2,false,$3,$4)', [
        id,
        status,
        { kind: 'source_fields', parentJobIds: ['ads'] },
        { logs },
      ]);
    const before = JSON.stringify(tasks);
    const result = await decorateTaskStopEvidence(
      tasks,
      [product, ads],
      db,
      (pg) => pg,
    );
    assert.match(result[0].overview.reason, /platform:0.*返回格式无法识别/);
    assert.match(result[0].overview.reason, /platform:1.*结果未确认/);
    assert.match(
      result[1].overview.reason,
      /AI分析失败 2项：中文译文未通过校验/,
    );
    assert.match(result[1].overview.reason, /AI分析取消 1项/);
    assert.doesNotMatch(result[1].overview.reason, /未保存具体错误/);
    assert.equal(JSON.stringify(tasks), before);
    assert.equal(
      (await db.query('SELECT status FROM research_requests ORDER BY step'))
        .rows[1].status,
      'started',
    );
  } finally {
    await db.close();
  }
});

test('checkpoint failure formats remain concrete, including parser, network, coverage and numeric failure counts', () => {
  for (const message of [
    'Sorftime 返回格式无法识别',
    'HTTP 502 来源错误',
    'ECONNRESET',
    '评论部分覆盖：后台来源请求保护，断点已保留',
  ])
    assert.equal(
      checkpointStopReason({ failures: 1, logs: [message] }),
      message,
    );
  const job = {
    status: 'partial',
    input: { kind: 'platform_products' },
    checkpoint: { unknownCharges: 1, logs: ['Sorftime 返回格式无法识别'] },
  };
  assert.match(taskOverview(job, {}).reason, /返回格式无法识别.*未自动重放/);
  const noHistory = taskOverview(
    { status: 'partial', input: { expansionOnly: true }, checkpoint: {} },
    {
      progress: {
        discovered: 1,
        discoveryDone: 0,
        discoveryTotal: 3,
        semrushEnabled: false,
      },
    },
  );
  assert.match(noHistory.reason, /历史记录未保存具体错误/);
  assert.match(noHistory.reason, /发现组合 0\/3/);
});

test('individual execution rows retain the exact safe error and do not invent a reason for empty records', () => {
  const job = {
    status: 'partial',
    input: { records: [{ term: 'seed' }] },
    checkpoint: {},
  };
  const [row] = taskCollections(job, {}, [
    {
      step: 'platform:0',
      status: 'failed',
      error: 'Sorftime HTTP 429: quota limited',
    },
  ]);
  assert.match(row.executions[0].message, /HTTP 429: quota limited/);
  assert.doesNotMatch(
    safeTaskError(
      'https://mcp.sorftime.com/token-value?api_key=secret token=secret Bearer private-token',
    ),
    /token-value|=secret|private-token/,
  );
});

test('Sorftime parser failures retain a redacted response preview without leaking the token', async () => {
  const token = 'synthetic-private-token';
  await assert.rejects(
    platformProductRequest(
      {
        provider: 'sorftime',
        op: 'search',
        term: 'elahring',
        market: 'US',
        page: 1,
      },
      {
        cache: false,
        collectorEnv: async () => ({}),
        readSorftimeToken: async () => token,
        connectSorftime: async () => ({
          tools: [
            {
              name: 'product_search_from_name',
              inputSchema: {
                properties: {
                  name: {},
                  query_type: {},
                  page: {},
                  amz_site: { enum: ['US'] },
                },
              },
            },
          ],
          rpc: async () => ({
            content: [
              {
                type: 'text',
                text: `Unrecognized response ${token} https://mcp.sorftime.com/${token}`,
              },
            ],
          }),
        }),
      },
    ),
    (error) => {
      assert.match(error.message, /格式无法识别/);
      assert.ok(error.mcpPreview);
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private-token/);
      return true;
    },
  );
});

test('invalid AI JSON preserves the returned preview and reports its parsing failure without another call', async () => {
  let calls = 0;
  await assert.rejects(
    configuredJson(
      'synthetic',
      {},
      {
        pool: { query: async () => ({ rows: [] }) },
        config: { model: 'synthetic' },
        postModel: async () => {
          calls++;
          return { choices: [{ message: { content: 'not valid JSON' } }] };
        },
      },
    ),
    (error) => {
      assert.match(error.message, /JSON格式无效/);
      assert.equal(error.rawPreview.preview, 'not valid JSON');
      return true;
    },
  );
  assert.equal(calls, 1);
});
