/* eslint-disable unicorn/no-await-expression-member -- Document IO follows the existing monitor-store convention. */
import {
  buildTrendWork,
  currentTrendPlan,
  defaultTrendPlan,
  presentSocialSummary,
  socialWindows,
  summarizeSocial,
  trendDay,
  trendDigest,
  updateHistory,
  validateTrendPlan,
} from './keyword-trends-domain.mjs';

export const TREND_PREFIX = 'keyword-trends:';
const P = TREND_PREFIX;
const identity = (a, b) =>
  a?.id === b?.keywordId && a.term === b.term && a.market === b.market;
export function trendSnapshotName(keywordId, source, day) {
  return `${P}snapshot:v2:${trendDigest(keywordId)}:${source}:${day}`;
}
export async function enqueueTrendWork(
  db,
  words,
  plan,
  now,
  trigger,
  parentJobId,
) {
  if (db.enqueue) return db.enqueue(words, plan, now, trigger, parentJobId);
  const day = trendDay(now);
  const name = `${P}run:${day}`;
  const run = (await db.read(name)) || {
    day,
    createdAt: new Date(now).toISOString(),
    work: [],
  };
  const added = buildTrendWork(words, plan, now);
  for (const old of run.work)
    if (old.status === 'pending' && old.comparisonVersion !== 2)
      Object.assign(old, {
        status: 'skipped',
        reason: '旧版步骤不自动升级或重放，请使用历史比对方案',
      });
  const keys = new Set(run.work.map((w) => w.key));
  for (const w of added)
    if (!keys.has(w.key))
      run.work.push({
        ...w,
        trigger,
        ...(parentJobId ? { researchParents: [parentJobId] } : {}),
        maxPages: plan.maxPages,
      });
  // An explicit resubmission may continue NEW pages after a user raises the
  // budget/cap. Completed or uncertain requests are never repeated.
  if (trigger === 'manual' || trigger === 'research')
    for (const w of added) {
      const tail = run.work.findLast(
        (e) =>
          e.keywordId === w.keywordId &&
          e.source === w.source &&
          e.comparisonVersion === 2,
      );
      if (
        tail?.status === 'partial' &&
        tail.nextCursor !== undefined &&
        tail.page <
          Math.min(plan.maxPages, tail.source === 'instagram' ? 11 : 100)
      ) {
        const next = {
          ...tail,
          page: tail.page + 1,
          cursor: tail.nextCursor,
          status: 'pending',
          trigger,
          maxPages: plan.maxPages,
        };
        next.key = tail.key.replace(/:\d+$/, `:${next.page}`);
        delete next.nextCursor;
        if (!run.work.some((e) => e.key === next.key)) run.work.push(next);
      } else if (
        tail &&
        ['failed', 'skipped'].includes(tail.status) &&
        !(await db.read(`${P}request:${day}:${tail.key}`)) &&
        tail.comparisonVersion === 2
      ) {
        Object.assign(tail, {
          status: 'pending',
          reason: '',
          trigger,
          maxPages: plan.maxPages,
        });
      }
    }
  for (const work of run.work) {
    if (
      work.status !== 'pending' ||
      !added.some(
        (w) => w.keywordId === work.keywordId && w.source === work.source,
      )
    )
      continue;
    if (!parentJobId) delete work.researchParents;
    else if (work.researchParents)
      work.researchParents = [
        ...new Set([...work.researchParents, parentJobId]),
      ];
  }
  // Request budget is shared by manual and scheduled work for the entire day.
  run.maxRequests = plan.maxRequests;
  await db.write(name, run);
  return {
    accepted: added.length,
    reused: added.filter((w) => keys.has(w.key)).length,
    day,
  };
}
export async function trendAction(input, user, io) {
  const { db, now = Date.now() } = io;
  if (input.action === 'server_keyword_trends_snapshot') {
    const words = await io.keywords(input.keywordIds);
    const byId = new Map(words.map((k) => [k.id, k]));
    const summaries = (
      await (io.summaries
        ? io.summaries(input.keywordIds)
        : db.list(`${P}summary:`))
    )
      .map((r) => r.value)
      .filter((s) => identity(byId.get(s.keywordId), s))
      .map((summary) => presentSocialSummary(summary));
    const run = await db.read(`${P}run:${trendDay(now)}`);
    for (const work of run?.work || []) {
      if (
        work.source === 'google' ||
        work.status !== 'pending' ||
        !identity(byId.get(work.keywordId), work)
      )
        continue;
      const existing = summaries.find(
        (s) => s.keywordId === work.keywordId && s.source === work.source,
      );
      if (existing)
        Object.assign(existing, {
          status: 'pending',
          attemptMessage: '已排队，等待后台采集',
        });
      else
        summaries.push({
          keywordId: work.keywordId,
          term: work.term,
          market: work.market,
          source: work.source,
          comparisonVersion: 2,
          metric: 'publication_daily_rate',
          periods: [],
          status: 'pending',
          attemptMessage: '已排队，等待后台采集',
        });
    }
    const savedPlan = await db.read(`${P}plan`);
    return {
      plan: currentTrendPlan(savedPlan),
      requiresPlanReview: !!savedPlan && savedPlan.comparisonVersion !== 2,
      summaries,
      run: run
        ? {
            day: run.day,
            total: run.work.length,
            pending: run.work.filter((w) => w.status === 'pending').length,
            work: run.work.slice(-40),
            usedRequests: (await db.list(`${P}request:${run.day}:`)).length,
          }
        : null,
    };
  }
  if (user?.role !== 'admin') throw new Error('仅管理员可配置或提交趋势采集');
  if (input.action === 'server_keyword_trends_save') {
    const plan = validateTrendPlan(input.plan || {});
    await db.write(`${P}plan`, plan);
    if (!plan.enabled && !io.deferDailyPause) {
      const name = `${P}run:${trendDay(now)}`;
      const run = await db.read(name);
      if (run) {
        for (const w of run.work)
          if (w.trigger === 'daily' && w.status === 'pending')
            Object.assign(w, { status: 'skipped', reason: '每日计划已暂停' });
        await db.write(name, run);
      }
    }
    return { plan };
  }
  if (input.action !== 'server_keyword_trends_collect')
    throw new Error('未知趋势操作');
  const ids = input.keywordIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new Error('请选择1至100个不同关键词');
  if (input.budgetAcknowledged !== true)
    throw new Error('请确认本次采集的来源额度预算');
  const plan = validateTrendPlan({
    ...((await db.read(`${P}plan`)) || defaultTrendPlan),
    ...input.plan,
    enabled: false,
  });
  const all = await io.keywords();
  const words = ids.map((id) => all.find((w) => w.id === id));
  if (
    words.some(
      (w) =>
        !w || w.dataNature === 'demo' || !['MX', 'US', 'VN'].includes(w.market),
    )
  )
    throw new Error(
      '关键词已删除、无效或为演示数据，请刷新后重新选择；未提交部分名单',
    );
  return enqueueTrendWork(db, words, plan, now, 'manual');
}
export async function advanceTrendQueue(io) {
  const { db, now = Date.now() } = io;
  const day = trendDay(now);
  const runName = `${P}run:${day}`;
  const savedPlan = await db.read(`${P}plan`);
  const plan = currentTrendPlan(savedPlan);
  // Never catch up missed paid runs, nor create work from legacy research jobs.
  const time = new Date(now + 8 * 3_600_000).toISOString().slice(11, 16);
  if (
    plan?.enabled &&
    time >= plan.time &&
    !(await db.read(`${P}scheduled:${day}`))
  ) {
    const words = (await io.keywords()).filter(
      (k) =>
        k.reviewStatus === 'selected' &&
        k.dataNature !== 'demo' &&
        plan.markets.includes(k.market),
    );
    words.sort((a, b) =>
      trendDigest(`${day}:${a.id}`).localeCompare(
        trendDigest(`${day}:${b.id}`),
      ),
    );
    await enqueueTrendWork(db, words, plan, now, 'daily');
    await db.write(`${P}scheduled:${day}`, {
      at: new Date(now).toISOString(),
      selectedCount: words.length,
    });
  }
  const run = await db.read(runName);
  if (!run) return;
  const entry = run.work.find((w) => w.status === 'pending');
  if (!entry) return;
  const finish = async (status, reason) => {
    Object.assign(entry, { status, reason, at: new Date(now).toISOString() });
    if (entry.source !== 'google' && status !== 'completed') {
      const name = `${P}summary:${trendDigest(entry.keywordId)}:${entry.source}`;
      const prior = await db.read(name);
      const summary =
        prior &&
        identity(
          { id: entry.keywordId, term: entry.term, market: entry.market },
          prior,
        )
          ? prior
          : {
              keywordId: entry.keywordId,
              term: entry.term,
              market: entry.market,
              source: entry.source,
              comparisonVersion: entry.comparisonVersion,
              metric: 'publication_daily_rate',
              periods: [],
            };
      await db.write(name, { ...summary, status, attemptMessage: reason });
    }
    await db.write(runName, run);
  };
  if (entry.comparisonVersion !== 2)
    return finish('skipped', '旧版步骤不自动升级或重放，请重新提交历史回查');
  if (entry.researchParents?.length) {
    let active = false;
    for (const id of entry.researchParents)
      if (await io.researchActive(id)) {
        active = true;
        break;
      }
    if (!active) return finish('skipped', '所属关键词研究已取消或删除');
  }
  const word = (await io.keywords()).find((k) => k.id === entry.keywordId);
  if (
    !identity(word, entry) ||
    (entry.trigger === 'daily' &&
      (word.reviewStatus !== 'selected' || !plan?.enabled))
  )
    return finish('skipped', '关键词或计划已变更');
  if (entry.source === 'google') {
    // Stable request IDs and the existing Google queue preserve its global
    // cooldown, deployment locks and retry policy. No direct parallel GT calls.
    const hash = trendDigest(`${day}:${entry.key}`);
    const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20)}`;
    try {
      const result = await io.submitGoogle(word, requestId);
      entry.jobId = result.id;
      return finish(
        'submitted',
        '已进入现有Google趋势队列，结果沿用关键词趋势字段',
      );
    } catch {
      return finish('failed', 'Google趋势排队失败，请检查现有任务队列');
    }
  }
  const journalName = `${P}request:${day}:${entry.key}`;
  const journal = await db.read(journalName);
  if (journal?.status === 'completed')
    return finish('completed', '已有本日采集记录，不重复请求');
  if (journal) {
    await db.write(`${P}gate:${day}`, {
      reason: '上次请求结果未完成确认，不自动重放收费请求',
    });
    return finish('unknown', '请求结果待人工核对，本日不重放');
  }
  const gate = await db.read(`${P}gate:${day}`);
  if (gate) return finish('skipped', gate.reason);
  const dayRequests = await db.list(`${P}request:${day}:`);
  if (
    dayRequests.some(
      (r) =>
        r.value.status !== 'completed' ||
        !Number.isFinite(r.value.creditsCharged),
    )
  ) {
    await db.write(`${P}gate:${day}`, {
      reason: '本日已有结果或扣费未确认的请求（含旧版），不继续收费调用',
    });
    return finish('unknown', '本日已有未确认请求，请先核对供应商账单');
  }
  const used = dayRequests.length;
  const dayBudget = savedPlan
    ? Math.min(run.maxRequests, plan.maxRequests)
    : run.maxRequests;
  if (used >= dayBudget) return finish('skipped', '已达本日共享社媒请求预算');
  let key;
  try {
    key = await io.key();
  } catch {
    return finish('failed', 'ScrapeCreators配置不可用');
  }
  if (!key)
    return finish('failed', '请先在数据源与设置中配置ScrapeCreators Key');
  await db.write(journalName, {
    status: 'started',
    source: entry.source,
    at: new Date(now).toISOString(),
  });
  try {
    const result = await io.fetch(entry, key);
    const name = trendSnapshotName(word.id, entry.source, day);
    const previous = await db.read(name);
    const snapshot =
      previous && previous.comparisonVersion === 2 && identity(word, previous)
        ? previous
        : {
            keywordId: word.id,
            term: word.term,
            market: word.market,
            source: entry.source,
            items: [],
            comparisonVersion: 2,
            anchorAt: entry.anchorAt,
          };
    const items = new Map(snapshot.items.map((i) => [i.id, i]));
    const previousIds = new Set(items.keys());
    for (const item of result.items) {
      const old = items.get(item.id);
      items.set(
        item.id,
        old
          ? {
              ...old,
              ...Object.fromEntries(
                Object.entries(item).filter(([, v]) => v !== null && v !== ''),
              ),
            }
          : item,
      );
    }
    snapshot.items = [...items.values()];
    snapshot.at = new Date(now).toISOString();
    snapshot.coverage = result.coverage;
    snapshot.history = updateHistory(
      snapshot,
      { ...result, items: result.items.filter((i) => !previousIds.has(i.id)) },
      entry,
    );
    const oldestNeeded = socialWindows(Date.parse(snapshot.anchorAt)).at(
      -1,
    ).previousStartAt;
    const reached =
      snapshot.history.chronological &&
      Number.isFinite(snapshot.history.oldestAt) &&
      snapshot.history.oldestAt <= oldestNeeded;
    const maxPages = Math.min(
      entry.maxPages,
      entry.source === 'instagram' ? 11 : 100,
    );
    const budget = dayBudget;
    const continuing =
      result.hasMore && !reached && entry.page < maxPages && used + 1 < budget;
    if (result.hasMore && !reached && !continuing)
      snapshot.history.stopReason =
        used + 1 >= budget
          ? '已达本日请求预算，可提高预算后手动续查未请求的新分页'
          : `已达${maxPages}页上限${entry.source === 'instagram' && maxPages === 11 ? '（INS接口最多11页）' : '，可提高页数后手动续查'}`;
    const summaryName = `${P}summary:${trendDigest(word.id)}:${entry.source}`;
    const priorSummary = await db.read(summaryName);
    const summary = summarizeSocial(snapshot);
    const historyIncomplete = summary.periods.some(
      (p) => p.state === 'coverage_insufficient',
    );
    if (priorSummary?.comparisonVersion === 2 && identity(word, priorSummary))
      summary.periods = summary.periods.map((period) => {
        const old = priorSummary.periods?.find((p) => p.key === period.key);
        return !period.previousComplete && Number.isFinite(old?.change)
          ? { ...old, stale: true }
          : period;
      });
    // A completed journal is committed together with the data. If saving fails,
    // leave it started; a restart will stop instead of repeating the paid call.
    await db.commitResult(async () => {
      await db.write(name, snapshot);
      await db.write(summaryName, summary);
      await db.write(journalName, {
        status: 'completed',
        source: entry.source,
        at: snapshot.at,
        creditsCharged: result.creditsCharged,
        count: result.items.length,
      });
      if (result.creditsCharged === null)
        await db.write(`${P}gate:${day}`, {
          reason: '本次扣费未明确返回，暂停本日后续社媒调用；请核对供应商账单',
        });
      if (continuing) {
        const next = {
          ...entry,
          page: entry.page + 1,
          cursor: result.cursor,
          status: 'pending',
        };
        next.key = entry.key.replace(/:\d+$/, `:${next.page}`);
        if (!run.work.some((w) => w.key === next.key))
          run.work.splice(run.work.indexOf(entry) + 1, 0, next);
      }
      let explanation = '继续回查历史分页';
      if (reached) explanation = '已回查至一年对比起点';
      if (result.exhausted)
        explanation = '已翻至公开结果末页，可直接计算两期环比';
      if (snapshot.history.stopReason)
        explanation = snapshot.history.stopReason;
      Object.assign(entry, {
        status: !continuing && historyIncomplete ? 'partial' : 'completed',
        reason: `${snapshot.items.length}条去重样本；${explanation}`,
        at: snapshot.at,
      });
      if (result.hasMore && !reached && !continuing && !result.paginationIssue)
        entry.nextCursor = result.cursor ?? entry.page + 1;
      await db.write(runName, run);
    });
  } catch (error) {
    const reason = error.status
      ? `社媒接口HTTP ${error.status}，本日停止自动调用`
      : '社媒采集或保存结果未知，本日不自动重放';
    await db.write(`${P}gate:${day}`, { reason });
    await finish('failed', reason);
  }
}
