import { randomUUID } from 'node:crypto';
import { pool, lock, unlock, putDocument } from './database.mjs';
import { collect, saveCheckpoint } from './store.mjs';
import { readKeyword, patchCollection } from './enrichment-jobs.mjs';
import {
  classifyStore,
  inferCategory,
  isCandidateUrl,
  hostnameRoot,
} from './collector.js';
import { fetchPublicPage } from './safe-web.mjs';
import { scoreSite } from './site-scoring.mjs';
import { runCombinedDiscovery } from './combined-discovery.mjs';
import { observeDiscovery } from './discovery-newness.mjs';
const readDoc = async (key) =>
  (
    await pool.query('SELECT value FROM workspace_documents WHERE name=$1', [
      `business:${key}`,
    ])
  ).rows[0]?.value;
export async function mergeBusiness(key, patch) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const old =
      (
        await c.query(
          'SELECT value FROM workspace_documents WHERE name=$1 FOR UPDATE',
          [`business:${key}`],
        )
      ).rows[0]?.value || {};
    let value = { ...old, ...patch };
    for (const field of ['sources', 'sourceEvidence', 'keywordIds', 'siteIds'])
      if (old[field] || patch[field])
        value[field] = [
          ...new Map(
            [...(old[field] || []), ...(patch[field] || [])].map((v) => [
              JSON.stringify(v),
              v,
            ]),
          ).values(),
        ];
    if (old.firstSeenAt) value.firstSeenAt = old.firstSeenAt;
    if (old.productId) value.productId = old.productId;
    if (old.metrics && !patch.metrics) value.metrics = old.metrics;
    if (key.startsWith('sites:')) value.assessment = scoreSite(value);
    if (key.startsWith('ads:')) value = observeDiscovery(old, value, 'ad');
    if (key.startsWith('products:')) value = observeDiscovery(old, value, 'product');
    await putDocument(
      'workspace_documents',
      `business:${key}`,
      value,
      false,
      c,
    );
    await c.query('COMMIT');
    return value;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export function validateMarketJob(input) {
  if (!['ads', 'site_metrics'].includes(input.kind))
    throw new Error('不支持的研究任务');
  const ids = input.kind === 'ads' ? input.keywordIds : input.siteIds;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string' || id.length > 120) ||
    new Set(ids).size !== ids.length
  )
    throw new Error('请选择1～100个有效且不重复的对象');
  const limits = {
    maxPages: input.maxPages ?? 3,
    maxAds: input.maxAds ?? 100,
    maxSites: input.maxSites ?? 10,
    maxRequests:
      input.maxRequests ?? Math.min(1000, ids.length * (input.maxPages ?? 3)),
  };
  for (const [name, max] of [
    ['maxPages', 10],
    ['maxAds', 100],
    ['maxSites', 20],
    ['maxRequests', 1000],
  ])
    if (
      !Number.isInteger(limits[name]) ||
      limits[name] < 1 ||
      limits[name] > max
    )
      throw new Error(
        '广告页数1～10、每词广告1～100、每词站点1～20、任务请求上限1～1000',
      );
  if (input.adStatus && !['ACTIVE', 'ALL', 'INACTIVE'].includes(input.adStatus))
    throw new Error('广告状态不正确');
  if (
    input.includeSearchSites !== undefined &&
    typeof input.includeSearchSites !== 'boolean'
  )
    throw new Error('双渠道采集参数不正确');
  if (
    input.includeSearchSites &&
    (input.kind !== 'ads' || limits.maxSites > 10)
  )
    throw new Error('双渠道仅支持广告任务，每路每词站点上限1～10');
  return {
    includeSearchSites: input.includeSearchSites === true,
    kind: input.kind,
    ids,
    ...limits,
    adStatus: input.adStatus || 'ACTIVE',
    adId: typeof input.adId === 'string' ? input.adId : undefined,
  };
}
export async function submitMarketJob(input, context = {}) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.requestId))
    throw new Error('缺少提交编号');
  const v = validateMarketJob(input),
    c = await pool.connect();
  if (context.daily) v.discoveryOnly = true;
  let locked = false,
    searchLocked = false;
  try {
    locked = await lock(c, 'market-submit');
    if (!locked) throw new Error('正在提交研究，请稍后重试');
    if (v.includeSearchSites) {
      searchLocked = await lock(c, 'enrichment-submit');
      if (!searchLocked) throw new Error('正在提交站点采集，请稍后重试');
    }
    await c.query('BEGIN');
    const previous = (
      await c.query('SELECT * FROM research_jobs WHERE request_id=$1', [
        input.requestId,
      ])
    ).rows[0];
    if (previous) {
      await c.query('COMMIT');
      return previous;
    }
    const active = (
      await c.query(
        "SELECT * FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false",
      )
    ).rows;
    if (active.length >= 20) throw new Error('后台已有20个任务，请稍后提交');
    const records = [];
    for (const id of v.ids) {
      const r =
        v.kind === 'ads'
          ? await readKeyword(id, c)
          : await readDoc(`sites:${id}`);
      if (!r || (v.kind === 'ads' && r.reviewStatus !== 'selected'))
        throw new Error('仅支持已入选关键词或仍存在的站点');
      if (
        active.some(
          (j) =>
            (j.input.kind === v.kind ||
              (v.includeSearchSites && j.input.kind === 'sites')) &&
            j.input.records?.some((x) => x.id === id),
        )
      )
        throw new Error('选中对象已有后台任务，请勿重复提交');
      records.push(
        v.kind === 'ads'
          ? { id: r.id, term: r.term, market: r.market }
          : { id: r.id, domain: r.domain, market: r.market, term: r.brand },
      );
    }
    let pageId;
    if (v.adId) {
      const ad = await readDoc(`ads:${v.adId}`);
      if (!ad?.pageId || !ad.keywordIds?.some((id) => v.ids.includes(id)))
        throw new Error('未找到已关联广告主，请从广告详情发起');
      pageId = ad.pageId;
    }
    const name =
      v.kind === 'ads'
        ? 'provider:scrapecreators:v1'
        : 'provider:semrush:mcp:v1';
    if (
      !(
        await c.query('SELECT name FROM provider_configs WHERE name=$1', [name])
      ).rows.length
    )
      throw new Error(
        v.kind === 'ads'
          ? '请先在数据源与设置配置 ScrapeCreators API Key'
          : '请先配置 Semrush MCP',
      );
    const jobId = randomUUID(),
      value = {
        ...v,
        pageId,
        records,
        markets: [...new Set(records.map((r) => r.market))],
      };
    await c.query(
      'INSERT INTO research_jobs(id,request_id,input,checkpoint) VALUES($1,$2,$3,$4)',
      [
        jobId,
        input.requestId,
        value,
        { submittedAt: new Date().toISOString() },
      ],
    );
    if (v.kind === 'ads')
      for (const r of records)
        await patchCollection(
          r.id,
          'adCollection',
          {
            jobId,
            status: 'queued',
            count: 0,
            target: v.maxAds,
            submittedAt: new Date().toISOString(),
          },
          {},
          c,
        );
    if (v.includeSearchSites)
      for (const r of records)
        await patchCollection(
          r.id,
          'siteCollection',
          {
            jobId,
            status: 'queued',
            count: 0,
            target: v.maxSites * 2,
            submittedAt: new Date().toISOString(),
            message: '等待Brave搜索与广告落地站合并采集',
          },
          {},
          c,
        );
    await c.query('COMMIT');
    return (await c.query('SELECT * FROM research_jobs WHERE id=$1', [jobId]))
      .rows[0];
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    if (searchLocked) await unlock(c, 'enrichment-submit');
    if (locked) await unlock(c, 'market-submit');
    c.release();
  }
}
export async function verifyAdSite(url, r, ad, fetchPage = fetchPublicPage) {
  if (!isCandidateUrl(url)) throw new Error('落地页属于平台或非独立站地址');
  const { html, url: final } = await fetchPage(url);
  if (!isCandidateUrl(final)) throw new Error('落地页重定向至非独立站');
  const classified = classifyStore(html, final);
  if (!classified.isIndependentStore)
    throw new Error('官网未通过电商验证，保留广告线索但不入独立站库');
  const domain = hostnameRoot(new URL(final).hostname);
  const plain = (v) =>
    String(v || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 300);
  const names = classified.products.map((p) => plain(p.name)).filter(Boolean);
  const brand =
    plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).split(
      /[|–—]/,
    )[0] ||
    ad.brand ||
    domain;
  const site = {
    id: `${r.market}-${domain}`,
    brand,
    domain,
    market: r.market,
    keyword: r.term,
    platform: classified.platform,
    type: '独立电商',
    category: inferCategory(r.term, ...names),
    mainProducts: names,
    ownershipBackground: '待从官网核验',
    ownershipOperations: '待核验',
    ownershipEvidence: '',
    ownershipSource: final,
    collectorMode: 'automatic',
    confidence: classified.confidence,
    signals: classified.signals,
    evidenceUrl: final,
    lastCollectedAt: new Date().toISOString(),
    dataNature: 'collected',
    sources: ['Meta 广告库 / ScrapeCreators'],
    keywordIds: [r.id],
    sourceEvidence: [
      {
        source: 'Meta 广告库 / ScrapeCreators',
        url: ad.evidenceUrl,
        landingUrl: final,
        keyword: r.term,
        adId: ad.archiveId,
        collectedAt: ad.lastCollectedAt,
      },
    ],
  };
  site.assessment = scoreSite(site);
  return site;
}
export async function runMarketJob(job, overrides = {}) {
  const io = {
    collect,
    saveCheckpoint,
    readDoc,
    mergeBusiness,
    verifyAdSite,
    patchCollection,
    readKeyword,
    isCancelled: async () =>
      Boolean(
        (
          await pool.query('SELECT cancelled FROM research_jobs WHERE id=$1', [
            job.id,
          ])
        ).rows[0]?.cancelled,
      ),
    ...overrides,
  };
  if (job.input.includeSearchSites)
    return runCombinedDiscovery(job, io, runMarketJob);
  const cp = {
    index: 0,
    page: 0,
    requests: 0,
    ads: 0,
    sites: 0,
    failures: 0,
    logs: [],
    ...job.checkpoint,
  };
  cp.startedAt ||= new Date().toISOString();
  const v = job.input;
  const persistCheckpoint = io.saveCheckpoint;
  io.saveCheckpoint = async (savedJob, checkpoint, status) => {
    if (v.kind === 'ads' && ['partial', 'cancelled'].includes(status)) {
      for (const record of v.records) {
        const current = await io.readKeyword(record.id);
        if (
          current?.adCollection?.jobId === job.id &&
          ['queued', 'running'].includes(current.adCollection.status)
        ) {
          await io.patchCollection(record.id, 'adCollection', {
            ...current.adCollection,
            status,
            message:
              status === 'cancelled'
                ? '任务已取消，已采集结果保留'
                : checkpoint.logs.at(-1) || '任务部分完成，请查看任务日志',
            finishedAt: new Date().toISOString(),
          });
        }
      }
    }
    return persistCheckpoint(savedJob, checkpoint, status);
  };
  try {
    for (; cp.index < v.records.length; cp.index++) {
      if (await io.isCancelled())
        return io.saveCheckpoint(job, cp, 'cancelled');
      const r = v.records[cp.index];
      cp.currentTerm = r.term;
      if (v.kind === 'site_metrics') {
        const site = await io.readDoc(`sites:${r.id}`);
        if (!site) {
          cp.failures++;
          continue;
        }
        try {
          const data = await io.collect(job, `domain:${cp.index}`, {
            sources: ['site_metrics'],
            domain: r.domain,
            market: r.market,
          });
          await io.mergeBusiness(`sites:${r.id}`, {
            metrics: data.metrics || undefined,
            metricsStatus: data.metrics ? '已补齐' : '未收录',
            metricsMessage: data.message,
          });
          cp.semrushUnits = (cp.semrushUnits || 0) + (data.apiUnits || 0);
          cp.logs.push(`${r.domain}：${data.message}`);
          if (!data.metrics) cp.failures++;
        } catch (e) {
          cp.failures++;
          cp.logs.push(`${r.domain}：${e.message}`);
          await io.mergeBusiness(`sites:${r.id}`, {
            metricsStatus: '采集失败',
            metricsMessage: e.message,
          });
          if (/401|403|429|额度|过期/.test(e.message)) throw e;
        }
      } else {
        let seenAds = new Set(cp.recordAdIds || []);
        let count = cp.recordAds || 0,
          siteIds = new Set(cp.recordSiteIds || []);
        const current = await io.readKeyword(r.id);
        if (!current || current.reviewStatus !== 'selected') {
          cp.logs.push(`${r.term}：已移出入选列表，跳过`);
          cp.failures++;
          continue;
        }
        await io.patchCollection(r.id, 'adCollection', {
          jobId: job.id,
          status: 'running',
          count,
          target: v.maxAds,
          startedAt: cp.startedAt,
        });
        for (; cp.page < v.maxPages && count < v.maxAds; cp.page++) {
          if (cp.requests >= v.maxRequests) {
            cp.logs.push('已达广告请求上限，剩余对象未采集');
            cp.failures++;
            return io.saveCheckpoint(
              job,
              { ...cp, finishedAt: new Date().toISOString() },
              'partial',
            );
          }
          if (await io.isCancelled())
            return io.saveCheckpoint(job, cp, 'cancelled');
          const data = await io.collect(job, `ads:${cp.index}:${cp.page}`, {
            sources: ['ads'],
            record: r,
            cursor: cp.cursor,
            adStatus: v.adStatus,
            pageId: v.pageId,
          });
          const ads = data.ads
            .filter((ad) => !seenAds.has(ad.id))
            .slice(0, v.maxAds - count);
          for (const ad of ads) {
            if (await io.isCancelled())
              return io.saveCheckpoint(job, cp, 'cancelled');
            const old = await io.readDoc(`ads:${ad.id}`);
            ad.siteIds = old?.siteIds || [];
            ad.verification = v.discoveryOnly ? old?.verification || [] : [];
            for (const url of v.discoveryOnly ? [] : ad.landingUrls) {
              if (siteIds.size >= v.maxSites) break;
              try {
                const domain = hostnameRoot(new URL(url).hostname),
                  existing = await io.readDoc(`sites:${r.market}-${domain}`);
                const site =
                  existing?.confidence >= 50
                    ? {
                        ...existing,
                        sources: ['Meta 广告库 / ScrapeCreators'],
                        sourceEvidence: [
                          {
                            source: 'Meta 广告库 / ScrapeCreators',
                            url: ad.evidenceUrl,
                            landingUrl: url,
                            adId: ad.archiveId,
                            keyword: r.term,
                          },
                        ],
                        keywordIds: [r.id],
                      }
                    : await io.verifyAdSite(url, r, ad);
                await io.mergeBusiness(`sites:${site.id}`, site);
                siteIds.add(site.id);
                ad.siteIds.push(site.id);
                ad.verification.push({
                  url,
                  status: 'verified',
                  siteId: site.id,
                });
                if (!existing?.metrics && !cp.metricBlocked) {
                  try {
                    const metric = await io.collect(
                      job,
                      `ad-domain:${site.id}`,
                      {
                        sources: ['site_metrics'],
                        domain: site.domain,
                        market: site.market,
                      },
                    );
                    await io.mergeBusiness(`sites:${site.id}`, {
                      metrics: metric.metrics || undefined,
                      metricsStatus: metric.metrics ? '已补齐' : '未收录',
                      metricsMessage: metric.message,
                    });
                  } catch (e) {
                    if (/401|403|429|额度|过期/.test(e.message))
                      cp.metricBlocked = true;
                    await io.mergeBusiness(`sites:${site.id}`, {
                      metricsStatus: '待补充',
                      metricsMessage: e.message,
                    });
                  }
                }
              } catch (e) {
                ad.verification.push({
                  url,
                  status: 'unverified',
                  reason: e.message,
                });
              }
            }
            ad.siteIds = [...new Set(ad.siteIds)];
            await io.mergeBusiness(`ads:${ad.id}`, ad);
          }
          for (const ad of ads) seenAds.add(ad.id);
          cp.recordAdIds = [...seenAds];
          count += ads.length;
          cp.ads += ads.length;
          cp.requests++;
          cp.creditsCharged =
            (cp.creditsCharged || 0) + (data.creditsCharged ?? 0);
          if (data.creditsCharged === null)
            cp.unknownCharges = (cp.unknownCharges || 0) + 1;
          cp.recordAds = count;
          cp.recordSiteIds = [...siteIds];
          cp.cursor = data.cursor;
          cp.logs.push(
            `${r.term}：第${cp.page + 1}页，本词累计${count}条广告，${siteIds.size}家官网；已请求${cp.requests}/${v.maxRequests}次`,
          );
          await io.patchCollection(
            r.id,
            'adCollection',
            {
              jobId: job.id,
              status: 'running',
              count,
              target: v.maxAds,
              message: cp.logs.at(-1),
            },
            { siteIds: [...siteIds] },
          );
          await io.saveCheckpoint(job, { ...cp, page: cp.page + 1 });
          if (!data.cursor) break;
        }
        cp.sites += siteIds.size;
        await io.patchCollection(
          r.id,
          'adCollection',
          {
            jobId: job.id,
            status: 'completed',
            count,
            target: v.maxAds,
            message: `查询已结束：${count}条广告、${siteIds.size}家已验证官网；数量为目标上限，非保证返回量`,
            finishedAt: new Date().toISOString(),
          },
          { siteIds: [...siteIds] },
        );
        cp.recordAdIds = [];
        cp.recordAds = 0;
        cp.recordSiteIds = [];
        cp.page = 0;
        cp.cursor = '';
      }
      await io.saveCheckpoint(job, { ...cp, index: cp.index + 1 });
    }
    await io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date().toISOString() },
      cp.failures ? 'partial' : 'completed',
    );
  } catch (e) {
    cp.failures++;
    cp.logs.push(e.message);
    await io.saveCheckpoint(
      job,
      { ...cp, finishedAt: new Date().toISOString() },
      (await io.isCancelled()) ? 'cancelled' : 'partial',
    );
  }
}
