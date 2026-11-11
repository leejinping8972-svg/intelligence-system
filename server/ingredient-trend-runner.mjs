import {
  runQuantityComments,
  prepareQuantityComments,
  commentStateKey,
} from './ingredient-trend-quantity-comments.mjs';
import { createTrendArchive } from './ingredient-trend-store.mjs';
import {
  analysisRecords,
  commentCandidates,
  commentPage,
  DAY,
  iso,
  mentionMetrics,
  trendHash,
  trendPost,
  TREND_POST_REQUEST_GUARD,
} from './ingredient-trend-domain.mjs';
import { stableId } from './discovery-monitor-domain.mjs';
import {
  analysisBatch,
  compactAnalysis,
  compactSamples,
  loadSample,
  storeSamples,
} from './ingredient-trend-checkpoint.mjs';
import {
  beginTrendTiming,
  saveTrendCheckpoint,
} from './ingredient-trend-timing.mjs';

export const coverageKey = (market, scope, community) =>
  `ingredient-trend:coverage:${market}:${scope}:${community.toLowerCase()}`;
export const trendScope = (job) =>
  job.input.monitorId ||
  trendHash([
    job.input.plan.market,
    job.input.plan.communities.map((c) => c.toLowerCase()).toSorted(),
  ]).slice(0, 24);
const failure = (cp, message) => {
  cp.failures.push(String(message).slice(0, 600));
};

