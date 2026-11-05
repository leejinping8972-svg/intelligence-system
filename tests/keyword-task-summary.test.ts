import type { Task } from '../apps/web-antd/src/views/intelligence/data';
import { expect, it } from 'vitest';
import { activeKeywordTasks } from '../apps/web-antd/src/views/intelligence/keyword-task-summary';
it('uses whole task progress, deduplicates markets and excludes AI, ads and inactive jobs', () => {
  const task = (
    id: string,
    market = 'US',
    status = 'queued',
    stage = 'keywords',
  ) =>
    ({
      id,
      cloudJobId: id.split(':')[0],
      market,
      status,
      stage,
      progress: { discovered: 709, processed: 0 },
      steps: [],
    }) as unknown as Task;
  const tasks = [
    task('one:US'),
    task('one:MX', 'MX'),
    task('ad', 'US', 'running', 'ads'),
    task('analysis', 'US', 'running', 'analysis'),
    task('old', 'US', 'completed'),
  ];
  expect(activeKeywordTasks(tasks, 'ALL')).toHaveLength(1);
  expect(activeKeywordTasks(tasks, 'US')[0]?.progress?.discovered).toBe(709);
  expect(activeKeywordTasks(tasks, 'VN')).toHaveLength(0);
});
