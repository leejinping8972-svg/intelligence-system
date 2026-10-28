<script setup lang="ts">
import type { Task } from '../data';

import { computed } from 'vue';

import { Alert, Tag } from 'ant-design-vue';
const props = defineProps<{ task: Task }>();
const rows = computed(() => props.task.collections || []);
const labels: Record<string, string> = {
  running: '进行中',
  done: '请求完成',
  started: '请求进行中',
  skipped: '已跳过',
  unknown: '结果未确认',
  submitted: '已提交，等待执行',
  queued: '等待执行',
  unsupported: '来源不支持',
  not_executed: '尚未执行',
  not_found: '未找到商品',
  budget_truncated: '预算不足，未完成',
  quantity_reached: '达到本次数量上限',
  pending: '等待执行',
  not_started: '停止时尚未执行',
  retry_wait: '等待重试',
  retrying: '等待重试',
  completed: '采集完成',
  collected: '采集完成',
  no_signal: '已返回零热度',
  empty: '未返回商品',
  partial: '未采集完整',
  blocked: '受限停止',
  failed: '采集失败',
  processed: '已处理，见执行记录',
  limited: '限流未完成',
  in_progress: '采集中',
  cancelled: '已取消',
};
const date = (v?: string) =>
  v && Number.isFinite(Date.parse(v))
    ? new Date(v).toLocaleString('zh-CN', { hour12: false })
    : '时间未记录';
</script>
<template>
  <section class="collection-details">
    <h3>各项采集任务（{{ rows.length }}）</h3>
    <Alert
      v-if="!rows.length"
      type="info"
      message="此历史任务未保存逐项进度，下方保留原执行记录。"
    />
    <details v-for="row in rows" :key="row.id" class="collection-row">
      <summary>
        <strong>{{ row.title }}</strong>
        <Tag
          :color="
            ['failed', 'partial', 'blocked', 'limited'].includes(row.status)
              ? 'orange'
              : row.status === 'running'
                ? 'blue'
                : 'default'
          "
        >
          {{ labels[row.status] || row.status }}
        </Tag>
        <span>{{ row.done }}/{{ row.total }}</span>
        <span v-if="row.message" class="reason">{{ row.message }}</span>
      </summary>
      <h4>采集执行记录</h4>
      <p v-if="!row.executions.length" class="hci-subtle">
        没有保存可关联到本项的逐次请求记录；不补造历史记录。
      </p>
      <div
        v-for="(event, index) in row.executions"
        :key="index"
        class="execution"
      >
        <span>{{ date(event.at) }}</span
        ><Tag>
          {{ event.httpStatus || labels[event.status || ''] || event.status }}
        </Tag>
        <p>{{ event.step }}</p>
        <p v-if="event.message">{{ event.message }}</p>
      </div>
    </details>
  </section>
</template>
<style scoped>
.collection-details {
  margin-top: 24px;
}

.collection-row {
  padding: 14px 0;
  border-bottom: 1px solid #e2e8f0;
}

summary {
  line-height: 1.9;
  overflow-wrap: anywhere;
  cursor: pointer;
}

summary strong {
  margin-right: 12px;
}

.reason {
  display: block;
  margin-left: 18px;
  color: #64748b;
}

.execution {
  padding: 8px 12px;
  margin: 10px 0 10px 18px;
  overflow-wrap: anywhere;
  background: #f8fafc;
}

h4 {
  margin-top: 12px;
}
</style>
