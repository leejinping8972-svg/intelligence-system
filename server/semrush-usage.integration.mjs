import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import { putDocument } from './database.mjs';
import { semrushUsage } from './semrush-usage.mjs';

// Called by the explicitly isolated PostgreSQL/MySQL monitor integration only.
export async function verifySemrushUsage(connection) {
  const options = { currentKeyId: 'usage-current-key', keyConfigured: true };
  const before = await semrushUsage(options, connection);
  const jobId = randomUUID();
  const input = {
    kind: 'platform_products',
    providers: ['semrush', 'sorftime'],
  };
  const checkpoint = {
    work: [
      { provider: 'semrush' },
      { provider: 'sorftime' },
      { provider: 'semrush' },
    ],
  };
  await connection.query(
    'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
    [jobId, randomUUID(), input, checkpoint],
  );
  const records = [
    [
      'sem-metric:0',
      'done',
      { apiUnits: 10, semrushKeyId: options.currentKeyId },
    ],
    ['sem-metric:1', 'done', { apiUnits: 0, cached: true }],
    ['sem-metric:2', 'failed', { semrushKeyId: options.currentKeyId }],
    ['domain:0', 'done', { apiUnits: 20, semrushKeyId: options.currentKeyId }],
    [
      'site-score:qa',
      'done',
      { apiUnits: 5, semrushKeyId: options.currentKeyId },
    ],
    [
      'platform:0',
      'done',
      { apiUnits: 30, semrushKeyId: options.currentKeyId },
    ],
    ['platform:1', 'done', { apiUnits: 5000 }],
    ['platform:2', 'done', { semrushKeyId: options.currentKeyId }],
    [
      'sem-discover:0',
      'done',
      { apiUnits: 40, semrushKeyId: options.currentKeyId },
    ],
    [
      'sem-discover:1',
      'done',
      {
        apiUnits: 50,
        semrushUnknownCharges: 0,
        semrushKeyId: options.currentKeyId,
      },
    ],
    [
      'sem-discover:2',
      'done',
      {
        apiUnits: 0,
        semrushUnknownCharges: 1,
        semrushKeyId: options.currentKeyId,
      },
    ],
    ['ad:0', 'done', { apiUnits: 9999 }],
  ];
  for (const [step, status, response] of records)
    await connection.query(
      'INSERT INTO research_requests(job_id,step,status,response) VALUES($1,$2,$3,$4)',
      [jobId, step, status, response],
    );
  await putDocument(
    'workspace_documents',
    `competitor:request:usage:${jobId}`,
    {
      status: 'completed',
      at: new Date().toISOString(),
      step: 'semrush:qa',
      response: { apiUnits: 60, semrushKeyId: options.currentKeyId },
    },
    false,
    connection,
  );
  const after = await semrushUsage(options, connection);
  assert.equal(after.confirmedUnits - before.confirmedUnits, 215);
  assert.equal(after.cachedRecords - before.cachedRecords, 1);
  assert.equal(after.unknownRecords - before.unknownRecords, 4);
  assert.equal(
    after.breakdown.find((g) => g.id === 'products').confirmedUnits -
      before.breakdown.find((g) => g.id === 'products').confirmedUnits,
    30,
  );
  const repeated = await semrushUsage(options, connection);
  assert.deepEqual({ ...repeated, checkedAt: after.checkedAt }, after);
  // oxlint-disable-next-line no-console -- Isolated integration proof, no credentials.
  console.log(
    'Semrush usage SQL integration passed: original journal sums, mixed providers, cache exclusion, unknown and legacy expansion gaps; no external calls.',
  );
}
