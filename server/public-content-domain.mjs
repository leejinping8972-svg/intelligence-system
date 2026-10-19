import { createHash } from 'node:crypto';

export const CONTENT_SOURCES = {
  youtube: {
    label: 'YouTube',
    category: 'social',
    credential: 'youtube',
    scopes: ['local'],
  },
  reddit: {
    label: 'Reddit / ScrapeCreators',
    category: 'social',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  tiktok: {
    label: 'TikTok / ScrapeCreators',
    category: 'social',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  facebook: {
    label: 'Facebook 公开视频 / ScrapeCreators',
    category: 'social',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  facebook_posts: {
    label: 'Facebook 公开帖子（网页索引）',
    category: 'social',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  instagram: {
    label: 'Instagram Reels / ScrapeCreators',
    category: 'social',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  local_health: {
    label: '本地卫生机构 / 医院文章（网页索引）',
    category: 'health',
    credential: 'scrapecreators',
    scopes: ['local'],
  },
  global_health: {
    label: 'NIH ODS / NCCIH / NHS / WHO（机构文章索引）',
    category: 'health',
    credential: 'scrapecreators',
    scopes: ['global'],
  },
  web_articles: {
    label: '网页文章 / 博客（网页索引）',
    category: 'web',
    credential: 'scrapecreators',
    scopes: ['local', 'global'],
  },
  medlineplus: {
    label: 'MedlinePlus / 美国国家医学图书馆',
    category: 'health',
    scopes: ['global'],
  },
  europepmc: {
    label: 'Europe PMC 文献检索',
    category: 'academic',
    scopes: ['global'],
  },
};
export const CONTENT_SCOPES = {
  local: '目标市场本地素材',
  global: '全球参考证据',
};
export const paidContentSource = (source) =>
  CONTENT_SOURCES[source]?.credential === 'scrapecreators' ||
  ['reddit_comments', 'youtube_transcript'].includes(source);
export const HEALTH_SITES = {
  VN: ['moh.gov.vn', 'vinmec.com', 'hcdc.vn'],
  US: ['medlineplus.gov', 'nih.gov', 'cdc.gov'],
  MX: ['gob.mx', 'imss.gob.mx', 'insp.mx'],
};
export const GLOBAL_HEALTH_SITES = [
  'ods.od.nih.gov',
  'nccih.nih.gov',
  'nhs.uk',
  'who.int',
];
export const marketName = (market) =>
  ({ VN: 'Việt Nam', US: 'United States', MX: 'México' })[market] || '';
export const cleanText = (value, max = 12_000) =>
  typeof value === 'string'
    ? value
        .slice(0, max * 4)
        .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replaceAll(/<[^>]*>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
export function decodeXml(value) {
  return String(value || '')
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replaceAll(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
      const known = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
        '&quot;': '"',
        '&apos;': "'",
      };
      if (known[entity]) return known[entity];
      const n = Number.parseInt(
        entity.slice(entity[2] === 'x' ? 3 : 2, -1),
        entity[2] === 'x' ? 16 : 10,
      );
      return n > 0 && n <= 1_114_111 ? String.fromCodePoint(n) : '';
    });
}
export function publicUrl(value, hosts) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !hosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^fbclid$|^gclid$/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return '';
  }
}
const aliases = [
  [
    'creatine|creatina|肌酸',
    { en: 'creatine', es: 'creatina', vi: 'creatine' },
  ],
  [
    'magnesium|magnesio|magie|甘氨酸镁',
    {
      en: 'magnesium glycinate',
      es: 'glicinato de magnesio',
      vi: 'magie glycinate',
    },
  ],
  [
    'probiotic|probiótico|益生菌|men vi sinh',
    { en: 'probiotic', es: 'probiótico', vi: 'men vi sinh' },
  ],
  [
    'collagen|colágeno|胶原',
    {
      en: 'collagen peptide',
      es: 'péptidos de colágeno',
      vi: 'collagen peptide',
    },
  ],
  ['inositol|肌醇', { en: 'inositol', es: 'inositol', vi: 'inositol' }],
  [
    'berberine|berberina|小檗碱',
    { en: 'berberine', es: 'berberina', vi: 'berberine' },
  ],
  [
    'electrolyte|electrolitos|电解质|điện giải',
    { en: 'electrolyte', es: 'electrolitos', vi: 'điện giải' },
  ],
  [
    'fiber|fibra|纤维|chất xơ',
    { en: 'dietary fiber', es: 'fibra dietética', vi: 'chất xơ' },
  ],
];
const linkIds = (value) =>
  [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map(String)
        .filter((v) => /^[\w:-]{1,120}$/.test(v)),
    ),
  ].slice(0, 20);
export function validateContentSearch(input) {
  const query = cleanText(input.query, 200);
  if (query.length < 2) throw new Error('请填写2～200个字符的关键词或产品名称');
  if (!['MX', 'US', 'VN'].includes(input.market))
    throw new Error('请选择国家市场');
  if (!['en', 'es', 'vi'].includes(input.language))
    throw new Error('请选择检索语言');
  if (!Array.isArray(input.sources)) throw new Error('请选择有效的数据来源');
  const sources = [...new Set(input.sources || [])];
  if (
    sources.length === 0 ||
    sources.some((s) => !Object.hasOwn(CONTENT_SOURCES, s))
  )
    throw new Error('请选择有效的数据来源');
  const scopes =
    input.scopes === undefined
      ? [
          ...new Set(
            sources.flatMap((source) => CONTENT_SOURCES[source].scopes),
          ),
        ]
      : [...new Set(Array.isArray(input.scopes) ? input.scopes : [])];
  if (scopes.length === 0 || scopes.some((scope) => !CONTENT_SCOPES[scope]))
    throw new Error('请勾选检索范围');
  if (
    scopes.some(
      (scope) =>
        !sources.some((source) =>
          CONTENT_SOURCES[source].scopes.includes(scope),
        ),
    )
  )
    throw new Error('每个检索范围至少选择一个适用来源');
  const applicableSources = sources.filter((source) =>
    CONTENT_SOURCES[source].scopes.some((scope) => scopes.includes(scope)),
  );
  const referenceLanguage = input.referenceLanguage === 'es' ? 'es' : 'en';
  const referenceQuery = cleanText(input.referenceQuery, 200) || query;
  if (
    scopes.includes('global') &&
    input.referenceLanguage !== undefined &&
    !['en', 'es'].includes(input.referenceLanguage)
  )
    throw new Error('全球参考检索语言仅支持英语或西班牙语');
  if (scopes.includes('global') && referenceQuery.length < 2)
    throw new Error('全球参考检索词至少2个字符');
  const limit = Number(input.limit ?? 30);
  if (!Number.isInteger(limit) || limit < 5 || limit > 100)
    throw new Error('结果上限须为5～100条');
  const extra = Array.isArray(input.relatedTerms)
    ? input.relatedTerms
        .map((v) => cleanText(v, 100))
        .filter(Boolean)
        .slice(0, 2)
    : [];
  const translated =
    input.includeRelated === true
      ? aliases
          .filter(([pattern]) => new RegExp(pattern, 'iu').test(query))
          .map(([, map]) => map[input.language])
      : [];
  const queries = [
    ...new Set([
      query,
      ...(input.includeRelated === true ? [...extra, ...translated] : []),
    ]),
  ].slice(0, 3);
  return {
    query,
    market: input.market,
    language: input.language,
    sources: applicableSources,
    scopes,
    referenceLanguage,
    referenceQuery,
    referenceQueries: [
      ...new Set([
        referenceQuery,
        ...(input.includeRelated === true
          ? aliases
              .filter(([pattern]) =>
                new RegExp(pattern, 'iu').test(referenceQuery),
              )
              .map(([, map]) => map[referenceLanguage])
          : []),
      ]),
    ].slice(0, 3),
    limit,
    queries,
    includeRelated: input.includeRelated === true,
    organize: input.organize === true,
    fetchDetails: input.fetchDetails !== false,
    keywordIds: linkIds(input.keywordIds),
    productIds: linkIds(input.productIds),
  };
}
export const validItemId = (value) => /^pc-[a-f\d]{24}$/.test(value || '');
const contentLanguage = (value) => {
  const key =
    typeof value === 'string' ? value.toLowerCase().split('-')[0] : '';
  return (
    {
      eng: 'en',
      english: 'en',
      spa: 'es',
      spanish: 'es',
      vie: 'vi',
      vietnamese: 'vi',
    }[key] || (/^[a-z]{2,3}$/.test(key) ? key : 'unknown')
  );
};
export const validJobId = (value) =>
  /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value || '');
