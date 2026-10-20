import type { Market, MarketFilter, Task } from './data';

export interface TaskGroup extends Task {
  markets: Market[];
  taskIds: string[];
}
export const taskStatuses: Record<string, { label: string; color: string }> = {
  queued: { label: '待执行', color: 'default' },
  running: { label: '执行中', color: 'blue' },
  waiting: { label: '等待重试', color: 'orange' },
  awaiting_review: { label: '待人工筛选', color: 'cyan' },
  completed: { label: '已完成', color: 'green' },
  partial: { label: '部分完成', color: 'orange' },
  cancelled: { label: '已取消', color: 'default' },
};
export function taskStatus(task: Task) {
  return task.status === 'running' &&
    (task.progress?.phase === 'waiting' ||
      (task.researchProgress?.waiting || 0) > 0)
    ? 'waiting'
    : task.status;
}
export function taskTitle(task: Task) {
  return task.title
    .replace(/^云端\s*·\s*/, '')
    .replace(/\s*·\s*(美国|墨西哥|越南)$/, '');
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
export function taskSummary(task: Task) {
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
        ? `商品 ${task.researchProgress.products} · 证据 ${task.researchProgress.evidence} · 请求 ${c.requests}/${c.requestLimit}`
        : `广告 ${task.collectionProgress?.ads ?? 0} · 站点 ${task.collectionProgress?.sites ?? 0} · 请求 ${c.requests}/${c.requestLimit}`,
    };
  return {
    percent: null,
    label: taskStatuses[task.status]?.label || task.status,
    result: task.steps.at(-1) || '等待后台更新',
  };
}
