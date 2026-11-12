import type { MarketFilter, Task } from './data';

export interface TaskGroup extends Task {
  markets: Task['market'][];
  taskIds: string[];
}
export const taskStatuses: Record<string, { label: string; color: string }> = {
  queued: { label: '待执行', color: 'default' },
  running: { label: '执行中', color: 'blue' },
  waiting: { label: '等待重试', color: 'orange' },
  completed: { label: '已完成', color: 'green' },
  failed: { label: '执行失败', color: 'red' },
  partial: { label: '已停止 · 未采集完', color: 'orange' },
  cancelled: { label: '已取消', color: 'default' },
  bulk_running: { label: '批处理待确认', color: 'orange' },
  bulk_paused: { label: '批处理已暂停', color: 'orange' },
  bulk_blocked: { label: '批处理受阻', color: 'red' },
  unavailable: { label: '资料待检查', color: 'orange' },
};

/** Display status: awaiting_review is treated as completed. */
export function taskStatus(task: Task) {
  if (task.status === 'awaiting_review') return 'completed';
  return task.status === 'running' &&
    (task.progress?.phase === 'waiting' ||
      (task.researchProgress?.waiting || 0) > 0)
    ? 'waiting'
    : task.status;
}

export function taskStatusInfo(task: Task) {
  if (task.overview?.outcome.startsWith('采集完成') && task.sourceAnalysis) {
    if (task.sourceAnalysis.pending) return { label: '采集完成 · 分析中', color: 'blue' };
    if (task.sourceAnalysis.failed || task.sourceAnalysis.cancelled)
      return { label: '采集完成 · 分析未完成', color: 'orange' };
  }
  return task.status === 'running' && task.overview?.ingredientTrend?.waiting
    ? { label: '等待采集', color: 'default' }
    : taskStatuses[taskStatus(task)];
}

export function mergeTaskStatusCounts(counts: Record<string, number> = {}) {
  const next = { ...counts };
  const review = Number(next.awaiting_review) || 0;
  if (review) {
    next.completed = (Number(next.completed) || 0) + review;
    delete next.awaiting_review;
  }
  return next;
}

/** Expand UI filters so "completed" also matches awaiting_review jobs. */
export function expandTaskStatusFilters(statuses: string[]) {
  if (!statuses.includes('completed')) return [...statuses];
  return [...new Set([...statuses, 'awaiting_review'])];
}

export function partialTaskRetriesFailures(task: Task) {
  const health = task.overview?.healthDiscovery;
  return Boolean(health && health.remainingWork === 0 &&
    (health.pages.failed > 0 || health.products.review > 0 || health.issues > 0));
}

export function partialTaskCanContinue(task: Task) {
  if (task.status !== 'partial' || task.readOnly || task.canContinue === false) return false;
  if (task.overview?.healthDiscovery) return task.overview.healthDiscovery.remainingWork > 0 || partialTaskRetriesFailures(task);
  if ((task.overview?.remaining ?? 0) > 0) return true;
  const collection = task.researchProgress || task.collectionProgress;
  if (
    collection &&
    Number(collection.total) > 0 &&
    Number(collection.done) < Number(collection.total)
  )
    return true;
  const progress = task.progress;
  if (
    progress &&
    !progress.terminal &&
    Number(progress.total) > 0 &&
    Number(progress.processed) < Number(progress.total)
  )
    return true;
  return task.researchProgress?.resource?.resumable === true;
}