export function normalizeContent(
  item,
  source,
  input,
  query,
  now = new Date().toISOString(),
) {
  const title = cleanText(item.title, 500);
  const url = item.url || '';
  if (!title || !url || !item.sourceId) return null;
  const id = `pc-${createHash('sha256').update(`${source}:${item.sourceId}`).digest('hex').slice(0, 24)}`;
  const text = cleanText(`${title} ${item.summary || ''}`)
    .normalize('NFKC')
    .toLocaleLowerCase();
  const words = query
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (t) =>
        t.length > 2 &&
        !['and', 'for', 'suplemento', 'supplement', 'the', 'with'].includes(t),
    );
  const matched = words.filter((word) => text.includes(word));
  if (words.length > 0 && matched.length === 0) return null;
  const date =
    item.publishedAt && Number.isFinite(Date.parse(item.publishedAt))
      ? new Date(item.publishedAt).toISOString()
      : null;
  const searchScope = input.searchScope || CONTENT_SOURCES[source].scopes[0];
  const marketBasis =
    item.marketBasis ||
    (searchScope === 'global'
      ? '全球参考检索，不限定研究或作者国家'
      : '按目标市场检索，作者地区未核实');
  return {
    ...item,
    id,
    title,
    summary: cleanText(item.summary),
    source,
    sourceLabel: CONTENT_SOURCES[source].label,
    category: CONTENT_SOURCES[source].category,
    publishedAt: date,
    collectedAt: now,
    language: contentLanguage(item.language),
    authorCountry: item.authorCountry || 'unknown',
    searchMarket: input.market,
    searchLanguage: input.language,
    matchedQueries: [query],
    matchReason:
      matched.length > 0 ? `命中：${matched.join('、')}` : '来源关键词检索匹配',
    keywordIds: input.keywordIds,
    productIds: input.productIds,
    favorite: false,
    textAvailability:
      item.textAvailability || (item.summary ? '摘要 / 描述' : '仅标题与链接'),
    reuseStatus: '未核验',
    searchScope,
    marketBasis,
    searchContexts: [
      {
        scope: searchScope,
        market: input.market,
        language: input.language,
        query,
        basis: marketBasis,
      },
    ],
  };
}
export function mergeContent(old, incoming) {
  if (!old) return incoming;
  return {
    ...old,
    ...incoming,
    favorite: old.favorite,
    firstCollectedAt: old.firstCollectedAt || old.collectedAt,
    keywordIds: [
      ...new Set([...(old.keywordIds || []), ...(incoming.keywordIds || [])]),
    ],
    productIds: [
      ...new Set([...(old.productIds || []), ...(incoming.productIds || [])]),
    ],
    matchedQueries: [
      ...new Set([
        ...(old.matchedQueries || []),
        ...(incoming.matchedQueries || []),
      ]),
    ],
    searchContexts: [
      ...new Map(
        [...(old.searchContexts || []), ...(incoming.searchContexts || [])].map(
          (context) => [JSON.stringify(context), context],
        ),
      ).values(),
    ].slice(-30),
    ai:
      old.title === incoming.title && old.summary === incoming.summary
        ? old.ai
        : undefined,
    ...(old.transcript ? { transcript: old.transcript } : {}),
    ...(old.transcript?.text ? { textAvailability: '已有字幕' } : {}),
  };
}
export function contentPlan(input) {
  // Query-major round robin prevents one source exhausting all result slots.
  if (input.scopes)
    return Array.from({ length: 3 }, (_, index) => index).flatMap((index) =>
      input.scopes.flatMap((scope) => {
        const query = (
          scope === 'global' ? input.referenceQueries : input.queries
        )?.[index];
        if (!query) return [];
        return input.sources
          .filter((source) => CONTENT_SOURCES[source].scopes.includes(scope))
          .map((source) => ({
            source,
            scope,
            query,
            language:
              scope === 'global' ? input.referenceLanguage : input.language,
            market: scope === 'global' ? 'ALL' : input.market,
            status: 'pending',
            count: 0,
          }));
      }),
    );
  return input.queries.flatMap((query) =>
    input.sources.map((source) => ({
      source,
      query,
      status: 'pending',
      count: 0,
    })),
  );
}
