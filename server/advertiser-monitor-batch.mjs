import { digest, validateSchedule } from './competitor-monitor-domain.mjs';

// The caller holds competitor-runner across validation and the complete transaction.
export async function saveAdvertiserBatch(input, db, connection) {
  const schedule = validateSchedule(input);
  if (
    !Array.isArray(input.adIds) ||
    input.adIds.length === 0 ||
    input.adIds.length > 1000 ||
    input.adIds.some((id) => typeof id !== 'string' || !id || id.length > 160)
  )
    throw new Error('请选择1～1000个有效广告主记录');
  const candidates = new Map();
  for (const id of new Set(input.adIds)) {
    const ad = await db.read(`business:ads:${id}`);
    if (
      !ad ||
      ad.id !== id ||
      ad.dataNature === 'demo' ||
      !['US', 'MX', 'VN'].includes(ad.market) ||
      !/^\d{1,40}$/.test(String(ad.pageId || ''))
    )
      throw new Error(
        '包含已删除、演示或缺少有效Page ID的广告主，请刷新后重试',
      );
    const targetId = digest(`advertiser:${ad.market}:${ad.pageId}`);
    candidates.set(targetId, { ad, targetId });
  }
  const documents = await db.list('competitor:target:');
  const existing = documents.map((row) => row.value);
  const known = new Set(
    existing
      .filter((t) => t.kind === 'advertiser')
      .map((t) => `${t.market}:${t.pageId}`),
  );
  const additions = [...candidates.values()].filter(
    ({ ad }) => !known.has(`${ad.market}:${ad.pageId}`),
  );
  if (existing.length + additions.length > 100)
    throw new Error(
      `最多监控100个对象，当前剩余${Math.max(0, 100 - existing.length)}个名额；本次新增${additions.length}个，请缩小选择范围`,
    );
  await connection.query('BEGIN');
  try {
    const at = new Date().toISOString();
    for (const { ad, targetId } of additions)
      await db.write(`competitor:target:${targetId}`, {
        ...schedule,
        id: targetId,
        kind: 'advertiser',
        market: ad.market,
        pageId: String(ad.pageId),
        siteId: '',
        label: ad.brand || `广告主 ${ad.pageId}`,
        createdAt: at,
        updatedAt: at,
      });
    await connection.query('COMMIT');
  } catch (error) {
    await connection.query('ROLLBACK');
    throw error;
  }
  return {
    saved: true,
    created: additions.length,
    preserved: candidates.size - additions.length,
    total: existing.length + additions.length,
  };
}
