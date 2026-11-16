import { createHash } from 'node:crypto';

import { batchName } from './collection-batch-domain.mjs';
import { createCollectionBatchAction, validateBatchMerge } from './collection-batches.mjs';

export const BATCH_MERGE_KIND = 'collection_batch_merge';
const stamp = () => new Date().toISOString();
const terminal = new Set(['cancelled', 'completed', 'failed']);

export function batchMergeTask(job) {
  const cp = job.checkpoint || {};
  return {
    id: `${job.id}:${job.input.market}`, cloudJobId: job.id, market: job.input.market,
    mode: 'live', stage: 'analysis', title: `云端 · 合并采集批次 · ${job.input.target}`,
    status: job.cancelled ? 'cancelled' : job.status,
    created: cp.submittedAt || new Date(job.created_at).toISOString(), steps: cp.logs || [],
    collectionProgress: { kind: BATCH_MERGE_KIND, total: job.input.batches.length,
      done: cp.mergeResult ? job.input.batches.length : 0,
      waiting: cp.phase === 'waiting_index' ? 1 : 0,
      current: cp.error || (cp.mergeResult ? `已合并到“${cp.mergeResult.target}”，汇总更新中` : '后台排队执行，关闭页面不影响'),
      stopReason: cp.error || '' },
  };
}

export function createCollectionBatchJobs(io) {
  const merge = createCollectionBatchAction(io);
  async function submit(input, user) {
    io.requireAdmin(user);
    validateBatchMerge(input);
    if (input.requestId !== undefined && !/^[a-f\d-]{36}$/i.test(input.requestId))
      throw Error('提交标识无效，请重新打开合并窗口');
    const batches = [...new Set(input.batches.map(batchName))].sort();
    if (batches.length < 2) throw Error('请选择至少两个不同的批次');
    const target = batchName(input.target);
    const digest = createHash('sha256').update(JSON.stringify([BATCH_MERGE_KIND, user.id, batches, target, input.expectedRevision, input.requestId || ''])).digest('hex');
    const id = `${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
    const jobInput = { kind: BATCH_MERGE_KIND, batches, target, expectedRevision: input.expectedRevision,
      actorId: user.id, market: ['MX','US','VN'].includes(input.market) ? input.market : 'ALL',
      markets: ['US','MX','VN'], seeds: [], sources: [] };
    // Persist only: HTTP never waits for index locks or scans affiliations.
    await io.pool.query(io.sql(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING',
      'INSERT IGNORE INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
    ), [id,id,jobInput,{ submittedAt: stamp(), phase: 'queued', logs: ['已提交后台合并任务，关闭页面不影响执行'] }]);
    const job = (await io.pool.query('SELECT id,status,cancelled FROM research_jobs WHERE id=$1', [id])).rows[0];
    if (!job) throw Error('任务提交失败，请重试');
    if (job.cancelled || job.status === 'cancelled') throw Error('此合并任务已取消；如需重新提交，请重新打开合并窗口');
    if (job.status === 'failed') throw Error('此合并任务已失败，请在“监控与任务”查看原因，刷新看板后重新提交');
    return { jobId: job.id, target, status: job.cancelled ? 'cancelled' : job.status };
  }
  async function run(job) {
    const current = (await io.pool.query('SELECT * FROM research_jobs WHERE id=$1',[job.id])).rows[0];
    if (!current || current.cancelled || terminal.has(current.status)) return;
    const cp = { ...current.checkpoint, startedAt: current.checkpoint.startedAt || stamp(),
      phase: 'waiting_index', nextRunAt: 0, logs: ['合并任务在后台执行；等待当前索引批次完成后统一归属'] };
    await io.saveCheckpoint(current, cp, 'running');
    try {
      return await merge(current.input, { id: current.input.actorId, role: 'admin' }, { jobId: current.id });
    } catch (error) {
      const latest = (await io.pool.query('SELECT * FROM research_jobs WHERE id=$1',[job.id])).rows[0];
      if (!latest || latest.cancelled || latest.checkpoint?.mergeResult) return;
      if (error.retryable) {
        await io.saveCheckpoint(latest, { ...cp, phase: 'waiting_index', nextRunAt: Date.now()+5000 }, 'queued');
      } else {
        const message = error.code ? '后台合并暂时失败，原数据已保留，请联系管理员' : String(error.message).slice(0,700);
        await io.saveCheckpoint(latest, { ...cp, phase: 'failed', error: message, finishedAt: stamp(), logs: [message] }, 'failed');
      }
    }
  }
  return { submit, run };
}
