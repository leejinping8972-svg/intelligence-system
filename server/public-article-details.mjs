import { load } from 'cheerio';

import {
  ArticleError,
  articleHttpsUrl,
  fetchPublicArticle,
} from './public-article-http.mjs';
import { parseArticleDocument } from './public-article-parser.mjs';
import { validItemId, validJobId } from './public-content-domain.mjs';

export const articleEligible = (item) =>
  item &&
  ((item.type === 'paper' && item.source === 'europepmc') ||
    (item.type === 'article' &&
      ['global_health', 'local_health', 'medlineplus', 'web_articles'].includes(
        item.source,
      )));
export function articlePmcId(item) {
  if (/^PMC\d{1,12}$/.test(item.pmcid || '')) return item.pmcid;
  const sourceId = item.sourceId?.match(/^PMC:(PMC\d{1,12})$/)?.[1];
  if (sourceId) return sourceId;
  for (const value of [item.url, item.fullTextUrl]) {
    try {
      const url = new URL(value);
      if (
        ['europepmc.org', 'pmc.ncbi.nlm.nih.gov', 'www.europepmc.org'].includes(
          url.hostname,
        )
      ) {
        const pmcid = url.pathname.match(/\/(PMC\d{1,12})(?:\/|$)/)?.[1];
        if (pmcid) return pmcid;
      }
    } catch {
      /* Missing optional link. */
    }
  }
  return '';
}
export async function fetchArticleDetails(item, io = {}) {
  if (!articleEligible(item))
    throw new ArticleError(
      '当前内容不是支持补采正文的文章或文献',
      'unsupported',
    );
  let requests = 0;
  const read = async (url) => {
    requests++;
    return (io.articleFetch || fetchPublicArticle)(url);
  };
  try {
    if (item.source === 'europepmc') {
      let pmcid = articlePmcId(item);
      if (!pmcid) {
        const pmid = item.sourceId?.match(/^MED:(\d{1,12})$/)?.[1];
        if (pmid) {
          const url = new URL(
            'https://www.ebi.ac.uk/europepmc/webservices/rest/search',
          );
          url.search = new URLSearchParams({
            query: `EXT_ID:${pmid} AND SRC:MED`,
            format: 'xml',
            resultType: 'core',
            pageSize: '1',
          }).toString();
          const metadata = await read(url.href);
          const $ = load(metadata.text, { xml: true });
          const result = $('result').first();
          if (
            result.find('id').first().text() === pmid &&
            result.find('source').first().text() === 'MED'
          )
            pmcid = result.find('pmcid').first().text();
        }
      }
      if (!/^PMC\d{1,12}$/.test(pmcid))
        throw new ArticleError(
          '该文献索引未提供可读取的 PMC 全文编号，保留原文入口',
          'unavailable',
        );
      const result = await read(
        `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
      );
      const document = parseArticleDocument(result.text, {
        pmcid,
        url: `https://europepmc.org/article/PMC/${pmcid}`,
        xml: true,
      });
      return { document, requests };
    }
    const url = articleHttpsUrl(item.url).href;
    const response = await read(url);
    return {
      document: parseArticleDocument(response.text, {
        url: response.url || url,
      }),
      requests,
    };
  } catch (error) {
    const failure =
      error instanceof ArticleError
        ? error
        : new ArticleError('正文读取超时、连接中断或解析失败；原索引保留');
    failure.requests = requests;
    throw failure;
  }
}
const active = (job) => ['queued', 'running'].includes(job.status);
export async function articleAction(input, user, io) {
  if (!validItemId(input.itemId)) throw new Error('文章编号无效');
  const item = await io.getItem(input.itemId);
  if (!articleEligible(item)) throw new Error('当前内容不支持文章正文采集');
  if (input.action === 'server_content_article_get') {
    const article = await io.getArticle(item.id);
    const jobs = await io.listJobs();
    const job = jobs.find(
      (candidate) =>
        active(candidate) &&
        candidate.steps.some(
          (step) =>
            step.kind === 'article_detail' &&
            step.itemId === item.id &&
            ['pending', 'running'].includes(step.status),
        ),
    );
    let state = article?.status || 'missing';
    if (job) state = 'running';
    else if (['queued', 'running'].includes(state)) state = 'interrupted';
    return {
      article: article?.document || null,
      state,
      reason: article?.reason || '',
      jobId: job?.id || '',
      itemId: item.id,
    };
  }
  if (!validJobId(input.requestId)) throw new Error('正文采集提交编号无效');
  return io.submitLease(async () => {
    const duplicate = await io.getJob(input.requestId);
    if (duplicate) {
      if (duplicate.mode !== 'article' || duplicate.itemId !== item.id)
        throw new Error('此提交编号已用于其他任务');
      return { job: duplicate };
    }
    const jobs = await io.listJobs();
    const pending = jobs.find(
      (candidate) =>
        active(candidate) &&
        candidate.steps.some(
          (step) =>
            step.kind === 'article_detail' &&
            step.itemId === item.id &&
            ['pending', 'running'].includes(step.status),
        ),
    );
    if (pending) return { job: pending };
    const previous = await io.getArticle(item.id);
    if (previous?.document) return { article: previous.document };
    if (jobs.filter((job) => active(job)).length >= 5)
      throw new Error('已有5项公共内容任务，请稍后补采正文');
    const now = new Date().toISOString();
    const job = {
      id: input.requestId,
      userId: user.id,
      mode: 'article',
      itemId: item.id,
      status: 'queued',
      input: {
        query: item.title,
        market: item.searchMarket,
        language: item.searchLanguage,
      },
      submittedAt: now,
      updatedAt: now,
      steps: [
        {
          kind: 'article_detail',
          source: 'article_fulltext',
          itemId: item.id,
          query: item.title,
          status: 'pending',
          count: 0,
          force: true,
        },
      ],
      itemIds: [item.id],
      requests: 0,
      creditsCharged: 0,
      unknownChargeRequests: 0,
      aiStatus: 'disabled',
    };
    await io.saveJob(job);
    return { job };
  });
}
export async function collectArticleStep(job, step, io) {
  const saveMetadata = (status, extra = {}) =>
    io.updateItem(step.itemId, (old) => ({
      ...old,
      articleDetails: { status, updatedAt: new Date().toISOString(), ...extra },
    }));
  let accounted = false;
  try {
    const item = await io.getItem(step.itemId);
    if (!articleEligible(item))
      throw new ArticleError('该条内容不支持正文采集', 'unsupported');
    const previous = await io.getArticle(item.id);
    if (previous?.document) {
      step.status = 'success';
      step.count = 1;
      step.message = '复用已保存正文，无需再次访问来源';
      step.cached = true;
      return;
    }
    if (
      previous &&
      !step.force &&
      Date.now() - Date.parse(previous.attemptedAt) < 86_400_000 &&
      !['queued', 'running'].includes(previous.status)
    ) {
      step.status = 'skipped';
      step.message = `24小时内已检查原文：${previous.reason || previous.status}；可在详情手动补采`;
      return;
    }
    await io.writeArticle(item.id, {
      status: 'running',
      jobId: job.id,
      attemptedAt: new Date().toISOString(),
    });
    await saveMetadata('running');
    const result = await fetchArticleDetails(item, io);
    if (io.leaseSignal?.aborted) return;
    job.requests += result.requests;
    accounted = true;
    await io.writeArticle(item.id, {
      status: 'ready',
      document: result.document,
      attemptedAt: new Date().toISOString(),
      jobId: job.id,
    });
    await saveMetadata('ready', {
      characters: result.document.characters,
      coverage: result.document.coverage,
    });
    step.status = 'success';
    step.count = 1;
    step.message = `已保存正文 ${result.document.characters} 字符、${result.document.sections.length} 节、${result.document.tables.length} 表、${result.document.figures.length} 图${result.document.truncated ? '；达到保留上限，部分内容截断' : ''}；无第三方收费调用`;
  } catch (error) {
    if (io.leaseSignal?.aborted) return;
    if (!accounted) job.requests += error.requests || 0;
    const state = error instanceof ArticleError ? error.state : 'failed';
    const reason =
      error instanceof ArticleError
        ? error.message
        : '正文保存未完成，原索引和已有正文保留';
    // Do not overwrite an already committed document after a metadata save failure.
    const previous = await io.getArticle(step.itemId);
    if (!previous?.document)
      await io.writeArticle(step.itemId, {
        status: state,
        reason,
        attemptedAt: new Date().toISOString(),
        jobId: job.id,
      });
    await saveMetadata(previous?.document ? 'ready' : state);
    step.status = ['blocked', 'unavailable', 'unsupported'].includes(state)
      ? 'skipped'
      : 'failed';
    step.message = reason;
  }
  step.accounted = true;
}
export async function executeArticleJob(job, io) {
  if (!active(job)) return;
  job.status = 'running';
  const step = job.steps[0];
  if (step.status === 'running') {
    step.status = 'unknown';
    step.message = '服务中断时正文读取结果未确认，可手动重试';
  }
  if (
    step.status === 'pending' &&
    !io.signal?.aborted &&
    !io.leaseSignal?.aborted
  ) {
    const currentJob = await io.getJob(job.id);
    if (currentJob?.status === 'cancelled') return;
    step.status = 'running';
    await io.saveJob(job);
    await collectArticleStep(job, step, io);
  }
  if (io.leaseSignal?.aborted) return;
  const savedJob = await io.getJob(job.id);
  if (savedJob?.status === 'cancelled') return;
  if (step.status === 'pending') return;
  job.status = step.status === 'success' ? 'completed' : 'partial';
  job.updatedAt = new Date().toISOString();
  job.finishedAt = job.updatedAt;
  await io.saveJob(job);
}
