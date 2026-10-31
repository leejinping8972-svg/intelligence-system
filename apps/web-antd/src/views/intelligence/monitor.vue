<script setup lang="ts">
import type { Task } from './data';
import type { TaskGroup } from './task-list';

import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Drawer,
  Empty,
  message,
  Spin,
  Tabs,
} from 'ant-design-vue';

import {
  cancelCloudJob,
  cloudRequest,
  cloudWorkspace,
  retryCloudTrends,
  syncCloudWorkspace,
} from './cloud-workspace';
import FocusedMonitors from './components/FocusedMonitors.vue';
import NewMonitorDialog from './components/NewMonitorDialog.vue';
import DiscoveryMonitors from './components/DiscoveryMonitors.vue';
import PageHeader from './components/PageHeader.vue';
import ResearchTaskList from './components/ResearchTaskList.vue';
import TaskCollections from './components/TaskCollections.vue';
import TaskProgress from './components/TaskProgress.vue';
import { audit, marketName, state } from './data';
import { resourceTaskCanResume } from './product-resources';
import { refreshCompetitorWorkspace } from './competitor-workspace';
import { groupTasks, taskStatus, taskStatuses, taskSummary } from './task-list';
const route = useRoute();
const router = useRouter();
const tab = ref('tasks');
const selected = ref<TaskGroup>();
const discoveryMonitors = ref<InstanceType<typeof DiscoveryMonitors>>();
function monitorSaved() {
  void discoveryMonitors.value?.refresh();
  void refreshCompetitorWorkspace(true);
}
const detailsLoading = ref(false);
const detailsError = ref('');
let detailsSequence = 0;
async function showDetails(task: TaskGroup) {
  selected.value = task;
  detailsError.value = '';
  const sequence = ++detailsSequence;
  detailsLoading.value = false;
  if (!task.cloudJobId) return;
  detailsLoading.value = true;
  try {
    const result = await cloudRequest<{ tasks: Task[] }>('server_task_detail', {
      jobId: task.cloudJobId,
    });
    if (sequence === detailsSequence && selected.value?.id === task.id)
      selected.value = groupTasks(result.tasks)[0];
  } catch (error) {
    if (sequence === detailsSequence)
      detailsError.value =
        error instanceof Error ? error.message : '详情读取失败';
  } finally {
    if (sequence === detailsSequence) detailsLoading.value = false;
  }
}
watch(
  () => cloudWorkspace.taskRevision,
  () => {
    if (selected.value && !detailsLoading.value)
      void showDetails(selected.value);
  },
);
const retrying = ref('');
const resuming = ref('');
async function resumeResource(task: Task) {
  if (!task.cloudJobId || !resourceTaskCanResume(task) || resuming.value)
    return;
  resuming.value = task.cloudJobId;
  try {
    await cloudRequest<{ jobId: string; tasks: Task[] }>(
      'server_product_resource_resume',
      { jobId: task.cloudJobId },
    );
    await syncCloudWorkspace();
    if (selected.value?.cloudJobId === task.cloudJobId)
      await showDetails(selected.value);
    message.success('已恢复同一任务，仅继续尚未执行步骤');
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '恢复任务失败');
  } finally {
    resuming.value = '';
  }
}
async function reResearch(task: Task) {
  if (!task.cloudJobId) return;
  try {
    const draft = await cloudRequest<{ path: string }>('server_task_research', {
      jobId: task.cloudJobId,
    });
    selected.value = undefined;
    await router.push({
      path: draft.path,
      query: { reResearch: task.cloudJobId },
    });
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '原研究参数读取失败',
    );
  }
}
async function retryTrends(task: Task) {
  if (!task.cloudJobId || retrying.value) return;
  retrying.value = task.cloudJobId;
  try {
    await retryCloudTrends(task.cloudJobId);
    message.success('已创建后台补齐任务，仅重试未完成趋势，不调用Sorftime扩词');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '重试提交失败');
  } finally {
    retrying.value = '';
  }
}
watch(
  () => route.query.tab,
  (v) => {
    if (v === 'tasks' || v === 'monitors' || v === 'audit') tab.value = v;
  },
  { immediate: true },
);
watch(tab, value => {
  if (route.query.tab !== value) void router.replace({ query: { ...route.query, tab: value } });
});
const tasks = computed(() => groupTasks(state.tasks, state.market));
watch(
  () => [route.query.job, tasks.value] as const,
  ([id, rows]) => {
    if (typeof id !== 'string' || selected.value?.cloudJobId === id) return;
    const task = rows.find((row) => row.cloudJobId === id);
    if (task) void showDetails(task);
  },
  { immediate: true },
);
function isLiveTask(task: Task) {
  return (
    task.mode === 'live' ||
    task.title.includes('真实研究') ||
    task.title.includes('独立站发现')
  );
}
function run(task: Task) {
  const original = state.tasks.find((t) => t.id === task.id);
  if (original) task = original;
  task.status = 'partial';
  task.steps = [
    '演示配置校验通过',
    '演示关键词阶段完成',
    '演示趋势阶段完成',
    '演示站点阶段完成',
    '真实数据源未接入：部分完成',
  ];
  audit('模拟研究执行', task.title, task.market);
}
async function cancel(task: Task) {
  if (task.cloudJobId) {
    try {
      await cancelCloudJob(task.cloudJobId);
      message.success('已取消；当前请求结束后停止后续采集，保留已有结果');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '取消失败');
    }
    return;
  }
  const original = state.tasks.find((t) => t.id === task.id);
  if (original) original.status = 'cancelled';
  task.status = 'cancelled';
  audit('取消演示任务', task.title, task.market);
}
watch(
  () => state.market,
  () => {
    selected.value = undefined;
  },
);
const auditRows = computed(() =>
  state.audit.filter(
    (e) => state.market === 'ALL' || e.market === state.market,
  ),
);
</script>
<template>
  <main class="hci-page">
    <PageHeader
      :mode="tab === 'tasks' ? 'tasks' : 'legacy'"
      :title="tab === 'monitors' ? '跟踪计划' : tab === 'audit' ? '操作记录' : '采集任务'"
      description="让重点对象持续可见，让每个研究步骤都有明确状态。"
    >
      <NewMonitorDialog @saved="monitorSaved" />
      <Button type="primary" @click="router.push('/research?new=1')">
        ＋ 新建研究
      </Button>
    </PageHeader>
    <div class="hci-demo-note">
      关键词研究、趋势补齐、平台商品与站点采集由服务器后台执行并保存。关闭浏览器后继续，回来后可查看进度与结果；历史本机任务保留原记录。
      <Button
        size="small"
        :loading="cloudWorkspace.syncing"
        @click="
          syncCloudWorkspace().catch((error) => message.error(error.message))
        "
      >
        刷新云端进度
      </Button>
      <p v-if="cloudWorkspace.error" role="alert">
        云端同步异常：{{ cloudWorkspace.error }}。本机缓存仍保留。
      </p>
    </div>
    <section class="hci-panel">
      <Tabs v-model:active-key="tab">
        <Tabs.TabPane key="monitors" tab="重点监控">
          <DiscoveryMonitors ref="discoveryMonitors" />
          <FocusedMonitors /> </Tabs.TabPane
        ><Tabs.TabPane key="tasks" :tab="`研究任务（${tasks.length}）`">
          <ResearchTaskList
            :tasks="tasks"
            :retrying="retrying"
            @details="showDetails"
            @cancel="cancel"
            @run="run"
            @trends="retryTrends"
            @research="reResearch"
            @retry="
              (task) => {
                task.status = 'queued';
                const original = state.tasks.find((t) => t.id === task.id);
                if (original) original.status = 'queued';
                audit('重试演示任务', task.title, task.market);
              }
            "
          /> </Tabs.TabPane
        ><Tabs.TabPane key="audit" :tab="`操作记录（${auditRows.length}）`">
          <Empty
            v-if="!auditRows.length"
            description="收藏、审核或修改监控后，会在这里留下记录"
          />
          <div
            v-for="event in auditRows"
            :key="event.id"
            class="hci-market-row"
          >
            <div>
              <b>{{ event.title }}</b>
              <p class="hci-subtle">{{ event.detail }}</p>
            </div>
            <span class="hci-subtle">{{ event.at }}</span>
          </div>
        </Tabs.TabPane>
      </Tabs>
    </section>
    <Drawer
      :open="!!selected"
      title="研究任务详情"
      width="min(960px, 100vw)"
      @close="
        selected = undefined;
        detailsSequence++;
        detailsLoading = false;
        router.replace({ query: { ...route.query, job: undefined } });
      "
    >
      <template v-if="selected">
        <Alert
          v-if="detailsError"
          type="error"
          :message="detailsError"
          show-icon
        />
        <Button v-if="detailsError" @click="showDetails(selected)">
          重新读取详情
        </Button>
        <Spin v-if="detailsLoading" tip="正在读取任务详情" />
        <p class="hci-subtle">
          覆盖市场：{{
            selected.markets
              .map((market) =>
                market === 'ALL' ? '市场未记录' : marketName(market),
              )
              .join(' / ')
          }}；进度为整项任务合计。
        </p>
        <h2 style="font-size: 22px">{{ selected.title }}</h2>
        <p class="hci-subtle" style="margin: 12px 0">
          {{ selected.created }} ·
          {{ taskStatuses[taskStatus(selected)]?.label }}
        </p>
        <Alert
          v-if="selected.overview?.reason"
          type="warning"
          show-icon
          :message="selected.overview.reason"
        />
        <p class="hci-evidence">
          {{ taskSummary(selected).label }}<br />{{
            taskSummary(selected).result
          }}
        </p>
        <TaskCollections :task="selected" />
        <details>
          <summary style="margin-top: 20px; cursor: pointer">
            查看本轮汇总与用量
          </summary>
          <TaskProgress :task="selected" />
        </details>
        <Button
          v-if="selected.cloudJobId && resourceTaskCanResume(selected)"
          :loading="resuming === selected.cloudJobId"
          @click="resumeResource(selected)"
        >
          继续未执行资源步骤
        </Button>
        <p
          v-if="
            selected.researchProgress?.resource &&
            selected.status === 'cancelled'
          "
          class="hci-subtle"
        >
          恢复沿用原任务的商品数、页数与请求记录；已执行请求不重放，结果未知的请求保留待核对。
        </p>
        <Button
          v-if="
            selected.cloudJobId &&
            selected.progress?.terminal &&
            selected.progress.failed > 0
          "
          :loading="retrying === selected.cloudJobId"
          @click="retryTrends(selected)"
        >
          仅重试未完成趋势
        </Button>
        <details>
          <summary style="margin: 24px 0 12px; cursor: pointer">
            任务级执行记录
          </summary>
          <div
            v-for="(step, i) in selected.steps"
            :key="i"
            class="hci-market-row"
          >
            <span class="hci-market-code">{{ i + 1 }}</span
            ><span style="flex: 1">{{ step }}</span>
          </div>
        </details>
        <div v-if="selected.readOnly" class="hci-evidence">
          当前展示已保存的任务摘要，原任务和检查点保留。
        </div>
        <div
          v-else-if="selected.researchProgress?.resource"
          class="hci-evidence"
        >
          本任务按已配置的资源路径执行。请求、累计预留与已确认用量分别记录；缺少回执的费用需人工核实。
        </div>
        <div v-else-if="isLiveTask(selected)" class="hci-evidence">
          本任务已调用已配置的真实采集服务。上方步骤会保留实际返回数量、失败原因和限流状态；外部费用以任务配置为准。
        </div>
        <div v-else class="hci-evidence">
          本任务仅模拟工作流，没有向第三方平台发出请求，也没有产生真实研究结果或费用。
        </div>
        <Button @click="router.push('/research')"> 返回关键词研究 </Button>
      </template>
    </Drawer>
  </main>
</template>
