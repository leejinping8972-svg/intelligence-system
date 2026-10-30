import { createHash, randomUUID } from 'node:crypto';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function textValue(value, max = 120) {
  if (typeof value !== 'string' || value.length > max) fail('视图字段无效');
  return value;
}
function option(value, options) {
  if (!options.includes(value)) fail('视图选项无效');
  return value;
}
function cleanFilters(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('缺少视图筛选');
  const keys = ['market', 'search', 'category', 'rating', 'ratingStatus', 'score', 'tags', 'timeRange', 'review', 'favorite', 'sort', 'order', 'pageSize', 'period'];
  if (Object.keys(value).some(key => !keys.includes(key))) fail('不支持的视图字段');
  const market = textValue(value.market, 3);
  if (market !== 'ALL' && !/^[A-Z]{2,3}$/.test(market)) fail('市场无效');
  const score = value.score;
  if (!score || typeof score !== 'object' || Object.keys(score).some(key => !['min', 'max', 'status'].includes(key))) fail('评分筛选无效');
  for (const n of [score.min, score.max]) {
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100)) fail('评分范围无效');
  }
  if (score.min !== null && score.max !== null && score.min > score.max) fail('评分范围无效');
  if (!Array.isArray(value.tags) || value.tags.length > 30) fail('标签无效');
  if (typeof value.favorite !== 'boolean') fail('收藏筛选无效');
  return {
    market, search: textValue(value.search, 300), category: textValue(value.category),
    rating: option(value.rating, ['ALL', 'UNRATED', 'A', 'B', 'C', 'D']),
    ratingStatus: textValue(value.ratingStatus, 40),
    score: { min: score.min, max: score.max, status: option(score.status, ['all', 'scored', 'unscored']) },
    tags: [...new Set(value.tags.map(tag => textValue(tag)))],
    timeRange: option(value.timeRange, ['ALL', '1', '7', '30', '90', '180', '365']),
    review: option(value.review, ['ALL', 'pending', 'selected', 'excluded']),
    favorite: value.favorite, sort: option(value.sort, ['', 'score', 'collectedAt']),
    order: option(value.order, ['', 'ascend', 'descend']),
    pageSize: option(value.pageSize, [10, 20, 50, 100]),
    period: option(value.period, [30, 90, 180, 365]),
  };
}

export function createKeywordViewsAction({ pool }) {
  return async function keywordViewsAction(input, user) {
    if (!user?.id) fail('请先登录账号', 401);
    if (input.userId !== undefined || input.owner !== undefined) fail('视图归属由登录账号确定');
    const prefix = `account:keyword-view:${createHash('sha256').update(String(user.id)).digest('hex')}:`;
    if (input.action === 'server_keyword_views_list') {
      const { rows } = await pool.query('SELECT value,revision FROM workspace_documents WHERE name LIKE $1', [`${prefix}%`]);
      return { views: rows.map(row => ({ ...row.value, revision: Number(row.revision) })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) };
    }
    if (!['server_keyword_views_save', 'server_keyword_views_delete'].includes(input.action)) fail('未知视图操作');
    const id = input.id || randomUUID();
    if (typeof id !== 'string' || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) fail('视图标识无效');
    const key = `${prefix}${id}`;
    const existing = (await pool.query('SELECT value,revision FROM workspace_documents WHERE name=$1', [key])).rows[0];
    if (input.id && !existing) fail('视图不存在或已删除', 404);
    if (existing && (!Number.isInteger(input.revision) || Number(existing.revision) !== input.revision)) fail('视图已在其他设备修改，请刷新后重试', 409);
    if (input.action === 'server_keyword_views_delete') {
      if (!existing) fail('视图不存在', 404);
      const result = await pool.query('DELETE FROM workspace_documents WHERE name=$1 AND revision=$2', [key, input.revision]);
      if (!result.rowCount) fail('视图已在其他设备修改，请刷新后重试', 409);
      return { deleted: true };
    }
    const name = textValue(input.name, 60).trim();
    if (!name) fail('请输入视图名称');
    const now = new Date().toISOString();
    const view = { id, name, filters: cleanFilters(input.filters), createdAt: existing?.value.createdAt || now, updatedAt: now };
    if (existing) {
      const result = await pool.query('UPDATE workspace_documents SET value=$1,revision=revision+1 WHERE name=$2 AND revision=$3', [view, key, input.revision]);
      if (!result.rowCount) fail('视图已在其他设备修改，请刷新后重试', 409);
    } else {
      await pool.query('INSERT INTO workspace_documents(name,value,revision) VALUES($1,$2,1)', [key, view]);
    }
    return { view: { ...view, revision: existing ? input.revision + 1 : 1 } };
  };
}
