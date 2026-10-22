import { hostnameRoot, inferCategory, isCandidateUrl } from './collector.js';

export const SEMRUSH_ADVERTISER_ROW_UNITS = 20;
export function validateSemrushSites(input) {
  if (
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId || '')
  )
    throw new Error('缺少有效提交编号');
  const seeds = [
    ...new Map(
      String(input.terms || '')
        .split(/\r?\n/)
        .map((s) => s.normalize('NFKC').replaceAll(/\s+/g, ' ').trim())
        .filter(Boolean)
        .map((s) => [s.toLowerCase(), s]),
    ).values(),
  ];
  if (!seeds.length || seeds.length > 100 || seeds.some((s) => s.length > 200))
    throw new Error('请输入1～100个关键词，每词不超过200字符');
  if (!['US', 'MX', 'VN'].includes(input.market))
    throw new Error('请选择支持的目标市场');
  const value = {
    kind: 'semrush_sites',
    seeds,
    market: input.market,
    markets: [input.market],
    perPage: input.perPage ?? 20,
    maxPages: input.maxPages ?? 3,
    maxSites: input.maxSites ?? 200,
    semrushUnitLimit: input.semrushUnitLimit ?? 2000,
  };
  for (const [key, min, max] of [
    ['perPage', 1, 100],
    ['maxPages', 1, 10],
    ['maxSites', 1, 1000],
    ['semrushUnitLimit', 20, 100000],
  ])
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max)
      throw new Error(
        '每页1～100条、每词1～10页、站点1～1000家、积分上限20～100000',
      );
  return value;
}
export function advertiserSites(rows, term, market, at) {
  const sites = new Map();
  for (const row of rows) {
    const raw = String(row.domain || row.Domain || row.Dn || '')
      .trim()
      .toLowerCase();
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(raw))
      continue;
    const domain = hostnameRoot(raw),
      root = `https://${domain}/`;
    if (!isCandidateUrl(root)) continue;
    let landingUrl = '';
    try {
      const url = new URL(row.url || row.Url || row.Ur || root);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        hostnameRoot(url.hostname) === domain
      )
        landingUrl = url.href;
    } catch {}
    const evidence = {
      source: 'Semrush phrase_adwords',
      keyword: term,
      url: root,
      landingUrl: landingUrl || root,
      collectedAt: at,
    };
    const previous = sites.get(domain);
    if (previous) {
      previous.sourceEvidence.push(evidence);
      continue;
    }
    sites.set(domain, {
      id: `${market}-${domain}`,
      brand: domain,
      domain,
      market,
      keyword: term,
      platform: '待识别',
      type: '付费搜索广告主 · 电商待核验',
      category: inferCategory(term),
      mainProducts: [],
      ownershipBackground: '待从官网核验',
      ownershipOperations: '',
      ownershipEvidence: '',
      ownershipSource: '',
      keywordIds: [],
      sources: ['Semrush phrase_adwords'],
      sourceEvidence: [evidence],
      lastCollectedAt: at,
      evidenceUrl: root,
      signals: ['Semrush付费搜索广告记录；实际成交与电商类型待核验'],
      dataNature: 'collected',
    });
  }
  return [...sites.values()];
}

// Every charged page uses a stable journal step. Unknown requests keep their reservation.
export async function runSemrushSites(job, io) {
  const v = job.input;
  const cp = {
    index: 0,
    page: 0,
    requests: 0,
    semrushUnits: 0,
    semrushReserved: 0,
    unknownCharges: 0,
    siteIds: [],
    logs: [],
    ...job.checkpoint,
  };
  const save = (status) =>
    io.saveCheckpoint(
      job,
      structuredClone({ ...cp, sites: cp.siteIds.length }),
      status,
    );
  try {
    if (cp.unknownCharges) return save('partial');
    while (cp.index < v.seeds.length) {
      const term = v.seeds[cp.index];
      while (cp.page < v.maxPages) {
        if (await io.isCancelled()) return save('cancelled');
        if (cp.siteIds.length >= v.maxSites && !cp.inFlight) {
          cp.logs.push('达到站点数量上限，已有结果保留');
          return save('partial');
        }
        const remaining = Math.floor(
          (v.semrushUnitLimit - cp.semrushReserved) /
            SEMRUSH_ADVERTISER_ROW_UNITS,
        );
        const limit = cp.inFlight?.limit ?? Math.min(v.perPage, remaining);
        if (limit < 1) {
          cp.logs.push('达到Semrush积分上限，已有结果保留');
          return save('partial');
        }
        const offset = cp.inFlight?.offset ?? cp.page * v.perPage;
        cp.currentTerm = `${term} · 第${cp.page + 1}页`;
        if (!cp.inFlight) {
          cp.semrushReserved += limit * SEMRUSH_ADVERTISER_ROW_UNITS;
          cp.requests++;
          cp.inFlight = { limit, offset };
          await save();
        }
        const result = await io.collect(
          job,
          `sem-sites:${cp.index}:${cp.page}`,
          {
            sources: ['semrush_sites'],
            term,
            market: v.market,
            limit,
            offset,
          },
        );
        if (await io.isCancelled()) {
          cp.logs.push('任务已取消，已返回页面仍保存，停止后续请求');
        }
        const ids = [];
        for (const site of advertiserSites(
          result.rows,
          term,
          v.market,
          result.collectedAt,
        )) {
          if (
            !cp.siteIds.includes(site.id) &&
            cp.siteIds.length >= v.maxSites
          ) {
            cp.siteLimitReached = true;
            break;
          }
          await io.saveSite(site, term, v.market);
          ids.push(site.id);
          if (!cp.siteIds.includes(site.id)) cp.siteIds.push(site.id);
        }
        await io.linkKeywords(term, v.market, ids);
        const units = result.apiUnits;
        if (Number.isSafeInteger(units) && units >= 0) {
          cp.semrushUnits += units;
          cp.semrushReserved += units - limit * SEMRUSH_ADVERTISER_ROW_UNITS;
        } else cp.unknownCharges++;
        delete cp.inFlight;
        cp.logs.push(
          `${cp.currentTerm}：返回${result.rows.length}条，识别${ids.length}家，本次去重${cp.siteIds.length}家`,
        );
        // Persist advancement with processed results before any further charged request.
        cp.page++;
        if (result.rows.length < limit) cp.page = v.maxPages;
        await save();
        if (await io.isCancelled()) return save('cancelled');
        if (cp.siteLimitReached) {
          cp.logs.push('达到站点数量上限，已有结果保留');
          return save('partial');
        }
        if (cp.unknownCharges) {
          cp.logs.push('扣费数据缺失，保留已预留积分并停止后续付费请求');
          return save('partial');
        }
      }
      cp.index++;
      cp.page = 0;
      await save();
    }
    cp.finishedAt = new Date().toISOString();
    return save('completed');
  } catch (error) {
    cp.logs.push(String(error.message).slice(0, 600));
    cp.unknownCharges += cp.inFlight ? 1 : 0;
    return save((await io.isCancelled()) ? 'cancelled' : 'partial');
  }
}
