// New opt-in research jobs only; legacy queued jobs keep their original scope.
export async function sampleRedditComments(job, io, cp, remember, check) {
  const v = job.input;
  if (!v.autoComments || v.sourceKind !== 'reddit_search') return;
  if (!cp.commentTargets) {
    const posts = [];
    for (const id of cp.evidenceIds) {
      const r = await io.read(`researchEvidence:${id}`);
      if (r?.kind === 'post' && r.platform === 'Reddit')
        posts.push(r.sourceUrl || r.url);
    }
    cp.commentTargets = [...new Set(posts)].slice(0, v.maxDiscussionPosts);
    cp.commentIndex = 0;
    cp.commentPage = 0;
    cp.commentCursor = '';
    await io.saveCheckpoint(job, cp);
  }
  for (; cp.commentIndex < cp.commentTargets.length; cp.commentIndex++) {
    for (; cp.commentPage < v.maxPages; cp.commentPage++) {
      await check();
      if (cp.requests >= v.maxRequests || cp.evidenceIds.length >= v.limit) {
        cp.limited = true;
        return;
      }
      let data;
      try {
        data = await io.collect(
          job,
          `consumer-comments:${cp.commentIndex}:${cp.commentPage}`,
          {
            sources: ['social_research'],
            kind: 'reddit_comments',
            url: cp.commentTargets[cp.commentIndex],
            market: v.market,
            query: v.query,
            cursor: cp.commentCursor,
            keywordIds: v.keywordIds,
            siteIds: v.siteIds,
            productIds: v.productIds,
          },
        );
      } catch (error) {
        cp.requests++;
        cp.failures++;
        cp.logs.push(`讨论评论采样失败：${error.message}`);
        // Failed/uncertain provider requests are never retried automatically.
        break;
      }
      cp.requests++;
      cp.creditsCharged = (cp.creditsCharged || 0) + (data.creditsCharged ?? 0);
      if (data.creditsCharged === null)
        cp.unknownCharges = (cp.unknownCharges || 0) + 1;
      for (const r of data.records) {
        if (cp.evidenceIds.length >= v.limit) {
          cp.limited = true;
          break;
        }
        await remember(r);
      }
      cp.commentCursor = data.cursor;
      cp.logs.push(
        `讨论${cp.commentIndex + 1}评论第${cp.commentPage + 1}页：${data.records.length}条`,
      );
      await io.saveCheckpoint(job, {
        ...cp,
        commentPage: cp.commentPage + 1,
      });
      if (!data.cursor || data.records.length === 0) break;
    }
    if (cp.commentCursor) cp.limited = true;
    cp.commentPage = 0;
    cp.commentCursor = '';
    await io.saveCheckpoint(job, { ...cp, commentIndex: cp.commentIndex + 1 });
  }
}
