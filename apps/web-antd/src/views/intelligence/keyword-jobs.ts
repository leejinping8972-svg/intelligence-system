import type { Keyword } from './data';
import type { KeywordResearchInput } from './keyword-research';

import { reactive, watch } from 'vue';

import {
  cancelCloudJob,
  cloudWorkspace,
  startCloudSync,
  submitCloudResearch,
} from './cloud-workspace';
import { audit, state } from './data';
import { activeKeywordTasks } from './keyword-task-summary';
export const keywordJob = reactive({
  running: false,
  discovered: 0,
  trended: 0,
  message: '',
  phase: '',
});
watch(
  () => [
    cloudWorkspace.taskRevision,
    cloudWorkspace.submitting,
    state.market,
    state.tasks,
  ],
  () => {
    const tasks = activeKeywordTasks(state.tasks, state.market);
    keywordJob.running = tasks.length > 0 || cloudWorkspace.submitting;
    keywordJob.discovered = tasks.reduce((n, task) => n + (task.progress?.discovered || 0), 0);
    keywordJob.trended = tasks.reduce((n, task) => n + (task.progress?.expansionOnly ? 0 : task.progress?.processed || 0), 0);
    keywordJob.phase = keywordJob.running ? '腾讯云后台执行' : '等待人工筛选';
  },
);
startCloudSync();
export async function startKeywordJob(
  input: Omit<KeywordResearchInput, 'signal'>,
  existingRecords?: Keyword[],
) {
  const result = await submitCloudResearch(input, existingRecords);
  audit('提交云端关键词研究', `任务${result.jobId}；关闭浏览器后继续运行`);
  return result;
}
export async function stopKeywordJob() {
  const ids = new Set(
    activeKeywordTasks(state.tasks, state.market)
      .filter(
        (task) =>
          task.cloudJobId && ['queued', 'running'].includes(task.status),
      )
      .map((task) => task.cloudJobId!),
  );
  for (const id of ids) await cancelCloudJob(id);
}
