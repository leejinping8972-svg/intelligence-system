import { Buffer } from 'node:buffer';

import { load } from 'cheerio';

import { articleEligible } from './public-article-details.mjs';
import { validItemId, validJobId } from './public-content-domain.mjs';
import {
  ContentProviderError,
  fetchContentTranscript,
} from './public-content-providers.mjs';

export const detailKinds = { metadata: '来源详情', transcript: '视频字幕' };
const active = (job) => ['queued', 'running'].includes(job.status);
const text = (value, limit = 30_000) =>
  typeof value === 'string'
    ? value.replaceAll('\r\n', '\n').trim().slice(0, limit)
    : '';
function abstractText(value) {
  const $ = load(`<div>${value || ''}</div>`);
  $('script,style').remove();
  $('p,div,h2,h3').append('\n\n');
  return text($.text())
    .replaceAll(/\n[ \t]+/g, '\n')
    .replaceAll(/\n{3,}/g, '\n\n');
}
async function jsonSource(url, io, headers = {}) {
  let response;
  try {
    response = await (io.fetcher || fetch)(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new ContentProviderError('详情来源连接中断，未自动重试');
  }
  if (!response.ok) {
    await response.body?.cancel();
    let status = 'failed';
    if (response.status === 429) status = 'rate_limited';
    if ([401, 403].includes(response.status)) status = 'blocked';
    throw new ContentProviderError(`详情来源 HTTP ${response.status}`, status);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4_000_000)
      throw new ContentProviderError('详情来源响应超过4MB上限');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (result.success === false) throw new Error('failed');
    return result;
  } catch {
    throw new ContentProviderError('详情来源未返回有效数据');
  }
}
export async function fetchDetailMetadata(item, io = {}) {
  if (item.source === 'europepmc') {
    const match = item.sourceId?.match(/^(MED|PMC):(PMC\d{1,12}|\d{1,12})$/);
    if (!match)
      throw new ContentProviderError('文献编号不支持精确补采', 'unsupported');
    const url = new URL(
      'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
    );
    url.search = new URLSearchParams({
      query: `EXT_ID:${match[2]} AND SRC:${match[1]}`,
      format: 'json',
      resultType: 'core',
      pageSize: '1',
    }).toString();
    const data = await jsonSource(url, io);
    const record = data.resultList?.result?.[0];
    if (!record || record.source !== match[1] || String(record.id) !== match[2])
      throw new ContentProviderError('来源未返回匹配的文献记录', 'unavailable');
    const summary = abstractText(record.abstractText);
    return {
      patch: {
        ...(summary ? { summary, textAvailability: '已补采来源研究摘要' } : {}),
        ...(/^PMC\d{1,12}$/.test(record.pmcid || '')
          ? { pmcid: record.pmcid }
          : {}),
      },
      empty: !summary,
      reason: summary
        ? '已读取官方研究摘要'
        : '官方索引未提供摘要；单独检查开放正文',
      creditsCharged: 0,
    };
  }
  if (item.source === 'youtube') {
    if (!/^[\w-]{11}$/.test(item.videoId || ''))
      throw new ContentProviderError('视频编号无效', 'unsupported');
    const key = await io.youtubeKey?.();
    if (!key)
      throw new ContentProviderError('未配置 YouTube Key', 'unconfigured');
    const url = new URL('https://www.googleapis.com/youtube/v3/videos');
    url.search = new URLSearchParams({
      part: 'snippet',
      id: item.videoId,
      key,
    }).toString();
    const data = await jsonSource(url, io);
    const video = data.items?.find((v) => v.id === item.videoId);
    if (!video)
      throw new ContentProviderError(
        '视频已删除、私密或当前不可读取',
        'unavailable',
      );
    const summary = text(video.snippet?.description, 10_000);
    return {
      patch: summary
        ? {
            summary,
            textAvailability: item.transcript?.text
              ? '已有字幕与完整视频描述'
              : '完整视频描述',
          }
        : {},
      empty: !summary,
      reason: summary ? '已读取视频来源完整描述' : '视频来源未提供描述',
      creditsCharged: 0,
    };
  }
  if (item.source === 'reddit') {
    const url = new URL(item.url);
    const postId = url.pathname.match(/\/comments\/([a-z\d]+)(?:\/|$)/i)?.[1];
    if (
      url.protocol !== 'https:' ||
      !['reddit.com', 'www.reddit.com'].includes(url.hostname) ||
      !postId ||
      url.username ||
      url.password ||
      url.port
    )
      throw new ContentProviderError('帖子原文地址不支持', 'unsupported');
    const key = await io.scrapeKey?.();
    if (!key)
      throw new ContentProviderError(
        '未配置 ScrapeCreators Key',
        'unconfigured',
      );
    const endpoint = new URL('https://api.scrapecreators.com/v1/reddit/post');
    endpoint.searchParams.set('url', url.href);
    const data = await jsonSource(endpoint, io, { 'x-api-key': key });
    const post = data.post || data;
    if (
      String(post.id || post.name?.replace(/^t3_/, '')) !== postId ||
      post.over_18 ||
      post.nsfw
    )
      throw new ContentProviderError(
        '来源未返回可用且编号匹配的公开帖子',
        'unavailable',
      );
    const summary = text(post.selftext);
    return {
      patch: summary ? { summary, textAvailability: '已补采帖子原文' } : {},
      empty: !summary,
      reason: summary
        ? '已读取帖子原文，不含评论'
        : '原帖为链接/媒体帖或没有文字正文',
      creditsCharged: Number.isFinite(data.credits_charged)
        ? data.credits_charged
        : null,
    };
  }
  throw new ContentProviderError('此来源暂不支持详情补采', 'unsupported');
}
export async function planHistoryDetails(
  items,
  io,
  { includePaid = false } = {},
) {
  const steps = [];
  let paid = 0;
  let inProgress = 0;
  let retained = 0;
  const jobs = await io.listJobs();
  for (const item of items) {
    const pending = jobs
      .filter((job) => active(job))
      .flatMap((job) =>
        job.steps.map((step) => ({
          ...step,
          itemId: step.itemId || job.itemId,
          mode: job.mode,
        })),
      );
    const add = (kind, source, isPaid = false) => {
      if (
        pending.some(
          (step) =>
            step.itemId === item.id &&
            ['pending', 'running'].includes(step.status) &&
            (step.kind === kind ||
              (source === 'youtube_transcript' && step.mode === 'transcript')),
        )
      ) {
        inProgress++;
        return;
      }
      if (item.detailEnrichment?.[kind]) {
        retained++;
        return;
      }
      if (isPaid && !includePaid) return;
      if (isPaid) paid++;
      steps.push({
        kind,
        source,
        itemId: item.id,
        query: item.title,
        status: 'pending',
        count: 0,
        paid: isPaid,
      });
    };
    if (item.source === 'europepmc' && !item.summary)
      add('detail_metadata', 'europepmc_metadata');
    if (item.source === 'youtube') {
      add('detail_metadata', 'youtube_metadata');
      if (item.transcript) {
        retained++;
      } else {
        add('detail_transcript', 'youtube_transcript', true);
      }
    }
    if (item.source === 'reddit' && !item.summary)
      add('detail_metadata', 'reddit_details', true);
    if (articleEligible(item)) {
      const article = await io.getArticle(item.id);
      if (
        !article &&
        !pending.some(
          (step) =>
            step.kind === 'article_detail' &&
            step.itemId === item.id &&
            ['pending', 'running'].includes(step.status),
        )
      )
        steps.push({
          kind: 'article_detail',
          source: 'article_fulltext',
          itemId: item.id,
          query: item.title,
          status: 'pending',
          count: 0,
        });
      else if (article) retained++;
      else inProgress++;
    }
  }
  return {
    steps,
    itemIds: items.map((item) => item.id),
    total: items.length,
    paidRequests: paid,
    publicRequests: steps.filter((s) => !s.paid).length,
    inProgress,
    retained,
  };
}
export async function historyDetailsAction(input, user, io) {
  const selectIds = input.itemIds;
  if (
    selectIds !== undefined &&
    (!Array.isArray(selectIds) ||
      selectIds.length > 1000 ||
      selectIds.some((id) => !validItemId(id)))
  )
    throw new Error('历史内容编号无效或超过1000条');
  const getPlan = async () => {
    const items = await io.allItems(selectIds);
    return planHistoryDetails(
      selectIds ? items.filter((i) => selectIds.includes(i.id)) : items,
      io,
      { includePaid: input.includePaid === true },
    );
  };
  if (input.action === 'server_content_history_preview') return getPlan();
  if (!validJobId(input.requestId)) throw new Error('历史补全提交编号无效');
  return io.submitLease(async () => {
    const previous = await io.getJob(input.requestId);
    if (previous) {
      if (
        previous.mode !== 'enrichment' ||
        previous.includePaid !== (input.includePaid === true) ||
        JSON.stringify(previous.selectedIds) !==
          JSON.stringify(selectIds || null)
      )
        throw new Error('提交编号已用于其他补全范围');
      return { job: previous };
    }
    const jobs = await io.listJobs();
    if (jobs.filter((job) => active(job)).length >= 5)
      throw new Error('已有5项公共内容任务，请等待后再补全');
    const plan = await getPlan();
    if (plan.paidRequests > 100)
      throw new Error('单批最多100次收费请求，请选择更小范围');
    if (plan.steps.length === 0) return { job: null, plan };
    const now = new Date().toISOString();
    const job = {
      id: input.requestId,
      userId: user.id,
      mode: 'enrichment',
      includePaid: input.includePaid === true,
      selectedIds: selectIds || null,
      input: {
        query: '历史公共内容详情补全',
        market: 'ALL',
        language: 'unknown',
      },
      status: 'queued',
      submittedAt: now,
      updatedAt: now,
      itemIds: plan.itemIds,
      steps: plan.steps,
      requests: 0,
      creditsCharged: 0,
      unknownChargeRequests: 0,
      aiStatus: 'disabled',
      plannedPaidRequests: plan.paidRequests,
    };
    await io.saveJob(job);
    return { job, plan };
  });
}
export async function enrichContentStep(job, step, io) {
  const item = await io.getItem(step.itemId);
  const saveState = async (status, reason) =>
    io.updateItem(step.itemId, (old) => ({
      ...old,
      detailEnrichment: {
        ...old.detailEnrichment,
        [step.kind]: { status, reason, attemptedAt: new Date().toISOString() },
      },
    }));
  if (!item) {
    step.status = 'skipped';
    step.message = '原内容不存在';
    return;
  }
  if (
    item.detailEnrichment?.[step.kind] ||
    (step.kind === 'detail_transcript' && item.transcript)
  ) {
    step.status = 'skipped';
    step.message = '已检查或已保存，未重复调用来源';
    return;
  }
  let attempted = false;
  let actualRequests = 0;
  const providerIo = {
    ...io,
    fetcher: (...args) => {
      actualRequests++;
      return (io.fetcher || fetch)(...args);
    },
  };
  try {
    // Credential checks happen inside providers; unconfigured errors are not charged.
    await saveState('running', '正在补全详情');
    step.usageAt = new Date().toISOString();
    attempted = true;
    const result =
      step.kind === 'detail_transcript'
        ? await (io.transcript || fetchContentTranscript)(item, providerIo)
        : await (io.metadata || fetchDetailMetadata)(item, providerIo);
    if (io.leaseSignal?.aborted) return;
    job.requests += actualRequests || result.requests || 0;
    step.accounted = true;
    step.creditsCharged = result.creditsCharged;
    step.quotaUnits = result.quotaUnits;
    step.actualRequests = actualRequests || result.requests || 0;
    if (step.paid) {
      if (result.creditsCharged === null) job.unknownChargeRequests++;
      else job.creditsCharged += result.creditsCharged;
    }
    const patch =
      step.kind === 'detail_transcript'
        ? {
            transcript: result.transcript,
            ...(result.transcript.text ? { textAvailability: '已有字幕' } : {}),
          }
        : result.patch;
    const available =
      step.kind === 'detail_transcript'
        ? !!result.transcript.text
        : !result.empty;
    const transcriptReason = available
      ? '已保存来源字幕'
      : '来源未提供可用字幕';
    const reason =
      step.kind === 'detail_transcript' ? transcriptReason : result.reason;
    await io.updateItem(item.id, (old) => ({
      ...old,
      ...patch,
      ai: patch.summary && patch.summary !== old.summary ? undefined : old.ai,
      detailEnrichment: {
        ...old.detailEnrichment,
        [step.kind]: {
          status: available ? 'ready' : 'unavailable',
          reason,
          attemptedAt: new Date().toISOString(),
        },
      },
    }));
    step.status = available ? 'success' : 'skipped';
    step.count = available ? 1 : 0;
    step.message = reason;
  } catch (error) {
    if (io.leaseSignal?.aborted) return;
    if (attempted && !step.accounted && actualRequests > 0) {
      job.requests += actualRequests;
      if (step.paid) job.unknownChargeRequests++;
    }
    step.accounted = true;
    step.status = error.state || 'failed';
    step.message =
      error instanceof ContentProviderError
        ? error.message
        : '详情保存未确认，原内容保留；不自动重复请求';
    await saveState(step.status, step.message);
    if (
      step.paid &&
      ['blocked', 'failed', 'rate_limited', 'unconfigured'].includes(
        step.status,
      )
    )
      for (const other of job.steps)
        if (other.paid && other.status === 'pending') {
          other.status = 'skipped';
          other.message = '收费来源暂不可用，停止后续收费请求；公开正文仍继续';
        }
  }
}
