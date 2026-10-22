import { createHash } from 'node:crypto';
import { naturalKey } from './domain.mjs';
import { normalizeContent } from './public-content-domain.mjs';

const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24);
const unique = (values) => [...new Set(values.filter(Boolean))];
const videoId = (url) => String(url || '').match(/\/video\/(\d+)/)?.[1];
const canonical = (url) => {
  try { const u = new URL(url); return videoId(url) ? `tiktok:${videoId(url)}` : `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/$/, '')}`; }
  catch { return ''; }
};
const sourceOf = (r) => /tiktok/i.test(r.platform) ? 'tiktok' : /youtube/i.test(r.platform) ? 'youtube' : /reddit/i.test(r.platform) ? 'reddit' : /facebook/i.test(r.platform) ? 'facebook' : /instagram/i.test(r.platform) ? 'instagram' : 'web_articles';
export const personaBusinessSignature = (study) => hash(JSON.stringify([1, study.queries.map((q) => [q.id, q.query]), unique([...(study.acquiredEvidence || []), ...study.evidence].map((r) => r.id)).sort()]));
export function refreshPersonaBusinessReview(record, studyId, evidence) {
  return { ...record, personaResearchLinks: (record.personaResearchLinks || []).map((link) => {
    if (link.studyId !== studyId) return link;
    const evidenceReviews = { ...link.evidenceReviews, [evidence.id]: evidence.review.status };
    const states = unique(Object.values(evidenceReviews));
    return { ...link, evidenceReviews, reviewStatus: states.length === 1 ? states[0] : 'mixed' };
  }) };
}

