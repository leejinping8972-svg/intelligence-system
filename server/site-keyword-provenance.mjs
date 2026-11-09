const clean = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim()
    : '';
const key = (value) => clean(value).toLowerCase();
const array = (value) => (Array.isArray(value) ? value : []);
const unique = (values) => [
  ...new Map(
    values.filter(Boolean).map((value) => [key(value), clean(value)]),
  ).values(),
];

/** Interpret saved provenance without inventing searches or splitting query punctuation. */
export function siteKeywordProvenance(site) {
  const searches = [...array(site.queryTerms), site.query];
  const nonSearch = [];
  const discoveries = [];
  const evidence = [];
  for (const item of array(site.sourceEvidence)) {
    if (!item || typeof item !== 'object') continue;
    const text = clean(item.keyword);
    const source = clean(item.source);
    const row = {
      source,
      text,
      url: item.url || '',
      collectedAt: item.collectedAt || '',
    };
    const competitor = text.match(/^保健品付费搜索竞品\s+(.+)$/);
    if (competitor || /domain_adwords_adwords/i.test(source)) {
      discoveries.push({
        ...row,
        source: /semrush/i.test(source) ? 'Semrush · 搜索广告竞品拓展' : source,
        text: competitor
          ? `与 ${competitor[1]} 竞争搜索广告关键词的站点`
          : text || '搜索广告竞品拓展',
      });
      nonSearch.push(text);
    } else if (
      /官网|官方|domain_rank|domain_traffic|人工|导入/i.test(source) ||
      /^付费搜索占比\s/.test(text)
    ) {
      evidence.push({
        ...row,
        source: /domain_rank|domain_traffic/i.test(source)
          ? 'Semrush · 搜索流量'
          : source,
      });
      nonSearch.push(text);
    } else if (text) {
      searches.push(text);
    }
    if (item.query) searches.push(item.query);
  }
  const primary = clean(site.keyword);
  if (/^保健品付费搜索竞品\s/.test(primary)) {
    nonSearch.push(primary);
    if (
      !discoveries.some((row) =>
        key(row.text).includes(
          key(primary.replace(/^保健品付费搜索竞品\s+/, '')),
        ),
      )
    )
      discoveries.push({
        source: '历史竞品拓展',
        text: primary.replace(/^保健品付费搜索竞品\s+/, '搜索广告竞品拓展：'),
        url: '',
        collectedAt: '',
      });
  } else if (primary) {
    const productNames = [
      ...array(site.mainProducts),
      ...array(site.categoryEvidence),
    ];
    const isEvidence =
      nonSearch.some((value) => key(value) === key(primary)) ||
      (evidence.length > 0 &&
        productNames.some((value) => key(value) === key(primary)));
    if (isEvidence) nonSearch.push(primary);
    else searches.push(primary);
  }
  const queryTerms = unique(searches);
  const queryKeys = new Set(queryTerms.map((term) => key(term)));
  return {
    queryTerms,
    nonSearchTerms: unique(nonSearch).filter(
      (term) => !queryKeys.has(key(term)),
    ),
    discoveries,
    evidence,
  };
}
