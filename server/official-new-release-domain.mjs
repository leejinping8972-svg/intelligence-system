export const officialHosts = { US: 'www.amazon.com', MX: 'www.amazon.com.mx' };
export const defaultOfficialBoard =
  'https://www.amazon.com/gp/new-releases/hpc/3760901';

// Only platform-owned new-release boards are accepted. No search or best-seller fallback.
export function officialBoardUrl(value, market = 'US') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('请填写Amazon官方新品榜链接');
  }
  const path = url.pathname.replace(/\/ref=[^/]*\/?$/, '').replace(/\/$/, '');
  if (
    url.protocol !== 'https:' ||
    url.hostname !== officialHosts[market] ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/gp\/new-releases(?:\/[a-z0-9_-]+){0,2}$/.test(path)
  )
    throw new Error(
      '仅接受所选站点的Amazon官方新品榜链接（/gp/new-releases），不支持搜索页或销量榜',
    );
  const page = url.searchParams.get('pg');
  if (page && !/^(?:[1-9]|10)$/.test(page)) throw new Error('新品榜页码无效');
  return `https://${url.hostname}${path}${page && page !== '1' ? `?pg=${page}` : ''}`;
}

export function officialBoards(input, market) {
  const values = Array.isArray(input)
    ? input
    : String(input || '')
        .split(/\r?\n/)
        .filter((v) => v.trim());
  if (!values.length && market !== 'US')
    throw new Error('该站点尚无已验证的默认新品榜，请填写官方新品榜链接');
  if (values.length > 20) throw new Error('最多填写20个官方新品榜链接');
  return [
    ...new Set(
      (values.length ? values : [defaultOfficialBoard]).map((v) => {
        const url = new URL(officialBoardUrl(String(v).trim(), market));
        url.search = '';
        return url.href;
      }),
    ),
  ];
}

export const officialCapabilities = () => ({
  channels: [
    {
      id: 'amazon',
      name: 'Amazon官方新品榜',
      tools: ['official_new_releases'],
      markets: ['US', 'MX'],
      sourceMarket: 'US',
    },
  ],
  social: [],
});
