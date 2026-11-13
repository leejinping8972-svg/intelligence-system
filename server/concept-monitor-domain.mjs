import { resourceCollectionTime, shanghaiDay } from './collection-time.mjs';

const kinds = ['keywords', 'ads', 'sites', 'products'];
const batchName = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ')
    : '';
const timestamp = (value) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : '';
const firstTime = (kind, row) =>
  timestamp(row.discovery?.firstSeenAt) ||
  timestamp(row.firstSeenAt) ||
  (kind === 'sites'
    ? (row.sourceEvidence || [])
        .map((evidence) => timestamp(evidence.collectedAt))
        .filter(Boolean)
        .toSorted()[0]
    : '') ||
  resourceCollectionTime(kind, row);

// Follow saved identities only. Do not infer links from similar terms/domains,
// or propagate backwards through a shared site into unrelated keywords.
export function conceptMonitorRows(state, now = Date.now(), onMembers) {
  const records = Object.fromEntries(
    kinds.map((kind) => [
      kind,
      new Map(
        (state[kind] || [])
          .filter((row) => row.id && row.dataNature !== 'demo')
          .map((row) => [row.id, row]),
      ),
    ]),
  );
  const batches = new Map();
  const byKeyword = new Map();
  const bySite = new Map();
  function index(map, id, kind, row) {
    if (!id) return;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push([kind, row]);
  }
  for (const kind of ['ads', 'sites', 'products'])
    for (const row of records[kind].values()) {
      for (const id of row.keywordIds || []) index(byKeyword, id, kind, row);
      if (kind === 'products') index(bySite, row.siteId, kind, row);
      if (kind === 'ads')
        for (const id of row.siteIds || []) index(bySite, id, kind, row);
    }
  function batch(value) {
    const name = batchName(value);
    if (!name) return;
    if (!batches.has(name))
      batches.set(name, {
        batch: name,
        members: Object.fromEntries(kinds.map((kind) => [kind, new Map()])),
      });
    return batches.get(name);
  }
  function add(group, kind, row, market) {
    if (!row || (market !== undefined && row.market !== market)) return;
    group.members[kind].set(row.id, row);
  }
  for (const row of records.keywords.values()) {
    const group = batch(row.batch);
    if (group) add(group, 'keywords', row);
  }
  for (const row of records.ads.values())
    for (const name of row.collectionBatches || []) {
      const group = batch(name);
      if (!group) continue;
      add(group, 'ads', row);
      for (const id of row.keywordIds || [])
        add(group, 'keywords', records.keywords.get(id), row.market);
    }
  const day = shanghaiDay(now);
  return [...batches.values()]
    .map((group) => {
      for (const row of group.members.keywords.values()) {
        for (const [kind, related] of byKeyword.get(row.id) || [])
          add(group, kind, related, row.market);
        for (const [kind, ids] of [
          ['products', row.productIds],
          ['sites', row.siteIds],
        ])
          for (const id of ids || [])
            add(group, kind, records[kind].get(id), row.market);
      }
      function destinations() {
        for (const row of group.members.ads.values()) {
          add(
            group,
            'products',
            records.products.get(row.productId),
            row.market,
          );
          for (const id of row.siteIds || [])
            add(group, 'sites', records.sites.get(id), row.market);
        }
        for (const row of group.members.products.values())
          add(group, 'sites', records.sites.get(row.siteId), row.market);
      }
      destinations();
      for (const row of group.members.sites.values())
        for (const [kind, related] of bySite.get(row.id) || [])
          add(group, kind, related, row.market);
      destinations();
      const counts = {};
      const members = {};
      const times = [];
      const markets = new Set();
      for (const kind of kinds) {
        const rows = [...group.members[kind].values()];
        counts[kind] = rows.length;
        const todayRows = rows.filter((row) => {
          const at = firstTime(kind, row);
          return at && shanghaiDay(Date.parse(at)) === day;
        });
        counts[`${kind}Today`] = todayRows.length;
        members[kind] = {ids: rows.map(row => row.id), todayIds: todayRows.map(row => row.id), day};
        for (const row of rows) {
          if (row.market) markets.add(row.market);
          const at = resourceCollectionTime(kind, row);
          if (at) times.push(at);
        }
      }
      onMembers?.(group.batch, members);
      return {
        id: group.batch,
        batch: group.batch,
        markets: [...markets].toSorted(),
        ...counts,
        collectedAt: times.toSorted().at(-1) || '',
      };
    })
    .toSorted(
      (a, b) =>
        b.collectedAt.localeCompare(a.collectedAt) ||
        a.batch.localeCompare(b.batch),
    );
}
