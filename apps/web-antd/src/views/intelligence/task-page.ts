import type { MarketFilter, Task } from './data';

import { cloudRequest } from './cloud-workspace';

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
}) {
  return cloudRequest<TaskPageResult>('server_task_page', {
    page: input.page,
    pageSize: input.pageSize,
    statuses: input.statuses?.length ? input.statuses : undefined,
    search: input.search?.trim() || undefined,
    market: input.market && input.market !== 'ALL' ? input.market : undefined,
  });
}
