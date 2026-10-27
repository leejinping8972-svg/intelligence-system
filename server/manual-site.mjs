import { randomUUID } from 'node:crypto';

import { load } from 'cheerio';

import { collectionPolicyMessage, resolveCollectionPolicy } from './collection-policy.mjs';
import { classifyStore, inferCategory, isCandidateUrl } from './collector.js';
import { appendCoreEvidence, archiveCoreEvidence } from './core-evidence.mjs';
import { lock, pool, putDocument, sql, unlock } from './database.mjs';
import { fetchPublicPage, landingUrl } from './safe-web.mjs';
import { scoreSite } from './site-scoring.mjs';
import { recordSourceCall } from './source-usage.mjs';

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export function validateManualSite(input) {
  const raw = String(input.url || '').trim();
  const url = landingUrl(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!url || raw.length > 2000 || !isCandidateUrl(url))
    throw new Error('请填写有效的公开独立站网址');
  if (!['MX', 'US', 'VN'].includes(input.market)) throw new Error('请选择归档市场');
  if (!uuid.test(input.requestId)) throw new Error('缺少提交编号');
  if (input.collectProducts !== undefined && typeof input.collectProducts !== 'boolean')
    throw new Error('商品采集选项无效');
  const brand = String(input.brand || '').trim();
  if (brand.length > 120) throw new Error('品牌名称最多120字');
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace(/\.$/, '');
  if (parsed.hostname.length > 120) throw new Error('独立站域名最多120字');
  for (const key of [...parsed.searchParams.keys()])
    if (/^utm_|^(?:fbclid|gclid)$/i.test(key)) parsed.searchParams.delete(key);
  return {
    url: parsed.toString(),
    domain: parsed.hostname.toLowerCase().replace(/^www\./, ''),
    market: input.market,
    brand,
    collectProducts: input.collectProducts !== false,
    profile: input.profile === 'deep' ? 'deep' : 'explore',
    requestId: input.requestId,
  };
}

export function manualSiteProfile(page, input, at = new Date().toISOString()) {
  const $ = load(page.html);
  if (/just a moment|access denied|security check|verify you are human/i.test($('title').text()))
    throw new Error('站点返回访问验证页，请稍后重试');
  const classification = classifyStore(page.html, page.url);
  const description = $('meta[name="description"], meta[property="og:description"]').first().attr('content') || '';
  const title = $('meta[property="og:site_name"]').attr('content') || $('title').text().split(/[|\u2013\u2014]/)[0]?.trim();
  const names = classification.products.map((product) => product.name).filter((name) => typeof name === 'string' && name.trim()).slice(0, 10);
  const brand = input.brand || title?.slice(0, 120) || input.domain;
  return {
    id: `${input.market}-${input.domain}`, domain: input.domain, market: input.market,
    brand, platform: classification.platform, type: '手动添加独立站',
    keyword: '', category: inferCategory(brand, description, ...names),
    mainProducts: names, ownershipBackground: '待从官网核验', ownershipOperations: '待从官网核验',
    ownershipEvidence: '已读取公开页面，企业归属及销售能力按官网证据核验。',
    ownershipSource: page.url, evidenceUrl: page.url, description: description.slice(0, 2000),
    confidence: classification.confidence, signals: classification.signals,
    sources: ['手动添加 · 官网公开资料'], collectorMode: 'manual',
    dataNature: 'collected', lastCollectedAt: at,
  };
}

export async function addManualSite(input, overrides = {}) {
  const value = validateManualSite(input);
  const io = { pool, lock, unlock, putDocument, fetchPage: (...args) => recordSourceCall({ task: '手动添加独立站', step: '官网公开资料', sourceId: 'official_sites', market: value.market, project: () => ({ requests: 1 }) }, () => fetchPublicPage(...args)), now: () => new Date().toISOString(), ...overrides };
  const receiptName = `manual-site:request:${value.requestId}`;
  const readReceipt = async (c) => (await c.query('SELECT value FROM workspace_documents WHERE name=$1', [receiptName])).rows[0]?.value;
  const previous = await readReceipt(io.pool);
  if (previous) {
    if (previous.url !== value.url || previous.market !== value.market || previous.brand !== value.brand || previous.collectProducts !== value.collectProducts || previous.profile !== value.profile)
      throw new Error('提交编号已用于其他站点或采集选项');
    return previous.result;
  }
  const page = await io.fetchPage(value.url, 0, ['text/html'], { allowedDomain: value.domain });
  const at = io.now();
  const profile = manualSiteProfile(page, value, at);
  const c = await io.pool.connect();
  let held = false;
  try {
    held = await io.lock(c, 'products-submit');
    if (!held) throw new Error('正在提交站点或商品采集，请稍后重试');
    await c.query('BEGIN');
    const replay = await readReceipt(c);
    if (replay) {
      if (JSON.stringify(replay.input) !== JSON.stringify(value)) throw new Error('提交编号已用于其他站点或采集选项');
      await c.query('COMMIT');
      return replay.result;
    }
    const matches = (await c.query(sql(
      "SELECT value FROM workspace_documents WHERE name LIKE 'business:sites:%' AND value->>'market'=$1 AND lower(regexp_replace(value->>'domain','^www\\.','','i'))=$2 FOR UPDATE",
      "SELECT value FROM workspace_documents WHERE name LIKE 'business:sites:%' AND JSON_UNQUOTE(JSON_EXTRACT(value,'$.market'))=$1 AND REGEXP_REPLACE(LOWER(JSON_UNQUOTE(JSON_EXTRACT(value,'$.domain'))),'^www[.]','')=$2 FOR UPDATE",
    ), [value.market, value.domain])).rows.map((row) => row.value);
    if (matches.length > 1) throw new Error('该市场已有多个同域名站点，请先合并重复记录');
    const old = matches[0];
    const site = { ...profile, ...old, lastCollectedAt: at,
      sources: [...new Set([...(old?.sources || []), ...profile.sources])],
      signals: [...new Set([...(old?.signals || []), ...profile.signals])],
      mainProducts: [...new Set([...(old?.mainProducts || []), ...profile.mainProducts])],
    };
    if (!old?.description) site.description = profile.description;
    if (!old?.platform || old.platform === '其他') site.platform = profile.platform;
    site.assessment = scoreSite(site);
    const saved = appendCoreEvidence('sites', old, site, profile);
    const write = (name, data, only = false) => io.putDocument('workspace_documents', name, data, only, c);
    await archiveCoreEvidence('sites', saved.id, saved, write, old);
    await write(`business:sites:${saved.id}`, saved);
    let jobId = '';
    if (value.collectProducts) {
      const active = (await c.query("SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false")).rows;
      const ongoing = active.find((job) => job.input.kind === 'products' && job.input.siteIds?.includes(saved.id));
      if (ongoing) jobId = ongoing.id;
      else {
        if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
        const policy = resolveCollectionPolicy({ profile: value.profile }, 1);
        jobId = randomUUID();
        await c.query('INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)', [jobId, value.requestId, {
          kind: 'products', records: [saved], siteIds: [saved.id], markets: [value.market],
          ...policy, maxPaidRequests: 0, collectionPolicyVersion: 4,
          policyWarnings: collectionPolicyMessage(policy, 1),
        }, { submittedAt: at }]);
      }
    }
    const result = { siteId: saved.id, jobId, reused: Boolean(old), brand: saved.brand, domain: saved.domain };
    await write(receiptName, { ...value, input: value, result, savedAt: at });
    await c.query('COMMIT');
    return result;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    try { if (held) await io.unlock(c, 'products-submit'); }
    finally { c.release(); }
  }
}
