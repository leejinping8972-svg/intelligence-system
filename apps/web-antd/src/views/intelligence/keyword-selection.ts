import type { Keyword } from './data';

type Identity = Pick<Keyword, 'id' | 'term' | 'market'>;
const keyOf = (r: Identity) =>
  `${r.market}|${r.term.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase()}`;

export function rememberSelection(
  ids: string[],
  rows: Identity[],
  previous = new Map<string, Identity>(),
) {
  const available = new Map(rows.map((r) => [r.id, r]));
  return new Map(
    ids.flatMap((id) => {
      const r = available.get(id) || previous.get(id);
      return r
        ? [[id, { id: r.id, term: r.term, market: r.market }] as const]
        : [];
    }),
  );
}
// A cloud refresh may replace an old identifier. Resolve the same term+market,
// retaining the user's selection instead of silently submitting a subset.
export function resolveSelection(
  ids: string[],
  snapshots: Map<string, Identity>,
  current: Keyword[],
) {
  const byId = new Map(current.map((r) => [r.id, r]));
  const byKey = new Map(current.map((r) => [keyOf(r), r]));
  const records: Keyword[] = [],
    missing: string[] = [],
    used = new Set<string>();
  const tableKeys: string[] = [];
  for (const id of ids) {
    const identity = snapshots.get(id);
    const record =
      byId.get(id) || (identity ? byKey.get(keyOf(identity)) : undefined);
    if (record && !used.has(record.id)) {
      records.push(record);
      used.add(record.id);
      tableKeys.push(record.id);
    } else {
      missing.push(id);
      tableKeys.push(id);
    }
  }
  return { records, missing, tableKeys };
}
export function requireCompleteSelection(
  ids: string[],
  snapshots: Map<string, Identity>,
  current: Keyword[],
) {
  if (!ids.length || ids.length > 100) throw new Error('请勾选1～100个关键词');
  const result = resolveSelection(ids, snapshots, current);
  if (result.missing.length || result.records.length !== ids.length)
    throw new Error(
      `已勾选${ids.length}个词，但只能匹配${result.records.length}个。任务未提交，请刷新并重新选择，系统不会只提交部分关键词。`,
    );
  return result.records;
}
