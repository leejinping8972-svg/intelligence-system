import type { MarketFilter, Task } from './data';

import { cloudRequest } from './cloud-workspace';
import { expandTaskStatusFilters, mergeTaskStatusCounts } from './task-list';

export type TaskPageResult = {
  page: number;
  pageSize: number;
  total: number;
  tasks: Task[];
  statusCounts: Record<string, number>;
  activeJobs: Array<{ id: string; status: string; updatedAt?: string }>;
  generatedAt: string;
};

export async function fetchTaskPage(input: {
  page: number;
  pageSize: number;
  statuses?: string[];
  search?: string;
  market?: MarketFilter;
}, options: { signal?: AbortSignal } = {}) {
  const statuses = input.statuses?.length
    ? expandTaskStatusFilters(input.statuses)
    : undefined;
  const result = await cloudRequest<TaskPageResult>('server_task_page', {
    page: input.page,
    pageSize: input.pageSize,
    statuses,
    search: input.search?.trim() || undefined,
    market: input.market && input.market !== 'ALL' ? input.market : undefined,
  }, options);
  return {
    ...result,
    statusCounts: mergeTaskStatusCounts(result.statusCounts),
  };
}
