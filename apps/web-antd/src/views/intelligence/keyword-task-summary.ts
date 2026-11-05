import type { Task } from './data';

export function activeKeywordTasks(tasks: Task[], market: string) {
  const jobs = new Map<string, Task>();
  for (const task of tasks) {
    if (
      task.stage !== 'keywords' ||
      !task.progress ||
      !['queued', 'running'].includes(task.status)
    )
      continue;
    if (market !== 'ALL' && task.market !== market) continue;
    jobs.set(task.cloudJobId || task.id, task);
  }
  return [...jobs.values()];
}
