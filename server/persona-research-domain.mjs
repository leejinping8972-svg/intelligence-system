import { createHash } from 'node:crypto';

export const personaLimitations = [
  '目标画像是招募条件；检索命中不证明年龄、居住地、婚育、孩子年龄或家庭购买决策权。',
  '自述未经身份或订单验证；品牌定位、购买/使用自述与研究推断分别记录。',
  '公开便利样本受关键词、平台排序、时间和预算影响，不代表总体人口；模型引用数不等于消费者比例。',
  '商品价格是页面快照，分母是审核通过且价格有效的商品记录，不是人群消费金额分布。',
  '孩子、孕哺及特殊人群的需求不能直接转为补充剂、剂量或疗效建议。',
];
const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 28);
const clean = (v, n = 1000) => String(v ?? '').trim().slice(0, n);
const languages = { VN: 'vi', US: 'en', MX: 'es' };
export function localPersonaContext(market, group) {
  const text = `${group.label} ${group.lifeStage} ${group.familyRole}`;
  const stage = /大童|青春期|上学|学龄|đi học|dậy thì|school|escolar/iu.test(text) ? 'school' : /新晋|产后|婴|幼|哺乳|con nhỏ|sau sinh|postpartum|bebé/iu.test(text) ? 'infant' : 'general';
  const role = /宝妈|母亲|妈妈|mẹ|mother|madre/iu.test(text) ? 'mother' : /父亲|爸爸|father|padre|bố/iu.test(text) ? 'father' : 'neutral';
  const subject = ({ VN: { mother: 'mẹ', father: 'bố', neutral: 'người chăm sóc' }, US: { mother: 'mother', father: 'father', neutral: 'caregiver' }, MX: { mother: 'madre', father: 'padre', neutral: 'persona cuidadora' } })[market][role];
  return ({ VN: { infant: `${subject} chăm con nhỏ`, school: `${subject} có con đi học`, general: `${subject} nhu cầu cuộc sống gia đình` }, US: { infant: `${subject} caring for a baby`, school: `${subject} with school age children`, general: `${subject} daily life family needs` }, MX: { infant: `${subject} con bebé`, school: `${subject} con hijos en edad escolar`, general: `${subject} vida diaria necesidades familiares` } })[market][stage];
}
const questionTerms = [
  [/睡|失眠|sleep|ngủ/iu, { VN: 'giấc ngủ', US: 'sleep', MX: 'sueño' }],
  [/掉发|脱发|hair|rụng tóc/iu, { VN: 'rụng tóc', US: 'hair loss', MX: 'caída del cabello' }],
  [/保健|补充剂|vitamin|supplement/iu, { VN: 'thực phẩm bổ sung', US: 'supplements', MX: 'suplementos' }],
  [/赠品|赠送|gift|quà/iu, { VN: 'quà tặng', US: 'free gift', MX: 'regalo' }],
  [/价格|预算|消费|price|budget/iu, { VN: 'giá chi tiêu', US: 'price budget', MX: 'precio presupuesto' }],
  [/信任|信息来源|trust/iu, { VN: 'tin tưởng chính hãng', US: 'trust authentic', MX: 'confianza auténtico' }],
];
const topics = {
  VN: [
    ['self', '本人需求', 'mệt mỏi giấc ngủ rụng tóc chăm sóc bản thân', 'mệt|ngủ|tóc|collagen|phụ nữ'],
    ['child', '孩子与照护', 'chăm con đi học ăn uống mua đồ cho con', 'con|bé|trẻ|học'],
    ['partner', '伴侣需求', 'mua cho chồng sức khỏe sinh hoạt', 'chồng|nam giới'],
    ['elder', '老人与照护', 'mua cho bố mẹ người cao tuổi chăm sóc', 'bố mẹ|ông bà|cao tuổi|xương'],
    ['household', '家庭购买场景', 'chi tiêu gia đình mua sắm chính hãng quà tặng', 'gia đình|mua|giá|tặng|chính hãng'],
  ],
  US: [
    ['self', '本人需求', 'fatigue sleep hair loss self care', 'sleep|fatigue|hair|women'],
    ['child', '孩子与照护', 'school children meals buying for children', 'child|school|kid'],
    ['partner', '伴侣需求', 'buying for husband health daily routine', 'husband|partner'],
    ['elder', '老人与照护', 'buying for parents elder care', 'parent|elder'],
    ['household', '家庭购买场景', 'family shopping budget trusted brands free gift', 'family|buy|price|gift'],
  ],
  MX: [
    ['self', '本人需求', 'cansancio sueño caída cabello autocuidado', 'sueño|cansancio|cabello|mujer'],
    ['child', '孩子与照护', 'hijos escuela alimentación compras', 'hijo|niño|escuela'],
    ['partner', '伴侣需求', 'comprar para esposo salud rutina', 'esposo|pareja'],
    ['elder', '老人与照护', 'comprar para padres adultos mayores cuidado', 'padres|mayores'],
    ['household', '家庭购买场景', 'compras familia presupuesto confianza regalo', 'familia|compra|precio|regalo'],
  ],
};
function integer(v, min, max, label) {
  if (!Number.isInteger(Number(v)) || Number(v) < min || Number(v) > max) throw new Error(`${label}须为${min}-${max}`);
  return Number(v);
}
function date(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) throw new Error('日期无效');
  return v;
}
export function validatePersonaPlan(input) {
  if (!languages[input.market]) throw new Error('请选择VN、US或MX');
  if (!Array.isArray(input.groups) || !input.groups.length || input.groups.length > 6) throw new Error('请设置1-6个人群');
  const groups = input.groups.map((g, i) => {
    const minAge = integer(g.minAge, 18, 90, '最低年龄');
    const maxAge = integer(g.maxAge, minAge, 90, '最高年龄');
    const value = { id: `g${i + 1}`, label: clean(g.label, 100), minAge, maxAge, lifeStage: clean(g.lifeStage, 300), familyRole: clean(g.familyRole, 300), localContext: clean(g.localContext, 300) };
    if (!value.label || !value.lifeStage || !value.familyRole) throw new Error('请填写人群名称、生命阶段及家庭角色');
    value.localContext ||= localPersonaContext(input.market, value);
    return value;
  });
  const startDate = date(input.startDate), endDate = date(input.endDate);
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期');
  const researchQuestion = clean(input.researchQuestion, 2000);
  if (!researchQuestion) throw new Error('请填写研究问题');
  const budget = {
    requests: integer(input.budget?.requests ?? 0, 0, 60, '补采请求'),
    credits: integer(input.budget?.credits ?? 0, 0, 60, '付费额度'),
    commentVideos: integer(input.budget?.commentVideos ?? 0, 0, 10, '评论视频数'),
    perQuery: integer(input.budget?.perQuery ?? 10, 1, 30, '每层保留数'),
  };
  const sources = [...new Set(input.sources || ['content', 'comments'])];
  if (!sources.length || sources.some((s) => !['content', 'comments', 'products'].includes(s))) throw new Error('请选择支持的补采来源');
  return { schemaVersion: 1, market: input.market, language: languages[input.market], title: clean(input.title || `${input.market}人群需求研究`, 160), groups, startDate, endDate, researchQuestion, budget, sources };
}
export function personaQueries(plan) {
  const focus = questionTerms.filter(([pattern]) => pattern.test(plan.researchQuestion)).map(([, values]) => values[plan.market]).join(' ');
  // Role-first order keeps a limited budget balanced across target groups.
  return topics[plan.market].flatMap(([role, topic, terms, pattern]) => plan.groups.map((g) => ({
    id: `${g.id}-${role}`, groupId: g.id, role, topic, pattern,
    query: `${g.localContext} ${terms}${focus ? ` ${focus}` : ''}`,
    identityQuery: `${g.localContext} ${g.minAge} ${g.maxAge} ${plan.market === 'VN' ? 'tuổi' : plan.market === 'MX' ? 'años' : 'years old'}`,
    language: plan.language,
  })));
}
export function reviewPersonaEvidence(record, patch, reviewer, at = new Date().toISOString()) {
  if (!['accepted', 'rejected', 'pending'].includes(patch.status)) throw new Error('审核状态无效');
  const allowed = ['explicit_self_report', 'purchase_usage_report', 'brand_positioning', 'research_inference', 'unknown'];
  const evidenceClass = patch.evidenceClass || record.evidenceClass || 'unknown';
  if (!allowed.includes(evidenceClass)) throw new Error('证据类型无效');
  const assertions = {};
  for (const field of ['age', 'location', 'familyRole', 'childAge', 'decisionRole', 'purchaseUsage']) {
    const a = patch.assertions?.[field];
    if (a?.value && a.value !== 'unknown') {
      if (!['explicit_self_report', 'purchase_usage_report'].includes(evidenceClass) || !a.quote || !record.text.includes(a.quote)) throw new Error('身份/购买自述必须附本条原文中的准确引句');
      if (field === 'age' && (!Number.isInteger(Number(a.value)) || Number(a.value) < 1 || Number(a.value) > 110)) throw new Error('自述年龄无效');
      assertions[field] = { value: clean(a.value, 160), quote: clean(a.quote, 1000), basis: '明确自述，未经独立核验' };
    } else assertions[field] = { value: 'unknown', quote: '' };
  }
  return { ...record, evidenceClass, assertions, review: { status: patch.status, note: clean(patch.note), reviewer: clean(reviewer, 100), at } };
}
export function personaEvidence(raw, context, plan) {
  const url = clean(raw.sourceUrl || raw.url || raw.evidenceUrl, 3000);
  if (!/^https:\/\//.test(url)) return null;
  const text = clean(raw.text || raw.title || raw.summary, 6000);
  if (!text) return null;
  const kind = raw.kind || 'content';
  const platform = raw.platform || raw.sourcePlatform || raw.source || 'public';
  const postedAt = raw.postedAt || raw.publishedAt || null;
  const timeScope = !postedAt ? 'unknown' : postedAt.slice(0, 10) < plan.startDate || postedAt.slice(0, 10) > plan.endDate ? 'historical_context' : 'in_period';
  return {
    id: `persona-${hash(`${platform}:${kind}:${url.split('?')[0]}:${raw.sourceId || text}`)}`,
    originalId: raw.id || null, text, url: raw.url || url, sourceUrl: url, platform, kind,
    ...(!context?.reused ? { sourceRecord: raw } : {}),
    market: plan.market, postedAt, collectedAt: raw.collectedAt || raw.lastCollectedAt || raw.sourceMetrics?.collectedAt || null,
    timeScope, marketBasis: raw.marketBasis || '目标市场检索，发言者所在地未知',
    price: Number(raw.price) > 0 ? Number(raw.price) : null, currency: raw.currency || null,
    category: raw.category || 'unknown', channel: raw.channel || platform,
    memberships: context ? [{ stratumId: context.id, groupId: context.groupId, role: context.role, topic: context.topic, query: context.query }] : [],
    provenance: [{ originalId: raw.id || null, reused: context?.reused === true, query: context?.query || raw.query || '', collectedAt: raw.collectedAt || raw.lastCollectedAt || null }],
    evidenceClass: ['product', 'ad'].includes(kind) ? 'brand_positioning' : 'unknown',
    assertions: Object.fromEntries(['age', 'location', 'familyRole', 'childAge', 'decisionRole', 'purchaseUsage'].map((k) => [k, { value: 'unknown', quote: '' }])),
    review: { status: 'pending' },
  };
}
export function mergePersonaEvidence(records, incoming) {
  const map = new Map(records.map((r) => [r.id, r]));
  for (const item of incoming.filter(Boolean)) {
    const old = map.get(item.id);
    if (!old) { map.set(item.id, item); continue; }
    const unique = (list) => [...new Map(list.map((v) => [JSON.stringify(v), v])).values()];
    map.set(item.id, { ...old, memberships: unique([...old.memberships, ...item.memberships]), provenance: unique([...old.provenance, ...item.provenance]) });
  }
  return [...map.values()];
}
export function validatePersonaFindings(findings, records) {
  const accepted = new Set(records.filter((r) => r.review.status === 'accepted').map((r) => r.id));
  const sections = ['needs', 'consumption', 'habits', 'trust', 'decision', 'family', 'hypotheses', 'comparison'];
  if (!Array.isArray(findings) || findings.length > 40) throw new Error('分析最多40条');
  return findings.map((f) => {
    if (!sections.includes(f.section) || !clean(f.label) || !clean(f.interpretation)) throw new Error('分析章节/内容无效');
    if (!['supported', 'partial', 'unverified', 'contradicted'].includes(f.verdict)) throw new Error('请选择证据结论');
    const evidenceIds = [...new Set(f.evidenceIds || [])];
    if (evidenceIds.some((id) => !accepted.has(id)) || (f.verdict !== 'unverified' && !evidenceIds.length)) throw new Error('结论必须引用审核通过的证据；无证据请标待验证');
    return { section: f.section, label: clean(f.label, 150), interpretation: clean(f.interpretation, 2000), suggestion: clean(f.suggestion, 1000), verdict: f.verdict, groupId: clean(f.groupId || 'all', 30), evidenceIds, confidence: ['中', '高'].includes(f.confidence) ? f.confidence : '低' };
  });
}
export function personaReport(study, records) {
  const accepted = records.filter((r) => r.review.status === 'accepted');
  const products = accepted.filter((r) => r.kind === 'product');
  const bands = study.plan.market === 'VN' ? [0, 100000, 300000, 600000, Infinity] : [0, 10, 30, 60, Infinity];
  const prices = products.filter((r) => r.price > 0 && r.currency === ({ VN: 'VND', US: 'USD', MX: 'MXN' }[study.plan.market]));
  const distribution = (values, key) => Object.entries(values.reduce((a, r) => { const k = r[key] || 'unknown'; a[k] = (a[k] || 0) + 1; return a; }, {})).map(([value, count]) => ({ value, count, denominator: values.length }));
  const coverage = study.queries.map((q) => {
    const matches = records.filter((r) => r.memberships.some((m) => m.stratumId === q.id));
    return { ...q, retrieved: matches.length, accepted: matches.filter((r) => r.review.status === 'accepted').length, sources: distribution(matches, 'platform'), requests: study.journal.filter((j) => j.stratumId === q.id), unknownIdentity: matches.filter((r) => r.assertions.age.value === 'unknown' || r.assertions.familyRole.value === 'unknown').length };
  });
  const findings = study.findings || [];
  return {
    id: study.id, kind: 'persona_research', reportType: 'persona', title: study.plan.title, market: study.plan.market,
    createdAt: study.createdAt, status: study.status, evidenceIds: records.map((r) => r.id), researchFocus: study.plan.researchQuestion,
    topicSummary: [],
    personaResearch: {
      plan: study.plan, coverage, journal: study.journal, findings,
      sampling: { retrieved: records.length, accepted: accepted.length, rejected: records.filter((r) => r.review.status === 'rejected').length, pending: records.filter((r) => r.review.status === 'pending').length, sources: new Set(records.map((r) => r.sourceUrl)).size, ageAndRoleSelfReports: accepted.filter((r) => r.assertions.age.value !== 'unknown' && r.assertions.familyRole.value !== 'unknown').length, inPeriod: accepted.filter((r) => r.timeScope === 'in_period').length, unknownDate: accepted.filter((r) => r.timeScope === 'unknown').length, historical: accepted.filter((r) => r.timeScope === 'historical_context').length },
      consumption: { basis: '审核商品供给快照，非消费者购买分布；按商品记录去重，可能含同SKU不同店铺。分类取来源原字段，缺失为unknown。', products: products.length, priced: prices.length, missingPrice: products.length - prices.length, priceBands: bands.slice(0, -1).map((low, i) => { const high = bands[i + 1]; return { low, high: Number.isFinite(high) ? high : null, count: prices.filter((r) => r.price >= low && r.price < high).length, denominator: prices.length }; }), currency: ({ VN: 'VND', US: 'USD', MX: 'MXN' }[study.plan.market]), categories: distribution(products, 'category'), channels: distribution(products, 'channel') },
      missingSections: ['needs', 'consumption', 'habits', 'trust', 'decision', 'family', 'hypotheses', 'comparison'].filter((s) => !findings.some((f) => f.section === s)),
      limitations: personaLimitations,
    },
    statistics: { sampleSize: accepted.length, sourceCount: new Set(accepted.map((r) => r.sourceUrl)).size, confidence: '低', method: '画像/需求/来源分层便利取样，人工审核；不计算人群百分比', themes: [], limitations: personaLimitations },
  };
}
