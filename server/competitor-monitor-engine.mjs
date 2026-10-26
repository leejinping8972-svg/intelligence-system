import {
  digest,
  extractLaunchTerms,
  rankHotwords,
} from './competitor-monitor-domain.mjs';

export async function executeMonitor(target, io) {
  const previous = io.publicOnly ? io.previousRun : null;
  const run = {
    day: io.day,
    status: 'running',
    startedAt: previous?.startedAt || io.at,
    requests: previous?.requests || 0,
    added: previous?.added || 0,
    keywords: previous?.keywords || 0,
    errors: previous?.channels?.filter((c) => c.kind !== 'products' && c.status === 'failed').flatMap((c) => c.errors || ['广告上次失败，本轮仅恢复官网']) || [],
    channels: previous?.channels?.filter((c) => c.kind !== 'products') || [],
    publicRecoveryAttempts: (previous?.publicRecoveryAttempts || 0) + (io.publicOnly ? 1 : 0),
    resumedAt: io.publicOnly ? io.at : undefined,
  };
  await io.saveRun(run);
  const request = async (key, call) => {
    if (run.requests >= target.maxRequests)
      throw new Error('已达到本日请求预算');
    run.requests++;
    await io.saveRun(run);
    return io.request(key, call);
  };
  for (const kind of ['products', 'ads']) {
    if (io.publicOnly && kind !== 'products') continue;
    if (kind === 'products' ? !target.siteId : !target.pageId) continue;
    const baseline = await io.baseline(kind);
    try {
      const remaining = target.maxRequests - run.requests;
      const channelLimit =
        kind === 'products' && target.pageId && !io.publicOnly
          ? Math.max(1, Math.floor(remaining / 2))
          : remaining;
      const result = await io.scan(kind, request, channelLimit);
      let added = 0,
        keywords = 0;
      for (const item of result.items) {
        const seen = await io.seen(kind, item.id);
        // A baseline is established only after a complete scan. Partial first scans
        // remain baseline observations, never a burst of alleged new launches.
        const launch = Boolean(baseline && !seen);
        const terms = launch ? extractLaunchTerms(item) : [];
        await io.persist(
          kind,
          item,
          launch
            ? {
                id: digest(`${target.id}:${kind}:${item.id}`),
                targetId: target.id,
                kind,
                itemId: item.id,
                title: item.title || item.headline || item.brand,
                url: item.evidenceUrl,
                market: target.market,
                detectedAt: io.at,
                label: '竞品上新',
                terms,
              }
            : null,
        );
        if (launch) {
          added++;
          keywords += terms.length;
        }
      }
      await io.saveProgress?.(kind, result.complete ? null : result.progress);
      if (result.complete && !baseline) await io.setBaseline(kind);
      run.added += added;
      run.keywords += keywords;
      let status = result.complete ? 'completed' : 'partial';
      if (result.items.length === 0 && result.errors.length > 0)
        status = 'failed';
      run.channels.push({
        kind,
        status,
        baseline: !baseline,
        observed: result.items.length,
        added,
        errors: result.errors,
      });
      if (kind === 'products') {
        run.nextRunAt = result.retryAt || 0;
        run.manualRequired = result.manualRequired === true;
        run.browserPages = result.browserPages || 0;
        run.publicPending = (result.progress?.queue?.length || 0) > 0;
      }
      run.errors.push(...result.errors);
    } catch (error) {
      run.channels.push({ kind, status: 'failed' });
      run.errors.push(error.message);
    }
  }
  run.status = run.channels.some((c) => c.status !== 'failed')
    ? 'partial'
    : 'failed';
  if (run.channels.every((c) => c.status === 'completed'))
    run.status = 'completed';
  if (run.manualRequired) run.status = 'blocked';
  else if (run.nextRunAt > (io.now?.() || Date.now()) && run.requests < target.maxRequests && run.publicRecoveryAttempts < 3) run.status = 'retry_wait';
  run.finishedAt = new Date().toISOString();
  await io.saveRun(run);
  return run;
}

export async function executeHotwords(config, io) {
  const run = {
    day: io.day,
    status: 'running',
    startedAt: io.at,
    requests: 0,
    reservedUnits: 0,
    confirmedUnits: 0,
    unknownCharges: 0,
    errors: [],
  };
  await io.saveRun(run);
  const rows = [];
  for (const seed of config.seeds) {
    const requestsBefore = run.requests;
    try {
      const result = await io.fetchSeed(seed, async (key, call) => {
        if (run.requests >= config.maxRequests)
          throw new Error('已达到Semrush每日请求次数上限');
        run.requests++;
        run.reservedUnits += 2000;
        await io.saveRun(run);
        return io.request(key, call);
      });
      if (result.apiUnits === null) run.unknownCharges++;
      else run.confirmedUnits += result.apiUnits;
      rows.push(...result.rows);
    } catch (error) {
      if (run.requests > requestsBefore) run.unknownCharges++;
      run.errors.push(error.message);
      // Stop on any failure or unknown billing, avoiding a cascade of paid calls.
      break;
    }
    if (run.unknownCharges) {
      run.errors.push('上游未返回用量，已停止后续付费请求');
      break;
    }
  }
  const previous = await io.previous();
  const ranking = rankHotwords(rows, previous?.rows);
  if (ranking.length > 0)
    await io.saveRanking({
      market: config.market,
      day: io.day,
      collectedAt: io.at,
      seeds: config.seeds,
      scope: '保健品种子词汇总 · 按月搜索量排序',
      report: 'phrase_fullsearch',
      complete: run.errors.length === 0,
      rows: ranking,
    });
  run.status = ranking.length > 0 ? 'completed' : 'empty';
  if (run.errors.length > 0)
    run.status = ranking.length > 0 ? 'partial' : 'failed';
  run.count = ranking.length;
  run.finishedAt = new Date().toISOString();
  await io.saveRun(run);
  return run;
}
