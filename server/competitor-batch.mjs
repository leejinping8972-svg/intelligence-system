import { digest, validateSchedule } from './competitor-monitor-domain.mjs';

// Called under the same competitor-runner lock as single-target configuration.
export async function saveSiteBatch(input, db, connection) {
  const schedule = validateSchedule(input);
  if (
    !Array.isArray(input.siteIds) ||
    input.siteIds.length === 0 ||
    input.siteIds.length > 1000 ||
    input.siteIds.some(
      (id) => typeof id !== 'string' || id.length === 0 || id.length > 160,
    )
  )
    throw new Error('请选择1～1000个有效站点');
  const ids = [...new Set(input.siteIds)];
  const documents = await db.list('competitor:target:');
  const existing = documents.map((item) => item.value);
  const known = new Set(
    existing.filter((item) => item.kind === 'site').map((item) => item.siteId),
  );
  const pending = ids.filter((id) => !known.has(id));
  if (existing.length + pending.length > 100)
    throw new Error(
      `最多监控100个对象，当前剩余${Math.max(0, 100 - existing.length)}个名额；本次新增${pending.length}个，请缩小选择范围`,
    );
  const targets = [];
  for (const id of pending) {
    const site = await db.read(`business:sites:${id}`);
    if (
      !site ||
      site.id !== id ||
      !['MX', 'US', 'VN'].includes(site.market) ||
      site.dataNature === 'demo'
    )
      throw new Error('包含不存在或无有效市场的站点，请刷新列表后重试');
    const at = new Date().toISOString();
    targets.push({
      ...schedule,
      id: digest(`site:${site.market}:${id}`),
      kind: 'site',
      market: site.market,
      siteId: id,
      pageId: '',
      label: site.domain || site.brand,
      createdAt: at,
      updatedAt: at,
    });
  }
  await connection.query('BEGIN');
  try {
    for (const target of targets)
      await db.write(`competitor:target:${target.id}`, target);
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
  return {
    saved: true,
    created: targets.length,
    preserved: ids.length - targets.length,
    total: existing.length + targets.length,
  };
}
