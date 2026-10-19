import {
  articleEligible,
  collectArticleStep,
  executeArticleJob,
} from './public-article-details.mjs';
import { contentAiInput, validateContentAi } from './public-content-ai.mjs';
import {
  contentPlan,
  mergeContent,
  paidContentSource,
  validateContentSearch,
  validJobId,
} from './public-content-domain.mjs';
import {
  ContentProviderError,
  fetchContentComments,
  fetchContentTranscript,
  searchContentSource,
} from './public-content-providers.mjs';

export function newContentJob(
  input,
  requestId,
  userId,
  now = new Date().toISOString(),
) {
  if (!validJobId(requestId)) throw new Error('缺少有效的搜索提交编号');
  const request = validateContentSearch(input);
  return {
    id: requestId,
    input: request,
    userId,
    mode: 'search',
    status: 'queued',
    submittedAt: now,
    updatedAt: now,
    steps: contentPlan(request),
    itemIds: [],
    requests: 0,
    creditsCharged: 0,
    unknownChargeRequests: 0,
    aiStatus: request.organize ? 'pending' : 'disabled',
  };
}
const ended = (status) =>
  ['cancelled', 'completed', 'failed', 'partial'].includes(status);
export async function executeContentJob(job, io) {
  if (ended(job.status)) return job;
  if (job.mode === 'article') return executeArticleJob(job, io);
  job.status = 'running';
  job.startedAt ||= new Date().toISOString();
  // A crash during a paid request has an unknown outcome. Never replay it automatically.
  for (const step of job.steps)
    if (step.status === 'running') {
      step.status = 'unknown';
      step.message = '服务重启时请求结果未确认，未自动重复调用';
      if (!step.accounted) {
        job.requests++;
        if (paidContentSource(step.source)) job.unknownChargeRequests++;
        step.accounted = true;
      }
    }
  if (job.aiStatus === 'running') {
    job.aiStatus = 'unknown';
    job.aiMessage = '模型结果未确认，未自动重复计费';
  }
  const save = async () => {
    job.updatedAt = new Date().toISOString();
    await io.saveJob(job);
  };
  const isCancelled = async () => {
    const current = await io.getJob(job.id);
    return current?.status === 'cancelled';
  };
  await save();
  for (const step of job.steps) {
    if (step.status !== 'pending') continue;
    if (await isCancelled()) return;
    if (io.leaseSignal?.aborted) return;
    if (io.signal?.aborted) return; // Current step is still pending and safe to resume.
    step.status = 'running';
    await save();
    if (step.kind === 'article_detail') {
      await collectArticleStep(job, step, io);
      if (io.leaseSignal?.aborted) return;
      await save();
      continue;
    }
    let attempted = false;
    try {
      if (job.mode === 'transcript' || job.mode === 'comments') {
        const item = await io.getItem(job.itemId);
        if (!item) throw new Error('原内容不存在');
        attempted = true;
        const result = await (
          job.mode === 'comments'
            ? io.comments || fetchContentComments
            : io.transcript || fetchContentTranscript
        )(item, io);
        if (io.leaseSignal?.aborted) return;
        job.requests++;
        step.accounted = true;
        if (result.creditsCharged === null) job.unknownChargeRequests++;
        else job.creditsCharged += result.creditsCharged;
        if (job.mode === 'comments') {
          await io.updateItem(item.id, (old) => ({
            ...old,
            comments: result.comments,
          }));
          step.status = 'success';
          step.count = result.comments.items.length;
          step.message = result.comments.completeness;
        } else {
          await io.updateItem(item.id, (old) => ({
            ...old,
            transcript: result.transcript,
            textAvailability: result.transcript.text
              ? '已有字幕'
              : old.textAvailability,
          }));
          step.status = 'success';
          step.count = result.transcript.text ? 1 : 0;
          step.message = result.transcript.text
            ? '已取得来源字幕；未生成音频转写'
            : '来源没有可用的原语言字幕';
        }
      } else {
        const cached = await io.readCache?.(step, job.input);
        attempted = !cached;
        const result =
          cached ||
          (await (io.search || searchContentSource)(step, job.input, io));
        if (io.leaseSignal?.aborted) return;
        if (!cached) {
          job.requests++;
          step.accounted = true;
        }
        if (!cached && paidContentSource(step.source)) {
          if (result.creditsCharged === null) job.unknownChargeRequests++;
          else job.creditsCharged += result.creditsCharged;
        }
        let added = 0;
        for (const item of result.items) {
          if (
            !job.itemIds.includes(item.id) &&
            job.itemIds.length >= job.input.limit
          )
            continue;
          await io.updateItem(item.id, (old) =>
            mergeContent(old, {
              ...item,
              keywordIds: job.input.keywordIds,
              productIds: job.input.productIds,
            }),
          );
          if (!job.itemIds.includes(item.id)) {
            job.itemIds.push(item.id);
            added++;
          }
          if (
            job.input.fetchDetails === true &&
            articleEligible(item) &&
            !job.steps.some(
              (candidate) =>
                candidate.kind === 'article_detail' &&
                candidate.itemId === item.id,
            )
          )
            job.steps.push({
              kind: 'article_detail',
              source: 'article_fulltext',
              query: item.title,
              itemId: item.id,
              status: 'pending',
              count: 0,
            });
        }
        step.count = result.items.length;
        step.added = added;
        step.rawCount = result.rawCount;
        step.pageLimit = result.pageLimit;
        step.candidateCount = result.candidateCount;
        step.cached = Boolean(cached);
        step.status = 'success';
        step.message = `本页返回${result.rawCount}条，本组处理上限${result.pageLimit ?? '未知'}条，安全候选${result.candidateCount ?? result.items.length}条，词面相关${result.items.length}条，新增${added}条${result.items.length === 0 ? '；候选未通过链接/相关性过滤' : ''}${result.rawCount > (result.pageLimit ?? Infinity) ? '；超出本组上限的候选未处理' : ''}`;
        if (result.rawCount === 0)
          step.message = `本页未返回候选（本组处理上限${result.pageLimit ?? '未知'}条）；不代表平台没有相关内容，未自动重复请求`;
        if (cached) step.message = '复用24小时内的结果，未重新请求来源';
        if (!cached) await io.writeCache?.(step, job.input, result);
      }
    } catch (error) {
      step.status = error.state || 'failed';
      step.message =
        error instanceof ContentProviderError
          ? error.message
          : '本步骤采集或保存未完成，原有结果已保留';
      if (
        attempted &&
        !step.accounted &&
        !['unconfigured', 'unsupported'].includes(step.status)
      ) {
        job.requests++;
        step.accounted = true;
        if (paidContentSource(step.source)) job.unknownChargeRequests++;
      }
      if (
        ['blocked', 'rate_limited', 'unconfigured', 'unsupported'].includes(
          step.status,
        )
      )
        for (const other of job.steps)
          if (other.source === step.source && other.status === 'pending') {
            other.status = 'skipped';
            other.message =
              '本来源不可用或冷却中，已跳过后续相关词；其他来源继续';
          }
    }
    await save();
    if (io.signal?.aborted) return;
  }
  if (job.aiStatus === 'pending') {
    if (io.signal?.aborted || io.leaseSignal?.aborted) return;
    if (await isCancelled()) return;
    const rawRecords = await Promise.all(
      job.itemIds.map((id) => io.getItem(id)),
    );
    const records = rawRecords.filter(Boolean);
    if (records.length === 0) {
      job.aiStatus = 'skipped';
      job.aiMessage = '没有可整理的内容';
    } else {
      job.aiStatus = 'running';
      await save();
      try {
        const sample = contentAiInput(records.filter((r) => !r.ai));
        const result =
          sample.length > 0
            ? await io.organize(sample)
            : { parsed: { items: [] }, usage: null, model: '复用已有整理' };
        if (io.leaseSignal?.aborted) return;
        if (sample.length === 0) {
          job.aiStatus = 'completed';
          job.aiCount = records.length;
          job.aiModel = result.model;
          await save();
        }
        if (sample.length > 0) {
          const updates = validateContentAi(result.parsed, sample);
          for (const [id, ai] of updates)
            await io.updateItem(id, (old) => ({ ...old, ai }));
          job.aiStatus = 'completed';
          job.aiCount = updates.size;
          job.aiUsage = result.usage;
          job.aiModel = result.model;
        }
      } catch (error) {
        job.aiStatus = 'failed';
        job.aiMessage =
          error.safeMessage ||
          'AI整理未完成，原始内容已保留；请检查模型配置或额度';
      }
    }
  }
  if (await isCancelled()) return;
  const failures =
    job.steps.some((s) => !['skipped', 'success'].includes(s.status)) ||
    ['failed', 'unknown'].includes(job.aiStatus);
  const failureStatus = job.itemIds.length > 0 ? 'partial' : 'failed';
  job.status = failures ? failureStatus : 'completed';
  job.finishedAt = new Date().toISOString();
  await save();
  return job;
}
