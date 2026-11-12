import {
  contentAiInput,
  validateContentAiItems,
} from './public-content-ai.mjs';

// This bounds one model context, not the number of items organized by a job.
export const CONTENT_AI_BATCH_SIZE = 10;

function summarize(job) {
  const batches = job.aiBatches;
  job.aiCount =
    job.aiReusedCount + batches.reduce((n, b) => n + (b.count || 0), 0);
  job.aiRequests = batches.filter((b) => b.status !== 'pending').length;
  const usage = {};
  for (const batch of batches)
    for (const [key, value] of Object.entries(batch.result?.usage || {}))
      if (typeof value === 'number' && Number.isFinite(value))
        usage[key] = (usage[key] || 0) + value;
  job.aiUsage = usage;
  const last = batches.findLast((batch) => batch.result);
  job.aiModel =
    last?.result.model || (batches.length ? undefined : '复用已有整理');
  job.aiPromptVersion = last?.result.promptVersion;
}

export async function executeContentAi(job, io, { save, isCancelled }) {
  if (!['pending', 'running'].includes(job.aiStatus)) return;
  if (io.signal?.aborted || io.leaseSignal?.aborted || (await isCancelled()))
    return;
  if (!job.aiBatches) {
    // Legacy jobs only recorded a single in-flight call. Its outcome is unknown.
    if (job.aiStatus === 'running') {
      job.aiStatus = 'unknown';
      job.aiMessage = '模型结果未确认，未自动重复计费';
      await save();
      return;
    }
    const records = (
      io.getItems
        ? await io.getItems(job.itemIds)
        : await Promise.all(job.itemIds.map((id) => io.getItem(id)))
    ).filter(Boolean);
    job.aiTotal = records.length;
    job.aiReusedCount = records.filter((record) => record.ai).length;
    const samples = contentAiInput(records.filter((record) => !record.ai));
    job.aiBatches = [];
    for (let i = 0; i < samples.length; i += CONTENT_AI_BATCH_SIZE)
      job.aiBatches.push({
        sample: samples.slice(i, i + CONTENT_AI_BATCH_SIZE),
        status: 'pending',
      });
  }
  for (const batch of job.aiBatches)
    if (batch.status === 'running') {
      batch.status = 'unknown';
      batch.message = '模型结果未确认，未自动重复计费';
    }
  job.aiStatus = 'pending';
  summarize(job);
  await save();
  for (const batch of job.aiBatches) {
    if (!['pending', 'returned'].includes(batch.status)) continue;
    if (io.signal?.aborted || io.leaseSignal?.aborted || (await isCancelled()))
      return;
    if (batch.status === 'pending') {
      batch.status = 'running';
      batch.usageAt = new Date().toISOString();
      job.aiStatus = 'running';
      job.aiUsageAt = batch.usageAt;
      summarize(job);
      await save();
      try {
        batch.result = await io.organize(batch.sample);
      } catch (error) {
        if (io.leaseSignal?.aborted) return;
        batch.status = 'failed';
        batch.message =
          error.safeMessage ||
          'AI整理未完成，原始内容已保留；请检查模型配置或额度';
      }
      if (io.leaseSignal?.aborted) return;
      if (batch.status === 'running') batch.status = 'returned';
      job.aiStatus = 'pending';
      summarize(job);
      // Save the response before applying item updates. Recovery uses this result.
      await save();
    }
    if (batch.status === 'returned') {
      let updates;
      try {
        if (batch.result.parseError) throw new Error(batch.result.parseError);
        const validated = validateContentAiItems(
          batch.result.parsed,
          batch.sample,
        );
        updates = validated.updates;
        batch.issues = validated.issues;
      } catch (error) {
        batch.status = 'failed';
        batch.message = error.message;
      }
      if (updates) {
        // Storage failures propagate, leaving the persisted response recoverable.
        for (const [id, ai] of updates)
          await io.updateItem(id, (old) => ({ ...old, ai }));
        batch.count = updates.size;
        batch.status =
          updates.size === batch.sample.length
            ? 'completed'
            : updates.size
              ? 'partial'
              : 'failed';
        if (batch.status !== 'completed') {
          const reasons = [
            ...new Set(batch.issues.map((issue) => issue.message)),
          ];
          batch.message = `本批保存${updates.size}/${batch.sample.length}条；${reasons.join('；')}；仅保留校验通过项，未自动重复调用`;
        }
      }
      summarize(job);
      await save();
    }
  }
  const incomplete = job.aiBatches.filter(
    (batch) => batch.status !== 'completed',
  );
  job.aiStatus = !job.aiTotal
    ? 'skipped'
    : incomplete.some((batch) => batch.status === 'unknown')
      ? 'unknown'
      : incomplete.length
        ? job.aiCount
          ? 'partial'
          : 'failed'
        : 'completed';
  job.aiMessage = !job.aiTotal
    ? '没有可整理的内容'
    : incomplete.length
      ? `已整理${job.aiCount}/${job.aiTotal}条；${[...new Set(incomplete.map((batch) => batch.message))].join('；')}`
      : '';
  await save();
}