export function taskTitle(task: Task) {
  if (task.context?.title) return task.context.title;
  return task.title
    .replace(/^云端\s*·\s*/, '')
    .replace(/\s*·\s*(美国|墨西哥|越南|市场未记录)$/, '');
}
export function groupTasks(
  tasks: Task[],
  market: MarketFilter = 'ALL',
): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const task of tasks) {
    const key = task.cloudJobId || task.id;
    const group = groups.get(key);
    if (group) {
      if (!group.markets.includes(task.market)) group.markets.push(task.market);
      if (!group.taskIds.includes(task.id)) group.taskIds.push(task.id);
    } else
      groups.set(key, {
        ...task,
        id: key,
        markets: [task.market],
        taskIds: [task.id],
      });
  }
  return [...groups.values()]
    .filter((t) => market === 'ALL' || t.markets.includes(market))
    .toSorted(
      (a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0),
    );
}
export function taskSummary(task: Task): {
  percent: null | number;
  label: string;
  result: string;
  color?: string;
} {
  const o = task.overview;
  if (o) {
    let color = '#408979';
    if (['cancelled', 'failed', 'partial'].includes(o.status))
      color = '#c48532';
    else if (o.status === 'running') color = '#1677ff';
    if (o.ingredientTrend) {
      const trend = o.ingredientTrend;
      const timing = (field: string) => trend.timings[field] === null || trend.timings[field] === undefined
        ? '' : `${(trend.timings[field] / 1000).toFixed(1)}秒`;
      const times = [
        ['lastSourceMs', '请求处理'], ['lastArchiveMs', '归档'],
        ['lastCheckpointMs', '保存'], ['lastQueueMs', '续跑延迟'], ['lastSchedulingMs', '计划调度'],
      ].map(([field = '', label]) => timing(field) ? `${label} ${timing(field)}` : '').filter(Boolean).join(' · ');
      return {
        percent: trend.percent,
        label: trend.operation === 'analyze'
          ? `周分析${trend.total ? ` ${trend.processed}/${trend.total}段` : ''} · ${o.outcome}`
          : `${trend.commentPosts ? `评论回访 ${trend.processed}/${trend.commentPosts}帖` : `已采 ${trend.posts}帖`} · ${o.outcome}`,
        result: [
          trend.waiting ? '当日采集保存后自动开始分析' : '',
          trend.operation === 'collect' ? `帖子 ${trend.posts} · 本轮新增 ${trend.newPosts} · 评论记录 ${trend.comments}` : '',
          trend.operation === 'collect' ? `已回访 ${trend.visitedPosts}帖 · 待续 ${trend.pendingPosts}帖 · 请求异常 ${trend.blockedPosts}帖` : '',
          trend.operation === 'collect' ? `帖子页 ${trend.pages} · 来源请求 ${trend.requests}次` : `模型请求 ${trend.modelCalls}次`,
          times ? `最近耗时：${times}` : '', o.reason,
        ].filter(Boolean).join('\n'),
        color,
      };
    }
    if (o.healthDiscovery) {
      const { categories: c, products: p, pages, issues } = o.healthDiscovery;
      return {
        percent: o.percent,
        label: `类目首屏 ${c.processed}/${c.total} · ${o.outcome}`,
        result: [
          `查询成功 ${c.succeeded} · 失败 ${c.failed} · 待查 ${c.remaining}`,
          `商品入库 ${p.accepted} · 排除 ${p.excluded} · 待确认 ${p.review} · 待处理 ${p.pending}`,
          `来源返回 ${p.returned} 条（含重复） · 已取 ${pages.processed} 页 · 待翻页 ${pages.pending}`,
          [
            pages.failed ? `来源异常 ${pages.failed} 个类目` : '',
            pages.truncated ? `翻页未完整 ${pages.truncated} 个类目` : '',
            issues ? `执行异常 ${issues} 条（详见记录）` : '',
            p.evidenceSkipped ? `日期/销量等证据不符 ${p.evidenceSkipped} 条` : '',
            p.limitSkipped ? `数量上限跳过 ${p.limitSkipped} 条` : '',
          ].filter(Boolean).join(' · '),
          o.reason,
          '进度条仅表示类目首屏查询进度，分页与商品处理结果另列。',
        ].filter(Boolean).join('\n'),
        color,
      };
    }
    const succeeded = o.succeeded === null ? '' : `采集成功 ${o.succeeded} · `;
    return {
      percent: o.percent,
      label: `总进度 ${o.processed}/${o.total} · ${o.outcome}`,
      result: [
        o.reason,
        `${succeeded}失败/受限 ${o.failed} · 待完成 ${o.remaining}`,
        task.context?.verificationOnly
          ? '仅核对，未更新商品库'
          : task.researchProgress
          ? `商品 ${task.researchProgress.products} · 证据 ${task.researchProgress.evidence}`
          : '',
      ]
        .filter(Boolean)
        .join('；'),
      color,
    };
  }
  const p = task.progress;
  const phases: Record<string, string> = {
    waiting: '限流冷却 / 延迟重试',
    metrics: '补充 Semrush 指标',
    discovery: '发现关键词',
    queued: '等待后台执行',
  };
  if (p)
    return {
      percent: p.percent,
      label:
        phases[p.phase] || (p.terminal ? '本轮处理已结束' : '趋势采集与评分'),
      result: `关键词 ${p.discovered} · 趋势 ${p.processed}/${p.total} · 评级 ${p.rated}`,
    };
  const c = task.researchProgress || task.collectionProgress;
  if (c)
    return {
      percent: c.total
        ? Math.min(100, Math.round((c.done / c.total) * 100))
        : 0,
      label:
        taskStatus(task) === 'waiting'
          ? '部分对象等待重试'
          : `已处理 ${c.done}/${c.total} 个对象`,
      result: task.researchProgress
        ? `商品 ${task.researchProgress.products} · 证据 ${task.researchProgress.evidence} · 请求 ${c.requests}/${c.requestLimit ?? '未设置'}`
        : `广告 ${task.collectionProgress?.ads ?? 0} · 站点 ${task.collectionProgress?.sites ?? 0} · 请求 ${c.requests}/${c.requestLimit ?? '未设置'}`,
    };
  return {
    percent: null,
    label: taskStatuses[taskStatus(task)]?.label || task.status,
    result: task.steps.at(-1) || '等待后台更新',
  };
}
