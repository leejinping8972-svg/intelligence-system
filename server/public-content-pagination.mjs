const indexedSources = new Set([
  'facebook_posts',
  'global_health',
  'instagram',
  'local_health',
  'web_articles',
]);
const token = (value) =>
  (typeof value === 'string' || typeof value === 'number') &&
  String(value).length > 0 &&
  String(value).length <= 4000
    ? String(value)
    : null;

export function contentPageSize(source, input, legacySize) {
  if (input.searchVersion !== 2) return legacySize;
  return Math.min(input.limit, source === 'youtube' ? 50 : 100);
}

export function contentPageParams(source, step, input) {
  if (input.searchVersion !== 2) return {};
  if (indexedSources.has(source)) return { page: step.page || 1 };
  if (source === 'youtube')
    return step.cursor ? { pageToken: step.cursor } : {};
  if (source === 'reddit') return step.cursor ? { after: step.cursor } : {};
  if (source === 'tiktok' || source === 'facebook')
    return step.cursor ? { cursor: step.cursor } : {};
  if (source === 'europepmc') return { cursorMark: step.cursor || '*' };
  if (source === 'medlineplus') return { retstart: step.offset || 0 };
  return {};
}

export function contentNextPage(source, data, step, input, rawCount, pageSize) {
  if (input.searchVersion !== 2 || !rawCount) return null;
  const hasMore = data?.has_more ?? data?.data?.has_more;
  if (
    hasMore === false ||
    hasMore === 0 ||
    hasMore === '0' ||
    hasMore === 'false'
  )
    return null;
  const page = (step.page || 1) + 1;
  if (indexedSources.has(source)) return page <= 11 ? { page } : null;
  if (source === 'medlineplus')
    return rawCount < pageSize
      ? null
      : { page, offset: (step.offset || 0) + rawCount };
  const next = token(
    source === 'youtube'
      ? data.nextPageToken
      : source === 'reddit'
        ? data.after
        : source === 'europepmc'
          ? data.nextCursorMark
          : (data.cursor ?? data.next_cursor ?? data.data?.cursor),
  );
  if (!next || next === String(step.cursor ?? '') || next === '0') return null;
  return { page, cursor: next };
}

export function appendContentPage(job, step, result) {
  if (
    job.input.searchVersion !== 2 ||
    !result.nextPage ||
    job.itemIds.length >= job.input.limit ||
    step.status !== 'success'
  )
    return;
  const sameGroup = (s) =>
    !s.kind &&
    s.source === step.source &&
    s.scope === step.scope &&
    s.query === step.query;
  if (
    result.pageFingerprint &&
    job.steps.some(
      (s) =>
        s !== step &&
        sameGroup(s) &&
        s.pageFingerprint === result.pageFingerprint,
    )
  ) {
    step.message += '；来源重复返回同一页，已停止翻页';
    return;
  }
  const next = {
    source: step.source,
    query: step.query,
    scope: step.scope,
    market: step.market,
    language: step.language,
    ...result.nextPage,
    status: 'pending',
    count: 0,
  };
  if (job.steps.some((s) => sameGroup(s) && (s.page || 1) === next.page))
    return;
  // Search all pending pages before fetching article bodies. New pages join the
  // back of the search queue, allowing every source to contribute each round.
  const details = job.steps.findIndex(
    (s) => s.kind === 'article_detail' && s.status === 'pending',
  );
  if (details > job.steps.indexOf(step)) job.steps.splice(details, 0, next);
  else job.steps.push(next);
}
