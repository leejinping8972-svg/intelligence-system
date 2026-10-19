import { Buffer } from 'node:buffer';

import {
  discoveryRequest,
  parseDiscovery,
} from './public-content-discovery.mjs';
import {
  cleanText,
  contentPlan,
  decodeXml,
  normalizeContent,
  publicUrl,
} from './public-content-domain.mjs';

export class ContentProviderError extends Error {
  constructor(message, status = 'failed') {
    super(message);
    this.state = status;
  }
}
async function request(
  url,
  { fetcher = fetch, headers = {}, json = true } = {},
) {
  let response;
  try {
    response = await fetcher(url, {
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new ContentProviderError('连接超时或网络不可达；本次未自动重试');
  }
  if (!response.ok) {
    await response.body?.cancel();
    let reason = '未成功返回数据';
    let state = 'failed';
    if (response.status === 429) {
      state = 'rate_limited';
      reason = '请求受限，其他来源继续';
    }
    if ([401, 403].includes(response.status)) {
      state = 'blocked';
      reason = '请检查密钥、权限或配额';
    }
    throw new ContentProviderError(
      `来源 HTTP ${response.status}：${reason}`,
      state,
    );
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 4_000_000)
      throw new ContentProviderError('来源返回内容超过大小限制');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!json) return text;
  try {
    const data = JSON.parse(text);
    if (data.success === false)
      throw new Error('Provider returned success=false');
    return data;
  } catch {
    throw new ContentProviderError(
      '来源未返回有效数据，请检查账户额度或稍后重试',
    );
  }
}
const urlWith = (base, params) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u;
};
const dateSeconds = (n) =>
  Number(n) > 0 && Number.isFinite(Number(n))
    ? new Date(Number(n) * 1000).toISOString()
    : null;
