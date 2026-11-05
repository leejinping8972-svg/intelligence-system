<script setup lang="ts">
import type { Task } from '../data';
import type { TaskGroup } from '../task-list';

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import {
  Button,
  Empty,
  Input,
  message,
  Pagination,
  Progress,
  Radio,
  Select,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import { cloudWorkspace } from '../cloud-workspace';
import { marketName, state } from '../data';
import { serverMode } from '../session';
import {
  groupTasks,
  mergeTaskStatusCounts,
  partialTaskCanContinue,
  taskStatus,
  taskStatuses,
  taskSummary,
  taskTitle,
} from '../task-list';
import { fetchTaskPage } from '../task-page';

const props = defineProps<{
  active?: boolean;
  tasks: TaskGroup[];
  retrying: string;
  resuming?: string;
}>();
const emit = defineEmits<{
  details: [task: TaskGroup];
  cancel: [task: Task];
  run: [task: Task];
  research: [task: Task];
  retry: [task: Task];
  trends: [task: Task];
  continue: [task: Task];
  'update:total': [total: number];
}>();
function savedView() {
  try {
    return localStorage.getItem('hci-task-view') === 'cards' ? 'cards' : 'list';
  } catch {
    return 'list';
  }
}
const view = ref(savedView());
const status = ref<string[]>([]);
const search = ref('');
const page = ref(1);
const size = ref(10);
const loading = ref(false);
const listError = ref('');
const remoteRows = ref<TaskGroup[]>([]);
const remoteTotal = ref(0);
const statusCounts = ref<Record<string, number>>({});
const activeJobs = ref<Array<{ id: string; status: string }>>([]);
let loadSequence = 0;
let loadedRevision = '';
let hasLoaded = false;
let loadController: AbortController | undefined;

const localRows = computed(() =>
  props.tasks.filter(
    (t) =>
      (status.value.length === 0 ||
        status.value.includes(taskStatus(t)) ||
        (status.value.includes('completed') &&
          t.status === 'awaiting_review')) &&
      `${taskTitle(t)} ${t.cloudJobId || t.id}`
        .toLowerCase()
        .includes(search.value.toLowerCase().trim()),
  ),
);

const rows = computed(() => (serverMode ? remoteRows.value : localRows.value));
const total = computed(() =>
  serverMode ? remoteTotal.value : localRows.value.length,
);

const visible = computed(() =>
  serverMode
    ? rows.value
    : rows.value.slice((page.value - 1) * size.value, page.value * size.value),
);

async function loadRemote() {
  if (!serverMode || props.active === false) return;
  const revision = cloudWorkspace.taskRevision;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const sequence = ++loadSequence;
  loading.value = true;
  listError.value = '';
  try {
    const result = await fetchTaskPage({
      page: page.value,
      pageSize: size.value,
      statuses: status.value,
      search: search.value,
      market: state.market,
    }, { signal: controller.signal });
    if (sequence !== loadSequence) return;
    remoteRows.value = groupTasks(result.tasks, state.market);
    remoteTotal.value = result.total;
    statusCounts.value = mergeTaskStatusCounts(result.statusCounts || {});
    activeJobs.value = result.activeJobs || [];
    loadedRevision = revision;
    hasLoaded = true;
    emit('update:total', result.total);
  } catch (error) {
    if (sequence !== loadSequence || controller.signal.aborted) return;
    listError.value =
      error instanceof Error ? error.message : '任务列表读取失败';
    message.error(listError.value);
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

watch([status, () => state.market], () => {
  page.value = 1;
  if (!serverMode) return;
  void loadRemote();
});
watch([page, size], () => {
  if (!serverMode) return;
  void loadRemote();
});
watch(
  () => props.tasks.length,
  () => {
    if (!serverMode) page.value = 1;
  },
);
function applySearch() {
  page.value = 1;
  if (serverMode) void loadRemote();
}
function resetFilters() {
  status.value = [];
  search.value = '';
  page.value = 1;
  if (serverMode) void loadRemote();
}
watch(
  () => cloudWorkspace.taskRevision,
  () => {
    if (serverMode && props.active !== false) void loadRemote();
  },
);
watch(() => props.active, active => {
  if (active === false) {
    loadController?.abort();
    loadSequence++;
    loading.value = false;
  }
  if (active && (!hasLoaded || loadedRevision !== cloudWorkspace.taskRevision)) void loadRemote();
});
onUnmounted(() => { loadController?.abort(); loadSequence++; });
watch(view, (value) => {
  try {
    localStorage.setItem('hci-task-view', value);
  } catch {}
});
onMounted(() => {
  if (serverMode) void loadRemote();
});

const options = computed(() =>
  Object.entries(taskStatuses).map(([value, item]) => {
    let count = props.tasks.filter((t) => taskStatus(t) === value).length;
    if (serverMode) {
      count =
        value === 'waiting'
          ? statusCounts.value.running || 0
          : statusCounts.value[value] || 0;
    }
    return {
      value,
      label: `${item.label}（${count}）`,
    };
  }),
);
const live = (t: Task) =>
  t.mode === 'live' || !!t.cloudJobId || /真实研究|独立站发现/.test(t.title);
const date = (value: string) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('zh-CN', { hour12: false })
    : '—';
const columns = [
  { title: '任务', key: 'title', width: 280 },
  { title: '覆盖市场', key: 'market', width: 140 },
  { title: '状态', key: 'status', width: 125 },
  { title: '总进度 / 结果与原因', key: 'progress', width: 290 },
  { title: '提交时间', key: 'created', width: 165 },
  { title: '操作', key: 'actions', width: 200, fixed: 'right' as const },
];
</script>
<template>
  <div class="task-toolbar">
    <Input.Search
      v-model:value="search"
      placeholder="搜索任务编号或内容"
      aria-label="搜索任务"
      allow-clear
      @search="applySearch"
    />
    <Select
      v-model:value="status"
      :options="options"
      mode="multiple"
      :max-tag-count="2"
      placeholder="全部任务状态"
      aria-label="筛选任务状态"
      allow-clear
    />
    <Button @click="resetFilters"> 重置筛选 </Button>
    <Button
      v-if="serverMode"
      :loading="loading"
      aria-label="刷新任务列表"
      @click="loadRemote"
    >
      刷新本页
    </Button>
    <Radio.Group v-model:value="view" aria-label="任务视图">
      <Radio.Button value="list">列表</Radio.Button>
      <Radio.Button value="cards">卡片</Radio.Button>
    </Radio.Group>
  </div>
  <div class="task-list-note">
    <span role="status">共 {{ total }} 项任务</span>
    <span v-if="activeJobs.length">
      进行中 {{ activeJobs.length }} 项；当前优先
      <code>{{ activeJobs[0]?.id }}</code>
    </span>
    <span>同一后台任务的多个市场合并展示；进度为整项任务合计。</span>
  </div>
  <p v-if="listError" class="task-list-error" role="alert">{{ listError }}</p>
  <p v-if="loading && hasLoaded" class="hci-subtle" role="status">正在更新任务进度，当前列表可继续查看。</p>
  <Spin :spinning="loading && !hasLoaded">
    <Table
      v-if="view === 'list'"
      :data-source="visible"
      :columns="columns"
      row-key="id"
      :pagination="false"
      :scroll="{ x: 1220 }"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-for="task in [record as TaskGroup]" :key="task.id">
          <template v-if="column.key === 'title'">
            <Button
              type="link"
              class="task-name"
              @click="emit('details', task)"
            >
              {{ taskTitle(task) }}
            </Button>
            <div class="task-id">
              {{ task.cloudJobId || task.id }}
            </div>
          </template>
          <template v-if="column.key === 'market'">
            <Tag v-for="market in task.markets" :key="market">
              {{ market === 'ALL' ? '市场未记录' : marketName(market) }}
            </Tag>
          </template>
          <template v-if="column.key === 'status'">
            <Tag :color="taskStatuses[taskStatus(task)]?.color">
              {{ taskStatuses[taskStatus(task)]?.label }}
            </Tag>
          </template>
          <template v-if="column.key === 'progress'">
            <div>{{ taskSummary(task).label }}</div>
            <Progress
              v-if="taskSummary(task).percent !== null"
              :percent="taskSummary(task).percent!"
              :stroke-color="taskSummary(task).color"
              :status="
                ['partial', 'cancelled', 'failed'].includes(task.status)
                  ? 'exception'
                  : 'normal'
              "
              size="small"
            />
            <div class="task-result">
              {{ taskSummary(task).result }}
            </div>
          </template>
          <template v-if="column.key === 'created'">
            {{ date(task.created) }}
          </template>
          <template v-if="column.key === 'actions'">
            <div class="task-actions">
              <Button size="small" @click="emit('details', task)">
                查看详情
</Button><Button
                v-if="
                  !task.readOnly &&
                  ['queued', 'running', 'partial'].includes(task.status) &&
                  (task.cloudJobId || !live(task))
                "
                size="small"
                @click="emit('cancel', task)"
              >
                取消
</Button><Button
                v-if="
                  !task.readOnly &&
                  task.cloudJobId &&
                  partialTaskCanContinue(task)
                "
                size="small"
                :loading="resuming === task.cloudJobId"
                :disabled="!!resuming && resuming !== task.cloudJobId"
                @click="emit('continue', task)"
              >
                继续采集
</Button><Button
                v-if="task.status === 'queued' && !live(task)"
                size="small"
                @click="emit('run', task)"
              >
                模拟执行
</Button><Button
                v-if="
                  !task.readOnly &&
                  [
                    'failed',
                    'cancelled',
                    'completed',
                    'awaiting_review',
                  ].includes(task.status)
                "
                size="small"
                @click="
                  live(task) ? emit('research', task) : emit('retry', task)
                "
              >
                {{ live(task) ? '重新研究' : '重试' }}
</Button><Button
                v-if="
                  task.cloudJobId &&
                  task.progress?.terminal &&
                  task.progress.failed > 0
                "
                size="small"
                :loading="retrying === task.cloudJobId"
                :disabled="!!retrying && retrying !== task.cloudJobId"
                @click="emit('trends', task)"
              >
                重试未完成趋势
              </Button>
            </div>
          </template>
        </template>
</template><template #emptyText>
        <Empty description="没有符合条件的任务" />
      </template>
    </Table>
    <div v-else class="task-cards">
      <Empty v-if="!visible.length" description="没有符合条件的任务" />
      <article v-for="task in visible" :key="task.id" class="task-card">
        <div class="task-card-head">
          <h3>{{ taskTitle(task) }}</h3>
          <Tag :color="taskStatuses[taskStatus(task)]?.color">
            {{ taskStatuses[taskStatus(task)]?.label }}
          </Tag>
        </div>
        <div class="task-card-meta">
          <span>{{
            task.markets
              .map((market) =>
                market === 'ALL' ? '市场未记录' : marketName(market),
              )
              .join(' / ')
          }}</span><time>{{ date(task.created) }}</time>
        </div>
        <div>{{ taskSummary(task).label }}</div>
        <Progress
          v-if="taskSummary(task).percent !== null"
          :percent="taskSummary(task).percent!"
          :stroke-color="taskSummary(task).color"
          :status="
            ['partial', 'cancelled', 'failed'].includes(task.status)
              ? 'exception'
              : 'normal'
          "
          size="small"
        />
        <p class="task-result">{{ taskSummary(task).result }}</p>
        <div class="task-id">{{ task.cloudJobId || task.id }}</div>
        <div class="task-actions">
          <Button size="small" @click="emit('details', task)">查看详情</Button><Button
            v-if="
              !task.readOnly &&
              ['queued', 'running', 'partial'].includes(task.status) &&
              (task.cloudJobId || !live(task))
            "
            size="small"
            @click="emit('cancel', task)"
          >
            取消
</Button><Button
            v-if="
              !task.readOnly && task.cloudJobId && partialTaskCanContinue(task)
            "
            size="small"
            :loading="resuming === task.cloudJobId"
            :disabled="!!resuming && resuming !== task.cloudJobId"
            @click="emit('continue', task)"
          >
            继续采集
</Button><Button
            v-if="task.status === 'queued' && !live(task)"
            size="small"
            @click="emit('run', task)"
          >
            模拟执行
</Button><Button
            v-if="
              !task.readOnly &&
              ['failed', 'cancelled', 'completed', 'awaiting_review'].includes(
                task.status,
              )
            "
            size="small"
            @click="live(task) ? emit('research', task) : emit('retry', task)"
          >
            {{ live(task) ? '重新研究' : '重试' }}
</Button><Button
            v-if="
              task.cloudJobId &&
              task.progress?.terminal &&
              task.progress.failed > 0
            "
            size="small"
            :loading="retrying === task.cloudJobId"
            @click="emit('trends', task)"
          >
            重试未完成趋势
          </Button>
        </div>
      </article>
    </div>
  </Spin>
  <Pagination
    v-model:current="page"
    v-model:page-size="size"
    :total="total"
    :page-size-options="['10', '20', '50', '100']"
    show-size-changer
    class="task-pagination"
    @change="
      (p, s) => {
        page = p;
        size = s;
      }
    "
  />
</template>
<style scoped>
.task-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 4px 0 16px;
}

.task-toolbar :deep(.ant-input-affix-wrapper) {
  width: 260px;
}

.task-toolbar :deep(.ant-select) {
  flex: 1;
  min-width: 220px;
  max-width: 360px;
}

.task-toolbar :deep(.ant-radio-group) {
  margin-left: auto;
}

.task-list-note {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
  margin-bottom: 16px;
  font-size: 13px;
  color: #64748b;
}

.task-list-note code {
  font-size: 12px;
}

.task-list-error {
  margin: 0 0 12px;
  color: #b42318;
}

.task-name {
  height: auto;
  padding: 0;
  font-weight: 600;
  text-align: left;
  white-space: normal;
}

.task-id {
  margin-top: 6px;
  font-size: 11px;
  color: #64748b;
  overflow-wrap: anywhere;
}

.task-result {
  display: -webkit-box;
  margin-top: 6px;
  overflow: hidden;
  -webkit-line-clamp: 2;
  font-size: 12px;
  color: #64748b;
  -webkit-box-orient: vertical;
}

.task-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-pagination {
  margin-top: 20px;
  text-align: right;
}

.task-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.task-card {
  padding: 20px;
  background: var(--hci-panel, #fff);
  border: 1px solid var(--hci-border, #e2e8f0);
  border-radius: 10px;
}

.task-card-head,
.task-card-meta {
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

.task-card-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.task-card-meta {
  flex-wrap: wrap;
  margin: 12px 0 20px;
  font-size: 12px;
  color: #64748b;
}

.task-card .task-actions {
  margin-top: 16px;
}

@media (max-width: 600px) {
  .task-toolbar :deep(.ant-input-affix-wrapper),
  .task-toolbar :deep(.ant-select) {
    flex: auto;
    width: 100%;
    max-width: none;
  }

  .task-cards {
    grid-template-columns: 1fr;
  }

  .task-pagination {
    text-align: left;
  }
}
</style>
