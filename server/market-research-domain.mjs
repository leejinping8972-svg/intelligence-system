import { createHash } from 'node:crypto';

const markets = new Set(['MX', 'US', 'VN']);
const languages = { US: 'en', MX: 'es', VN: 'vi' };

const integer = (value, fallback, min, max, message) => {
  const result = Number(value ?? fallback);
  if (!Number.isInteger(result) || result < min || result > max)
    throw new Error(message);
  return result;
};

export const defaultMarketPlan = (market = 'VN') => ({
  market,
  language: languages[market] || 'en',
  seeds: [],
  keywordIds: [],
  sources: {
    tiktokShop: true,
    tiktokContent: true,
    tiktokComments: true,
    metaActiveAds: true,
    independentSites: true,
  },
  budgets: {
    maxProducts: market === 'VN' ? 1000 : 500,
    perKeyword: 50,
    productRequests: 2000,
    maxAdsPerKeyword: 100,
    adPages: 5,
    adRequests: 1000,
    maxContentQueries: 10,
    contentPerQuery: 50,
    commentVideos: 20,
    commentPages: 3,
    siteProducts: 500,
    siteRequests: 1000,
    siteDetailProducts: 100,
  },
});

export function validateMarketPlan(input = {}) {
  if (!markets.has(input.market)) throw new Error('请选择美国、墨西哥或越南');
  const base = defaultMarketPlan(input.market);
  const seeds = [
    ...new Set(
      (Array.isArray(input.seeds)
        ? input.seeds
        : String(input.seeds || '').split(/\r?\n/)
      )
        .map((value) =>
          String(value).normalize('NFKC').replaceAll(/\s+/g, ' ').trim(),
        )
        .filter(Boolean),
    ),
  ];
  if (
    seeds.length === 0 ||
    seeds.length > 100 ||
    seeds.some((value) => value.length > 200)
  )
    throw new Error('请输入1～100个市场种子词，每词不超过200字符');
  const keywordIds = [...new Set(input.keywordIds || [])];
  if (
    keywordIds.length > 100 ||
    keywordIds.some((id) => typeof id !== 'string' || id.length > 120)
  )
    throw new Error('关联关键词最多100个');
  const sources = Object.fromEntries(
    Object.keys(base.sources).map((key) => [
      key,
      input.sources?.[key] === undefined
        ? base.sources[key]
        : input.sources[key] === true,
    ]),
  );
  if (!Object.values(sources).some(Boolean))
    throw new Error('请至少选择一个数据来源');
  if (sources.tiktokComments && !sources.tiktokContent)
    throw new Error('评论采集需要同时开启商品相关TikTok内容检索');
  if (sources.metaActiveAds && keywordIds.length === 0)
    throw new Error('采集Meta在投广告时至少关联1个已入选关键词');
  const b = input.budgets || {};
  const budgets = {
    maxProducts: integer(
      b.maxProducts,
      base.budgets.maxProducts,
      1,
      1000,
      'TikTok Shop商品上限须为1～1000',
    ),
    perKeyword: integer(
      b.perKeyword,
      base.budgets.perKeyword,
      1,
      100,
      '单词商品上限须为1～100',
    ),
    productRequests: integer(
      b.productRequests,
      base.budgets.productRequests,
      1,
      100_000,
      '商品请求上限须为1～100000',
    ),
    maxAdsPerKeyword: integer(
      b.maxAdsPerKeyword,
      base.budgets.maxAdsPerKeyword,
      1,
      100,
      '单词广告上限须为1～100',
    ),
    adPages: integer(
      b.adPages,
      base.budgets.adPages,
      1,
      10,
      '广告页数须为1～10',
    ),
    adRequests: integer(
      b.adRequests,
      base.budgets.adRequests,
      1,
      1000,
      '广告请求上限须为1～1000',
    ),
    maxContentQueries: integer(
      b.maxContentQueries,
      base.budgets.maxContentQueries,
      1,
      20,
      '内容检索词须为1～20',
    ),
    contentPerQuery: integer(
      b.contentPerQuery,
      base.budgets.contentPerQuery,
      5,
      100,
      '每次内容结果须为5～100',
    ),
    commentVideos: integer(
      b.commentVideos,
      base.budgets.commentVideos,
      0,
      20,
      '评论视频数须为0～20',
    ),
    commentPages: integer(
      b.commentPages,
      base.budgets.commentPages,
      1,
      10,
      '评论页数须为1～10',
    ),
    siteProducts: integer(
      b.siteProducts,
      base.budgets.siteProducts,
      1,
      1000,
      '独立站商品上限须为1～1000',
    ),
    siteRequests: integer(
      b.siteRequests,
      base.budgets.siteRequests,
      1,
      2000,
      '独立站请求上限须为1～2000',
    ),
    siteDetailProducts: integer(
      b.siteDetailProducts,
      base.budgets.siteDetailProducts,
      0,
      1000,
      '独立站详情目标须为0～1000',
    ),
  };
  if (budgets.productRequests < seeds.length)
    throw new Error('商品请求上限不足以覆盖全部种子词');
  if (budgets.siteDetailProducts > budgets.siteProducts)
    throw new Error('独立站详情目标不能超过商品上限');
  return {
    market: input.market,
    language: languages[input.market],
    seeds,
    keywordIds,
    sources,
    budgets,
  };
}

export function marketRunStages(plan) {
  const result = [];
  if (plan.sources.tiktokShop)
    result.push({
      key: 'tiktok_shop',
      label: 'TikTok Shop商品',
      status: 'pending',
    });
  if (plan.sources.tiktokContent)
    result.push({
      key: 'tiktok_content',
      label: '商品相关TikTok内容',
      status: 'pending',
    });
  if (plan.sources.tiktokComments && plan.budgets.commentVideos > 0)
    result.push({
      key: 'tiktok_comments',
      label: '重点TikTok内容评论',
      status: 'pending',
    });
  if (plan.sources.metaActiveAds)
    result.push({
      key: 'meta_ads',
      label: 'Meta在投广告与落地站',
      status: 'pending',
    });
  if (plan.sources.independentSites)
    result.push({
      key: 'site_products',
      label: '独立站商品',
      status: 'pending',
    });
  return result;
}

export const terminalStatus = (status) =>
  ['cancelled', 'completed', 'failed', 'partial'].includes(status);

export function marketChildRequestId(runId, stage, index = 0) {
  const hex = createHash('sha256')
    .update(`${runId}:${stage}:${index}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