const list = (value, name) => {
  if (!Array.isArray(value))
    throw new ContentProviderError(`来源未返回 ${name} 列表，未标记为采集成功`);
  return value;
};
export function parseMedline(xml) {
  if (!/<nlmSearchResult\b/.test(xml) || /<error\b/i.test(xml))
    throw new ContentProviderError('MedlinePlus 未返回有效检索结果');
  return [
    ...xml.matchAll(/<document\b([^>]*)>([\s\S]*?)<\/document>/g),
  ].flatMap(([, attrs, body]) => {
    const rawUrl = decodeXml(attrs.match(/\burl="([^"]+)"/)?.[1]);
    const values = {};
    for (const [, name, value] of body.matchAll(
      /<content\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/content>/g,
    ))
      values[name.toLowerCase()] = cleanText(decodeXml(value));
    const url = publicUrl(rawUrl, ['medlineplus.gov']);
    return url
      ? [
          {
            sourceId: url,
            url,
            title: values.title,
            author: values.organizationname || 'National Library of Medicine',
            summary: values.fullsummary || values.snippet || '',
            type: 'article',
          },
        ]
      : [];
  });
}
export async function searchContentSource(step, input, io = {}) {
  const { source, query } = step;
  const planLength = contentPlan(input).length;
  input = {
    ...input,
    language: step.language || input.language,
    market: step.market || input.market,
    searchScope:
      step.scope ||
      (['europepmc', 'medlineplus'].includes(source) ? 'global' : 'local'),
  };
  const perSource = Math.min(
    20,
    Math.max(1, Math.ceil(input.limit / Math.max(1, planLength))),
  );
  const fetcher = io.fetcher || fetch;
  let creditsCharged = null;
  let data;
  let raw = [];
  if (source === 'youtube') {
    const key = await io.youtubeKey?.();
    if (!key)
      throw new ContentProviderError(
        '尚未配置 YouTube Key，请在数据源与设置中填写',
        'unconfigured',
      );
    data = await request(
      urlWith('https://www.googleapis.com/youtube/v3/search', {
        part: 'snippet',
        type: 'video',
        q: query,
        maxResults: perSource,
        relevanceLanguage: input.language,
        regionCode: input.market,
        safeSearch: 'moderate',
        key,
      }),
      { fetcher },
    );
    raw = list(data.items, 'items').flatMap((item) =>
      /^[\w-]{11}$/.test(item.id?.videoId || '')
        ? [
            {
              sourceId: item.id.videoId,
              title: decodeXml(item.snippet?.title),
              summary: decodeXml(item.snippet?.description),
              author: item.snippet?.channelTitle || '',
              publishedAt: item.snippet?.publishedAt,
              type: 'video',
              url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
              thumbnail: publicUrl(item.snippet?.thumbnails?.medium?.url, [
                'ytimg.com',
              ]),
              videoId: item.id.videoId,
              marketBasis:
                '地区参数表示在目标国家可观看，语言仅为相关性偏好；作者地区未核实',
            },
          ]
        : [],
    );
  } else if (
    [
      'facebook',
      'facebook_posts',
      'global_health',
      'instagram',
      'local_health',
      'web_articles',
    ].includes(source)
  ) {
    const key = await io.scrapeKey?.();
    if (!key)
      throw new ContentProviderError(
        '请在数据源与设置中配置 ScrapeCreators Key',
        'unconfigured',
      );
    const discovery = discoveryRequest(source, query, input);
    data = await request(
      urlWith(
        `https://api.scrapecreators.com${discovery.path}`,
        discovery.params,
      ),
      { fetcher, headers: { 'x-api-key': key } },
    );
    raw = parseDiscovery(source, data, input, perSource, list);
    creditsCharged = Number.isFinite(data.credits_charged)
      ? data.credits_charged
      : null;
  } else if (source === 'reddit' || source === 'tiktok') {
    const key = await io.scrapeKey?.();
    if (!key)
      throw new ContentProviderError(
        '尚未配置 ScrapeCreators Key，请在数据源与设置中填写',
        'unconfigured',
      );
    const path =
      source === 'reddit' ? '/v1/reddit/search' : '/v1/tiktok/search/keyword';
    data = await request(
      urlWith(
        `https://api.scrapecreators.com${path}`,
        source === 'reddit'
          ? { query, filter: 'posts', sort: 'relevance', timeframe: 'all' }
          : { query, region: input.market, sort_by: 'relevance' },
      ),
      { fetcher, headers: { 'x-api-key': key } },
    );
    creditsCharged = Number.isFinite(data.credits_charged)
      ? data.credits_charged
      : null;
    if (source === 'reddit')
      raw = list(data.posts, 'posts')
        .slice(0, perSource)
        .flatMap((post) => {
          if (post.over_18 || post.nsfw) return [];
          const url = publicUrl(
            `https://www.reddit.com${post.permalink || ''}`,
            ['reddit.com'],
          );
          const fallback = publicUrl(post.url, ['reddit.com']);
          const link = post.permalink ? url : fallback;
          return link
            ? [
                {
                  sourceId: String(post.name || post.id || ''),
                  url: link,
                  title: post.title,
                  summary: post.selftext || '',
                  author: post.author || '',
                  subreddit: cleanText(post.subreddit, 100),
                  marketBasis:
                    'Reddit 按关键词检索，没有国家过滤；作者地区未核实',
                  publishedAt:
                    post.created_at_iso || dateSeconds(post.created_utc),
                  type: post.is_video ? 'video' : 'post',
                  thumbnail: publicUrl(post.thumbnail, [
                    'redd.it',
                    'redditmedia.com',
                  ]),
                  interactions: {
                    likes: post.score ?? post.ups ?? null,
                    comments: post.num_comments ?? null,
                  },
                },
              ]
            : [];
        });
    if (source === 'tiktok')
      raw = list(data.search_item_list, 'search_item_list')
        .slice(0, perSource)
        .flatMap((item) => {
          if (!/^\d{10,30}$/.test(String(item.aweme_id))) return [];
          const user = item.author?.unique_id;
          const url = user
            ? `https://www.tiktok.com/@${encodeURIComponent(user)}/video/${item.aweme_id}`
            : `https://www.tiktok.com/@_/video/${item.aweme_id}`;
          return [
            {
              sourceId: String(item.aweme_id),
              url,
              title: item.desc || 'TikTok 视频',
              summary: item.desc || '',
              author: item.author?.nickname || user || '',
              language: item.desc_language || 'unknown',
              marketBasis: '已传目标地区参数；不代表作者国家或观众地区已核实',
              publishedAt: dateSeconds(item.create_time),
              type: 'video',
              thumbnail: publicUrl(item.video?.cover?.url_list?.[0], [
                'tiktokcdn.com',
                'tiktokcdn-us.com',
                'tiktokcdn-eu.com',
                'tiktok.com',
              ]),
              interactions: {
                views: item.statistics?.play_count ?? null,
                likes: item.statistics?.digg_count ?? null,
                comments: item.statistics?.comment_count ?? null,
              },
            },
          ];
        });
  } else if (source === 'medlineplus') {
    if (input.language === 'vi')
      throw new ContentProviderError(
        'MedlinePlus 仅提供英语和西语主题；本次越南语请求已跳过',
        'unsupported',
      );
    data = await request(
      urlWith('https://wsearch.nlm.nih.gov/ws/query', {
        db: input.language === 'es' ? 'healthTopicsSpanish' : 'healthTopics',
        term: query,
        retmax: perSource,
        rettype: 'brief',
        tool: 'IntelligencePublicContent',
      }),
      { fetcher, json: false },
    );
    raw = parseMedline(data).map((item) => ({
      ...item,
      language: input.language,
    }));
  } else if (source === 'europepmc') {
    data = await request(
      urlWith('https://www.ebi.ac.uk/europepmc/webservices/rest/search', {
        query: `(${query.replaceAll(/[{}[\]"\\]/g, ' ')})`,
        format: 'json',
        resultType: 'core',
        pageSize: perSource,
      }),
      { fetcher },
    );
    raw = list(data.resultList?.result, 'resultList.result').map((item) => ({
      sourceId: `${item.source}:${item.id}`,
      title: item.title,
      author: item.authorString || '',
      summary: cleanText(item.abstractText),
      publishedAt: item.firstPublicationDate,
      language: item.language || 'unknown',
      type: 'paper',
      url: item.pmid
        ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(item.pmid)}/`
        : `https://europepmc.org/article/${encodeURIComponent(item.source)}/${encodeURIComponent(item.id)}`,
      doi: item.doi || '',
      publicationType: item.pubTypeList?.pubType || [],
      fullTextUrl: publicUrl(
        item.fullTextUrlList?.fullTextUrl?.find(
          (link) => link.availabilityCode === 'OA',
        )?.url,
        ['pmc.ncbi.nlm.nih.gov', 'europepmc.org'],
      ),
      textAvailability: item.abstractText
        ? '研究摘要；全文请查看原文'
        : '仅文献索引',
    }));
  } else throw new ContentProviderError('不支持的数据来源');
  const payloadKey = {
    youtube: 'items',
    reddit: 'posts',
    tiktok: 'search_item_list',
    facebook: 'videos',
    instagram: 'reels',
    facebook_posts: 'results',
    local_health: 'results',
    global_health: 'results',
    web_articles: 'results',
  }[source];
  const returned = payloadKey ? data?.[payloadKey] : data?.resultList?.result;
  return {
    items: raw
      .slice(0, perSource)
      .map((item) => normalizeContent(item, source, input, query))
      .filter(Boolean),
    rawCount: Array.isArray(returned) ? returned.length : raw.length,
    pageLimit: perSource,
    candidateCount: Math.min(raw.length, perSource),
    creditsCharged,
  };
}
export async function fetchContentComments(item, io = {}) {
  const url = publicUrl(item.url, ['reddit.com']);
  if (
    item.source !== 'reddit' ||
    !url ||
    !/\/comments\/[a-z\d]+\//i.test(new URL(url).pathname)
  )
    throw new ContentProviderError('仅支持已入库 Reddit 帖子的评论');
  const key = await io.scrapeKey?.();
  if (!key)
    throw new ContentProviderError('请配置 ScrapeCreators Key', 'unconfigured');
  const result = await request(
    urlWith('https://api.scrapecreators.com/v1/reddit/post/comments', {
      url,
      trim: true,
    }),
    { fetcher: io.fetcher || fetch, headers: { 'x-api-key': key } },
  );
  const comments = list(result.comments, 'comments')
    .slice(0, 20)
    .map((comment) => ({
      id: cleanText(comment.id, 80),
      author: cleanText(comment.author, 120),
      text: cleanText(comment.body, 4000),
      url: publicUrl(comment.url || comment.permalink, ['reddit.com']),
      score: typeof comment.score === 'number' ? comment.score : null,
    }))
    .filter(
      (comment) =>
        comment.text && !['[deleted]', '[removed]'].includes(comment.text),
    );
  return {
    comments: {
      items: comments,
      collectedAt: new Date().toISOString(),
      completeness: '仅本次返回的前20条顶层评论，非完整评论树',
    },
    creditsCharged: Number.isFinite(result.credits_charged)
      ? result.credits_charged
      : null,
  };
}
export async function fetchContentTranscript(item, io = {}) {
  if (item.source !== 'youtube' || !/^[\w-]{11}$/.test(item.videoId || ''))
    throw new ContentProviderError('首版仅支持读取 YouTube 已有字幕');
  const key = await io.scrapeKey?.();
  if (!key)
    throw new ContentProviderError(
      '请配置 ScrapeCreators Key 后获取字幕',
      'unconfigured',
    );
  const result = await request(
    urlWith('https://api.scrapecreators.com/v1/youtube/video/transcript', {
      url: `https://www.youtube.com/watch?v=${item.videoId}`,
      original_audio: true,
      cache_max_age: '7d',
    }),
    { fetcher: io.fetcher || fetch, headers: { 'x-api-key': key } },
  );
  const segments = Array.isArray(result.transcript)
    ? result.transcript.slice(0, 500).map((s) => ({
        text: cleanText(s.text, 1000),
        startMs: Number(s.startMs) || 0,
      }))
    : [];
  return {
    transcript: {
      text: cleanText(
        result.transcript_only_text || segments.map((s) => s.text).join(' '),
        30_000,
      ),
      segments,
      language: cleanText(result.language, 40),
      collectedAt: new Date().toISOString(),
    },
    creditsCharged: Number.isFinite(result.credits_charged)
      ? result.credits_charged
      : null,
  };
}
