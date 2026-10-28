import { Buffer } from 'node:buffer';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

import { requestSources, usageEvent } from './source-usage-domain.mjs';

const accountingFields = [
  'apiUnits',
  'cached',
  'provider',
  'providerCalls',
  'usage',
  'unknownCharges',
  'creditsCharged',
  'requestUsage',
  'requests',
  'quotaUnits',
];

export function accountingProjection(column, engine = 'postgres') {
  return engine === 'mysql'
    ? `JSON_OBJECT(${accountingFields.map((field) => `'${field}',JSON_EXTRACT(${column},'$.${field}')`).join(',')})`
    : `jsonb_build_object(${accountingFields.map((field) => `'${field}',${column}->'${field}'`).join(',')})`;
}

export function monitorUsageQuery(engine = 'postgres', count = 0) {
  const selected = count
    ? ` AND d.name IN (${Array.from({ length: count }, (_, index) => `$${index + 1}`).join(',')})`
    : '';
  if (engine !== 'mysql') {
    return `SELECT d.name,d.revision,d.value->>'at' AS at,d.value->>'step' AS step,d.value->>'status' AS status,${accountingProjection("d.value->'response'")} AS record FROM workspace_documents d WHERE d.name LIKE 'competitor:request:%'${selected}`;
  }
  // JSON_TABLE extracts the small accounting projection in one pass over each journal.
  // Keep JSON types so strings and missing values cannot become confirmed charges.
  const metadata = ['at', 'step', 'status'];
  const columns = [
    ...metadata.map((field) => `meta_${field} JSON PATH '$.${field}'`),
    ...accountingFields.map(
      (field, index) => `field_${index} JSON PATH '$.response.${field}'`,
    ),
  ];
  return `SELECT /*+ MAX_EXECUTION_TIME(15000) */ d.name,d.revision,${metadata.map((field) => `JSON_UNQUOTE(p.meta_${field}) AS ${field}`).join(',')},JSON_OBJECT(${accountingFields.map((field, index) => `'${field}',p.field_${index}`).join(',')}) AS record FROM workspace_documents d JOIN JSON_TABLE(d.value,'$' COLUMNS(${columns.join(',')})) AS p WHERE d.name LIKE 'competitor:request:%'${selected}`;
}

const monitorCacheName = 'read:source-usage:monitor:v1';
export function createMonitorUsageReader({
  engine = 'postgres',
  write,
  onCacheError = (error) =>
    console.warn(
      'Source usage cache save failed',
      error.code || 'CACHE_WRITE_FAILED',
    ),
}) {
  return async (connection) => {
    const saved = (
      await connection.query(
        'SELECT value FROM workspace_documents WHERE name=$1',
        [monitorCacheName],
      )
    ).rows[0]?.value;
    let entries = [];
    try {
      if (saved?.version === 1 && saved.codec === 'deflate-json-v1') {
        const decoded = JSON.parse(
          inflateRawSync(Buffer.from(saved.body, 'base64'), {
            maxOutputLength: 32 * 1024 * 1024,
          }).toString('utf8'),
        );
        if (
          Array.isArray(decoded) &&
          decoded.every(
            (entry) =>
              typeof entry.name === 'string' &&
              typeof entry.revision === 'string' &&
              entry.event?.id === `${entry.name}:${entry.event.sourceId}`,
          )
        )
          entries = decoded;
      }
    } catch {
      /* A disposable cache can be rebuilt from the original journals. */
    }
    const byName = new Map(entries.map((entry) => [entry.name, entry]));
    const versions = (
      await connection.query(
        "SELECT name,revision FROM workspace_documents WHERE name LIKE 'competitor:request:%' ORDER BY name",
      )
    ).rows;
    const changed = versions
      .filter((row) => byName.get(row.name)?.revision !== String(row.revision))
      .map((row) => row.name);
    for (const name of changed) byName.delete(name);
    const currentEntries = () =>
      versions.map((row) => byName.get(row.name)).filter(Boolean);
    const save = async () => {
      try {
        await write(
          monitorCacheName,
          {
            version: 1,
            codec: 'deflate-json-v1',
            body: deflateRawSync(
              Buffer.from(JSON.stringify(currentEntries())),
            ).toString('base64'),
          },
          connection,
        );
      } catch (error) {
        onCacheError(error);
      }
    };
    try {
      for (let start = 0; start < changed.length; start += 200) {
        const names = changed.slice(start, start + 200);
        const rows = (
          await connection.query(monitorUsageQuery(engine, names.length), names)
        ).rows;
        for (const row of rows) {
          const event = usageEvent(
            {
              ...row,
              id: row.name,
              job_id: row.name.split(':').slice(3, -1).join(':'),
              task: '定时监控',
            },
            requestSources(row.step, row.record)[0],
          );
          byName.set(row.name, {
            name: row.name,
            revision: String(row.revision),
            event,
          });
        }
      }
    } catch (error) {
      await save();
      throw error;
    }
    const current = currentEntries();
    if (changed.length || current.length !== entries.length || !saved) {
      await save();
    }
    return current.map((entry) => entry.event);
  };
}

export async function usageReadWithin(pending, milliseconds = 2000) {
  let timer;
  try {
    return await Promise.race([
      pending.then((events) => ({ events })),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ loading: true }), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function createUsageEventCache(
  read,
  { ttl = 15_000, now = Date.now } = {},
) {
  const entries = new WeakMap();
  let generation = 0;
  const cached = async (connection, { refresh = false } = {}) => {
    const existing = entries.get(connection);
    if (existing?.pending) return existing.pending;
    if (!refresh && existing?.error && existing.expiresAt > now())
      throw existing.error;
    if (
      !refresh &&
      existing?.expiresAt > now() &&
      existing.generation === generation
    )
      return existing.events;
    const entry = { generation };
    entries.set(connection, entry);
    entry.pending = Promise.resolve()
      .then(() => read(connection))
      .then((events) => {
        entry.events = events;
        entry.expiresAt = now() + ttl;
        return events;
      })
      .catch((error) => {
        entry.error = error;
        entry.expiresAt = now() + 5000;
        throw error;
      })
      .finally(() => {
        entry.pending = null;
      });
    return entry.pending;
  };
  cached.invalidate = () => {
    generation++;
  };
  return cached;
}
