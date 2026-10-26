import { createHash } from 'node:crypto';

import {
  decorateResourceProduct,
  rankResourceProducts,
} from './product-resource-domain.mjs';

const budgetKeys = [
  'requests', 'providerCalls', 'sorftimeCalls', 'scrapeCredits',
  'semrushUnits', 'braveRequests', 'browserPages', 'modelTokens',
];
const counters = () => Object.fromEntries(budgetKeys.map((key) => [key, 0]));
const cappedBudgetKeys = budgetKeys.filter((key) => key !== 'semrushUnits');
const stamp = (io) => new Date(io.now()).toISOString();
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const discovery = (work) => work.discovery !== false && !work.productId;
const sourceKey = (work) => {
  if (work.provider !== 'public_web') return work.provider;
  try { return `public_web:${new URL(work.url).hostname}`; }
  catch { return 'public_web'; }
};
const workKey = (work) => digest([
  work.routeId, work.provider, work.op, work.term, work.category?.id,
  work.url, work.domain, work.page, work.cursor, work.productId,
]);
const scopeKey = (work) => JSON.stringify([
  work.provider, work.op, work.term, work.category?.id, work.domain,
  work.scopeUrl || (work.op === 'public_page' ? work.url : undefined),
]);
const identity = (product, plan) => product?.sourceProductId
  ? JSON.stringify([product.sourcePlatform || plan.platform, product.market || plan.market, String(product.sourceProductId), String(product.sourceVariantId || product.resourceRaw?.variantId || '')])
  : undefined;

function enrichmentIdentityMatches(product, result, plan) {
  const expected = identity(product, plan);
  const matches = (candidate) => identity(candidate, plan) === expected;
  if (result.product && !matches(result.product)) return false;
  if (Array.isArray(result.products) && result.products.some((candidate) => !matches(candidate))) return false;
  for (const patch of [result.product, result.patch].filter(Boolean)) {
    for (const field of ['sourceProductId', 'sourcePlatform', 'market']) {
      if (Object.hasOwn(patch, field) && String(patch[field] ?? '') !== String(product[field] ?? '')) return false;
    }
    const expectedVariant = String(product.sourceVariantId || product.resourceRaw?.variantId || '');
    if (Object.hasOwn(patch, 'sourceVariantId') && String(patch.sourceVariantId ?? '') !== expectedVariant) return false;
    if (patch.resourceRaw && Object.hasOwn(patch.resourceRaw, 'variantId') && String(patch.resourceRaw.variantId ?? '') !== expectedVariant) return false;
  }
  return matches({ ...product, ...result.product, ...result.patch });
}

function initialWork(plan) {
  const common = { routeId: plan.routeId, provider: plan.provider, page: 1 };
  if (plan.mode === 'category') return [{
    ...common,
    op: plan.ranking === 'platform_bestsellers' ? 'bestsellers' : 'category',
    category: plan.category,
  }];
  if (plan.mode === 'urls') return (plan.urls || []).map((url) => ({
    ...common, url, scopeUrl: url,
    op: plan.initialOperation || plan.discoveryOperation || (['tiktok_shop', 'sorftime'].includes(plan.provider) ? 'detail' : 'public_page'),
  }));
  const op = plan.initialOperation || plan.discoveryOperation || (plan.provider === 'semrush'
    ? 'domains'
    : plan.platform === 'instagram' && plan.provider !== 'brave' ? 'instagram_search' : 'search');
  return (plan.terms || []).map((term) => ({ ...common, op, term }));
}

