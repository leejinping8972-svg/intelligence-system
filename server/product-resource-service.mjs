import { createHash, randomUUID } from 'node:crypto';

import { lock, unlock, pool, putDocument } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { mergeContent } from './public-content-domain.mjs';
import { resourceCapabilities, resourceRoute, resourceResumeAllowed } from './product-resource-domain.mjs';

const uuid = (v) => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(v || '');
const signature = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const queryInput = (input) => {
  const route = resourceRoute(input.routeId);
  if (!uuid(input.requestId)) throw new Error('类目查询需要有效提交编号');
  if (!route?.modes.includes('category') || !route.markets.includes(input.market)) throw new Error('此来源或国家不支持真实类目查询，请选择关键词样本或公开类目页');
  const query = String(input.query || '').normalize('NFKC').trim();
  const parentId = String(input.parentId || '').trim();
  const parentReceiptId = String(input.parentReceiptId || '').trim();
  if (query.length > 200 || parentId.length > 200) throw new Error('类目查询参数过长');
  if (parentId && !uuid(parentReceiptId)) throw new Error('查询子类目需要父类来源凭证，请重新选择实际返回类目');
  return { routeId: route.id, provider: route.provider, platform: route.platform, market: input.market, query, parentId, parentReceiptId };
};

export async function resourceConfiguration(connection = pool) {
  const { rows } = await connection.query("SELECT name FROM provider_configs WHERE name IN ('credentials','provider:sorftime:mcp:v1','provider:scrapecreators:v1','provider:semrush:mcp:v1')");
  const names = new Set(rows.map((r) => r.name));
  return { sorftime: names.has('credentials') || names.has('provider:sorftime:mcp:v1'), brave: names.has('credentials'), tiktok_shop: names.has('provider:scrapecreators:v1'), scrapecreators: names.has('provider:scrapecreators:v1'), semrush: names.has('provider:semrush:mcp:v1'), public_web: true };
}
export async function queryResourceCategories(input, overrides = {}) {
  const q = queryInput(input);
  const io = { pool, collect, saveCheckpoint, ...overrides };
  const c = await io.pool.connect();
  let held = false, job;
  try {
    held = await (overrides.lock || lock)(c, 'platform-products-submit');
    if (!held) throw new Error('正在提交平台查询，请稍后重试');
    if (q.parentId) {
      const receipt = (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [`resource:category-receipt:${q.parentReceiptId}`])).rows[0]?.value;
      const parent = receipt?.routeId === q.routeId && receipt.market === q.market && receipt.categories.find((category) => category.id === q.parentId);
      if (!parent) throw new Error('父类来源凭证无效或国家已改变，请重新查询真实类目');
      q.parentPath = parent.path;
    }
    const previous = (await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [input.requestId])).rows[0];
    if (previous) {
      if (previous.input.categorySignature !== signature(q)) throw new Error('提交编号已用于其他查询；请刷新类目查询编号');
      if (previous.status === 'completed' && previous.checkpoint.categoryResult) return previous.checkpoint.categoryResult;
      throw new Error('此查询已发出或结果未知，禁止自动重放；请核对原查询记录与实际用量');
    }
    const configured = await resourceConfiguration(c);
    if (!configured[q.provider]) throw new Error('请先在数据源设置配置Sorftime；尚未调用供应商');
    const id = randomUUID();
    const value = { kind: 'platform_products', resourceCategories: true, categorySignature: signature(q), markets: [q.market], market: q.market, seeds: [], ...q };
    const checkpoint = { requests: 5, submittedAt: new Date().toISOString(), logs: ['用户确认的单次类目查询；最多5次HTTP和一个数据工具调用。'] };
    await c.query("INSERT INTO research_jobs(id,request_id,input,checkpoint,status) VALUES($1,$2,$3,$4,'querying')", [id, input.requestId, value, checkpoint]);
    job = { id, input: value, checkpoint };
  } finally {
    if (held) await (overrides.unlock || unlock)(c, 'platform-products-submit');
    c.release();
  }
  try {
    const result = await io.collect(job, 'resource:categories', { sources: ['platform_products'], resourceDiscovery: true, ...q, op: 'categories', limit: 200, sorftimeRequestLimit: 1 });
    const categories = (result.categories || []).slice(0, 200).map((category) => ({ ...category, receiptId: job.id, market: q.market, provider: q.provider, platform: q.platform }));
    const response = { categories, receiptId: job.id, requests: result.usage?.requests ?? 5, usage: result.usage || { sorftimeCalls: result.providerCalls }, stopReason: categories.length ? 'bounded_query' : 'not_indexed', message: result.message || '仅返回来源实际类目；选中路径和国家会随商品保存，未遍历全树。' };
    await (overrides.putDocument || putDocument)('workspace_documents', `resource:category-receipt:${job.id}`, { routeId: q.routeId, market: q.market, categories, collectedAt: result.collectedAt || new Date().toISOString() }, true);
    await io.saveCheckpoint(job, { ...job.checkpoint, requests: response.requests, categoryResult: response, finishedAt: new Date().toISOString() }, 'completed');
    return response;
  } catch (error) {
    await io.saveCheckpoint(job, { ...job.checkpoint, stopReason: 'category_query_failed', logs: [String(error.message).slice(0, 700)], finishedAt: new Date().toISOString() }, 'failed');
    throw error;
  }
}
export async function assertResourceCategory(plan, connection = pool) {
  if (plan.mode !== 'category') return;
  const receipt = (await connection.query('SELECT value FROM workspace_documents WHERE name=$1', [`resource:category-receipt:${plan.category.receiptId}`])).rows[0]?.value;
  if (!receipt || receipt.routeId !== plan.routeId || receipt.market !== plan.market) throw new Error('类目查询凭证无效或国家/来源已改变，请重新查询真实类目');
  const category = receipt.categories.find((c) => c.id === plan.category.id && JSON.stringify(c.path) === JSON.stringify(plan.category.path));
  if (!category) throw new Error('类目ID和路径未出现在此来源查询结果，禁止使用拼造类目');
  plan.category = { ...category, receiptId: plan.category.receiptId };
}
export async function upsertResourceContent(content) {
  if (!content?.id || !content.sourceId || !content.title || !content.url) throw new Error('公共内容缺少来源身份，未保存');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const name = `content:item:${content.id}`;
    const old = (await c.query('SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE', [name])).rows[0]?.value;
    const merged = mergeContent(old, content);
    await putDocument('workspace_documents', name, merged, false, c);
    await c.query('COMMIT');
    return merged;
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}
export async function resumeResourceJob(input, overrides = {}) {
  if (!uuid(input.jobId)) throw new Error('任务编号无效');
  const io = { pool, lock, unlock, ...overrides };
  const c = await io.pool.connect();
  let held = false;
  try {
    held = await io.lock(c, 'runner');
    if (!held) throw new Error('采集器正在保存请求结果，请稍后恢复；未重放任何请求');
    const job = (await c.query('SELECT * FROM research_jobs WHERE id=$1', [input.jobId])).rows[0];
    if (!resourceResumeAllowed(job)) throw new Error('此任务不可恢复：仅已取消且无未知收费/在途请求的资源任务可继续，预算和请求日志不重置');
    const cp = { ...job.checkpoint, nextRunAt: 0, resumedAt: new Date().toISOString(), logs: [...(job.checkpoint.logs || []), '用户恢复未执行步骤；原预算、来源停止状态及收费journal保持。'].slice(-300) };
    delete cp.finishedAt;
    await c.query("UPDATE research_jobs SET cancelled=false,status='queued',checkpoint=$2,updated_at=now() WHERE id=$1", [job.id, cp]);
    return { ...job, status: 'queued', cancelled: false, checkpoint: cp };
  } finally { if (held) await io.unlock(c, 'runner'); c.release(); }
}
export async function productResourceAction(input) {
  if (input.action === 'server_product_resource_capabilities') return { ...resourceCapabilities(await resourceConfiguration()), configurationNote: '仅检查加密配置容器是否存在；不读取密钥、不执行连接或收费测试。容器存在不证明某个Key已配置或权限可用。' };
  if (input.action === 'server_product_resource_categories') return queryResourceCategories(input);
  if (input.action === 'server_product_resource_observations') {
    if (!/^[a-z\d._-]{1,160}$/i.test(input.productId || '')) throw new Error('商品编号无效');
    const page = input.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new Error('观察分页无效');
    const escapedId = input.productId.replaceAll('_', '!_');
    const rows = (await pool.query("SELECT name,value FROM workspace_documents WHERE name LIKE $1 ESCAPE '!' ORDER BY name LIMIT 51 OFFSET $2", [`resource:observation:products:${escapedId}:%`, (page - 1) * 50])).rows;
    return { observations: rows.slice(0, 50).map((r) => r.value), page, pageSize: 50, hasMore: rows.length > 50, ordering: 'immutable_key' };
  }
  throw new Error('不支持的商品资源动作');
}