// This materializes already acquired records. It never invokes a provider or model.
export async function materializePersonaBusiness(study, io) {
  const records = [...new Map([...(study.acquiredEvidence || []), ...study.evidence].map((r) => [r.id, r])).values()];
  const result = { signature: personaBusinessSignature(study), reviewStatuses: Object.fromEntries(records.map((r) => [r.id, r.review.status])), keywords: [], contentIds: [], commentIds: [], productIds: [], siteIds: [], adIds: [], references: {}, created: {}, warnings: [] };
  const current = {};
  for (const [kind, prefix] of Object.entries({ content: 'content:item:', comment: 'business:researchEvidence:', product: 'business:products:', site: 'business:sites:', ad: 'business:ads:' })) current[kind] = await io.list(prefix);
  const queryKeywords = new Map();
  for (const q of study.queries) {
    if (q.query.length > 255) { result.warnings.push(`关键词过长，保留研究原始查询：${q.id}`); continue; }
    const related = records.filter((r) => r.kind === 'product' && r.memberships.some((m) => m.query === q.query || m.stratumId === q.id));
    const keyword = await io.keyword({ id: `persona-kw-${hash(`${study.plan.market}|${q.query.toLowerCase()}`)}`, term: q.query, termZh: `${q.topic}（研究检索，相关性待审核）`, market: study.plan.market, source: '画像研究', category: '画像需求研究', collectedAt: study.createdAt, seedTerm: q.query, dataNature: 'imported', reviewStatus: 'pending', reviewNote: `研究 ${study.id}；定位条件不证明发言者身份；无搜索量统计。`, series: [], productIds: related.map((r) => r.originalId).filter(Boolean) });
    queryKeywords.set(q.query, keyword.id);
    result.keywords.push({ id: keyword.id, naturalKey: naturalKey(keyword), query: q.query });
  }
  const keysFor = (r) => unique(r.memberships.flatMap((m) => [queryKeywords.get(m.query), ...study.queries.filter((q) => q.id === m.stratumId).map((q) => queryKeywords.get(q.query))]));
  const addRef = (r, list, id) => {
    (result.references[r.id] ||= []).push({ list, id });
    result[`${list}Ids`].push(id);
  };
  const annotate = (old, r) => {
    const prior = old.personaResearchLinks?.find((l) => l.studyId === study.id);
    const evidenceReviews = { ...prior?.evidenceReviews, [r.id]: r.review.status };
    const reviewStates = unique(Object.values(evidenceReviews));
    const link = { studyId: study.id, evidenceIds: unique([...(prior?.evidenceIds || []), r.id]), groups: unique([...(prior?.groups || []), ...r.memberships.map((m) => m.groupId)]), roles: unique([...(prior?.roles || []), ...r.memberships.map((m) => m.role)]), queries: unique([...(prior?.queries || []), ...r.memberships.map((m) => m.query)]), evidenceReviews, reviewStatus: reviewStates.length === 1 ? reviewStates[0] : 'mixed', identityBasis: '研究定位关联，不证明年龄、所在地或家庭身份' };
    return { ...old, personaResearchIds: unique([...(old.personaResearchIds || []), study.id]), personaResearchLinks: [...(old.personaResearchLinks || []).filter((l) => l.studyId !== study.id), link] };
  };
  const save = async (kind, prefix, candidate, r) => {
    let created = false;
    const saved = await io.update(`${prefix}${candidate.id}`, (old) => {
      created = !old;
      const base = old || candidate;
      return annotate({ ...base, ...(kind === 'content' ? { keywordIds: unique([...(base.keywordIds || []), ...keysFor(r)]), matchedQueries: unique([...(base.matchedQueries || []), ...r.memberships.map((m) => m.query)]), searchContexts: [...new Map([...(base.searchContexts || []), ...r.memberships.map((m) => ({ scope: 'local', market: study.plan.market, language: study.plan.language, query: m.query, basis: r.marketBasis }))].map((v) => [JSON.stringify(v), v])).values()] } : {}) }, r);
    });
    if (created) { current[kind].push(saved); result.created[kind] = (result.created[kind] || 0) + 1; }
    else current[kind] = current[kind].map((v) => v.id === saved.id ? saved : v);
    return saved;
  };
  const ensureContent = async (r, parentOnly = false) => {
    const old = current.content.find((c) => c.id === r.originalId || canonical(c.url) === canonical(r.sourceUrl));
    const raw = r.sourceRecord || {};
    const source = sourceOf(r), id = videoId(r.sourceUrl) || raw.sourceId || r.originalId || hash(r.sourceUrl);
    const item = old || normalizeContent({ sourceId: id, url: r.sourceUrl, title: parentOnly ? '原评论所属内容（标题未补采）' : raw.title || r.text, summary: parentOnly ? '' : raw.summary || r.text, author: raw.author || '', language: raw.language || 'unknown', type: source === 'web_articles' ? 'article' : 'video', publishedAt: parentOnly ? null : r.postedAt, marketBasis: r.marketBasis, interactions: raw.interactions || {}, textAvailability: parentOnly ? '仅来源链接；未重新采集正文' : '描述 / 原始检索文本' }, source, { market: study.plan.market, language: study.plan.language, searchScope: 'local', keywordIds: [], productIds: [] }, '', r.collectedAt || study.createdAt);
    if (!item) throw new Error(`无法归档公共内容 ${r.id}`);
    return save('content', 'content:item:', item, r);
  };
  for (const r of records.filter((r) => r.kind === 'content')) {
    const saved = await ensureContent(r); addRef(r, 'content', saved.id);
  }
  for (const r of records.filter((r) => r.kind === 'comment')) {
    const old = current.comment.find((c) => c.id === r.originalId && !c.sourceEvidenceId)
      || (r.provenance.some((p) => p.reused) && current.comment.find((c) => c.kind === 'comment' && c.text === r.text && canonical(c.sourceUrl || c.url) === canonical(r.sourceUrl) && !c.sourceEvidenceId));
    const raw = r.sourceRecord || {};
    const candidate = old || { id: `comment-${hash(`${r.platform}:${r.originalId || r.id}:${r.sourceUrl}`)}`, kind: 'comment', text: r.text, platform: r.platform, sourceId: raw.sourceId || raw.id || r.originalId, sourceUrl: r.sourceUrl, url: r.sourceUrl, market: study.plan.market, postedAt: r.postedAt, collectedAt: r.collectedAt, likes: raw.likes ?? null, dataNature: 'collected', evidenceClass: 'unknown', reviewStatus: 'pending' };
    const saved = await save('comment', 'business:researchEvidence:', candidate, r); addRef(r, 'comment', saved.id);
    const parent = await ensureContent(r, true);
    await io.update(`content:item:${parent.id}`, (value) => ({ ...value, comments: { ...(value.comments || {}), items: [...new Map([...(value.comments?.items || []), { id: saved.id, text: saved.text, author: raw.author || '', url: saved.url || saved.sourceUrl, score: saved.likes ?? null, postedAt: saved.postedAt || null, collectedAt: saved.collectedAt || null }].map((v) => [v.id, v])).values()], collectedAt: value.comments?.collectedAt || saved.collectedAt, completeness: '已保存的有限评论取样；不代表全部评论或目标人群。原始时间逐条保留，未新增采集。' } }));
    addRef(r, 'content', parent.id);
  }
  for (const r of records.filter((r) => ['product', 'site', 'ad'].includes(r.kind))) {
    const kind = r.kind, prefix = { product: 'business:products:', site: 'business:sites:', ad: 'business:ads:' }[kind];
    const old = current[kind].find((v) => (v.market || v.searchMarket) === study.plan.market && (v.id === r.originalId || canonical(v.sourceUrl || v.evidenceUrl || v.url || (v.domain ? `https://${v.domain}` : '')) === canonical(r.sourceUrl)));
    const raw = r.sourceRecord || {};
    // Reuse preserves manual reviews, richer fields, historical metrics and the original ID.
    const candidate = old || { ...raw, id: raw.id || r.originalId || `${study.plan.market}-${kind}-${hash(r.sourceUrl)}`, title: raw.title || r.text, market: study.plan.market, sourceUrl: r.sourceUrl, evidenceUrl: r.sourceUrl, lastCollectedAt: r.collectedAt, dataNature: 'collected', ...(kind === 'product' ? { brand: raw.brand || '品牌待确认', category: r.category || '待分类', price: r.price, currency: r.currency, ingredient: raw.ingredient || '未取得可核验配方', dose: raw.dose || '未取得每份剂量', reviewed: false, favorite: false, benefits: raw.benefits || [], ingredientInsights: raw.ingredientInsights || [], siteId: raw.siteId || '', sourcePlatform: r.platform } : {}) };
    const saved = await save(kind, prefix, candidate, r); addRef(r, kind, saved.id);
    if (kind === 'product' && !/tiktok|amazon|facebook|youtube|reddit|instagram/i.test(r.platform)) {
      const domain = new URL(r.sourceUrl).hostname.replace(/^www\./, '');
      const site = current.site.find((v) => v.market === study.plan.market && v.domain?.replace(/^www\./, '') === domain) || { id: `${study.plan.market}-site-${hash(domain)}`, market: study.plan.market, domain, brand: raw.brand || domain, category: '品牌/零售官网线索', url: `https://${domain}`, source: '画像研究已有商品页', discoveredAt: r.collectedAt, dataNature: 'collected', favorite: false, reviewed: false };
      const linkedSite = await save('site', 'business:sites:', site, r); addRef(r, 'site', linkedSite.id);
      await io.update(`${prefix}${saved.id}`, (v) => ({ ...v, siteId: v.siteId || linkedSite.id }));
    }
  }
  for (const key of ['contentIds', 'commentIds', 'productIds', 'siteIds', 'adIds']) result[key] = unique(result[key]);
  const job = { id: study.id, mode: 'search', status: 'completed', submittedAt: study.createdAt, finishedAt: study.finishedAt || study.createdAt, input: { query: `${study.plan.title}（已采结果归档）`, queries: study.queries.map((q) => q.query), market: study.plan.market, language: study.plan.language, scopes: ['local'], limit: result.contentIds.length }, steps: [{ source: 'tiktok', query: '画像研究证据归档', status: 'success', count: result.contentIds.length, message: '复用已保存来源；本步骤0次外部请求。' }], itemIds: result.contentIds, requests: 0, creditsCharged: 0, unknownChargeRequests: 0, aiStatus: 'disabled', personaStudyId: study.id };
  await io.update(`content:job:${study.id}`, () => job);
  return result;
}
