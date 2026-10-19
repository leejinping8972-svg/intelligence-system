import { hostnameRoot } from './collector.js';

// Keep each channel's checkpoint separate. Existing request journal step names
// stay stable, including after a restart between the two channels.
export async function runCombinedDiscovery(job, io, runAds) {
  const v = job.input;
  const cp = {
    search: { index: 0, failures: 0, logs: [] },
    advertising: {},
    siteIdsByKeyword: {},
    ...job.checkpoint,
  };
  cp.startedAt ||= new Date().toISOString();
  const link = (id, ids = []) => {
    cp.siteIdsByKeyword[id] = [
      ...new Set([...(cp.siteIdsByKeyword[id] || []), ...ids]),
    ];
  };
  const persist = async (status) => {
    const ad = cp.advertising;
    cp.index =
      status === 'completed' || status === 'partial'
        ? v.records.length
        : Math.min(cp.search.index, ad.index || 0);
    cp.ads = ad.ads || 0;
    cp.requests = ad.requests || 0;
    cp.creditsCharged = ad.creditsCharged;
    cp.unknownCharges = ad.unknownCharges;
    cp.sites = new Set(Object.values(cp.siteIdsByKeyword).flat()).size;
    cp.logs = [...cp.search.logs, ...(ad.logs || [])];
    cp.channels = [
      {
        source: 'Brave Search',
        status: cp.search.status || 'running',
        done: cp.search.index,
        total: v.records.length,
      },
      {
        source: 'ScrapeCreators',
        status: cp.adStatus || 'queued',
        done: ad.index || 0,
        total: v.records.length,
      },
    ];
    if (status) cp.finishedAt = new Date().toISOString();
    await io.saveCheckpoint(job, structuredClone(cp), status);
  };
  const finish = async (status) => {
    if (status === 'cancelled') {
      if (!cp.search.status) cp.search.status = 'cancelled';
      if (!['completed', 'partial'].includes(cp.adStatus))
        cp.adStatus = 'cancelled';
    }
    for (const r of v.records) {
      const current = await io.readKeyword(r.id);
      const ids = cp.siteIdsByKeyword[r.id] || [];
      const recordStatus =
        current?.reviewStatus === 'selected' ? status : 'cancelled';
      let siteStatus = ids.length > 0 ? 'completed' : 'empty';
      if (['cancelled', 'partial'].includes(recordStatus))
        siteStatus = recordStatus;
      // Do not replace a newer job's state or resurrect a removed selection.
      if (current?.siteCollection?.jobId === job.id) {
        await io.patchCollection(
          r.id,
          'siteCollection',
          {
            ...current.siteCollection,
            status: siteStatus,
            count: ids.length,
            target: v.maxSites * 2,
            finishedAt: new Date().toISOString(),
            message: `${status === 'cancelled' ? '已取消，已有结果保留' : '两路采集已结束'}：本次合并去重 ${ids.length} 家站点；来源与失败原因见后台任务。每路最多 ${v.maxSites} 家，不保证返回数量。`,
          },
          { siteIds: ids },
        );
      }
      if (
        current?.adCollection?.jobId === job.id &&
        (recordStatus === 'cancelled' ||
          ['queued', 'running'].includes(current.adCollection.status))
      ) {
        await io.patchCollection(r.id, 'adCollection', {
          ...current.adCollection,
          status: recordStatus === 'cancelled' ? 'cancelled' : 'partial',
          finishedAt: new Date().toISOString(),
          message:
            recordStatus === 'cancelled'
              ? '任务已取消，已有结果保留'
              : '广告未全部完成，已有结果保留，请查看渠道日志',
        });
      }
    }
    await persist(status);
  };
  try {
    // Search first: verified sites can be reused when the ad landing page points
    // to the same domain. A failed channel never prevents the other from running.
    for (; cp.search.index < v.records.length; cp.search.index++) {
      if (await io.isCancelled()) return finish('cancelled');
      const r = v.records[cp.search.index];
      cp.currentTerm = `Brave Search · ${r.term}`;
      const current = await io.readKeyword(r.id);
      if (!current || current.reviewStatus !== 'selected') {
        cp.search.logs.push(`${r.term}：已移出入选列表，跳过搜索`);
        continue;
      }
      await io.patchCollection(r.id, 'siteCollection', {
        jobId: job.id,
        status: 'running',
        target: v.maxSites * 2,
        count: (cp.siteIdsByKeyword[r.id] || []).length,
        startedAt: cp.startedAt,
        message: 'Brave 搜索与官网核验中，随后处理广告落地站',
      });
      await persist();
      try {
        const result = await io.collect(job, `sites:${cp.search.index}`, {
          keywords: [r.term],
          markets: [r.market],
          sources: ['site_discovery'],
          maxSites: v.maxSites,
          productsPerSite: 1,
          sorftimeRequestLimit: 0,
        });
        const group = result.groups?.find(
          (g) => g.market === r.market && g.keyword === r.term,
        );
        if (!group || !Array.isArray(group.sites))
          throw new Error('采集服务未返回对应关键词的站点结果');
        const cancelledAfterFetch = await io.isCancelled();
        for (const raw of group.sites.slice(0, v.maxSites)) {
          const { products: _products, ...data } = raw;
          if (raw.market !== r.market)
            throw new Error('站点市场与所选关键词不一致');
          const domain = hostnameRoot(new URL(raw.evidenceUrl).hostname);
          const id = `${r.market}-${domain}`;
          const existing = await io.readDoc(`sites:${id}`);
          await io.mergeBusiness(`sites:${id}`, {
            ...data,
            id,
            domain,
            keywordIds: [r.id],
            sources: ['Brave Search'],
            sourceEvidence: [
              {
                source: 'Brave Search',
                keyword: r.term,
                url: raw.evidenceUrl,
                collectedAt: raw.lastCollectedAt,
              },
            ],
            dataNature: 'collected',
          });
          link(r.id, [id]);
          if (!existing?.metrics && !cp.metricBlocked && !cancelledAfterFetch) {
            try {
              const metric = await io.collect(job, `ad-domain:${id}`, {
                sources: ['site_metrics'],
                domain,
                market: r.market,
              });
              await io.mergeBusiness(`sites:${id}`, {
                metrics: metric.metrics || undefined,
                metricsStatus: metric.metrics ? '已补齐' : '未收录',
                metricsMessage: metric.message,
              });
            } catch (error) {
              if (/401|403|429|额度|过期/.test(error.message))
                cp.metricBlocked = true;
              await io.mergeBusiness(`sites:${id}`, {
                metricsStatus: '待补充',
                metricsMessage: error.message,
              });
            }
          }
        }
        await io.patchCollection(
          r.id,
          'siteCollection',
          {
            jobId: job.id,
            status: 'running',
            target: v.maxSites * 2,
            count: (cp.siteIdsByKeyword[r.id] || []).length,
            startedAt: cp.startedAt,
            message: 'Brave 搜索已结束，等待广告渠道合并核验',
          },
          { siteIds: cp.siteIdsByKeyword[r.id] || [] },
        );
        cp.search.logs.push(
          `${r.term}：Brave 搜索返回 ${group.coverage?.searchResults ?? '未知'} 条，本次已验证 ${group.sites.length} 家；等待广告来源合并`,
        );
        if (cancelledAfterFetch) return finish('cancelled');
      } catch (error) {
        cp.search.failures++;
        cp.search.logs.push(
          `${r.term}：Brave Search 失败：${error.message}；广告渠道继续`,
        );
      }
      await persist();
    }
    cp.search.status = cp.search.failures ? 'partial' : 'completed';
    await persist();
    if (await io.isCancelled()) return finish('cancelled');
    if (!cp.adStatus || !['completed', 'partial'].includes(cp.adStatus)) {
      cp.adStatus = 'running';
      await runAds(
        {
          ...job,
          input: { ...v, includeSearchSites: false },
          checkpoint: {
            ...cp.advertising,
            metricBlocked: cp.metricBlocked || cp.advertising.metricBlocked,
          },
        },
        {
          ...io,
          mergeBusiness: async (key, value) => {
            await io.mergeBusiness(key, value);
            if (key.startsWith('sites:')) {
              for (const id of value.keywordIds || []) link(id, [value.id]);
            }
          },
          patchCollection: async (id, field, patch, extra) => {
            if (field === 'adCollection') link(id, extra?.siteIds);
            await io.patchCollection(id, field, patch, extra);
          },
          saveCheckpoint: async (_job, checkpoint, status) => {
            cp.advertising = structuredClone(checkpoint);
            cp.currentTerm = `ScrapeCreators · ${checkpoint.currentTerm || ''}`;
            if (status) cp.adStatus = status;
            await persist();
          },
        },
      );
    }
    if (cp.adStatus === 'cancelled' || (await io.isCancelled()))
      return finish('cancelled');
    return finish(
      cp.search.failures || cp.adStatus !== 'completed'
        ? 'partial'
        : 'completed',
    );
  } catch (error) {
    cp.search.logs.push(`双渠道任务异常：${error.message}`);
    return finish((await io.isCancelled()) ? 'cancelled' : 'partial');
  }
}
