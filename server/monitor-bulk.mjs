import { validateSchedule } from './competitor-monitor-domain.mjs';
import { westmonthChannelKey } from './westmonth-market.mjs';

export async function removeMonitorTarget(config, db, connection) {
  const site = config.siteId
    ? await db.read(`business:sites:${config.siteId}`)
    : null;
  for (const key of new Set([
    `competitor:target:${config.id}`,
    `competitor:baseline:${config.id}:${westmonthChannelKey('products', site)}`,
    `competitor:baseline:${config.id}:products`,
    `competitor:baseline:${config.id}:ads`,
    `competitor:crawl:${config.id}:products`,
    `competitor:crawl:${config.id}:ads`,
  ]))
    await connection.query('DELETE FROM workspace_documents WHERE name=$1', [
      key,
    ]);
}

// The caller holds monitor-config. Validate first, then commit config changes
// together; preserve observations, history, source journals and active requests.
export async function applyMonitorBatch(input, db, connection) {
  if (
    !Array.isArray(input.ids) ||
    input.ids.length === 0 ||
    input.ids.length > 100 ||
    input.ids.some((id) => typeof id !== 'string' || !/^[a-f\d]{32}$/.test(id))
  )
    throw new Error('请选择1～100个有效监控对象');
  const remove = input.action === 'server_competitor_batch_remove';
  const patch = input.patch;
  if (!remove) {
    if (
      !patch ||
      typeof patch !== 'object' ||
      Array.isArray(patch) ||
      Object.keys(patch).length === 0 ||
      Object.keys(patch).some(
        (key) => !['hour', 'maxPages', 'enabled'].includes(key),
      ) ||
      ('enabled' in patch && typeof patch.enabled !== 'boolean') ||
      ('hour' in patch && !Number.isInteger(patch.hour)) ||
      ('maxPages' in patch && !Number.isInteger(patch.maxPages))
    )
      throw new Error('请选择要修改的监控设置，并填写有效值');
    validateSchedule({ ...{ hour: 8, maxPages: 10 }, ...patch });
  }
  const at = new Date().toISOString();
  const pending = [];
  const failed = [];
  for (const id of new Set(input.ids)) {
    const config = await db.read(`competitor:target:${id}`);
    if (!config) {
      failed.push({ id, error: '监控配置已不存在，请刷新列表' });
      continue;
    }
    const run = remove ? await db.read(`competitor:run:${id}`) : null;
    if (run?.status === 'running') {
      failed.push({
        id,
        error: '仍在执行，请先批量暂停，待当前请求结束后再取消监控',
      });
      continue;
    }
    pending.push(
      remove
        ? config
        : {
            ...config,
            ...validateSchedule({ ...config, ...patch }),
            ...(patch.enabled === false
              ? { pausedAt: at, requested: false, publicRetryRequested: false }
              : {}),
            updatedAt: at,
          },
    );
  }
  await connection.query('BEGIN');
  try {
    for (const config of pending) {
      await (remove
        ? removeMonitorTarget(config, db, connection)
        : db.write(`competitor:target:${config.id}`, config));
    }
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
  return { succeededIds: pending.map((config) => config.id), failed };
}
