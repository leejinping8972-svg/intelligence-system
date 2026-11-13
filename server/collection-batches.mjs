import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  BATCH_SETTINGS,
  batchName,
  batchRecord,
  canonicalBatch,
  mergeBatchAliases,
} from './collection-batch-domain.mjs';

export function createCollectionBatchAction({
  pool,
  sql,
  putDocument,
  lock,
  unlock,
  requireAdmin,
}) {
  return async function merge(input, user) {
    requireAdmin(user);
    if (
      !Array.isArray(input.batches) ||
      input.batches.length < 2 ||
      input.batches.length > 50 ||
      input.batches.some(
        (name) =>
          typeof name !== 'string' ||
          !batchName(name) ||
          batchName(name).length > 100,
      ) ||
      typeof input.target !== 'string' ||
      !batchName(input.target) ||
      batchName(input.target).length > 100 ||
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    )
      throw new Error('请选择2～50个批次，并填写不超过100字的目标批次名称');
    const c = await pool.connect();
    let held = false;
    try {
      for (let attempt = 0; attempt < 40 && !held; attempt++) {
        held = await lock(c, 'workspace-reads');
        if (!held) await sleep(250);
      }
      if (!held) throw new Error('后台索引正在更新，请稍后重试合并');
      await c.query('BEGIN');
      const previous = (
        await c.query(
          'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
          [BATCH_SETTINGS],
        )
      ).rows[0]?.value || { revision: 0, aliases: {}, history: [] };
      if (input.expectedRevision !== previous.revision)
        throw new Error('批次已发生变化，请刷新看板后重新选择');
      const sources = [
        ...new Set(
          input.batches.map((name) => canonicalBatch(name, previous.aliases)),
        ),
      ];
      if (sources.length < 2) throw new Error('所选批次已经合并，请刷新看板');
      const saved = (
        await c.query(
          "SELECT payload FROM workspace_statistic_rows WHERE kind='concept-monitor' AND market='ALL' AND variant='all'",
        )
      ).rows;
      const available = new Set(
        saved.map((row) => canonicalBatch(row.payload.batch, previous.aliases)),
      );
      if (sources.some((name) => !available.has(name)))
        throw new Error('所选批次已不存在，请刷新看板');
      const { aliases, target } = mergeBatchAliases(
        previous.aliases,
        sources,
        input.target,
      );
      const changed = { keywords: 0, ads: 0 };
      // Rewrite only current affiliations. Related records are retained, never moved by proximity.
      // The identity map also covers not-yet-indexed data and late writes from old jobs.
      for (const kind of ['keywords', 'ads']) {
        let cursor = '';
        for (;;) {
          const rows = (
            await c.query(
              'SELECT id,source_key,payload FROM workspace_read_rows WHERE collection=$1 AND id>$2 ORDER BY id LIMIT 200',
              [kind, cursor],
            )
          ).rows;
          const keys = rows
            .filter((row) => {
              const old = batchRecord(kind, row.payload, previous.aliases);
              const names =
                kind === 'keywords' ? [old.batch] : old.collectionBatches;
              return names.some((name) => sources.includes(name));
            })
            .map((row) => row.source_key);
          const key = kind === 'keywords' ? 'natural_key' : 'name';
          const table =
            kind === 'keywords' ? 'research_keywords' : 'workspace_documents';
          const value = kind === 'keywords' ? 'data' : 'value';
          const currentRows = keys.length
            ? (
                await c.query(
                  `SELECT ${key} AS source_key,${value} AS value FROM ${table} WHERE ${key} IN (${keys.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY ${key} FOR UPDATE`,
                  keys,
                )
              ).rows
            : [];
          const pending = [];
          for (const row of currentRows) {
            const current = row.value;
            const updated = batchRecord(kind, current, aliases);
            if (
              JSON.stringify(
                kind === 'keywords' ? current.batch : current.collectionBatches,
              ) ===
              JSON.stringify(
                kind === 'keywords' ? updated.batch : updated.collectionBatches,
              )
            )
              continue;
            pending.push([row.source_key, updated]);
            changed[kind]++;
          }
          if (pending.length)
            await c.query(
              sql(
                `INSERT INTO ${table}(${key},${value}) VALUES ${pending.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')} ON CONFLICT(${key}) DO UPDATE SET ${value}=EXCLUDED.${value}${kind === 'ads' ? ',revision=workspace_documents.revision+1' : ''}`,
                `INSERT INTO ${table}(${key},${value}) VALUES ${pending.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')} ON DUPLICATE KEY UPDATE ${value}=VALUES(${value})${kind === 'ads' ? ',revision=revision+1' : ''}`,
              ),
              pending.flat(),
            );
          if (rows.length < 200) break;
          cursor = rows.at(-1).id;
        }
      }
      const revision = previous.revision + 1;
      const event = {
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: user.id,
        batches: sources,
        target,
        changed,
      };
      await putDocument(
        'workspace_documents',
        BATCH_SETTINGS,
        { revision, aliases, history: [...(previous.history || []), event] },
        false,
        c,
      );
      await putDocument(
        'workspace_documents',
        'read:concept-monitor-version',
        { version: 0 },
        false,
        c,
      );
      await c.query('COMMIT');
      return {
        target,
        revision,
        changed,
        batches: sources,
        refreshPending: true,
      };
    } catch (error) {
      await c.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      if (held) await unlock(c, 'workspace-reads');
      c.release();
    }
  };
}
