import { createHash } from 'node:crypto';

export const digest = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 32);
export const dayKey = (now = Date.now()) =>
  new Date(now + 8 * 3_600_000).toISOString().slice(0, 10);
export function validateSchedule(input) {
  const hour = Number(input.hour ?? 8);
  const maxRequests = Number(input.maxRequests ?? 10);
  if (
    !Number.isInteger(hour) ||
    hour < 0 ||
    hour > 23 ||
    !Number.isInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests > 100
  )
    throw new Error('北京时间更新小时须为0～23，每日请求上限须为1～100');
  return { enabled: input.enabled === true, hour, maxRequests };
}
export function due(config, run, now = Date.now()) {
  return (
    config.enabled &&
    (!run || run.day !== dayKey(now)) &&
    new Date(now + 8 * 3_600_000).getUTCHours() >= config.hour
  );
}
export function validateHotwords(input) {
  const config = validateSchedule(input);
  const seeds = [
    ...new Set(
      (Array.isArray(input.seeds) ? input.seeds : [])
        .map((s) => String(s).normalize('NFKC').trim())
        .filter(Boolean),
    ),
  ];
  if (
    !['MX', 'US', 'VN'].includes(input.market) ||
    seeds.length === 0 ||
    seeds.length > 10 ||
    seeds.some((s) => s.length > 100)
  )
    throw new Error('请选择市场并填写1～10个保健品种子词，每词最多100字');
  return {
    ...config,
    market: input.market,
    seeds,
    maxRequests: seeds.length,
    unitLimit: 0,
  };
}
export function rankHotwords(rows, previous = []) {
  const unique = new Map();
  for (const row of rows) {
    const key = row.term?.normalize('NFKC').trim().toLowerCase();
    if (!key || !Number.isFinite(row.volume) || row.volume < 0) continue;
    if (!unique.has(key) || unique.get(key).volume < row.volume)
      unique.set(key, row);
  }
  const old = new Map(previous.map((r) => [r.term.toLowerCase(), r.rank]));
  return [...unique.values()]
    .toSorted((a, b) => b.volume - a.volume || a.term.localeCompare(b.term))
    .slice(0, 100)
    .map((r, i) => ({
      ...r,
      rank: i + 1,
      change: old.has(r.term.toLowerCase())
        ? old.get(r.term.toLowerCase()) - i - 1
        : null,
    }));
}
// Evidence-based lexical extraction: no model calls, no inferred ingredients.
export function extractLaunchTerms(item) {
  const text =
    `${item.title || item.headline || ''} ${item.ingredient || ''} ${item.copy || ''} ${item.claim || ''}`.replaceAll(
      /<[^>]*>/g,
      ' ',
    );
  const matches =
    text.match(
      /omega[ -]?[369](?:[ -][369])*|\b(?:creatine|collagen|magnesium|melatonin|probiotics?|prebiotics?|ashwagandha|berberine|electrolytes?|vitamin\s+[a-z0-9]+|fish oil|coq10|whey protein|l[ -]theanine)(?:\s+(?:gummies|capsules|powder|tablets|citrate|glycinate))?\b|胶原蛋白|益生菌|褪黑素|鱼油|肌酸|维生素[ABCDＥEＫK0-9]*|colágeno|magnesio|melatonina|probióticos|creatina|vitamina\s+[a-z0-9]+/giu,
    ) || [];
  const title = String(item.title || item.headline || '')
    .replaceAll(/<[^>]*>/g, ' ')
    .replaceAll(item.brand || '\u0000', '')
    .replaceAll(
      /\b\d+(?:\.\d+)?\s*(?:mg|mcg|kg|ml|oz|capsules|tablets|count)\b/gi,
      '',
    )
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (title.length >= 3 && title.length <= 100 && title.split(' ').length <= 10)
    matches.push(title);
  return [
    ...new Set(
      matches.map((s) =>
        s.normalize('NFKC').toLowerCase().replaceAll(/\s+/g, ' ').trim(),
      ),
    ),
  ].slice(0, 20);
}
export function mergeObserved(old, item, at) {
  if (!old)
    return {
      ...item,
      firstSeenAt: item.firstSeenAt || at,
      lastCollectedAt: at,
    };
  // Keep human decisions, associations and enriched fields from other collectors.
  const merged = { ...item, ...old, lastCollectedAt: at };
  if (
    /^(?:VN|US|MX)-westmonth\.com$/.test(item.siteId || '') &&
    (item.sourceMetrics?.soldPlatform === '西之月' ||
      item.decisionData?.listing?.platform === '西之月' ||
      item.priceEvidence?.provider === '西之月官网')
  ) {
    if (item.catalogDeliveryRegionId) {
      for (const field of [
        'catalogEvidenceUrl',
        'catalogScope',
        'catalogDeliveryRegionId',
        'catalogSkuId',
        'catalogListedAtRaw',
      ])
        if (item[field] !== undefined) merged[field] = item[field];
    }
    if (item.priceEvidence?.kind === 'discount' && item.price > 0) {
      merged.price = item.price;
      merged.currency = item.currency;
      merged.priceEvidence = item.priceEvidence;
      merged.collectionFields = [
        ...new Set([
          ...(old.collectionFields || []),
          ...(item.collectionFields || []),
        ]),
      ];
    }
    if (item.sourceMetrics)
      merged.sourceMetrics = { ...old.sourceMetrics, ...item.sourceMetrics };
    if (item.decisionData?.listing)
      merged.decisionData = {
        ...old.decisionData,
        listing: item.decisionData.listing,
      };
  }
  return merged;
}
