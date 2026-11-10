import {
  commentPage,
  DAY,
  iso,
  trendHash,
  TREND_REQUEST_GUARD,
} from './ingredient-trend-domain.mjs';

// Progress is scoped to a monitor. Archives remain shared, but one monitor's
// quota/cursors must not consume another monitor's work.
export const commentStateKey = (market, scope, postId) =>
  `ingredient-trend:comment-state:${market}:${scope}:${postId}`;
const hasWork = (sample) =>
  Boolean(sample.bufferedPage || sample.pending.length > 0);

export async function prepareQuantityComments(
  posts,
  plan,
  now,
  scope,
  archive,
) {
  if (plan.maxCommentsPerPost === 0) return [];
  const samples = [];
  for (const post of posts) {
    if (
      !post.publishedAt ||
      Date.parse(post.publishedAt) < now - 14 * DAY ||
      Date.parse(post.publishedAt) > now ||
      post.reportedComments === 0
    )
      continue;
    const previous = await archive.read(
      commentStateKey(plan.market, scope, post.id),
    );
    // A legacy unknown response must also be resolved before a v2 collection.
    const blocked =
      previous?.blocked || (!previous && post.commentState?.blocked);
    const continuing = previous && hasWork(previous);
    samples.push({
      post,
      pending: continuing ? previous.pending : [{ cursor: '', parentId: null }],
      visited: continuing ? previous.visited || [] : [],
      ids: continuing ? previous.ids || [] : [],
      missingCursor: continuing ? previous.missingCursor || 0 : 0,
      ...(continuing && previous.bufferedPage
        ? { bufferedPage: previous.bufferedPage }
        : {}),
      reported: post.reportedComments,
      lastVisitedAt: previous?.lastVisitedAt || '',
      blocked: blocked || null,
      pages: 0,
      bodyMissing: 0,
      runIds: [],
    });
  }
  // Rotate across jobs before draining branches. Large discussions must not
  // starve posts which have never received a first page.
  return samples.toSorted(
    (a, b) =>
      a.lastVisitedAt.localeCompare(b.lastVisitedAt) ||
      a.post.id.localeCompare(b.post.id),
  );
}

