import { requireAdmin } from './auth.mjs';
import { pool, putDocument, sql } from './database.mjs';
import { stableId } from './discovery-monitor-domain.mjs';
import { naturalKey } from './domain.mjs';
import { mergeKeywordMetrics } from './keyword-data.mjs';
import { createKeywordSaver } from './keyword-store.mjs';
import { productKeywordSample } from './product-keywords-domain.mjs';
import { runProductKeywordJob } from './product-keywords-engine.mjs';
import { collect, saveCheckpoint } from './store.mjs';

const defaults = { pool, putDocument, sql };
const now = () => new Date().toISOString();

// Called inside the product-save transaction; only local writes, no providers.
export async function queueProductKeywords(product, connection, overrides = {}) {
  const io = { ...defaults, ...overrides };
  if (product.dataNature === 'demo' || !['MX', 'US', 'VN'].includes(product.market)) return;
  const sample = productKeywordSample(product);
  if (!sample.sources.length) return;
  const id = stableId(`product-keywords-v1|${product.id}|${sample.fingerprint}`);
  const input = {
    kind: 'product_keywords', targetId: product.id, market: product.market,
    markets: [product.market], seeds: [], sample,
  };
  const existing = (await connection.query('SELECT id,status,checkpoint,cancelled FROM research_jobs WHERE request_id=$1', [id])).rows[0];
  if (existing && overrides.retryIncomplete && !existing.cancelled && ['failed', 'partial'].includes(existing.status)) {
    const receipts = (await connection.query('SELECT step,status FROM research_requests WHERE job_id=$1', [id])).rows;
    if (!receipts.some((receipt) => ['failed', 'started'].includes(receipt.status)) &&
        (!existing.checkpoint?.linked || (existing.checkpoint.index || 0) < (existing.checkpoint.keywords?.length || 0)))
      await connection.query("UPDATE research_jobs SET status='queued',updated_at=now() WHERE id=$1", [id]);
  }
  await connection.query(io.sql(
    'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4) ON CONFLICT(request_id) DO NOTHING',
    'INSERT IGNORE INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
  ), [id, id, input, {
    submittedAt: now(), logs: ['等待提取商品关键词并补齐非趋势搜索指标'],
    ...(product.fieldAnalysis?.status === 'pending' && product.fieldAnalysis.jobId
      ? { waitingForCollectionId: product.fieldAnalysis.jobId } : {}),
  }]);
  const job = (await connection.query('SELECT id,status,checkpoint FROM research_jobs WHERE request_id=$1', [id])).rows[0];
  product.keywordDerivation = {
    ...(product.keywordDerivation?.jobId === id ? product.keywordDerivation : {}),
    jobId: id, fingerprint: sample.fingerprint,
    status: job.status === 'completed' && product.keywordDerivation?.jobId === id ? product.keywordDerivation.status : job.status,
    count: job.checkpoint?.keywords?.length || 0,
  };
  return { jobId: id, status: job.status, reused: Boolean(existing) };
}

export async function submitProductKeywords(input, user, overrides = {}) {
  requireAdmin(user);
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100 ||
      input.ids.some((id) => typeof id !== 'string' || !id || id.length > 160))
    throw Error('每次请选择1～100件商品');
  const io = { ...defaults, ...overrides };
  const c = await io.pool.connect();
  try {
    await c.query('BEGIN');
    const products = [];
    for (const id of [...new Set(input.ids)].sort()) {
      const product = (await c.query('SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE', [`business:products:${id}`])).rows[0]?.value;
      if (!product || product.dataNature === 'demo' || !productKeywordSample(product).sources.length)
        throw Error('所选商品已删除或缺少原文，请刷新后重新选择；未提交部分名单');
      products.push(product);
    }
    const jobs = [];
    for (const product of products) {
      const result = await queueProductKeywords(product, c, { ...io, retryIncomplete: true });
      if (!result) throw Error('商品市场不支持关键词研究；未提交部分名单');
      jobs.push(result);
      await io.putDocument('workspace_documents', `business:products:${product.id}`, product, false, c);
    }
    await c.query('COMMIT');
    return { accepted: products.length, jobs, reused: jobs.filter((job) => job.reused).length };
  } catch (error) { await c.query('ROLLBACK'); throw error; }
  finally { c.release(); }
}

export function productKeywordIO(overrides = {}) {
  const io = { ...defaults, collect, saveCheckpoint, now, ...overrides };
  const saveDerived = createKeywordSaver({ pool: io.pool, sql: io.sql });
  const readProduct = async (id, connection = io.pool, locked = false) =>
    (await connection.query(`SELECT value FROM workspace_documents WHERE name=$1${locked ? ' FOR UPDATE' : ''}`, [`business:products:${id}`])).rows[0]?.value;
  const transaction = async (action) => {
    const c = await io.pool.connect();
    try { await c.query('BEGIN'); const result = await action(c); await c.query('COMMIT'); return result; }
    catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
  };
  return {
    ...io, readProduct,
    hasConfig: async (name) => (await io.pool.query('SELECT name FROM provider_configs WHERE name=$1', [name])).rows.length > 0,
    cancelled: async (job) => Boolean((await io.pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [job.id])).rows[0]?.cancelled),
    updateProduct: (job, patch) => transaction(async (c) => {
      const product = await readProduct(job.input.targetId, c, true);
      if (!product || product.keywordDerivation?.jobId !== job.id) return;
      product.keywordDerivation = { ...product.keywordDerivation, ...patch, updatedAt: io.now() };
      await io.putDocument('workspace_documents', `business:products:${product.id}`, product, false, c);
    }),
    linkKeywords: (job, candidates, model) => transaction(async (c) => {
      const product = await readProduct(job.input.targetId, c, true);
      if (!product || productKeywordSample(product).fingerprint !== job.input.sample.fingerprint)
        throw Error('商品来源已更新或删除，请对最新资料补做关键词');
      const keywords = [];
      for (const candidate of [...candidates].sort((a, b) => naturalKey({ ...a, market: product.market }).localeCompare(naturalKey({ ...b, market: product.market })))) {
        const record = await saveDerived({
          term: candidate.term, termZh: candidate.termZh, market: product.market,
          source: '商品原文提词（候选）', seedTerm: candidate.term,
          reviewStatus: 'pending', dataNature: 'imported',
          collectedAt: io.now(), updatedAt: io.now(), productIds: [product.id],
          productKeywordEvidence: [{ ...candidate.evidence, model, collectedAt: io.now() }],
        }, true, c);
        keywords.push({ id: record.id, term: record.term, market: record.market });
      }
      product.keywordIds = [...new Set([...(product.keywordIds || []), ...keywords.map((record) => record.id)])];
      await io.putDocument('workspace_documents', `business:products:${product.id}`, product, false, c);
      return keywords;
    }),
    saveMetrics: (key, state, metrics) => transaction(async (c) => {
      const row = (await c.query('SELECT data FROM research_keywords WHERE natural_key=$1 FOR UPDATE', [key])).rows[0];
      if (!row) return;
      const record = { ...row.data, semrushCollection: state };
      if (metrics) {
        const { searchTrend: _trend, ...nonTrend } = metrics;
        record.metrics = mergeKeywordMetrics(record, nonTrend);
      }
      await c.query('UPDATE research_keywords SET data=$2,updated_at=now() WHERE natural_key=$1', [key, record]);
    }),
  };
}

export async function runProductKeywords(job, overrides = {}) {
  return runProductKeywordJob(job, productKeywordIO(overrides));
}
