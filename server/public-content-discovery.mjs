import {
  cleanText,
  GLOBAL_HEALTH_SITES,
  HEALTH_SITES,
  marketName,
  publicUrl,
} from './public-content-domain.mjs';

// Only the fixed ScrapeCreators endpoint is fetched. Returned links are never
// crawled automatically; arbitrary article URLs cannot become SSRF targets.
export function articleUrl(value) {
  try {
    const url = new URL(value);
    if (!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(url.hostname))
      return '';
    if (/\.(?:local|internal|localhost|test|invalid)$/i.test(url.hostname))
      return '';
    return publicUrl(value, [url.hostname]);
  } catch {
    return '';
  }
}
export function discoveryRequest(source, query, input) {
  const local = input.searchScope !== 'global';
  const localized = local
    ? `${query} ${marketName(input.market)}`.trim()
    : query;
  if (source === 'facebook')
    return { path: '/v1/facebook/search/videos', params: { query: localized } };
  if (source === 'instagram')
    return { path: '/v2/instagram/reels/search', params: { query: localized } };
  let search = query;
  if (source === 'facebook_posts') search = `${localized} site:facebook.com`;
  if (source === 'local_health')
    search = `${query} (${(HEALTH_SITES[input.market] || []).map((host) => `site:${host}`).join(' OR ')})`;
  if (source === 'global_health')
    search = `${query} (${GLOBAL_HEALTH_SITES.map((host) => `site:${host}`).join(' OR ')})`;
  if (source === 'web_articles' && local) search = localized;
  return {
    path: '/v1/google/search',
    params: { query: search, ...(local ? { region: input.market } : {}) },
  };
}
const number = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export function parseDiscovery(source, data, input, limit, getList) {
  if (source === 'facebook')
    return getList(data.videos, 'videos')
      .slice(0, limit)
      .flatMap((video) => {
        const url = publicUrl(video.url, ['facebook.com']);
        return url
          ? [
              {
                sourceId: String(video.id || url),
                url,
                title: video.title || video.description,
                summary: video.description || '',
                type: 'video',
                author: video.author?.name || '',
                thumbnail: publicUrl(video.thumbnail_url, ['fbcdn.net']),
                publishedAt:
                  typeof video.creation_time === 'number'
                    ? new Date(video.creation_time * 1000).toISOString()
                    : video.publish_time,
                marketBasis:
                  '关键词附带目标国家名称；平台不提供严格国家筛选，作者地区未核实',
              },
            ]
          : [];
      });
  if (source === 'instagram')
    return getList(data.reels, 'reels')
      .slice(0, limit)
      .flatMap((reel) => {
        const url = publicUrl(reel.url, ['instagram.com']);
        return url
          ? [
              {
                sourceId: String(reel.id || reel.shortcode || url),
                url,
                title: cleanText(reel.caption, 500) || 'Instagram Reel',
                summary: reel.caption || '',
                author: reel.owner?.full_name || reel.owner?.username || '',
                type: 'video',
                thumbnail: publicUrl(reel.thumbnail_src, [
                  'cdninstagram.com',
                  'fbcdn.net',
                ]),
                publishedAt: reel.taken_at,
                interactions: {
                  likes: number(reel.like_count),
                  comments: number(reel.comment_count),
                },
                marketBasis:
                  '公开 Reels 网页索引，关键词附带目标国家名称；作者地区未核实',
              },
            ]
          : [];
      });
  return getList(data.results, 'results')
    .slice(0, limit)
    .flatMap((result) => {
      let url = articleUrl(result.url);
      if (source === 'facebook_posts') {
        url = publicUrl(url, ['facebook.com']);
        if (
          url &&
          !/\/(?:posts|permalink|photos|story\.php|permalink\.php)\b/i.test(
            new URL(url).pathname,
          )
        )
          url = '';
      }
      if (source === 'local_health')
        url = publicUrl(url, HEALTH_SITES[input.market] || []);
      if (source === 'global_health') url = publicUrl(url, GLOBAL_HEALTH_SITES);
      if (!url) return [];
      let marketBasis =
        input.searchScope === 'global'
          ? '全球网页参考，未限定来源国家；权威性未核实'
          : '地区偏好与关键词国家提示；来源国家及内容语言未核实';
      if (source === 'local_health')
        marketBasis =
          '目标市场卫生机构 / 医院站点白名单；不等于作者国家或功效已核实';
      if (source === 'global_health')
        marketBasis =
          '国际卫生机构站点白名单；非目标国家限定，不代表支持当前产品宣称';
      return [
        {
          sourceId: url,
          url,
          title: result.title,
          summary: result.description || '',
          author: new URL(url).hostname,
          type: source === 'facebook_posts' ? 'post' : 'article',
          textAvailability: '搜索索引摘要；正文请查看原文',
          publisherCountry:
            source === 'local_health' ? input.market : 'unknown',
          marketBasis,
        },
      ];
    });
}