export async function runQuantityComments(job, io, cp, archive, context) {
  const { scope, request, save, failure } = context;
  const plan = job.input.plan,
    candidates = cp.samples || [];
  const eligible = (sample, index) =>
    cp.activeSourceStep
      ? index === cp.activeSample
      : !sample.blocked &&
        hasWork(sample) &&
        sample.runIds.length < plan.maxCommentsPerPost &&
        (sample.bufferedPage || cp.sourceRequests < TREND_REQUEST_GUARD);
  const persist = async (sample, at) => {
    const { post, runIds: _runIds, ...state } = sample;
    const value = { ...state, lastVisitedAt: at, lastJobId: job.id };
    await archive.write(commentStateKey(plan.market, scope, post.id), value);
    // Keep the existing overview compatible without using this shared summary
    // as another monitor's continuation state.
    await archive.savePost(post, {
      commentState: {
        reported: sample.reported,
        ids: sample.ids,
        pending: sample.pending,
        countsMatch: sample.countsMatch === true,
        blocked: sample.blocked,
        bufferedCount: sample.bufferedPage?.records.length || 0,
        lastVisitedAt: at,
        lastJobId: job.id,
      },
    });
  };
  if (candidates.some((sample, index) => eligible(sample, index))) {
    let index = (cp.sampleIndex || 0) % candidates.length;
    while (!eligible(candidates[index], index))
      index = (index + 1) % candidates.length;
    const sample = candidates[index];
    cp.activeSample = index;
    let page = sample.bufferedPage;
    if (!page) {
      const work = sample.pending[0];
      let result;
      try {
        result = await request({
          op: 'comments',
          url: sample.post.url,
          cursor: work.cursor,
        });
      } catch (error) {
        sample.blocked = {
          jobId: job.id,
          step: cp.activeSourceStep,
          message: String(error.message).slice(0, 500),
        };
        await persist(sample, iso(cp.asOf));
        cp.sourceRequests++;
        cp.commentRequests++;
        cp.calls++;
        delete cp.activeSourceStep;
        delete cp.activeAccounted;
        delete cp.activeSample;
        failure(cp, `${sample.post.id}评论请求待确认，已停止自动重采`);
        return save();
      }
      page = {
        ...commentPage(result.raw, sample.post),
        cursor: work.cursor,
        at: result.requestLog?.startedAt || iso(cp.asOf),
        capture: `${job.id}:${cp.activeSourceStep}`,
        offset: 0,
      };
      if (!cp.activeAccounted) {
        cp.sourceRequests++;
        cp.commentRequests++;
        cp.calls++;
        cp.credits = (cp.credits || 0) + (result.creditsCharged || 0);
        cp.activeAccounted = true;
      }
    }
    const ids = new Set(sample.ids),
      runIds = new Set(sample.runIds);
    let offset = page.offset || 0;
    for (; offset < page.records.length; offset++) {
      const record = page.records[offset];
      if (!runIds.has(record.id) && runIds.size >= plan.maxCommentsPerPost)
        break;
      await archive.observe(record, page.capture, page.at);
      ids.add(record.id);
      runIds.add(record.id);
      if (!record.text) sample.bodyMissing++;
    }
    sample.ids = [...ids];
    sample.runIds = [...runIds];
    sample.reported = page.reported;
    if (offset < page.records.length) sample.bufferedPage = { ...page, offset };
    else {
      delete sample.bufferedPage;
      sample.pending.shift();
      if (page.cursor) sample.visited.push(trendHash(page.cursor));
      for (const next of page.cursors) {
        if (sample.visited.includes(trendHash(next.cursor))) {
          sample.missingCursor++;
          failure(cp, `${sample.post.id}评论游标重复，未标记完整覆盖`);
        } else if (!sample.pending.some((p) => p.cursor === next.cursor))
          sample.pending.push(next);
      }
      sample.missingCursor += page.missingCursor;
      sample.pages++;
    }
    sample.paginationExhausted = !hasWork(sample) && !sample.missingCursor;
    sample.countGap =
      sample.reported === null ? null : sample.reported - sample.ids.length;
    sample.countsMatch = sample.countGap === 0 && sample.paginationExhausted;
    await persist(sample, page.at);
    cp.sampleIndex = index + 1;
    cp.logs.push(
      `${sample.post.id}评论：本次${sample.runIds.length}/${plan.maxCommentsPerPost}条，当前遍历累计${sample.ids.length}/${sample.reported ?? '未知'}；${hasWork(sample) ? '待续内容已保存' : '来源分页结束'}`,
    );
    delete cp.activeSample;
    delete cp.activeSourceStep;
    delete cp.activeAccounted;
    return save();
  }
  for (const sample of candidates) {
    if (
      sample.blocked ||
      hasWork(sample) ||
      sample.missingCursor ||
      !sample.countsMatch
    ) {
      let reason = '来源计数缺口';
      if (sample.blocked) reason = '请求待确认';
      else if (
        sample.runIds.length >= plan.maxCommentsPerPost &&
        hasWork(sample)
      )
        reason = '每帖评论数量上限';
      else if (hasWork(sample) && cp.sourceRequests >= TREND_REQUEST_GUARD)
        reason = '后台来源请求保护';
      failure(
        cp,
        `${sample.post.id}评论部分覆盖：${reason}，本次${sample.runIds.length}条，断点已保留`,
      );
    }
  }
  cp.comments = candidates.reduce((n, sample) => n + sample.runIds.length, 0);
  cp.logs.push(
    `采集结束：${cp.posts}帖（首次入库${cp.newPosts}），回访${candidates.length}帖，本次去重评论${cp.comments}条；${plan.maxCommentsPerPost === 0 ? '评论采集已关闭；' : ''}未执行AI分析`,
  );
  cp.samples = candidates.map((sample) => ({
    postId: sample.post.id,
    unique: sample.ids.length,
    observed: sample.runIds.length,
    pendingCount: sample.pending.length + (sample.bufferedPage ? 1 : 0),
    countsMatch: sample.countsMatch === true,
    blocked: sample.blocked,
  }));
  cp.phase = 'done';
  return save(cp.failures.length > 0 ? 'partial' : 'completed');
}
