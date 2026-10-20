// Pure rules shared by API persistence and the UI. Observation dates never prove launch dates.
const DAY = 86_400_000;
export function validDiscoveryDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    return undefined;
  if (value.length > 10 && !Number.isFinite(Date.parse(value)))
    return undefined;
  const date = value.slice(0, 10);
  const time = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(time) &&
    new Date(time).toISOString().slice(0, 10) === date
    ? time
    : undefined;
}
export function discoveryDecision(item, kind, now = Date.now()) {
  const first = item.discovery?.firstSeenAt || item.firstSeenAt;
  const observed = validDiscoveryDate(first);
  const recentDiscovery =
    observed !== undefined &&
    Date.parse(first) <= now &&
    now - observed < 8 * DAY;
  const listing = item.decisionData?.listing;
  const isProduct = kind === 'product';
  const date = isProduct ? listing?.date : item.startDate;
  const source = isProduct ? listing?.provider : item.source;
  const collectedAt = isProduct ? listing?.collectedAt : item.lastCollectedAt;
  const evidenceUrl = isProduct ? listing?.evidenceUrl : item.evidenceUrl;
  const time = validDiscoveryDate(date);
  const collected = Date.parse(collectedAt || '');
  let publicEvidence = false;
  try {
    const url = new URL(evidenceUrl);
    publicEvidence =
      ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password;
  } catch {}
  const supported = Boolean(
    source &&
    publicEvidence &&
    Number.isFinite(collected) &&
    collected <= now &&
    (!isProduct || (listing.platform && listing.market === item.market)),
  );
  const windowDays = isProduct ? 90 : 7;
  const known =
    supported &&
    time !== undefined &&
    Date.parse(date) <= Math.min(now, collected);
  const isNew = known ? Math.floor((now - time) / DAY) <= windowDays : null;
  let label = isProduct ? '新品待核验' : '新广告待核验';
  if (isNew === true) label = isProduct ? '新品（90天内）' : '新广告（7天内）';
  if (isNew === false) label = isProduct ? '非近期新品' : '非近期新广告';
  return {
    version: 'discovery-v1',
    isNew,
    label,
    recentDiscovery,
    windowDays,
    reason: known
      ? `${isProduct ? '来源上架' : '平台投放开始'}日期 ${date.slice(0, 10)}，${isNew ? '在' : '超过'}${windowDays}天窗口；${isProduct ? '不等同于品牌首发' : '按广告ID判断，不将同素材复用合并'}。`
      : '缺少可核验的来源日期或来源依据；系统首次发现不能证明刚上市或刚开始投放。',
    source: source || '',
    evidenceDate: known ? date.slice(0, 10) : '',
    evidenceUrl: evidenceUrl || '',
    evaluatedAt: new Date(now).toISOString(),
  };
}
export function observeDiscovery(old, patch, kind, now = Date.now()) {
  const merged = { ...old, ...patch };
  const at =
    kind === 'product'
      ? patch.sourceMetrics?.collectedAt ||
        patch.lastCollectedAt ||
        patch.firstSeenAt
      : patch.lastCollectedAt || patch.firstSeenAt;
  // Detail-only writes, favorites and completion progress do not create new sightings.
  const observation = Date.parse(at || '');
  if (!Number.isFinite(observation) || observation > now) return merged;
  const previous = old?.discovery;
  const firstSeenAt = previous?.firstSeenAt || old?.firstSeenAt || at;
  const lastSeenAt =
    previous?.lastSeenAt ||
    old?.lastCollectedAt ||
    old?.sourceMetrics?.collectedAt ||
    firstSeenAt;
  const nextSeen = Date.parse(at) > Date.parse(lastSeenAt) ? at : lastSeenAt;
  merged.firstSeenAt = firstSeenAt;
  merged.discovery = {
    version: 'discovery-v1',
    firstSeenAt,
    lastSeenAt: nextSeen,
    observationDays: [
      ...new Set([
        ...(previous?.observationDays || [firstSeenAt.slice(0, 10)]),
        at.slice(0, 10),
      ]),
    ]
      .toSorted()
      .slice(-90),
    decision: discoveryDecision({ ...merged, firstSeenAt }, kind, now),
  };
  return merged;
}
export function protectDiscoveryEdit(old, incoming) {
  if (!old?.discovery) {
    const value = { ...incoming };
    delete value.discovery;
    return value;
  }
  return {
    ...incoming,
    discovery: old.discovery,
    firstSeenAt: old.firstSeenAt,
    lastCollectedAt: old.lastCollectedAt,
    startDate: old.startDate,
    source: old.source,
    evidenceUrl: old.evidenceUrl,
    decisionData: old.decisionData,
    sourceMetrics: old.sourceMetrics,
  };
}
