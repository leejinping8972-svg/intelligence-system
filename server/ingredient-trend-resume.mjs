import { sampleSummary } from './ingredient-trend-checkpoint.mjs';
import { TREND_SOURCE, trendHash } from './ingredient-trend-domain.mjs';
import { commentStateKey } from './ingredient-trend-quantity-comments.mjs';

export const isIngredientTrendCollection = (job) =>
  job.input?.kind === 'discovery_monitor' &&
  job.input.plan?.sourceMode === TREND_SOURCE &&
  job.input.plan.collectionLimitsVersion === 2 &&
  (job.checkpoint?.operation || job.input.trendOperation || 'collect') ===
    'collect';

const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const signature = (summary) =>
  JSON.stringify(
    canonical({
      ...summary,
      stateKey: undefined,
      post: undefined,
    }),
  );
const scopeOf = (job) =>
  job.input.monitorId ||
  trendHash([
    job.input.plan.market,
    job.input.plan.communities.map((c) => c.toLowerCase()).toSorted(),
  ]).slice(0, 24);

async function readStates(connection, names) {
  const values = new Map();
  for (let offset = 0; offset < names.length; offset += 100) {
    const batch = names.slice(offset, offset + 100);
    const { rows } = await connection.query(
      `SELECT name,value FROM workspace_documents WHERE name IN (${batch.map((_, i) => `$${i + 1}`).join(',')})`,
      batch,
    );
    for (const row of rows) values.set(row.name, row.value);
  }
  return values;
}

// Old terminal checkpoints dropped stateKey. Recover the exact immutable
// snapshot by its saved summary, never by restarting a post from its root page.
async function restoreReferences(job, samples, connection) {
  const missing = new Map(
    samples
      .filter((s) => !s.stateKey && !s.post)
      .map((s) => [s.postId, signature(s)]),
  );
  if (!missing.size) return;
  const matches = new Map();
  let after = '';
  while (true) {
    const { rows } = await connection.query(
      'SELECT name,value FROM workspace_documents WHERE name LIKE $1 AND name>$2 ORDER BY name LIMIT 250',
      [`ingredient-trend:sample:${job.id}:%`, after],
    );
    for (const { name, value } of rows) {
      if (
        !value?.post ||
        !Array.isArray(value.runIds) ||
        !Array.isArray(value.ids) ||
        !Array.isArray(value.pending)
      )
        continue;
      if (missing.get(value.post.id) !== signature(sampleSummary(value)))
        continue;
      const hash = trendHash(canonical(value));
      const old = matches.get(value.post.id);
      if (old && old.hash !== hash)
        throw Error('评论断点归档存在歧义，未重新请求来源');
      matches.set(value.post.id, { name, hash });
    }
    if (rows.length < 250) break;
    after = rows.at(-1).name;
  }
  for (const sample of samples) {
    if (!missing.has(sample.postId)) continue;
    const match = matches.get(sample.postId);
    if (!match) throw Error(`${sample.postId}评论断点归档缺失，未重新请求来源`);
    sample.stateKey = match.name;
  }
}

// Runs under the research_jobs row lock. Request counters/identities and
// confirmed or unknown journals remain intact; user cancellation is respected.
export async function prepareIngredientTrendResume(job, connection) {
  const cp = structuredClone(job.checkpoint);
  delete cp.finishedAt;
  if (cp.phase !== 'done') return cp;
  const plan = job.input.plan;
  const scope = scopeOf(job);
  const samples = (cp.samples || []).filter(
    (s) =>
      !s.blocked && s.pendingCount > 0 && s.observed < plan.maxCommentsPerPost,
  );
  const guardedPosts = cp.failures?.some((message) =>
    message.includes('后台帖子请求保护'),
  );
  const posts = guardedPosts
    ? (cp.coverage || []).filter(
        (s) =>
          s.partial &&
          s.scan &&
          !s.blocked &&
          !s.sourceExhausted &&
          !s.scan.orderIssues &&
          !s.scan.missingDates &&
          (cp.communitySeen?.[s.community]?.length || 0) <
            plan.maxPostsPerCommunity,
      )
    : [];
  if (!samples.length && !posts.length)
    throw Error(
      '该任务已达到设置的采集数量或没有可继续的游标；异常请求需先确认',
    );
  const stateKeys = samples.map((s) =>
    commentStateKey(plan.market, scope, s.postId),
  );
  const coverageKeys = posts.map(
    (s) =>
      `ingredient-trend:coverage:${plan.market}:${scope}:${s.community.toLowerCase()}`,
  );
  const states = await readStates(connection, [...stateKeys, ...coverageKeys]);
  for (const key of [...stateKeys, ...coverageKeys]) {
    const state = states.get(key);
    if (
      state?.lastJobId !== job.id &&
      Date.parse(state?.lastVisitedAt || state?.observedAt || '') >= cp.asOf
    )
      throw Error('该监控已有更新的采集断点，请使用最新任务继续，避免重复请求');
  }
  await restoreReferences(job, samples, connection);
  const communities = new Set(posts.map((p) => p.community));
  cp.postQueue = posts.map((state) => ({
    community: state.community,
    state,
    scan: state.scan,
  }));
  cp.coverage = (cp.coverage || []).filter(
    (s) => !communities.has(s.community),
  );
  cp.phase = posts.length ? 'posts' : 'comments';
  cp.failures = (cp.failures || []).filter(
    (message) =>
      !message.includes('后台来源请求保护') &&
      !message.includes('后台帖子请求保护'),
  );
  cp.logs = [
    ...(cp.logs || []),
    '手动继续成分采集：接回保存的游标与原请求编号，取消后台请求次数上限',
  ];
  return cp;
}