function costFor(work, plan, limit) {
  const cost = { ...counters(), requests: 1 };
  if (work.provider === 'sorftime') cost.requests = 5;
  if (work.provider === 'semrush') cost.requests = 14;
  if (work.provider !== 'public_web') cost.providerCalls = 1;
  if (work.provider === 'sorftime') cost.sorftimeCalls = 1;
  if (['tiktok_shop', 'scrapecreators', 'instagram_scrapecreators'].includes(work.provider)) cost.scrapeCredits = 1;
  if (work.provider === 'semrush') cost.semrushUnits = limit * (work.op === 'domains' ? 20 : 30);
  if (work.provider === 'brave') cost.braveRequests = 1;
  if (work.provider === plan.provider) {
    for (const key of budgetKeys) {
      if (key === 'semrushUnits') continue;
      const value = plan.operationCosts?.[work.op]?.[key] ?? plan.cost?.[key];
      if (Number.isFinite(value) && value >= 0) cost[key] = value;
    }
    const units = plan.operationCosts?.[work.op]?.semrushUnits;
    if (Number.isFinite(units) && units >= 0) cost.semrushUnits = units;
  }
  return cost;
}

function reportedUsage(result, work, cost) {
  const confirmed = counters();
  const unknown = [];
  for (const key of budgetKeys) {
    if (!cost[key]) continue;
    if (result.cached) { confirmed[key] = 0; continue; }
    let value = result.usage?.[key] ?? result[key];
    if (key === 'requests') {
      if (Number.isFinite(result.controlRequests) && Number.isFinite(result.dataRequests)) value ??= result.controlRequests + result.dataRequests;
      if (cost.requests === 1) value ??= 1;
    }
    if (key === 'sorftimeCalls') value ??= result.providerCalls;
    if (key === 'scrapeCredits') value ??= result.creditsCharged;
    if (key === 'semrushUnits') value ??= result.apiUnits;
    if (['providerCalls', 'braveRequests'].includes(key)) value ??= 1;
    if (Number.isFinite(value) && value >= 0) confirmed[key] = value;
    else unknown.push(key);
  }
  return { confirmed, unknown };
}

function supportedFollowup(plan, provider, op) {
  if (Array.isArray(plan.supportedOperations)) return plan.supportedOperations.includes(op);
  if (plan.operations && Object.hasOwn(plan.operations, op)) return Boolean(plan.operations[op]?.supported ?? plan.operations[op]);
  return provider === 'sorftime' || (provider === 'tiktok_shop' && op === 'detail');
}

function completionState(cp, work, status, message, at) {
  if (!work.productId) return;
  (cp.completion[work.productId] ||= {})[work.op] = { status, message, at };
}