export async function runIngredientTrend(job, io) {
  const quantity = job.input.plan.collectionLimitsVersion === 2;
  const plan = job.input.plan,
    scope = trendScope(job),
    archive = createTrendArchive(io, plan.market);
  const cp = structuredClone(job.checkpoint);
  beginTrendTiming(io, cp);
  cp.logs ||= [];
  cp.failures ||= [];
  cp.calls ||= 0;
  cp.sourceRequests ||= 0;
  cp.commentRequests ||= 0;
  cp.asOf ||= io.now();
  cp.startedAt ||= cp.submittedAt || iso(io.now());
  cp.operation ||= job.input.trendOperation || 'collect';
  const save = async (status = 'running') => {
    cp.logs = cp.logs.slice(-200);
    if (status === 'running') {
      cp.nextRunAt = io.now() + 1000;
    } else {
      cp.finishedAt = iso(io.now());
    }
    if (quantity) await compactSamples(job, cp, archive);
    await compactAnalysis(job, cp, archive);
    return saveTrendCheckpoint(io, job, cp, status);
  };
  const cancelled = async () => {
    const result = await io.pool.query(
      'SELECT cancelled FROM research_jobs WHERE id=$1',
      [job.id],
    );
    return result.rows[0]?.cancelled;
  };
  const timedCollect = async (step, work) => {
    const started = performance.now();
    cp.timings.lastProviderMs = null;
    try {
      const result = await io.collect(job, step, work);
      cp.timings.lastProviderMs = result.requestLog?.durationMs ?? null;
      return result;
    } finally {
      cp.timings.lastSourceMs = performance.now() - started;
      cp.timings.sourceMs =
        (cp.timings.sourceMs || 0) + cp.timings.lastSourceMs;
    }
  };
  const request = async (work) => {
    const step = cp.activeSourceStep || `ingredient-trend:${cp.sourceRequests}`;
    cp.activeSourceStep = step;
    // Keep the work in the saved queue until its response AND archive writes commit.
    // collect() journals started/done and returns a cached response after a crash.
    await save();
    return timedCollect(step, {
      sources: ['ingredient_trend_source'],
      provider: 'scrapecreators',
      ...work,
    });
  };
  try {
    if (await cancelled()) return save('cancelled');
    if (cp.phase === 'done')
      return save(cp.failures.length > 0 ? 'partial' : 'completed');
    if (cp.operation === 'analyze') return await analyze();
    if (!cp.phase) {
      cp.phase = 'posts';
      cp.postQueue = [];
      cp.communityPages = {};
      cp.seenPosts = [];
      if (quantity) cp.communitySeen = {};
      cp.posts = 0;
      cp.newPosts = 0;
      cp.bodyMissing = 0;
      cp.coverage = [];
      for (const community of plan.communities) {
        const state =
          (await archive.read(coverageKey(plan.market, scope, community))) ||
          {};
        if (state.blocked) {
          cp.coverage.push({ ...state, community });
          failure(cp, `r/${community}有待确认的失败请求，已停止自动重采`);
          continue;
        }
        const scan = state.scan || {
          asOf: cp.asOf,
          cutoff: state.coveredThrough
            ? Date.parse(state.coveredThrough) - DAY
            : cp.asOf - 7 * DAY,
          cursor: '',
          cursorHashes: [],
          fingerprints: [],
          orderIssues: 0,
          missingDates: 0,
        };
        cp.postQueue.push({ community, state, scan });
      }
      cp.logs.push(
        '每日增量采集：首次回溯7天，后续重叠1天并按帖子ID合并；不调用分析模型',
      );
    }
    if (
      cp.phase === 'posts' &&
      cp.postQueue.length > 0 &&
      (cp.sourceRequests <
        (quantity ? TREND_POST_REQUEST_GUARD : plan.maxRequests) ||
        (quantity && cp.activeSourceStep)) &&
      (quantity || cp.seenPosts.length < plan.maxProducts)
    ) {
      const work = cp.postQueue[0],
        { community, scan } = work;
      const key = coverageKey(plan.market, scope, community);
      if (
        quantity &&
        (cp.communitySeen[community]?.length || 0) >= plan.maxPostsPerCommunity
      ) {
        const state = { ...work.state, community, scan, partial: true };
        await archive.write(key, state);
        cp.coverage.push(state);
        cp.postQueue.shift();
        failure(cp, `r/${community}达到每社区帖子上限，断点已保留`);
        return save();
      }
      let result;
      const buffered = Boolean(scan.bufferedRaw),
        capture =
          scan.bufferedCapture ||
          `${job.id}:${cp.activeSourceStep || `ingredient-trend:${cp.sourceRequests}`}`;
      try {
        result = buffered
          ? {
              raw: scan.bufferedRaw,
              requestLog: { startedAt: scan.bufferedAt },
            }
          : await request({ op: 'community', community, cursor: scan.cursor });
      } catch (error) {
        const state = {
          ...work.state,
          community,
          monitorId: job.input.monitorId || '',
          scan,
          blocked: {
            jobId: job.id,
            step: `ingredient-trend:${cp.sourceRequests}`,
            message: String(error.message).slice(0, 500),
          },
        };
        await archive.write(key, state);
        cp.coverage.push(state);
        cp.postQueue.shift();
        cp.sourceRequests++;
        cp.calls++;
        failure(
          cp,
          `r/${community}：${error.message}；已保留断点，需确认请求后再继续`,
        );
        delete cp.activeSourceStep;
        delete cp.activeAccounted;
        return save();
      }
      const raw = result.raw;
      if (!buffered && !cp.activeAccounted) {
        cp.sourceRequests++;
        cp.calls++;
        cp.credits = (cp.credits || 0) + (result.creditsCharged || 0);
        cp.activeAccounted = true;
      }
      if (!Array.isArray(raw?.posts))
        throw new Error(`r/${community}响应缺少posts数组，原始响应已保留`);
      const fingerprint = trendHash(raw.posts.map((p) => p.id));
      if (scan.fingerprints.includes(fingerprint))
        throw new Error(`r/${community}返回重复页面，未标记覆盖完成`);
      const at = result.requestLog?.startedAt || iso(cp.asOf);
      let oldest = Infinity,
        accepted = 0,
        missingBody = 0;
      const prepared = raw.posts.map((p) => trendPost(p, community));
      const unique = new Set(
        quantity ? cp.communitySeen[community] : cp.seenPosts,
      );
      for (let i = scan.pageOffset || 0; i < prepared.length; i++) {
        const p = prepared[i];
        const stamp = Date.parse(p.publishedAt);
        if (
          p.publishedAt &&
          stamp >= scan.cutoff &&
          stamp <= scan.asOf &&
          !unique.has(p.id) &&
          unique.size >=
            (quantity ? plan.maxPostsPerCommunity : plan.maxProducts)
        ) {
          Object.assign(scan, {
            bufferedRaw: raw,
            bufferedCapture: capture,
            bufferedAt: at,
            pageOffset: i,
          });
          if (quantity) cp.communitySeen[community] = [...unique];
          else cp.seenPosts = [...unique];
          work.state = { ...work.state, community, scan, partial: true };
          await archive.write(key, work.state);
          delete cp.activeSourceStep;
          delete cp.activeAccounted;
          cp.logs.push(
            `达到帖子上限，r/${community}本页剩余内容已保存，下次无需重新请求此页`,
          );
          if (quantity) {
            cp.coverage.push(work.state);
            cp.postQueue.shift();
            failure(
              cp,
              `r/${community}达到每社区帖子上限，已付费页面剩余内容留待下次`,
            );
          }
          return save();
        }
        if (!p.publishedAt) scan.missingDates++;
        else if (!p.stickied) {
          if (stamp > (scan.lastTimestamp ?? Infinity)) scan.orderIssues++;
          scan.lastTimestamp = stamp;
          oldest = Math.min(oldest, stamp);
        }
        if (!p.publishedAt || stamp < scan.cutoff || stamp > scan.asOf)
          continue;
        const stored = await archive.observe(p, capture, at);
        if (!unique.has(p.id)) {
          unique.add(p.id);
          accepted++;
          cp.posts++;
          if (stored.added) cp.newPosts++;
        }
        if (!p.text) {
          missingBody++;
          cp.bodyMissing++;
        }
      }
      if (quantity) cp.communitySeen[community] = [...unique];
      else cp.seenPosts = [...unique];
      delete scan.bufferedRaw;
      delete scan.bufferedCapture;
      delete scan.bufferedAt;
      delete scan.pageOffset;
      scan.fingerprints.push(fingerprint);
      const reached =
        oldest < scan.cutoff && !scan.orderIssues && !scan.missingDates;
      const exhausted = !raw.after;
      if (
        raw.after &&
        (typeof raw.after !== 'string' ||
          scan.cursorHashes.includes(trendHash(raw.after)))
      )
        throw new Error(`r/${community}游标重复或无效`);
      scan.cursor = raw.after || '';
      if (raw.after) scan.cursorHashes.push(trendHash(raw.after));
      const pages = (cp.communityPages[community] || 0) + 1;
      cp.communityPages[community] = pages;
      const complete =
        (reached || exhausted) && !scan.missingDates && !scan.orderIssues;
      const state = {
        ...work.state,
        community,
        monitorId: job.input.monitorId || '',
        observedAt: at,
        scan: complete ? null : scan,
        partial: !complete,
        sourceExhausted: exhausted,
        reachedBoundary: reached,
        coveredFrom: complete
          ? iso(
              Math.min(
                Date.parse(work.state.coveredFrom || iso(scan.cutoff)),
                scan.cutoff,
              ),
            )
          : work.state.coveredFrom || null,
        coveredThrough: complete
          ? iso(scan.asOf)
          : work.state.coveredThrough || null,
        missingDates: scan.missingDates,
        orderIssues: scan.orderIssues,
        lastJobId: job.id,
      };
      await archive.write(key, state);
      delete cp.activeSourceStep;
      delete cp.activeAccounted;
      cp.logs.push(
        `r/${community}第${pages}页：来源${raw.posts.length}帖，窗口接纳${accepted}帖，${missingBody}帖无文字正文；${complete ? '已到时间边界' : '仍有未覆盖内容'}`,
      );
      cp.postQueue.shift();
      if (
        complete &&
        scan.asOf < cp.asOf &&
        (quantity || pages < plan.maxPages)
      ) {
        cp.postQueue.push({
          community,
          state,
          scan: {
            asOf: cp.asOf,
            cutoff: scan.asOf - DAY,
            cursor: '',
            cursorHashes: [],
            fingerprints: [],
            orderIssues: 0,
            missingDates: 0,
          },
        });
      } else if (!complete && !exhausted && (quantity || pages < plan.maxPages))
        cp.postQueue.push({ community, state, scan });
      else {
        cp.coverage.push(state);
        if (!complete)
          failure(
            cp,
            `r/${community}未完成覆盖：页数、日期或顺序限制，断点已保留`,
          );
      }
      return save();
    }
    if (cp.phase === 'posts') {
      for (const work of cp.postQueue) {
        const state = {
          ...work.state,
          community: work.community,
          scan: work.scan,
          partial: true,
        };
        await archive.write(
          coverageKey(plan.market, scope, work.community),
          state,
        );
        cp.coverage.push(state);
      }
      if (cp.postQueue.length > 0)
        failure(
          cp,
          quantity
            ? '触发后台帖子请求保护，未完成的社区保留断点，剩余额度用于评论'
            : '来源请求或帖子上限已到，未完成的社区保留断点',
        );
      cp.postQueue = [];
      cp.phase = 'comments';
      const archivedPosts = await archive.recent('post', cp.asOf);
      const posts = archivedPosts.filter((p) =>
        plan.communities.some(
          (c) => c.toLowerCase() === p.community.toLowerCase(),
        ),
      );
      if (quantity) {
        cp.samples = await prepareQuantityComments(
          posts,
          plan,
          cp.asOf,
          scope,
          archive,
        );
        cp.sampleIndex = 0;
        return save();
      }
      cp.samples = commentCandidates(posts, plan, cp.asOf).map((post) => {
        const previous = post.commentState;
        return {
          post,
          pending: previous?.pending?.length
            ? previous.pending
            : [{ cursor: '', parentId: null }],
          visited: previous?.pending?.length ? previous.visited || [] : [],
          ids: previous?.pending?.length ? previous.ids || [] : [],
          missingCursor: previous?.pending?.length
            ? previous.missingCursor || 0
            : 0,
          reported: post.reportedComments,
          pages: 0,
          bodyMissing: 0,
        };
      });
      cp.sampleIndex = 0;
      return save();
    }
    if (quantity)
      return await runQuantityComments(job, io, cp, archive, {
        scope,
        request,
        save,
        failure,
      });
    const candidates = cp.samples || [];
    if (
      cp.phase === 'comments' &&
      candidates.some((s) => s.pending.length) &&
      cp.sourceRequests < plan.maxRequests &&
      cp.commentRequests < plan.maxCommentRequests
    ) {
      let index = cp.sampleIndex % candidates.length;
      while (candidates[index].pending.length === 0)
        index = (index + 1) % candidates.length;
      const sample = candidates[index],
        work = sample.pending[0];
      cp.activeSample = index;
      let result;
      try {
        result = await request({
          op: 'comments',
          url: sample.post.url,
          cursor: work.cursor,
        });
      } catch (error) {
        sample.blocked = {
          jobId: job.id,
          step: `ingredient-trend:${cp.sourceRequests}`,
          message: String(error.message).slice(0, 500),
        };
        await archive.savePost(sample.post, {
          commentState: {
            ...sample,
            lastVisitedAt: iso(cp.asOf),
            post: undefined,
          },
        });
        sample.pending = [];
        cp.sourceRequests++;
        cp.commentRequests++;
        cp.calls++;
        delete cp.activeSourceStep;
        failure(cp, `评论请求待确认：${sample.post.id}，已停止自动重采`);
        return save();
      }
      const page = commentPage(result.raw, sample.post),
        at = result.requestLog?.startedAt || iso(cp.asOf);
      const ids = new Set(sample.ids);
      await archive.observeMany(
        page.records,
        `${job.id}:${cp.sourceRequests}`,
        at,
      );
      for (const c of page.records) {
        ids.add(c.id);
        if (!c.text) sample.bodyMissing++;
      }
      sample.ids = [...ids];
      sample.pending.shift();
      if (work.cursor) sample.visited.push(trendHash(work.cursor));
      for (const next of page.cursors)
        if (
          !sample.visited.includes(trendHash(next.cursor)) &&
          !sample.pending.some((p) => p.cursor === next.cursor)
        )
          sample.pending.push(next);
      sample.missingCursor += page.missingCursor;
      sample.reported = page.reported;
      sample.pages++;
      sample.paginationExhausted =
        sample.pending.length === 0 && !sample.missingCursor;
      sample.countGap =
        sample.reported === null ? null : sample.reported - sample.ids.length;
      sample.countsMatch = sample.countGap === 0;
      const { post, ...persisted } = sample;
      await archive.savePost(post, {
        commentState: { ...persisted, lastVisitedAt: at, lastJobId: job.id },
      });
      cp.sourceRequests++;
      cp.commentRequests++;
      cp.calls++;
      cp.credits = (cp.credits || 0) + (result.creditsCharged || 0);
      cp.sampleIndex = index + 1;
      cp.logs.push(
        `${post.id}评论：已取${sample.ids.length}/${sample.reported ?? '来源未标示'}；${sample.pending.length}个待处理分支`,
      );
      delete cp.activeSample;
      delete cp.activeSourceStep;
      return save();
    }
    for (const sample of candidates) {
      if (
        sample.pending.length > 0 ||
        sample.missingCursor ||
        !sample.countsMatch
      )
        failure(
          cp,
          `${sample.post.id}评论部分覆盖：${sample.ids.length}/${sample.reported ?? '未知'}，待处理分支${sample.pending.length}`,
        );
    }
    cp.comments = candidates.reduce((n, s) => n + s.ids.length, 0);
    cp.logs.push(
      `采集结束：${cp.posts}帖（首次入库${cp.newPosts}），回访${candidates.length}帖、评论观测${cp.comments}条；未执行AI分析`,
    );
    // Compact final checkpoint; archive and request journal retain full evidence.
    cp.samples = candidates.map(
      ({ post, pending, visited: _visited, ids, ...s }) => ({
        ...s,
        postId: post.id,
        pendingCount: pending.length,
        unique: ids.length,
      }),
    );
    cp.phase = 'done';
    return save(cp.failures.length > 0 ? 'partial' : 'completed');
  } catch (error) {
    failure(cp, error.message);
    // A parse/archive failure still follows a real paid response. Pause this
    // source rather than starting the same request under tomorrow's job ID.
    const blocked = {
      jobId: job.id,
      step: cp.activeSourceStep || `ingredient-trend:${cp.sourceRequests}`,
      message: String(error.message).slice(0, 500),
    };
    if (
      cp.operation === 'collect' &&
      cp.phase === 'posts' &&
      cp.postQueue?.[0]
    ) {
      const work = cp.postQueue[0];
      await archive.write(coverageKey(plan.market, scope, work.community), {
        ...work.state,
        community: work.community,
        scan: work.scan,
        partial: true,
        blocked,
      });
    } else if (
      cp.operation === 'collect' &&
      cp.activeSample !== undefined &&
      cp.samples?.[cp.activeSample]
    ) {
      const summary = cp.samples[cp.activeSample];
      let loaded;
      try {
        loaded = await loadSample(summary, archive);
      } catch (stateError) {
        failure(cp, stateError.message);
      }
      if (loaded) {
        const { post, ...sample } = loaded;
        const state = { ...sample, blocked, lastVisitedAt: iso(cp.asOf) };
        if (quantity)
          await archive.write(
            commentStateKey(plan.market, scope, post.id),
            state,
          );
        await archive.savePost(post, { commentState: state });
        if (quantity) {
          const summaries = await storeSamples(
            job,
            [{ ...loaded, blocked }],
            archive,
          );
          cp.samples[cp.activeSample] = summaries[0];
        }
      } else if (quantity && summary.postId) {
        // Missing immutable state must also stop tomorrow's monitor from
        // requesting a fresh paid page. Preserve any surviving continuation.
        const key = commentStateKey(plan.market, scope, summary.postId);
        const previous = await archive.read(key);
        await archive.write(key, {
          pending: [],
          ids: [],
          ...previous,
          blocked,
        });
        summary.blocked = blocked;
      }
    }
    return save('partial');
  }

  async function analyze() {
    if (!cp.analysisRecords && !cp.analysisRecordKeys) {
      // Avoid racing the same monitor's still-running daily collection.
      if (job.input.monitorId) {
        const { rows } = await io.pool.query(
          "SELECT id,input FROM research_jobs WHERE status IN ('queued','running') AND cancelled=false AND id<>$1",
          [job.id],
        );
        const dependency = rows.find(
          (r) =>
            r.input.kind === 'discovery_monitor' &&
            r.input.monitorId === job.input.monitorId &&
            r.input.plan?.sourceMode === 'ingredient_trends' &&
            (r.input.trendOperation || 'collect') === 'collect',
        );
        if (dependency) {
          if (cp.waitingForCollectionId !== dependency.id)
            cp.logs.push('等待本监控的当日采集保存后再分析');
          cp.waitingForCollectionId = dependency.id;
          cp.nextRunAt = 0;
          return saveTrendCheckpoint(io, job, cp, 'running');
        }
      }
      delete cp.waitingForCollectionId;
      cp.sourceCoverage = [];
      for (const community of plan.communities)
        cp.sourceCoverage.push(
          (await archive.read(coverageKey(plan.market, scope, community))) || {
            community,
            partial: true,
          },
        );
      const through = cp.sourceCoverage.map((s) =>
        Date.parse(s.coveredThrough),
      );
      cp.windowAsOf = through.every((value) => Number.isFinite(value))
        ? Math.min(cp.asOf, ...through)
        : cp.asOf;
      cp.postCoverageReady =
        through.every((value) => Number.isFinite(value)) &&
        cp.asOf - cp.windowAsOf <= 2 * DAY &&
        cp.sourceCoverage.every((s) => !s.partial && !s.blocked);
      cp.comparisonReady =
        cp.postCoverageReady &&
        cp.sourceCoverage.every(
          (s) => Date.parse(s.coveredFrom) <= cp.windowAsOf - 14 * DAY,
        );
      const archivedPosts = await archive.recent('post', cp.windowAsOf);
      const posts = archivedPosts.filter((p) =>
        plan.communities.some(
          (c) => c.toLowerCase() === p.community.toLowerCase(),
        ),
      );
      const archivedComments = await archive.recent('comment', cp.windowAsOf);
      const comments = archivedComments.filter((c) =>
        plan.communities.some(
          (name) => name.toLowerCase() === c.community.toLowerCase(),
        ),
      );
      const records = analysisRecords(
        posts,
        comments,
        cp.windowAsOf,
        plan.communities,
      );
      cp.analysisRecords = quantity
        ? records
        : records.slice(-plan.analysisMaxRecords);
      cp.omittedRecords = quantity
        ? 0
        : Math.max(0, records.length - plan.analysisMaxRecords);
      cp.analysisOffset = 0;
      cp.findings = [];
      cp.commentCoverage = [];
      const commentStates = quantity
        ? await archive.readMany(
            posts.map((post) => commentStateKey(plan.market, scope, post.id)),
          )
        : null;
      for (const post of posts) {
        const state = quantity
          ? commentStates.get(commentStateKey(plan.market, scope, post.id))
          : post.commentState;
        if (!quantity && !state) continue;
        cp.commentCoverage.push({
          postId: post.id,
          reported: state?.reported ?? post.reportedComments,
          unique: state?.ids?.length || 0,
          pending:
            (state?.pending?.length || 0) + (state?.bufferedPage ? 1 : 0),
          countsMatch:
            state?.countsMatch === true || post.reportedComments === 0,
          blocked: Boolean(state?.blocked),
          disabled: quantity && plan.maxCommentsPerPost === 0,
        });
      }
      cp.window = {
        start: iso(cp.windowAsOf - 7 * DAY),
        end: iso(cp.windowAsOf),
      };
      if (cp.omittedRecords)
        failure(
          cp,
          `分析上限：${cp.omittedRecords}段资料未纳入，本次为部分分析`,
        );
      cp.logs.push(
        `周分析读取归档${cp.analysisRecords.length}段资料（当前及前一周），不重新请求社媒接口`,
      );
      return save();
    }
    const recordCount = cp.analysisRecords?.length ?? cp.analysisRecordCount;
    if (cp.findingsKey && !cp.findings) {
      cp.findings = await archive.read(cp.findingsKey);
      if (!Array.isArray(cp.findings))
        throw new Error('分析中间结果归档缺失，已停止继续请求');
    }
    if (cp.analysisOffset < recordCount) {
      const batch = [];
      let chars = 0;
      for (const record of await analysisBatch(cp, archive)) {
        const size = record.title.length + record.text.length;
        if (batch.length > 0 && chars + size > 40_000) break;
        batch.push(record);
        chars += size;
      }
      await save();
      if (!cp.findings) cp.findings = await archive.read(cp.findingsKey);
      if (!Array.isArray(cp.findings))
        throw new Error('分析中间结果归档缺失，已停止继续请求');
      const response = await timedCollect(
        `ingredient-trend-analysis:${cp.analysisOffset}`,
        { sources: ['ingredient_analysis'], records: batch, focus: plan.focus },
      );
      if (await cancelled()) return save('cancelled');
      for (const item of response.ingredients) {
        let finding = cp.findings.find((f) => f.key === item.key);
        if (!finding) {
          finding = { ...item, mentions: [] };
          cp.findings.push(finding);
        }
        const combined = [
          ...finding.mentions,
          ...item.mentions.map((m) => {
            const record = batch.find((r) => r.id === m.id);
            if (!record) throw new Error('分析引用不是当前输入资料');
            return {
              ...m,
              sourceId: record.sourceId,
              postId: record.postId,
              author: record.author,
              community: record.community,
              type: record.type,
            };
          }),
        ];
        finding.mentions = [
          ...new Map(combined.map((m) => [m.id, m])).values(),
        ];
        finding.summaries ||= [];
        if (item.summary && !finding.summaries.includes(item.summary))
          finding.summaries.push(item.summary);
        finding.summary = finding.summaries.join('；');
      }
      cp.analysisOffset += batch.length;
      cp.calls++;
      cp.modelCalls = (cp.modelCalls || 0) + 1;
      cp.logs.push(
        `已分析${cp.analysisOffset}/${recordCount}段资料；${cp.findings.length}种成分有原文引用`,
      );
      return save();
    }
    const reportId = stableId(`ingredient-trend-report:${job.id}`),
      at = iso(cp.asOf),
      findings = [];
    for (const finding of cp.findings) {
      const current = mentionMetrics(
        finding.mentions,
        cp.windowAsOf - 7 * DAY,
        cp.windowAsOf + 1,
      );
      if (!current.mentionCount) continue;
      const previous = mentionMetrics(
        finding.mentions,
        cp.windowAsOf - 14 * DAY,
        cp.windowAsOf - 7 * DAY,
      );
      const name = `discovery:ingredient:${stableId(`${plan.market}|${finding.key}`)}`,
        old = await archive.read(name);
      const mentions = [
        ...new Map(
          [...(old?.mentions || []), ...finding.mentions].map((m) => [m.id, m]),
        ).values(),
      ].slice(-300);
      const value = {
        ...old,
        ...finding,
        id: stableId(name),
        market: plan.market,
        mentions,
        firstSeenAt: old?.firstSeenAt || at,
        lastSeenAt: at,
        firstSeenInSystem: !old,
        mentionCount: new Set(mentions.map((m) => m.sourceId || m.id)).size,
        platforms: ['Reddit'],
        communities: plan.communities,
        lastJobId: job.id,
        weeklyReportId: reportId,
        window: cp.window,
        current,
        previous,
        comparisonReady: cp.comparisonReady && !cp.omittedRecords,
        observedChange:
          cp.comparisonReady && !cp.omittedRecords
            ? current.mentionCount - previous.mentionCount
            : null,
        summary: finding.summary,
        days: 7,
      };
      await archive.write(name, value);
      findings.push({ ...value, mentions: finding.mentions });
    }
    const report = {
      id: reportId,
      market: plan.market,
      monitorId: job.input.monitorId || '',
      asOf: iso(cp.windowAsOf),
      generatedAt: at,
      window: cp.window,
      communities: plan.communities,
      findings,
      recordCount,
      omittedRecords: cp.omittedRecords,
      comparisonReady: cp.comparisonReady && !cp.omittedRecords,
      postCoverageReady: cp.postCoverageReady,
      sourceCoverage: cp.sourceCoverage,
      commentCoverage: cp.commentCoverage,
      sampleBased: true,
      lastJobId: job.id,
      modelCalls: cp.modelCalls || 0,
    };
    await archive.write(
      `ingredient-trend:report:${plan.market}:${at}:${reportId}`,
      report,
    );
    cp.reportId = reportId;
    cp.ingredients = findings.length;
    cp.analysisDone = true;
    cp.logs.push(
      `周分析已保存${findings.length}种成分；首次入库不等于市场新成分，讨论变化仅代表采集样本`,
    );
    if (!cp.postCoverageReady)
      failure(cp, '社区列表覆盖不足或未完成，报告已标记采集不完整');
    delete cp.analysisRecords;
    delete cp.findings;
    delete cp.findingsKey;
    cp.phase = 'done';
    return save(cp.failures.length > 0 ? 'partial' : 'completed');
  }
}
