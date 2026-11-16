import { discoveryDecision, productListingEvidence, validDiscoveryDate } from './discovery-newness.mjs';
import { inNewProductPool } from './product-pool-domain.mjs';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const OFFSET = 8 * 3_600_000;
const dayOf = (time) => new Date(time + OFFSET).toISOString().slice(0, 10);

// Date-only source values retain their calendar date. Timestamps use Shanghai time,
// including timestamps without an explicit zone (never the execution host's zone).
function zonedDate(value) {
  if (validDiscoveryDate(value) === undefined) return '';
  return value.length === 10
    ? `${value}T00:00:00+08:00`
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}+08:00`;
}
export function weeklyDate(value, now = Date.now()) {
  const time = Date.parse(zonedDate(value));
  return Number.isFinite(time) && time <= now ? dayOf(time) : '';
}

export function weekStart(day) {
  const time = Date.parse(`${day}T00:00:00Z`);
  const weekday = (new Date(time).getUTCDay() + 6) % 7;
  return new Date(time - weekday * DAY).toISOString().slice(0, 10);
}

export function createWeeklyAccumulator(now = Date.now(), onMember) {
  const currentWeek = weekStart(dayOf(now));
  const markets = ['ALL', 'US', 'MX', 'VN'];
  const groups = new Map(markets.map((market) => [market, {
    weeks: new Map(),
    missingDiscovery: 0,
    missingLaunch: 0,
  }]));
  function bucket(group, start) {
    if (!group.weeks.has(start)) group.weeks.set(start, {
      weekStart: start,
      weekEnd: new Date(Date.parse(start) + 6 * DAY).toISOString().slice(0, 10),
      discoveredProducts: 0,
      newProducts: 0,
      discoveredAds: 0,
      newAds: 0,
    });
    return group.weeks.get(start);
  }
  function add(kind, row) {
    if (!row.id || row.dataNature === 'demo') return;
    const capture = weeklyDate(row.discovery?.firstSeenAt, now) ? row.discovery.firstSeenAt : row.firstSeenAt;
    const discovered = weeklyDate(capture, now);
    const product = kind === 'products';
    const listing = product ? productListingEvidence(row) : null;
    // Keep the original discovery week after subsequent collections. Evaluate the
    // seven-day age at that first capture, never against today's moving window.
    const evidence = product ? {
      ...row, decisionData: { listing: listing ? { ...listing, date: zonedDate(listing.date), collectedAt: zonedDate(listing.collectedAt) } : undefined },
    } : { ...row, startDate: zonedDate(row.startDate), lastCollectedAt: zonedDate(row.lastCollectedAt) };
    const supported = discoveryDecision(evidence, product ? 'product' : 'ad', now).isNew !== null;
    const sourceDate = product ? listing?.date : row.startDate;
    const launched = supported
      ? weeklyDate(sourceDate, now)
      : '';
    const age = discovered && launched ? Date.parse(discovered) - Date.parse(launched) : -1;
    const isNew = age >= 0 && age <= 7 * DAY &&
      Date.parse(zonedDate(sourceDate)) <= Date.parse(zonedDate(capture)) &&
      (!product || inNewProductPool(row));
    for (const market of ['ALL', ...(groups.has(row.market) && row.market !== 'ALL' ? [row.market] : [])]) {
      const group = groups.get(market);
      if (discovered) {
        const week = bucket(group, weekStart(discovered));
        week[product ? 'discoveredProducts' : 'discoveredAds']++;
        if (isNew) week[product ? 'newProducts' : 'newAds']++;
        onMember?.(market, week.weekStart, kind, row.id, isNew);
      }
      else group.missingDiscovery++;
      if (!launched) group.missingLaunch++;
    }
  }
  function results() {
    return Object.fromEntries([...groups].map(([market, group]) => {
      // Keep twelve weeks visible even in a new workspace, and retain all older history.
      const minimum = new Date(Date.parse(currentWeek) - 11 * WEEK).toISOString().slice(0, 10);
      const earliest = [...group.weeks.keys(), minimum].sort()[0];
      for (let at = Date.parse(earliest); at <= Date.parse(currentWeek); at += WEEK)
        bucket(group, new Date(at).toISOString().slice(0, 10));
      return [market, {
        rows: [...group.weeks.values()].sort((a, b) => b.weekStart.localeCompare(a.weekStart)),
        missingDiscovery: group.missingDiscovery,
        missingLaunch: group.missingLaunch,
      }];
    }));
  }
  return { add, results };
}