// One call advances one persisted step. A restarted step uses the same store
// journal key, so a completed response is replayed locally and an unknown paid
// result cannot turn into a second provider request.
export async function runProductResourceDiscovery(job, io) {
  const plan = { ...job.input.resourcePlan, market: job.input.resourcePlan.market || job.input.market };
  const cp = {
    resourceVersion: 1, index: 0, requests: 0, products: 0, failures: 0,
    productIds: [], contentIds: [], identityIds: {}, detailIds: [], completion: {},
    work: initialWork(plan), pageFingerprints: {}, discoveryPages: 0, publicPages: 0,
    sourceStates: {}, reserved: counters(), confirmedUsage: counters(),
    stopReasons: [], logs: [], ...job.checkpoint,
  };
  cp.reserved = { ...counters(), ...cp.reserved };
  cp.confirmedUsage = { ...counters(), ...cp.confirmedUsage };
  cp.startedAt ||= stamp(io);
  const dirtyCompletion = new Set();
  const setCompletion = (work, status, message, at = stamp(io)) => {
    completionState(cp, work, status, message, at);
    if (work.productId) dirtyCompletion.add(work.productId);
  };
  const flushCompletion = async () => {
    for (const id of dirtyCompletion) {
      const dataCompletion = {};
      for (const [op, state] of Object.entries(cp.completion[id] || {})) dataCompletion[op === 'history' ? 'resourceHistory' : 'resourceDetail'] = {
        ...state, jobId: job.id,
        status: ({ not_found: 'empty', budget_truncated: 'failed', not_executed: 'failed' })[state.status] || state.status,
      };
      await io.upsertProduct({ id, dataCompletion });
    }
    dirtyCompletion.clear();
  };
  const log = (message) => { cp.logs.push(message); cp.logs = cp.logs.slice(-300); };
  const addWork = (work) => {
    const key = workKey(work);
    if (!cp.work.some((item) => workKey(item) === key)) cp.work.push(work);
  };
  const stop = (work, reason, status, message) => {
    const key = workKey(work);
    if (!cp.stopReasons.some((item) => item.key === key && item.reason === reason)) cp.stopReasons.push({ key, provider: work.provider, op: work.op, reason, status, message });
    setCompletion(work, status, message);
    log(`${work.provider} · ${work.op}：${message}`);
  };
  const updateProgress = () => {
    cp.products = cp.productIds.length;
    cp.resourceProgress = {
      routeId: plan.routeId, platform: plan.platform, mode: plan.mode,
      requestedWindowDays: plan.salesWindowDays, requestedQuantity: plan.maxProducts,
      ranking: plan.ranking, coverage: 'collected_sample', completeMarketCoverage: false,
      completedSteps: cp.index, plannedSteps: cp.work.length, discoveryPages: cp.discoveryPages, publicPages: cp.publicPages, contents: cp.contentIds.length,
      reserved: cp.reserved, usage: cp.confirmedUsage, sourceStates: cp.sourceStates,
      stopReasons: cp.stopReasons, rankingSummary: cp.rankingSummary,
    };
  };
  const save = async (status = 'running') => {
    updateProgress();
    return io.saveCheckpoint(job, cp, status);
  };
  const finish = async (status) => {
    if (status === 'cancelled') for (const [id, states] of Object.entries(cp.completion)) for (const [op, state] of Object.entries(states)) {
      if (['queued', 'running'].includes(state.status)) setCompletion({ productId: id, op }, 'cancelled', '任务已取消，已确认来源证据保留；恢复后继续未执行步骤');
    }
    await flushCompletion();
    if (status !== 'cancelled' && !cp.rankedAt) {
      const products = (await Promise.all(cp.productIds.map((id) => io.readProduct(id)))).filter(Boolean);
      const ranked = rankResourceProducts(products, plan);
      for (const product of ranked.products || []) await io.upsertProduct(product);
      cp.rankingSummary = ranked.summary;
      cp.rankedAt = stamp(io);
    }
    cp.finishedAt = stamp(io);
    cp.nextRunAt = 0;
    return save(status);
  };
  const completedStatus = () => cp.stopReasons.some((item) => item.status !== 'quantity_reached') ? 'partial' : 'completed';
  if (await io.isCancelled()) return finish('cancelled');
  if (cp.index >= cp.work.length) return finish(completedStatus());
  const work = cp.work[cp.index];
  const key = workKey(work);
  const state = (cp.sourceStates[sourceKey(work)] ||= {});
  const isDiscovery = discovery(work);
  const isPublicPage = isDiscovery && work.op === 'public_page';
  cp.currentTerm = work.term || work.category?.path?.join(' / ') || work.url || work.productId;
  const advance = async () => {
    await flushCompletion();
    cp.inFlight = undefined;
    cp.index++;
    if (await io.isCancelled()) return finish('cancelled');
    if (cp.index >= cp.work.length) return finish(completedStatus());
    cp.nextRunAt = io.now();
    return save();
  };
  if (state.blocked && !cp.inFlight) {
    stop(work, state.reason || 'source_blocked', 'not_executed', '来源已停止；其他来源和已确认结果保留');
    return advance();
  }
  if (!cp.inFlight && isDiscovery && cp.productIds.length >= plan.maxProducts) {
    stop(work, 'quantity_limit', 'quantity_reached', '已达到本次商品数量上限，后续发现请求未执行');
    return advance();
  }
  if (!cp.inFlight && isDiscovery && (isPublicPage ? (work.page || 1) > plan.budget.maxPages : cp.discoveryPages >= plan.budget.maxPages)) {
    stop(work, 'page_limit', 'budget_truncated', '已达到分页预算；样本未覆盖全市场或全类目');
    return advance();
  }
  const product = work.productId ? await io.readProduct(work.productId) : undefined;
  if (work.productId && !product) {
    stop(work, 'product_missing', 'not_found', '商品已删除，未请求详情或历史');
    return advance();
  }
  const limit = Math.max(1, Math.min(work.op === 'domains' ? 3 : 20, isDiscovery ? plan.maxProducts - cp.productIds.length : 1));
  const cost = cp.inFlight?.cost || costFor(work, plan, limit);
  if (!cp.inFlight) {
    const exceeded = cappedBudgetKeys.find((name) => cp.reserved[name] + cost[name] > (plan.budget[name] ?? 0));
    if (exceeded) {
      stop(work, `${exceeded}_limit`, 'budget_truncated', `达到 ${exceeded} 预算，本步骤未发起请求`);
      return advance();
    }
    if (state.nextAllowedAt > io.now()) {
      cp.nextRunAt = state.nextAllowedAt;
      return save();
    }
    for (const name of budgetKeys) cp.reserved[name] += cost[name];
    cp.requests = cp.reserved.requests;
    if (isPublicPage) cp.publicPages++;
    else if (isDiscovery) cp.discoveryPages++;
    cp.inFlight = { key, index: cp.index, cost, startedAt: stamp(io) };
    setCompletion(work, 'running', '正在向来源请求数据');
    await flushCompletion();
    await save();
  }
  if (cp.inFlight.key !== key || cp.inFlight.index !== cp.index) throw new Error('商品资源检查点不一致，已停止以避免错误重放');
  let result;
  try {
    result = await io.collect(job, `resource:${key}`, {
      sources: ['platform_products'], resourceDiscovery: true,
      ...work, market: plan.market, platform: work.platform || plan.platform,
      websiteDomain: work.websiteDomain || plan.websiteDomain,
      windowDays: plan.salesWindowDays, ranking: plan.ranking, limit,
      product, requestLimit: 1, sorftimeRequestLimit: cost.sorftimeCalls,
    });
  } catch (error) {
    const message = String(error.message || '来源请求失败').slice(0, 700);
    cp.failures++;
    const unsupported = /不支持|未开放|unsupported|not supported/i.test(message);
    const paid = cost.sorftimeCalls > 0 || cost.scrapeCredits > 0 || cost.semrushUnits > 0 || cost.braveRequests > 0;
    const unknown = paid && !unsupported;
    if (unknown || /HTTP (401|403|429)|unauthori|字段结构|rate.?limit/i.test(message)) {
      state.blocked = true;
      state.reason = unknown ? 'charge_unknown' : 'source_rejected';
    }
    if (unknown) cp.unknownCharges = (cp.unknownCharges || 0) + 1;
    stop(work, unsupported ? 'unsupported' : unknown ? 'charge_unknown' : 'request_failed', unsupported ? 'unsupported' : unknown ? 'unknown' : 'failed', message);
    return advance();
  }
  if (!result || typeof result !== 'object') throw new Error('来源返回结构未识别，保留调用日志等待核验');
  const at = result.collectedAt || cp.inFlight.startedAt;
  if (!cp.inFlight.accounted) {
    const usage = reportedUsage(result, work, cost);
    for (const name of budgetKeys) {
      cp.confirmedUsage[name] += usage.confirmed[name];
      if (result.cached || (name === 'requests' && !usage.unknown.includes(name))) cp.reserved[name] += usage.confirmed[name] - cost[name];
      else if (usage.confirmed[name] > cost[name]) cp.reserved[name] += usage.confirmed[name] - cost[name];
    }
    cp.requests = cp.reserved.requests;
    if (usage.unknown.length) {
      state.blocked = true;
      state.reason = 'charge_unknown';
      cp.unknownCharges = (cp.unknownCharges || 0) + 1;
      stop(work, 'charge_unknown', 'unknown', `${usage.unknown.join('、')} 实际扣费未返回；保留预留额度并停止此来源`);
    }
    if (cappedBudgetKeys.some((name) => cp.reserved[name] > (plan.budget[name] ?? 0))) {
      state.blocked = true;
      state.reason = 'reported_cost_limit';
      stop(work, 'reported_cost_limit', 'budget_truncated', '来源返回用量高于预留，已修正用量并停止该来源');
    }
    state.nextAllowedAt = io.now() + (work.provider === 'public_web' ? 2000 : 1500);
    cp.inFlight.accounted = true;
    await save();
  }

  if (product && !enrichmentIdentityMatches(product, result, plan)) {
    cp.failures++;
    stop(work, 'identity_mismatch', 'failed', '来源补全商品、平台、国家或变体标识不一致，原商品字段未覆盖');
    return advance();
  }
  if (result.unsupported || result.status === 'unsupported') stop(work, 'unsupported', 'unsupported', result.message || '来源不支持该操作');
  for (const content of (result.contents || []).slice(0, 100)) {
    if (!content.id || !io.upsertContent) continue;
    if (!cp.contentIds.includes(content.id) && cp.contentIds.length >= plan.maxProducts) break;
    await io.upsertContent(content);
    if (!cp.contentIds.includes(content.id)) cp.contentIds.push(content.id);
  }
  cp.contents = cp.contentIds.length;
  const evidencePlan = { ...plan, routeId: work.routeId, provider: work.provider, platform: work.platform || plan.platform };
  const discoveryOrigin = { routeId: plan.routeId, provider: plan.provider, platform: plan.platform, fromContentId: work.fromContentId };
  const pageIdentities = [];
  let rejected = 0;
  const discoveredProducts = product ? [] : result.products || (result.product ? [result.product] : []);
  for (const candidate of discoveredProducts.slice(0, 100)) {
    const productIdentity = identity(candidate, plan);
    if (!productIdentity || !candidate.id || !candidate.title || (candidate.market && candidate.market !== plan.market)) { rejected++; continue; }
    const previousId = cp.identityIds[productIdentity];
    if (!previousId && cp.productIds.length >= plan.maxProducts) break;
    const variantId = candidate.sourceVariantId || candidate.resourceRaw?.variantId;
    const id = previousId || (variantId ? `${candidate.id}-variant-${digest(String(variantId)).slice(0, 12)}` : candidate.id);
    const patch = decorateResourceProduct({ ...candidate, id }, evidencePlan, {
      jobId: job.id, collectedAt: at, sourceRank: candidate.resourceRaw?.sourceRank,
      query: work.term, category: work.category, discoveryOrigin,
      coverage: { scope: 'collected_sample', complete: false, pages: cp.discoveryPages, publicPages: cp.publicPages },
    });
    await io.upsertProduct(patch);
    cp.identityIds[productIdentity] = id;
    if (!cp.productIds.includes(id)) cp.productIds.push(id);
    pageIdentities.push(productIdentity);
    if (io.linkKeyword && work.term) {
      for (const keyword of (job.input.keywordRecords || []).filter((item) => item.term.toLowerCase() === work.term.toLowerCase())) await io.linkKeyword(keyword, [id]);
    }
    if (['sorftime', 'tiktok_shop'].includes(work.provider) && !cp.detailIds.includes(id)) {
      const operations = [
        ...(plan.includeDetails ? ['detail'] : []),
        ...(plan.includeHistory ? ['history'] : []),
      ];
      if (operations.length && cp.detailIds.length < plan.budget.maxDetailProducts) {
        cp.detailIds.push(id);
        for (const op of operations) {
          if (supportedFollowup(plan, work.provider, op)) {
            addWork({ routeId: work.routeId, provider: work.provider, op, productId: id, term: work.term, discovery: false });
            setCompletion({ productId: id, op }, 'queued', '已列入本次有限补全计划', at);
          } else setCompletion({ ...work, op, productId: id }, 'unsupported', '现有来源不支持该商品操作，保留缺失状态', at);
        }
      } else if (operations.length) {
        for (const op of operations) stop({ ...work, op, productId: id }, 'detail_product_limit', 'budget_truncated', '达到本次详情商品数量预算，该商品补全未执行');
      }
    }
  }
  if (product) {
    const patch = { ...product, ...result.product, ...result.patch, id: product.id };
    if (result.series) patch.decisionData = { ...patch.decisionData, series: [result.series] };
    await io.upsertProduct(decorateResourceProduct(patch, evidencePlan, {
      jobId: job.id, collectedAt: at, query: work.term,
      discoveryOrigin,
      coverage: { scope: 'collected_sample', complete: false, pages: cp.discoveryPages, publicPages: cp.publicPages },
      states: { [work.op === 'history' ? 'history' : 'detail']: {
        status: result.unsupported ? 'unsupported' : result.empty ? 'not_indexed' : 'observed',
        message: result.message || '未返回字段保持未知',
      } },
    }));
    setCompletion(work, result.empty ? 'not_found' : result.unsupported ? 'unsupported' : 'completed', result.message || '已保存真实来源字段，未返回字段保留未知', at);
  }
  const leadRecords = (result.leads || []).map((lead) => typeof lead === 'string' ? { url: lead } : lead).filter((lead) => lead?.url).slice(0, 100);
  const leads = leadRecords.map((lead) => lead.url);
  const fingerprints = (cp.pageFingerprints[scopeKey(work)] ||= []);
  const contentFingerprint = pageIdentities.length || leads.length ? digest([pageIdentities.toSorted(), leads.toSorted()]) : undefined;
  const pageFingerprint = result.pageFingerprint;
  const repeated = Boolean((contentFingerprint && fingerprints.includes(contentFingerprint)) || (pageFingerprint && fingerprints.includes(pageFingerprint)));
  for (const fingerprint of [contentFingerprint, pageFingerprint].filter(Boolean)) if (!fingerprints.includes(fingerprint)) fingerprints.push(fingerprint);
  if (repeated) stop(work, 'repeated_page', 'coverage_incomplete', '来源返回重复页，已停止翻页并保留当前样本');
  else {
    for (const lead of leadRecords) addWork({
      provider: 'public_web', routeId: `${lead.platform || work.platform || plan.platform}-public`, op: 'public_page',
      platform: lead.platform || work.platform || plan.platform,
      websiteDomain: lead.websiteDomain || work.websiteDomain || plan.websiteDomain, fromContentId: lead.fromContentId || work.fromContentId,
      url: lead.url, scopeUrl: work.scopeUrl || lead.url, page: 1, term: work.term,
    });
    for (const domain of (result.domains || []).slice(0, 3)) addWork({
      routeId: work.routeId, provider: 'semrush', op: 'shopping', domain, term: work.term, page: 1,
    });
    if (result.hasMore && isDiscovery) {
      const canPage = isPublicPage ? (work.page || 1) < plan.budget.maxPages : cp.discoveryPages < plan.budget.maxPages;
      if (canPage && cp.productIds.length < plan.maxProducts) addWork({
        ...work, page: (work.page || 1) + 1, cursor: result.nextCursor,
        ...(result.nextUrl ? { url: result.nextUrl } : {}),
      });
      else stop(work, cp.productIds.length >= plan.maxProducts ? 'quantity_limit' : 'page_limit', cp.productIds.length >= plan.maxProducts ? 'quantity_reached' : 'budget_truncated', '有限数量或分页预算已用完，未继续扩大扫描范围');
    }
  }
  if (rejected) log(`${work.provider}：${rejected}条缺少来源商品标识、标题或市场不符，未入库`);
  if (!product && !result.contents?.length && (result.empty || (Array.isArray(result.products) && result.products.length === 0 && !leads.length && !result.domains?.length && !result.hasMore))) stop(work, 'not_found', 'not_found', result.message || '来源未收录本次查询商品；不等于销量为零');
  log(`${work.provider} · ${work.op}：${result.message || `保存${pageIdentities.length}件，线索${leads.length}条；累计${cp.productIds.length}件`}`);
  return advance();
}
