import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import { stableId } from './discovery-monitor-domain.mjs';
import { withFormulaIntelligence } from './formula-intelligence.mjs';
import {
  pendingSourceFields,
  sourceFieldSample,
} from './source-field-domain.mjs';
import { collect, saveCheckpoint } from './store.mjs';

export async function queueSourceFields(
  kind,
  value,
  connection = pool,
  requestKey = '',
) {
  if (value.fieldAnalysis?.status !== 'pending') return;
  const sample = {
    ...sourceFieldSample(kind, value),
    sources: value.fieldAnalysis.sources,
    fingerprint: value.fieldAnalysis.fingerprint,
  };
  const id = stableId(
    `source-fields-v1|${kind}|${value.id}|${sample.fingerprint}|${requestKey}`,
  );
  if (
    (
      await connection.query(
        'SELECT id FROM research_jobs WHERE request_id=$1',
        [id],
      )
    ).rows.length
  )
    return id;
  await connection.query(
    sql(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING',
      'INSERT IGNORE INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
    ),
    [
      id,
      id,
      {
        kind: 'source_fields',
        targetKind: kind,
        targetId: value.id,
        market: value.market,
        markets: [value.market],
        seeds: [],
        sample,
      },
      {
        submittedAt: new Date().toISOString(),
        logs: ['来源资料已保存，等待AI字段分析'],
      },
    ],
  );
  return id;
}
export async function runSourceFields(job, overrides = {}) {
  const io = { pool, collect, saveCheckpoint, putDocument, ...overrides };
  const cp = { ...job.checkpoint, logs: [...(job.checkpoint.logs || [])] };
  try {
    if (job.cancelled) return;
    cp.calls = 1;
    const result = await io.collect(job, 'field-analysis', {
      sources: ['field_analysis'],
      sample: job.input.sample,
    });
    const c = await io.pool.connect();
    try {
      await c.query('BEGIN');
      const cancelled = (
        await c.query(
          'SELECT cancelled FROM research_jobs WHERE id=$1 FOR UPDATE',
          [job.id],
        )
      ).rows[0]?.cancelled;
      if (cancelled) {
        await c.query('ROLLBACK');
        return await io.saveCheckpoint(job, cp, 'cancelled');
      }
      const name = `business:${job.input.targetKind}:${job.input.targetId}`;
      const value = (
        await c.query(
          'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
          [name],
        )
      ).rows[0]?.value;
      if (value?.fieldAnalysis?.fingerprint === job.input.sample.fingerprint) {
        let updated = {
          ...value,
          ...result.patch,
          fieldAnalysis: {
            ...result.analysis,
            model: result.model,
            sources: job.input.sample.sources,
          },
        };
        if (job.input.targetKind === 'products')
          updated = withFormulaIntelligence(updated);
        await io.putDocument('workspace_documents', name, updated, false, c);
        cp.logs.push(
          `AI已分析${Object.keys(result.patch).length}个字段，均保留原文引用`,
        );
      } else cp.logs.push('来源已更新，本次旧分析未覆盖新资料');
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    await io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date().toISOString() },
      'completed',
    );
  } catch (error) {
    cp.logs.push(String(error.message).slice(0, 600));
    await io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date().toISOString() },
      'partial',
    );
  }
}
export async function sourceFieldsAction(input, user) {
  requireAdmin(user);
  if (
    input.action !== 'server_source_fields_submit' ||
    !/^[\da-f-]{36}$/i.test(input.requestId || '') ||
    !['products', 'sites', 'ads'].includes(input.kind) ||
    !Array.isArray(input.ids) ||
    !input.ids.length ||
    input.ids.length > 100 ||
    input.ids.some(
      (id) => typeof id !== 'string' || !/^[a-z\d._:-]{1,160}$/i.test(id),
    )
  )
    throw new Error('请选择1至100条资料进行AI分析');
  const c = await pool.connect();
  let held = false;
  const jobIds = [];
  try {
    held = await lock(c, 'monitor-config');
    if (!held) throw new Error('配置正在保存，请稍后重试');
    await c.query('BEGIN');
    for (const id of [...new Set(input.ids)]) {
      const name = `business:${input.kind}:${id}`;
      const old = (
        await c.query(
          'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
          [name],
        )
      ).rows[0]?.value;
      if (!old) continue;
      const value = pendingSourceFields(input.kind, old);
      const jobId = await queueSourceFields(
        input.kind,
        value,
        c,
        input.requestId,
      );
      await putDocument('workspace_documents', name, value, false, c);
      if (jobId) jobIds.push(jobId);
    }
    await c.query('COMMIT');
    return { jobIds, queued: jobIds.length };
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    if (held) await unlock(c, 'monitor-config');
    c.release();
  }
}
