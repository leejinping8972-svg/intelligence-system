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
export const keywordJob = reactive({
  running: false,
  discovered: 0,
  trended: 0,
  message: '',
  phase: '',
});
watch(
  () => [
    cloudWorkspace.active,
    cloudWorkspace.submitting,
    state.keywords.length,
  ],
  () => {
    keywordJob.running = cloudWorkspace.active > 0 || cloudWorkspace.submitting;
    keywordJob.discovered = state.keywords.length;
    keywordJob.trended = state.keywords.filter(
      (record) => record.trendStatus === 'collected',
    ).length;
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
    state.tasks
      .filter(
        (task) =>
          task.cloudJobId && ['queued', 'running'].includes(task.status),
      )
      .map((task) => task.cloudJobId!),
  );
  for (const id of ids) await cancelCloudJob(id);
}
