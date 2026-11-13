export const BATCH_SETTINGS = 'settings:collection-batches';
export const batchName = (value) =>
  typeof value === 'string'
    ? value.normalize('NFKC').trim().replaceAll(/\s+/g, ' ')
    : '';

export function canonicalBatch(value, aliases = {}) {
  let name = batchName(value);
  const visited = new Set();
  while (Object.hasOwn(aliases, name) && !visited.has(name)) {
    visited.add(name);
    name = batchName(aliases[name]);
  }
  return name;
}

export function batchRecord(kind, record, aliases) {
  if (kind === 'keywords')
    return { ...record, batch: canonicalBatch(record.batch, aliases) };
  if (kind === 'ads')
    return {
      ...record,
      collectionBatches: [
        ...new Set(
          (record.collectionBatches || [])
            .map((name) => canonicalBatch(name, aliases))
            .filter(Boolean),
        ),
      ],
    };
  return record;
}

// Aliases are authoritative batch identities, including future writes from old checkpoints.
export function mergeBatchAliases(current, sources, target) {
  const aliases = { ...current };
  const destination = canonicalBatch(target, current);
  const selected = new Set(
    sources.map((name) => canonicalBatch(name, current)),
  );
  for (const key of new Set([...Object.keys(current), ...selected])) {
    const name = canonicalBatch(key, current);
    const next = selected.has(name) ? destination : name;
    if (key === next) delete aliases[key];
    else
      Object.defineProperty(aliases, key, {
        value: next,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return { aliases, target: destination };
}
