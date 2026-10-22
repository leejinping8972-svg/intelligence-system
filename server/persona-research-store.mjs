import { randomUUID } from 'node:crypto';
import { requireAdmin } from './auth.mjs';
import { openAdsKey, scrapeRequest } from './ads-provider.mjs';
import { pool, lock, unlock, putDocument } from './database.mjs';
import { normalizeEvidence } from './research-evidence.mjs';
import { normalizeTikTokShopProduct } from './tiktok-shop-provider.mjs';
import { marketObservationRecords } from './market-report-domain.mjs';
import { personaQueries, personaReport, reviewPersonaEvidence, validatePersonaFindings, validatePersonaPlan } from './persona-research-domain.mjs';
import { executePersonaStudy } from './persona-research-engine.mjs';
import { isDeepStrictEqual } from 'node:util';
import { materializePersonaBusiness, personaBusinessSignature, refreshPersonaBusinessReview } from './persona-business-records.mjs';
import { saveKeyword } from './store.mjs';
import { naturalKey } from './domain.mjs';

const read = async (name, c = pool) => (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [name])).rows[0]?.value;
const put = (name, value, c = pool) => putDocument('workspace_documents', name, value, false, c);
const docs = async (prefix) => (await pool.query('SELECT value FROM workspace_documents WHERE name LIKE $1', [`${prefix}%`])).rows.map((r) => r.value);
export async function existingPersonaEvidence(market) {
  const history = marketObservationRecords(await docs(`market:observation:${market}:`));
  const [products, ads, sites, content, comments] = await Promise.all(['business:products:', 'business:ads:', 'business:sites:', 'content:item:', 'business:researchEvidence:'].map(docs));
  const rows = [
    ...[...products, ...history.products].map((r) => ({ ...r, kind: 'product', text: r.title })),
    ...[...ads, ...history.ads].map((r) => ({ ...r, kind: 'ad', text: r.text || r.body || r.headline || r.title, sourceUrl: r.sourceUrl || r.adLibraryUrl || r.url })),
    ...[...sites, ...history.sites].map((r) => ({ ...r, kind: 'site', text: r.description || r.brand || r.domain, sourceUrl: r.url || `https://${r.domain}` })),
    ...[...content, ...history.content].map((r) => ({ ...r, kind: 'content', text: `${r.title || ''}\n${r.summary || ''}`, platform: r.sourceLabel || r.source })),
    ...[...comments, ...history.comments].filter((r) => r.kind === 'comment'),
  ];
  return rows.filter((r) => (r.market === market || r.searchMarket === market) && r.dataNature !== 'demo' && !String(r.id).startsWith('persona-'));
}
export async function collectPersonaSource(source, q, plan) {
  const stored = await readConfig();
  const key = openAdsKey(stored);
  if (source === 'comments') {
    const raw = await scrapeRequest('/v1/tiktok/video/comments', { url: q.url }, key, fetch, 'GET');
    const value = normalizeEvidence(raw, { kind: 'tiktok_comments', url: q.url, query: q.query, market: plan.market });
    return { records: value.records, credits: value.creditsCharged };
  }
  const raw = await scrapeRequest(source === 'products' ? '/v1/tiktok/shop/search' : '/v1/tiktok/search/keyword', { query: q.query, region: plan.market, ...(source === 'products' ? { page: 1 } : { sort_by: 'relevance' }) }, key, fetch, 'GET');
  const at = new Date().toISOString();
  let records;
  if (source === 'products') {
    const list = raw.products || raw.data?.products;
    if (!Array.isArray(list)) throw new Error('商品返回结构未知，停止后续补采');
    records = list.map((p) => {
      const shownPrice = String(p.product_price_info?.sale_price_decimal || '');
      const nestedPrice = /^\d{1,3}(\.\d{3})+$/.test(shownPrice) ? Number(shownPrice.replaceAll('.', '')) : Number(shownPrice.replaceAll(',', ''));
      return normalizeTikTokShopProduct({ ...p, price: p.price ?? (nestedPrice || undefined), currency: p.currency || p.product_price_info?.currency_name, product_url: p.product_url || p.seo_url?.canonical_url, sold_count: p.sold_count ?? p.sold_info?.sold_count }, plan.market, at);
    }).filter(Boolean).map((p) => ({ ...p, kind: 'product', text: p.title }));
  } else {
    const list = raw.search_item_list || raw.data?.search_item_list || raw.aweme_list;
    if (!Array.isArray(list)) throw new Error('内容返回结构未知，停止后续补采');
    records = list.map((entry) => {
      const p = entry.aweme_info || entry.aweme || entry;
      if (!/^\d{10,30}$/.test(String(p.aweme_id || ''))) return null;
      return { id: String(p.aweme_id), sourceId: String(p.aweme_id), kind: 'content', platform: 'TikTok', text: p.desc, url: `https://www.tiktok.com/@${encodeURIComponent(p.author?.unique_id || '_')}/video/${p.aweme_id}`, collectedAt: at, postedAt: Number(p.create_time) > 0 ? new Date(Number(p.create_time) * 1000).toISOString() : null };
    }).filter(Boolean);
  }
  return { records, credits: Number.isFinite(raw.credits_charged) ? raw.credits_charged : null };
}
async function readConfig() {
  const r = (await pool.query('SELECT value FROM provider_configs WHERE name=$1', ['provider:scrapecreators:v1'])).rows[0]?.value;
  if (!r) throw new Error('未配置既有采集来源');
  return r;
}
async function publish(report, evidence) {
  const study = await read(`persona:study:${report.id}`);
  if (study) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const businessIo = {
        list: async (prefix) => (await c.query('SELECT value FROM workspace_documents WHERE name LIKE $1', [`${prefix}%`])).rows.map((r) => r.value),
        keyword: async (record) => {
          await saveKeyword(record, true, c);
          return (await c.query('SELECT data FROM research_keywords WHERE natural_key=$1', [naturalKey(record)])).rows[0].data;
        },
        update: async (name, transform) => {
          await putDocument('workspace_documents', name, {}, true, c);
          const old = (await c.query('SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE', [name])).rows[0]?.value;
          const value = transform(old?.id ? old : undefined);
          await put(name, value, c); return value;
        },
      };
      if (study.businessSync?.signature !== personaBusinessSignature(study)) study.businessSync = await materializePersonaBusiness(study, businessIo);
      else for (const r of study.evidence) {
        if (study.businessSync.reviewStatuses?.[r.id] === r.review.status) continue;
        for (const ref of study.businessSync.references[r.id] || []) {
          const prefix = { content: 'content:item:', comment: 'business:researchEvidence:', product: 'business:products:', site: 'business:sites:', ad: 'business:ads:' }[ref.list];
          await businessIo.update(`${prefix}${ref.id}`, (old) => refreshPersonaBusinessReview(old, study.id, r));
        }
        study.businessSync.reviewStatuses[r.id] = r.review.status;
      }
      await put(`persona:study:${study.id}`, study, c);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; }
    finally { c.release(); }
  }
  // Per-study IDs keep reviews of reused evidence independent between reports.
  const ids = new Map(evidence.map((r) => [r.id, `${report.id}:${r.id}`]));
  const publishedEvidence = new Map((await docs(`business:researchEvidence:${report.id}:`)).map((r) => [r.id, r]));
  for (const r of evidence) {
    const value = { ...r, id: ids.get(r.id), sourceEvidenceId: r.id };
    if (!isDeepStrictEqual(publishedEvidence.get(value.id), value)) await put(`business:researchEvidence:${value.id}`, value);
  }
  const published = { ...report, evidenceIds: [...ids.values()], personaResearch: { ...report.personaResearch, findings: report.personaResearch.findings.map((f) => ({ ...f, evidenceIds: f.evidenceIds.map((id) => ids.get(id)) })) } };
  await put(`business:insightReports:${report.id}`, published);
  return report;
}
export async function runPersonaResearch(job, overrides = {}) {
  const study = await read(`persona:study:${job.id}`);
  if (!study) throw new Error('人群研究计划不存在');
  await executePersonaStudy(study, {
    existing: existingPersonaEvidence,
    collect: collectPersonaSource,
    save: (s) => put(`persona:study:${s.id}`, s), publish,
    cancelled: async () => Boolean((await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [job.id])).rows[0]?.cancelled),
    ...overrides,
  });
  await pool.query('UPDATE research_jobs SET status=$2,checkpoint=$3,updated_at=now() WHERE id=$1', [job.id, study.status, { logs: ['人群研究补采结束，待审核证据和分析'], requests: study.journal.length }]);
}
export async function personaResearchAction(input, user) {
  if (input.action === 'server_persona_preview') {
    const plan = validatePersonaPlan(input.plan);
    return { plan, queries: personaQueries(plan), estimatedRequests: Math.min(plan.budget.requests, personaQueries(plan).length * plan.sources.filter((s) => s !== 'comments').length + plan.budget.commentVideos), configured: Boolean((await pool.query('SELECT name FROM provider_configs WHERE name=$1', ['provider:scrapecreators:v1'])).rows.length) };
  }
  if (input.action === 'server_persona_detail') {
    const study = await read(`persona:study:${input.id}`);
    if (!study) throw new Error('人群研究不存在');
    return { study, report: personaReport(study, study.evidence) };
  }
  requireAdmin(user);
  const c = await pool.connect(); let held = false;
  try {
    held = await lock(c, 'insight-submit');
    if (!held) throw new Error('其他研究正在保存，请稍后重试');
    if (input.action === 'server_persona_submit') {
      if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId || '')) throw new Error('缺少提交编号');
      const duplicate = (await c.query('SELECT id FROM research_jobs WHERE request_id=$1', [input.requestId])).rows[0];
      if (duplicate) return { id: duplicate.id };
      const plan = validatePersonaPlan(input.plan);
      if (plan.budget.requests > 0 && plan.budget.credits < 1) throw new Error('补采须有明确额度；复用模式请求设为0');
      if (plan.budget.requests > 0) await readConfig();
      const active = (await c.query("SELECT id FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false")).rows;
      if (active.length >= 20) throw new Error('后台已有20个任务');
      const id = randomUUID();
      const study = { id, plan, queries: personaQueries(plan), evidence: [], journal: [], findings: [], createdAt: new Date().toISOString(), status: 'queued', revision: 1 };
      await c.query('BEGIN');
      try {
        await put(`persona:study:${id}`, study, c);
        await put(`business:insightReports:${id}`, personaReport(study, []), c);
        await c.query('INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)', [id, input.requestId, { kind: 'persona_research', market: plan.market, markets: [plan.market], title: plan.title }, { submittedAt: study.createdAt }]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; }
      return { id };
    }
    const study = await read(`persona:study:${input.id}`, c);
    if (!study) throw new Error('人群研究不存在');
    if (input.action === 'server_persona_cancel') {
      const job = (await c.query('SELECT status FROM research_jobs WHERE id=$1', [study.id])).rows[0];
      await c.query('UPDATE research_jobs SET cancelled=true WHERE id=$1', [study.id]);
      if (job?.status === 'queued') {
        study.status = 'cancelled';
        await c.query("UPDATE research_jobs SET status='cancelled' WHERE id=$1", [study.id]);
        await put(`persona:study:${study.id}`, study, c);
        await publish(personaReport(study, study.evidence), study.evidence);
      }
      return { cancelRequested: true };
    }
    if (['queued', 'running'].includes(study.status)) throw new Error('采集中，请完成或取消后再审核');
    if (input.revision !== study.revision) throw new Error('研究已更新，请刷新后重试');
    if (input.action === 'server_persona_review') {
      const index = study.evidence.findIndex((r) => r.id === input.evidenceId);
      if (index < 0) throw new Error('证据不存在');
      study.evidence[index] = reviewPersonaEvidence(study.evidence[index], input.patch, user?.username || user?.id || 'admin');
      // Previously cited evidence cannot silently change underneath a completed finding.
      study.findings = (study.findings || []).filter((f) => !f.evidenceIds.includes(input.evidenceId));
      study.status = 'partial';
    } else if (input.action === 'server_persona_finalize') {
      study.findings = validatePersonaFindings(input.findings, study.evidence);
      study.status = input.complete === true ? 'completed' : 'partial';
      if (input.complete === true && personaReport(study, study.evidence).personaResearch.missingSections.length) throw new Error('请逐项填写分析；无证据章节可明确标待验证');
    } else throw new Error('不支持的人群研究动作');
    study.revision++; await put(`persona:study:${study.id}`, study, c);
    await publish(personaReport(study, study.evidence), study.evidence);
    return { study, report: personaReport(study, study.evidence) };
  } finally { if (held) await unlock(c, 'insight-submit'); c.release(); }
}
