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
  startCloudSync,
  syncCloudWorkspace,
} from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import ResearchTaskList from './components/ResearchTaskList.vue';
import FocusedMonitors from './components/FocusedMonitors.vue';
import { useCompetitorWorkspace } from './competitor-workspace';
import { focusedMonitorRows } from './focused-monitors';
import TaskProgress from './components/TaskProgress.vue';
import { audit, marketName, state } from './data';
import { groupTasks } from './task-list';
startCloudSync();
const route = useRoute();
const router = useRouter();
const tab = ref('tasks');
const watchWorkspace = useCompetitorWorkspace();
const selected = ref<TaskGroup>();
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
    if (v === 'tasks' || v === 'monitors') tab.value = v;
  },
  { immediate: true },
);
const monitors = computed(() =>
  focusedMonitorRows(state.products, state.monitors, watchWorkspace.targets, watchWorkspace.runs, state.market),
);
const tasks = computed(() => groupTasks(state.tasks, state.market));
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
const statuses = {
  awaiting_review: '采集已完成 · 待人工筛选',
  queued: '待执行',
  running: '执行中',
  completed: '已完成',
  partial: '部分完成',
  cancelled: '已取消',
};
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="监控与任务"
      description="让重点对象持续可见，让每个研究步骤都有明确状态。"
    >
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
        <Tabs.TabPane key="monitors" :tab="`重点监控（${monitors.length}）`"><FocusedMonitors /></Tabs.TabPane><Tabs.TabPane key="tasks" :tab="`研究任务（${tasks.length}）`">
          <ResearchTaskList
            :tasks="tasks"
            :retrying="retrying"
            @details="showDetails"
            @cancel="cancel"
            @run="run"
            @trends="retryTrends"
            @research="router.push('/research?new=1')"
            @retry="
              (task) => {
                task.status = 'queued';
                const original = state.tasks.find((t) => t.id === task.id);
                if (original) original.status = 'queued';
                audit('重试演示任务', task.title, task.market);
              }
            "
          />
</Tabs.TabPane><Tabs.TabPane key="audit" :tab="`操作记录（${auditRows.length}）`">
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
      :width="960"
      @close="
        selected = undefined;
        detailsSequence++;
        detailsLoading = false;
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
            selected.markets.map(marketName).join(' / ')
          }}；进度为整项任务合计。
        </p>
        <h2 style="font-size: 22px">{{ selected.title }}</h2>
        <p class="hci-subtle" style="margin: 12px 0">
          {{ selected.created }} · {{ statuses[selected.status] }}
        </p>
        <TaskProgress :task="selected" detail />
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
        <h3 style="margin: 24px 0 12px">执行记录</h3>
        <div
          v-for="(step, i) in selected.steps"
          :key="i"
          class="hci-market-row"
        >
          <span class="hci-market-code">{{ i + 1 }}</span><span style="flex: 1">{{ step }}</span>
        </div>
        <div v-if="isLiveTask(selected)" class="hci-evidence">
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
