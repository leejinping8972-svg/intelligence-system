import { createHash } from 'node:crypto';

const number = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function evidenceSnapshot(kind, value) {
  const sm = value.sourceMetrics;
  const m = value.metrics;
  let sold;
  if (number(sm?.soldCount)) sold = sm.soldCount;
  let snapshot;
  if (kind === 'products' && sm?.collectedAt)
    snapshot = {
      at: sm.collectedAt,
      source: sold !== undefined ? sm.soldProvider || value.sourceProvider || '官网公开详情' : value.sourceProvider || '官网公开详情',
      platform: sold !== undefined ? sm.soldPlatform || value.sourcePlatform || '' : value.sourcePlatform || '',
      scope: value.sourceProductId || value.id,
      market: value.market,
      evidenceUrl: sold !== undefined ? sm.soldEvidenceUrl || value.evidenceUrl || value.sourceUrl || '' : value.evidenceUrl || value.sourceUrl || '',
      ...(sold === undefined ? {} : { sold }),
      soldRaw: sm.soldRaw,
      soldPrecision:
        sm.soldPrecision || (number(sm.soldCount) ? 'exact' : 'unknown'),
      ...(value.price > 0
        ? { price: value.price, currency: value.currency }
        : {}),
    };
  if (kind === 'sites' && m?.collectedAt && m.market === value.market)
    snapshot = {
      at: m.collectedAt,
      source: m.source,
      platform: 'Google搜索',
      scope: value.domain || value.id,
      market: value.market,
      evidenceUrl: value.evidenceUrl || '',
      ...(number(m.organicTraffic) ? { organicTraffic: m.organicTraffic } : {}),
      ...(number(m.paidTraffic) ? { paidTraffic: m.paidTraffic } : {}),
    };
  if (kind === 'ads' && value.lastCollectedAt)
    snapshot = {
      at: value.lastCollectedAt,
      source: value.source || '来源未记录',
      platform: value.platform,
      scope: value.archiveId || value.id,
      market: value.market,
      evidenceUrl: value.evidenceUrl || '',
      status: value.status,
      creative: createHash('sha256')
        .update(
          JSON.stringify([
            value.headline,
            value.copy,
            value.landingUrls,
            value.imageUrls,
            value.videoUrls,
          ]),
        )
        .digest('hex'),
    };
  return snapshot && Number.isFinite(Date.parse(snapshot.at))
    ? snapshot
    : undefined;
}
export function appendCoreEvidence(kind, old, value, patch = value) {
  const history = [...(old?.coreEvidence?.history || [])];
  const previousLength = history.length;
  for (const snapshot of [
    old && !old.coreEvidence && evidenceSnapshot(kind, old),
    evidenceSnapshot(kind, patch),
  ]) {
    if (!snapshot) continue;
    const key = JSON.stringify(snapshot);
    if (!history.some((s) => JSON.stringify(s) === key)) history.push(snapshot);
  }
  const historyCount =
    (old?.coreEvidence?.historyCount ?? previousLength) +
    history.length -
    previousLength;
  const fieldUpdatedAt = { ...old?.coreEvidence?.fieldUpdatedAt };
  if (kind === 'products') {
    for (const item of [old, patch].filter(Boolean)) {
      const at =
        item.sourceContent?.collectedAt ||
        item.sourceMetrics?.collectedAt ||
        item.lastCollectedAt;
      if (!at) continue;
      for (const key of [
        'price',
        'size',
        'ingredient',
        'dose',
        'claim',
        'benefits',
      ]) {
        const v = item[key];
        let present;
        if (key === 'price')
          present =
            number(v) && (v > 0 || item.collectionFields?.includes('price'));
        else if (Array.isArray(v)) present = v.length > 0;
        else
          present =
            typeof v === 'string' &&
            v &&
            !/^(平台未返回|未知|待识别|待补充|官网未公开)/.test(v);
        if (present && (item === patch || !fieldUpdatedAt[key]))
          fieldUpdatedAt[key] = at;
      }
      if (
        number(item.sourceMetrics?.orderCount) &&
        (item === patch || !fieldUpdatedAt.orderCount)
      )
        fieldUpdatedAt.orderCount = item.sourceMetrics.collectedAt || at;
    }
  }
  const ordered = history.toSorted((a, b) => a.at.localeCompare(b.at));
  // Keep the business record below the browser sync limit. All observations
  // also live in immutable archive documents written in the same transaction.
  let size = 2;
  let start = ordered.length;
  while (start > 0 && ordered.length - start < 600) {
    const next = JSON.stringify(ordered[start - 1]).length + 1;
    if (size + next > 160_000) break;
    size += next;
    start--;
  }
  return {
    ...value,
    coreEvidence: {
      ...old?.coreEvidence,
      ...value.coreEvidence,
      version: 1,
      history: ordered.slice(start),
      historyCount,
      historyTruncated: Boolean(
        old?.coreEvidence?.historyTruncated || start > 0,
      ),
      ...(kind === 'products' ? { fieldUpdatedAt } : {}),
    },
  };
}

// Archive observations independently of the mutable business document. The
// immutable key makes retries idempotent and keeps source evidence recoverable.
export async function archiveCoreEvidence(kind, id, value, write, old) {
  const existing = new Set(
    (old?.coreEvidence?.history || []).map((s) => JSON.stringify(s)),
  );
  for (const snapshot of value.coreEvidence?.history || []) {
    if (existing.has(JSON.stringify(snapshot))) continue;
    const hash = createHash('sha256')
      .update(JSON.stringify(snapshot))
      .digest('hex')
      .slice(0, 32);
    await write(`core:observation:${kind}:${id}:${hash}`, snapshot, true);
  }
}
export function exactProductLinks(ad, products) {
  const normalize = (url) => {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) return '';
      u.hash = '';
      for (const key of [...u.searchParams.keys()])
        if (/^utm_|^(fbclid|gclid)$/i.test(key)) u.searchParams.delete(key);
      return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/$/, '')}${u.search}`;
    } catch {
      return '';
    }
  };
  const urls = new Set(
    (ad.landingUrls || []).map((url) => normalize(url)).filter(Boolean),
  );
  return products
    .filter(
      (p) =>
        p.market === ad.market &&
        [p.sourceUrl, p.evidenceUrl].some((url) => {
          const key = normalize(url);
          return key && !/^[^/]+\/?$/.test(key) && urls.has(key);
        }),
    )
    .map((p) => p.id);
}
