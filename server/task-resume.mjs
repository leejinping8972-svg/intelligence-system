import { isHealthDiscovery, prepareHealthRetry } from './health-discovery-retry.mjs';
import { isIngredientTrendCollection, prepareIngredientTrendResume } from './ingredient-trend-resume.mjs';
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

// A repeated click after a lost response acknowledges the existing execution.
// Never reset a running task, its checkpoint or its request journal.
export async function resumePartialTask(jobId, pool, options = {}) {
  if (!uuid.test(jobId)) throw new Error('任务编号无效');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const job = (await c.query('SELECT * FROM research_jobs WHERE id=$1 FOR UPDATE', [jobId])).rows[0];
    if (!job) throw new Error('任务不存在');
    const blocked = Boolean(job.checkpoint?.semBlocked);
    if (!job.cancelled && ['queued', 'running'].includes(job.status)) {
      await c.query('COMMIT');
      return { resumed: true, jobId, status: job.status, reused: true };
    }
    if (job.status !== 'partial' && !(blocked && !job.cancelled && ['awaiting_review', 'completed'].includes(job.status)))
      throw new Error('该任务当前没有可继续的采集环节，请刷新任务状态');
    const requests = (await c.query('SELECT step,status FROM research_requests WHERE job_id=$1', [jobId])).rows;
    if (requests.some(row => row.status === 'started'))
      throw new Error('任务存在结果未确认的请求，已保留记录；为避免重复扣费，暂不能继续');
    if (options.retryFailures && !isHealthDiscovery(job)) throw Error('该任务暂不支持仅重试异常');
    const checkpoint = options.retryFailures ? await prepareHealthRetry(job, c)
      : isIngredientTrendCollection(job) ? await prepareIngredientTrendResume(job, c)
        : { ...job.checkpoint };
    if (blocked) {
      const attempted = new Set(requests.map(row => row.step));
      let index = 0;
      while (index < (checkpoint.keywords?.length || 0) && attempted.has(`sem-metric:${index}`)) index++;
      if (index >= (checkpoint.keywords?.length || 0))
        throw new Error('月搜索量没有尚未执行的词；已失败请求不会自动重放');
      checkpoint.metricIndex = index;
      delete checkpoint.semBlocked;
      delete checkpoint.semBlockedError;
      delete checkpoint.finishedAt;
      checkpoint.logs = [...(checkpoint.logs || []), '手动继续月搜索量：保留所有已执行请求，仅处理尚未执行的词；请先确保账户权限和实际额度可用'];
    }
    delete checkpoint.nextRunAt;
    await c.query("UPDATE research_jobs SET cancelled=false,status='queued',checkpoint=$2,updated_at=now() WHERE id=$1", [jobId, checkpoint]);
    await c.query('COMMIT');
    return { resumed: true, jobId, status: 'queued' };
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { c.release(); }
}
