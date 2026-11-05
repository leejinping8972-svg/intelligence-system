import type { Task } from './data';

export function taskObjectSummary(task: Task) {
  const context = task.context;
  if (!context) return '历史任务未记录对象信息';
  const first = context.objects[0];
  if (!first) return context.scope || '任务未记录具体对象';
  const count = context.objectCount || context.objects.length;
  return count > 1
    ? `${first.label || first.sourceId || first.id} 等 ${count} 项`
    : first.label && first.label !== '名称未记录'
      ? first.label
      : first.sourceId || first.id || '名称未记录';
}

export function taskTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '未记录';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
