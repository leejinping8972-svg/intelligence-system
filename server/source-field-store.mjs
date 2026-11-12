import { requireAdmin } from './auth.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import { stableId } from './discovery-monitor-domain.mjs';
import { withFormulaIntelligence } from './formula-intelligence.mjs';
import { prepareProductIntake } from './product-intake.mjs';
import {
  pendingSourceFields,
  sourceFieldSample,
} from './source-field-domain.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { translateCollectionRecords } from './collection-translation.mjs';
import { analysisMonitor, analysisTaskId, attachAnalysisMonitor, attachAnalysisParent, syncAnalysisStage } from './source-analysis-stage.mjs';

function preserveAdTranslations(old, next) {
  const result = { ...next };
  for (const key of ['brandZh', 'headlineZh', 'copyZh', 'sellingPointZh']) {
    if (!String(result[key] || '').trim() && String(old?.[key] || '').trim())
      result[key] = old[key];
  }
  return result;
}

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
  const existing = (await connection.query('SELECT id,input,status,cancelled FROM research_jobs WHERE request_id=$1 FOR UPDATE', [id])).rows[0];
  value.fieldAnalysis.jobId = id;
  if (existing) {
    await attachAnalysisParent(connection, existing, analysisTaskId());
    await attachAnalysisMonitor(connection, existing, analysisMonitor());
    return id;
  }
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
        ...(kind === 'products' ? { productIntakeVersion: 2 } : {}),
      },
      {
        submittedAt: new Date().toISOString(),
        logs: ['来源资料已保存，等待AI字段分析'],
      },
    ],
  );
  const child = (await connection.query('SELECT id,input,status,cancelled FROM research_jobs WHERE request_id=$1 FOR UPDATE', [id])).rows[0];
  await attachAnalysisParent(connection, child, analysisTaskId());
  await attachAnalysisMonitor(connection, child, analysisMonitor());
  return id;
}
export async function runSourceFields(job, overrides = {}) {
  const io = { pool, collect, saveCheckpoint, putDocument, translate: (kind, records) => translateCollectionRecords(kind, records, undefined, { jobId: job.id, step: 'field-analysis-translation', optional: true }), ...overrides };
  const save = io.saveCheckpoint;
  io.saveCheckpoint = async (savedJob, checkpoint, status = 'running') => {
    const connection = await io.pool.connect();
    try {
      await connection.query('BEGIN');
      await save(savedJob, checkpoint, status, connection);
      await syncAnalysisStage(job, io.pool, connection);
      await connection.query('COMMIT');
    } catch (error) { await connection.query('ROLLBACK').catch(() => {}); throw error; }
    finally { connection.release(); }
  };
  await syncAnalysisStage(job, io.pool);
  const cp = { ...job.checkpoint, logs: [...(job.checkpoint.logs || [])] };
  try {
    if (job.cancelled) return;
    cp.calls = 1;
    let result;
    let prepared;
    if (job.input.targetKind === 'products' && job.input.productIntakeVersion === 2) {
      const unknown = (await io.pool.query("SELECT status,error FROM research_requests WHERE job_id=$1 AND step='field-analysis' AND status<>'done' LIMIT 1", [job.id])).rows[0];
      if (unknown) throw Error(unknown.error || '上次分析结果未知，不重复请求');
      const current = (await io.pool.query('SELECT value FROM workspace_documents WHERE name=$1', [`business:products:${job.input.targetId}`])).rows[0]?.value;
      if (!current || current.fieldAnalysis?.fingerprint !== job.input.sample.fingerprint)
        return io.saveCheckpoint(job, { ...cp, logs: [...cp.logs, '来源已更新或商品已删除，未覆盖新资料'] }, 'completed');
      prepared = await prepareProductIntake(job, current, { ...io, isCancelled: async () => (await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [job.id])).rows[0]?.cancelled });
      cp.logs.push(...prepared.errors);
      result = { patch: prepared.product, analysis: prepared.product.fieldAnalysis, model: prepared.product.fieldAnalysis.model };
    } else result = await io.collect(job, 'field-analysis', {
      sources: ['field_analysis'], sample: job.input.sample,
    });
    // Product intake already translates the extracted fields and reports its
    // gaps. A second attempt would throw the same saved validation error and
    // prevent the successful analysis from being written.
    if (!prepared)
      [result.patch] = await io.translate(job.input.targetKind, [result.patch]);
    if (result.patch?.collectionTranslation?.status === 'partial')
      cp.logs.push(result.patch.collectionTranslation.message);
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
        const patch = job.input.targetKind === 'ads'
          ? preserveAdTranslations(value, result.patch)
          : result.patch;
        let updated = {
          ...value,
          ...patch,
          fieldAnalysis: {
            ...result.analysis,
            jobId: job.id,
            model: result.model,
            sources: prepared?.product.fieldAnalysis.sources || job.input.sample.sources,
          },
        };
        if (prepared) {
          for (const key of ['favorite', 'reviewed', 'firstSeenAt', 'siteId', 'keywordIds', 'newProductClassifications']) updated[key] = value[key];
        }
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
      prepared?.errors.length ? 'partial' : 'completed',
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
      const pending = pendingSourceFields(input.kind, old);
      const value = input.kind === 'ads'
        ? preserveAdTranslations(old, pending)
        : pending;
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
