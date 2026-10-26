const markets = new Set(['MX', 'US', 'VN']);
const names = { US: '美国', MX: '墨西哥', VN: '越南', ALL: '市场未记录' };
const kinds = new Set([
  'ad_analysis',
  'ads',
  'consumer_research',
  'evidence_analysis',
  'market_analysis',
  'metrics',
  'persona_research',
  'platform_products',
  'products',
  'semrush_sites',
  'site_metrics',
  'sites',
]);
const bulkStates = new Set([
  'bulk_blocked',
  'bulk_paused',
  'bulk_running',
  'cancelled',
  'completed',
  'partial',
]);
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;
const shown = (value) => count(value) ?? '未记录';

function summaryTasks(job, bulk = false) {
  const input = job?.input || {};
  const cp = job?.checkpoint || {};
  const covered = [
    ...new Set(
      [
        ...(Array.isArray(input.markets) ? input.markets : []),
        ...(bulk && Array.isArray(input.work)
          ? input.work.map((item) => item?.market)
          : []),
      ].filter((market) => markets.has(market)),
    ),
  ];
  const created = [cp.submittedAt, cp.startedAt, job?.created_at].find(
    (value) => value && Number.isFinite(Date.parse(value)),
  );
  const total =
    count(cp.total) ?? (Array.isArray(input.work) ? input.work.length : null);
  return (covered.length ? covered : ['ALL']).map((market) => ({
    id: `${job.id}:${market}`,
    cloudJobId: job.id,
    market,
    mode: 'live',
    readOnly: true,
    title: `云端 · ${bulk ? 'Semrush 批量数据补全' : '任务资料待检查'} · ${names[market]}`,
    status: job.cancelled
      ? 'cancelled'
      : bulk && bulkStates.has(job.status)
        ? job.status
        : 'unavailable',
    created: created ? new Date(created).toISOString() : '',
    steps: bulk
      ? [
          '以上为已保存检查点；批处理执行状态需确认，未自动恢复或重放请求。',
          `对象总数 ${shown(total)}；已请求 ${shown(cp.executed)}；已复用 ${shown(cp.reused)}；已应用 ${shown(cp.applied)}；剩余 ${shown(cp.remaining)}；未知结果 ${shown(cp.unknown)}`,
        ]
      : ['该任务的类型或资料暂时无法完整展示，原任务和已保存结果保留。'],
  }));
}

export const unavailableTasks = (job) => summaryTasks(job);

// One unsupported or malformed persisted job must not block all task reads.
export function projectJobTasks(job, project) {
  if (job?.input?.kind === 'bulk_semrush_enrichment')
    return summaryTasks(job, true);
  if (job?.input?.kind && !kinds.has(job.input.kind))
    return unavailableTasks(job);
  try {
    const tasks = project(job);
    if (
      !Array.isArray(tasks) ||
      !tasks.length ||
      tasks.some((task) => !task || !Array.isArray(task.steps))
    )
      return unavailableTasks(job);
    return tasks;
  } catch {
    return unavailableTasks(job);
  }
}
