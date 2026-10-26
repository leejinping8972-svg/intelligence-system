<script setup lang="ts">
import type { Task } from '../data';
import type { TaskGroup } from '../task-list';

import { computed, ref, watch } from 'vue';

import {
  Button,
  Empty,
  Input,
  Pagination,
  Progress,
  Radio,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import { marketName } from '../data';
import { taskStatus, taskStatuses, taskSummary, taskTitle } from '../task-list';
const props = defineProps<{ tasks: TaskGroup[]; retrying: string }>();
const emit = defineEmits<{
  details: [task: TaskGroup];
  cancel: [task: Task];
  run: [task: Task];
  research: [];
  retry: [task: Task];
  trends: [task: Task];
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
const rows = computed(() =>
  props.tasks.filter(
    (t) =>
      (status.value.length === 0 || status.value.includes(taskStatus(t))) &&
      `${taskTitle(t)} ${t.cloudJobId || t.id}`
        .toLowerCase()
        .includes(search.value.toLowerCase().trim()),
  ),
);
const visible = computed(() =>
  rows.value.slice((page.value - 1) * size.value, page.value * size.value),
);
watch([status, search, () => props.tasks.length], () => {
  page.value = 1;
});
watch(view, (value) => {
  try {
    localStorage.setItem('hci-task-view', value);
  } catch {}
});
const options = computed(() =>
  Object.entries(taskStatuses).map(([value, item]) => ({
    value,
    label: `${item.label}（${props.tasks.filter((t) => taskStatus(t) === value).length}）`,
  })),
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
  { title: '流程进度 / 结果', key: 'progress', width: 290 },
  { title: '提交时间', key: 'created', width: 165 },
  { title: '操作', key: 'actions', width: 200, fixed: 'right' as const },
];
</script>
<template>
  <div class="task-toolbar">
    <Input
      v-model:value="search"
      placeholder="搜索任务名称或编号"
      aria-label="搜索任务"
      allow-clear
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
    <Button
      @click="
        status = [];
        search = '';
      "
    >
      重置筛选
    </Button>
    <Radio.Group v-model:value="view" aria-label="任务视图">
      <Radio.Button value="list">列表</Radio.Button>
      <Radio.Button value="cards">卡片</Radio.Button>
    </Radio.Group>
  </div>
  <div class="task-list-note">
    <span role="status">共 {{ rows.length }} 项任务</span><span>同一后台任务的多个市场合并展示；进度为整项任务合计。</span>
  </div>
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
          <Button type="link" class="task-name" @click="emit('details', task)">
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
            :status="task.status === 'cancelled' ? 'normal' : undefined"
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
            <Button size="small" @click="emit('details', task)">查看详情</Button><Button
              v-if="
                !task.readOnly && ['queued', 'running'].includes(task.status) &&
                (task.cloudJobId || !live(task))
              "
              size="small"
              @click="emit('cancel', task)"
            >
              取消
</Button><Button
              v-if="task.status === 'queued' && !live(task)"
              size="small"
              @click="emit('run', task)"
            >
              模拟执行
</Button><Button
              v-if="!task.readOnly && ['partial', 'cancelled'].includes(task.status)"
              size="small"
              @click="live(task) ? emit('research') : emit('retry', task)"
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
</template><template #emptyText><Empty description="没有符合条件的任务" /></template>
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
        <span>{{ task.markets.map((market) => market === 'ALL' ? '市场未记录' : marketName(market)).join(' / ') }}</span><time>{{ date(task.created) }}</time>
      </div>
      <div>{{ taskSummary(task).label }}</div>
      <Progress
        v-if="taskSummary(task).percent !== null"
        :percent="taskSummary(task).percent!"
        size="small"
      />
      <p class="task-result">{{ taskSummary(task).result }}</p>
      <div class="task-id">{{ task.cloudJobId || task.id }}</div>
      <div class="task-actions">
        <Button size="small" @click="emit('details', task)">查看详情</Button><Button
          v-if="
            !task.readOnly && ['queued', 'running'].includes(task.status) &&
            (task.cloudJobId || !live(task))
          "
          size="small"
          @click="emit('cancel', task)"
        >
          取消
</Button><Button
          v-if="task.status === 'queued' && !live(task)"
          size="small"
          @click="emit('run', task)"
        >
          模拟执行
</Button><Button
          v-if="!task.readOnly && ['partial', 'cancelled'].includes(task.status)"
          size="small"
          @click="live(task) ? emit('research') : emit('retry', task)"
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
  <Pagination
    v-model:current="page"
    v-model:page-size="size"
    :total="rows.length"
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
