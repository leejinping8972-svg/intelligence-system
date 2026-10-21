const HOST = 'https://api.scrapecreators.com';
const count = (v) =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
function published(value) {
  const time =
    typeof value === 'number'
      ? value * (value < 1e12 ? 1000 : 1)
      : Date.parse(value);
  return Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : '';
}
function publicUrl(value, source) {
  try {
    const u = new URL(value),
      host = {
        tiktok: 'tiktok.com',
        instagram: 'instagram.com',
        facebook: 'facebook.com',
      }[source];
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (u.hostname === host || u.hostname.endsWith(`.${host}`))
      ? u.href
      : '';
  } catch {
    return '';
  }
}
export function socialRequest(work) {
  if (work.source === 'tiktok')
    return {
      path: '/v1/tiktok/search/keyword',
      params: {
        query: work.term,
        region: work.market,
        date_posted: work.window,
        sort_by: 'date-posted',
        ...(work.cursor ? { cursor: work.cursor } : {}),
      },
    };
  if (work.source === 'instagram')
    return {
      path: '/v2/instagram/reels/search',
      params: {
        query: `${work.term} ${{ US: 'United States', MX: 'Mexico', VN: 'Vietnam' }[work.market]}`,
        date_posted: work.window,
        page: work.page,
      },
    };
  if (work.source === 'facebook')
    return {
      path: '/v1/facebook/search/videos',
      params: {
        query: `${work.term} ${{ US: 'United States', MX: 'Mexico', VN: 'Vietnam' }[work.market]}`,
        ...(work.cursor ? { cursor: work.cursor } : {}),
      },
    };
  throw new Error('不支持的社媒趋势来源');
}
export function parseSocialResult(work, payload) {
  const source = work.source;
  const rows = {
    tiktok: payload.search_item_list,
    instagram: payload.reels,
    facebook: payload.videos,
  }[source];
  if (!Array.isArray(rows))
    throw new Error('趋势接口返回结构异常，未作为空结果保存');
  const map = new Map();
  for (const raw of rows.slice(0, 250)) {
    const r = raw.aweme_info || raw;
    let id, url, date, author, stats;
    if (source === 'tiktok') {
      id = String(r.aweme_id || '');
      url = /^\d{10,30}$/.test(id)
        ? `https://www.tiktok.com/@${encodeURIComponent(r.author?.unique_id || '_')}/video/${id}`
        : '';
      date = r.create_time;
      author = r.author?.unique_id;
      stats = {
        views: r.statistics?.play_count,
        likes: r.statistics?.digg_count,
        comments: r.statistics?.comment_count,
      };
    } else if (source === 'instagram') {
      id = String(r.id || r.shortcode || '');
      url = r.url;
      date = r.taken_at || r.taken_at_timestamp || r.created_at;
      author = r.owner?.username;
      stats = {
        views: r.video_play_count ?? r.play_count,
        likes: r.like_count,
        comments: r.comment_count,
      };
    } else {
      id = String(r.id || r.url || '');
      url = r.url;
      date = r.creation_time ?? r.publish_time;
      author = r.author?.name;
      stats = {
        views: r.view_count,
        likes: r.like_count,
        comments: r.comment_count,
      };
    }
    url = publicUrl(url, source);
    if (!id || !url) continue;
    map.set(id, {
      id: id.slice(0, 300),
      url,
      publishedAt: published(date),
      author: String(author || '').slice(0, 150),
      ...Object.fromEntries(
        Object.entries(stats).map(([k, v]) => [k, count(v)]),
      ),
    });
  }
  const cursor =
    payload.has_more === false || payload.has_more === 0
      ? null
      : (payload.cursor ?? null);
  return {
    items: [...map.values()],
    cursor,
    hasMore:
      source === 'instagram'
        ? rows.length > 0
        : Boolean(cursor) && cursor !== work.cursor,
    creditsCharged: count(payload.credits_charged),
    coverage: {
      tiktok:
        'TikTok关键词搜索样本；地区参数是访问出口，不证明作者或受众国家；搜索结果可能重复或截断',
      instagram:
        'Google已索引Reels样本；时间参数为索引窗口，周期统计使用真实发布时间；国家名称只是关键词提示',
      facebook:
        'Facebook公开视频/Reels搜索样本；接口没有日期过滤，按返回内容真实发布时间分组；国家名称只是关键词提示',
    }[source],
  };
}
export async function fetchSocialTrend(work, key, fetcher = fetch) {
  const request = socialRequest(work),
    url = new URL(`${HOST}${request.path}`);
  for (const [k, v] of Object.entries(request.params))
    url.searchParams.set(k, String(v));
  const response = await fetcher(url, {
    headers: { 'x-api-key': key },
    redirect: 'error',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    const e = new Error(
      `社媒趋势接口HTTP ${response.status}；本日停止自动调用，请核对权限、限流和额度`,
    );
    e.status = response.status;
    throw e;
  }
  const data = await response.json();
  if (data.success === false)
    throw new Error('社媒趋势接口未成功返回，扣费待确认');
  return parseSocialResult(work, data);
}
