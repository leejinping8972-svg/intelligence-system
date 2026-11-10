import { createHash } from 'node:crypto';

export const TREND_SOURCE = 'ingredient_trends';
export const TREND_COMMUNITIES = ['Supplements', 'Nootropics', 'Biohackers'];
export const DAY = 86_400_000;
export const trendHash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const iso = (time) => new Date(time).toISOString();
export const contentHash = (record) =>
  trendHash([
    record.title || '',
    (record.text || '').replaceAll(/\s+/g, ' ').trim(),
  ]);
const integer = (value, fallback, min, max, label) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(`${label}须为${min}至${max}`);
  return result;
};
const time = (value, fallback) => {
  const result = value || fallback;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result))
    throw new Error('执行时间无效');
  return result;
};
export function ingredientTrendPlan(input, scheduled = false) {
  const raw = input.communities ?? TREND_COMMUNITIES;
  const communities = [
    ...new Map(
      (Array.isArray(raw) ? raw : String(raw).split(/[\n,，]+/))
        .map((s) => {
          const name = String(s).trim().replace(/^r\//i, '');
          return [name.toLowerCase(), name];
        })
        .filter(([, name]) => name),
    ).values(),
  ];
  if (
    communities.length === 0 ||
    communities.length > 10 ||
    communities.some((s) => !/^[a-z\d_]{3,21}$/i.test(s))
  )
    throw new Error('请填写1至10个Reddit社区名，如Supplements');
  const plan = {
    kind: 'ingredients',
    market: input.market,
    sourceMode: TREND_SOURCE,
    channels: ['reddit'],
    sourceMarkets: {},
    days: 7,
    communities,
    topics: [],
    supplementOnly: true,
    maxProducts: integer(input.maxProducts, 1000, 1, 5000, '每次最多帖子数'),
    maxPages: integer(input.maxPages, 20, 1, 100, '每社区最多页数'),
    maxDetails: integer(input.maxDetails, 6, 0, 20, '每次回访帖子数'),
    maxRequests: integer(input.maxRequests, 60, 1, 500, '每次来源请求上限'),
    maxCommentRequests: integer(
      input.maxCommentRequests,
      30,
      0,
      300,
      '评论请求上限',
    ),
    analysisMaxRecords: integer(
      input.analysisMaxRecords,
      2000,
      40,
      5000,
      '每周分析资料上限',
    ),
    analysisWeekday: integer(input.analysisWeekday, 1, 0, 6, '周分析日期'),
    analysisTime: time(input.analysisTime, '10:00'),
    focus: String(input.focus || '')
      .trim()
      .slice(0, 1000),
  };
  if (scheduled) {
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
      throw new Error('监控开关无效');
    Object.assign(plan, {
      frequency: 'daily',
      time: time(input.time, '09:00'),
      weekday: 1,
      monthDay: 1,
      enabled: input.enabled === true,
    });
  }
  return plan;
}
export function effectiveDiscoveryPlan(plan) {
  if (plan.kind !== 'ingredients') return plan;
  const input =
    plan.sourceMode === TREND_SOURCE
      ? plan
      : { market: plan.market, time: plan.time, enabled: plan.enabled };
  return { ...plan, ...ingredientTrendPlan(input, true) };
}
export function trendSlots(plan, now) {
  const d = new Date(now + 8 * 3_600_000);
  if (!plan.enabled) return [];
  const day = d.toISOString().slice(0, 10),
    clock = d.toISOString().slice(11, 16);
  return [
    ...(clock >= plan.time ? [{ operation: 'collect', slot: day }] : []),
    ...(d.getUTCDay() === plan.analysisWeekday && clock >= plan.analysisTime
      ? [{ operation: 'analyze', slot: day }]
      : []),
  ];
}
export function redditUrl(value) {
  const u = new URL(
    value.startsWith('/') ? `https://www.reddit.com${value}` : value,
  );
  if (
    !['www.reddit.com', 'reddit.com', 'old.reddit.com'].includes(u.hostname) ||
    u.protocol !== 'https:' ||
    u.port ||
    u.username ||
    u.password ||
    !/^\/r\/[a-z\d_]+\/comments\/[a-z\d]+\//i.test(u.pathname)
  )
    throw new Error('Reddit原文链接无效');
  u.search = '';
  u.hash = '';
  return u.href;
}
function published(raw) {
  const n = Number(raw.created_utc ?? raw.created);
  const date = n > 0 ? n * 1000 : Date.parse(raw.created_at_iso || '');
  return Number.isFinite(date) ? iso(date) : null;
}
const author = (name) =>
  typeof name === 'string' &&
  !['[deleted]', '[removed]', 'AutoModerator'].includes(name)
    ? name
    : '';
export function trendPost(raw, community) {
  const id = String(raw.id || '').replace(/^t3_/, '');
  if (!/^[a-z\d]+$/i.test(id)) throw new Error('帖子缺少有效ID');
  if (raw.subreddit && raw.subreddit.toLowerCase() !== community.toLowerCase())
    throw new Error('来源返回了其他社区的帖子');
  return {
    id,
    community,
    platform: 'Reddit',
    type: 'post',
    title: String(raw.title || ''),
    text: typeof raw.selftext === 'string' ? raw.selftext : '',
    url: redditUrl(
      raw.permalink ||
        `https://www.reddit.com/r/${community}/comments/${id}/post/`,
    ),
    publishedAt: published(raw),
    author: author(raw.author),
    reportedComments: Number.isInteger(raw.num_comments)
      ? raw.num_comments
      : null,
    score: Number.isFinite(raw.score) ? raw.score : null,
    stickied: raw.stickied === true,
    mediaOnly: !raw.selftext,
    postId: id,
  };
}
export function commentPage(raw, post) {
  if (!Array.isArray(raw.comments))
    throw new Error('评论响应缺少comments数组；原始响应已保留');
  const records = new Map(),
    cursors = [],
    missing = [];
  const more = (value, parentId) => {
    if (!value?.has_more) return;
    if (typeof value.cursor !== 'string' || !value.cursor)
      missing.push(parentId || post.id);
    else cursors.push({ cursor: value.cursor, parentId });
  };
  const visit = (items, parent) => {
    if (!Array.isArray(items)) throw new Error('嵌套评论格式无效');
    for (const c of items) {
      const id = String(c.id || '').replace(/^t1_/, '');
      if (!/^[a-z\d]+$/i.test(id)) throw new Error('评论缺少有效ID');
      const parentId = c.parent_id || parent || `t3_${post.id}`;
      records.set(id, {
        id,
        postId: post.id,
        parentId,
        type: 'comment',
        platform: 'Reddit',
        community: post.community,
        title: post.title,
        text: typeof c.body === 'string' ? c.body : '',
        url: redditUrl(c.permalink || c.url || `${post.url}${id}/`),
        publishedAt: published(c),
        author: author(c.author),
        score: Number.isFinite(c.score) ? c.score : null,
      });
      if (Array.isArray(c.replies)) visit(c.replies, `t1_${id}`);
      else if (c.replies && typeof c.replies === 'object') {
        visit(c.replies.items || [], `t1_${id}`);
        more(c.replies.more, `t1_${id}`);
      }
    }
  };
  visit(raw.comments, null);
  more(raw.more, null);
  return {
    records: [...records.values()],
    cursors,
    missingCursor: missing.length,
    reported: Number.isInteger(raw.post?.num_comments)
      ? raw.post.num_comments
      : post.reportedComments,
  };
}
const supplementWords =
  /supplement|vitamin|mineral|nootropic|capsule|powder|extract|creatine|magnesium|ashwagandha|protein|amino|probiotic|herbal|omega|保健|补充剂|成分/i;
export function commentCandidates(posts, plan, now) {
  return posts
    .filter(
      (p) =>
        p.publishedAt &&
        Date.parse(p.publishedAt) >= now - 14 * DAY &&
        p.reportedComments > 0 &&
        (p.community.toLowerCase() === 'supplements' ||
          supplementWords.test(`${p.title}\n${p.text}`)),
    )
    .filter((p) => !p.commentState?.blocked)
    .toSorted((a, b) => {
      // Resume pending branches first, then changed counts; oldest visit provides rotation.
      const rank = (p) => {
        if (p.commentState?.pending?.length) return 2;
        return p.commentState?.reported === p.reportedComments ? 0 : 1;
      };
      return (
        rank(b) - rank(a) ||
        (a.commentState?.lastVisitedAt || '').localeCompare(
          b.commentState?.lastVisitedAt || '',
        ) ||
        b.reportedComments - a.reportedComments ||
        a.id.localeCompare(b.id)
      );
    })
    .slice(0, plan.maxDetails);
}
export function analysisRecords(posts, comments, asOf, communities) {
  const result = [];
  for (const r of [...posts, ...comments]) {
    const stamp = Date.parse(r.publishedAt);
    if (
      !communities.some((c) => c.toLowerCase() === r.community.toLowerCase()) ||
      !Number.isFinite(stamp) ||
      stamp < asOf - 14 * DAY ||
      stamp > asOf ||
      !`${r.title || ''}${r.text || ''}`.trim() ||
      ['[removed]', '[deleted]'].includes(r.text)
    )
      continue;
    // Preserve all archived text, splitting instead of silently truncating at the model boundary.
    const text = r.text || '';
    for (let offset = 0; offset < Math.max(text.length, 1); offset += 3000)
      result.push({
        id: `${r.type}:${r.id}:${offset}`,
        sourceId: `${r.type}:${r.id}`,
        postId: r.postId,
        title: r.type === 'post' ? r.title : '',
        text: text.slice(offset, offset + 3000),
        platform: r.platform,
        url: r.url,
        publishedAt: r.publishedAt,
        author: r.author,
        community: r.community,
        type: r.type,
        topic: `r/${r.community}`,
      });
  }
  return result.toSorted(
    (a, b) =>
      a.publishedAt.localeCompare(b.publishedAt) || a.id.localeCompare(b.id),
  );
}
export function mentionMetrics(mentions, start, end) {
  const unique = new Map(
    mentions
      .filter(
        (m) =>
          Date.parse(m.publishedAt) >= start && Date.parse(m.publishedAt) < end,
      )
      .map((m) => [m.sourceId || m.id, m]),
  );
  const rows = [...unique.values()];
  return {
    mentionCount: rows.length,
    postCount: rows.filter((m) => m.type === 'post').length,
    commentCount: rows.filter((m) => m.type === 'comment').length,
    authorCount: new Set(rows.map((m) => m.author).filter(Boolean)).size,
    discussionCount: new Set(rows.map((m) => m.postId).filter(Boolean)).size,
  };
}
