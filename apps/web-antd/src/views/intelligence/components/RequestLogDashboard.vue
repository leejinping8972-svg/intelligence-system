<script setup lang="ts">
import type { RequestLogEntry, RequestLogSnapshot } from '../source-usage';

import { computed, onMounted, ref } from 'vue';

import { Alert, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from 'ant-design-vue';

import { adminRequest, session } from '../session';
import { usageTime } from '../source-usage';

const data = ref<RequestLogSnapshot>();
const busy = ref(false);
const error = ref('');
const days = ref(7);
const sourceId = ref('');
const status = ref('');
const query = ref('');
const host = ref('');
const page = ref(1);
const isAdmin = computed(() => session.user?.role === 'admin');
const taskGroups = computed(() => data.value?.byTask.slice(0, 12) || []);
const statusOptions = [
  { label: '全部结果', value: '' },
  { label: '成功', value: 'success' },
  { label: 'HTTP 错误', value: 'http_error' },
  { label: '请求失败', value: 'error' },
  { label: '进行中', value: 'started' },
];

function formatDuration(value: null | number) {
  if (value === null || value === undefined) return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(2)} s`;
}
function formatRate(value: number) {
  return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}/小时`;
}
function outcomeLabel(entry: RequestLogEntry) {
  if (entry.rateLimited) return '429 限流';
  if (entry.outcome === 'http_error') return `HTTP ${entry.httpStatus || '错误'}`;
  if (entry.outcome === 'error') return entry.errorKind || '请求失败';
  if (entry.status === 'started') return '进行中';
  return '成功';
}
function outcomeColor(entry: RequestLogEntry) {
  if (entry.rateLimited || entry.outcome === 'error' || entry.outcome === 'http_error') return 'orange';
  if (entry.status === 'started') return 'blue';
  return 'green';
}
async function load() {
  if (!isAdmin.value) return;
  busy.value = true;
  error.value = '';
  try {
    data.value = await adminRequest<RequestLogSnapshot>('server_source_request_log', {
      days: days.value,
      sourceId: sourceId.value.trim(),
      status: status.value,
      query: query.value.trim(),
      host: host.value.trim(),
      page: page.value,
      pageSize: 50,
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '请求日志读取失败';
  } finally {
    busy.value = false;
  }
}
async function applyFilters() {
  page.value = 1;
  await load();
}
onMounted(() => void load());
</script>

<template>
  <section class="request-log-dashboard" aria-label="请求频率日志">
    <div class="source-heading">
      <div>
        <h2>请求频率日志</h2>
        <p>按任务、来源和目标主机查看实际请求、耗时、重试与 429。</p>
      </div>
      <Button :loading="busy" aria-label="刷新请求日志" @click="load">刷新</Button>
    </div>
    <Alert
      v-if="!isAdmin"
      type="info"
      message="请求日志仅管理员可查看"
      show-icon
    />
    <template v-else>
      <Alert v-if="error" type="error" :message="error" show-icon />
      <Skeleton v-if="!data && busy" active :paragraph="{ rows: 4 }" />
      <template v-if="data">
        <div class="request-log-overview">
          <div><span>请求总数</span><strong>{{ data.summary.requests }}</strong></div>
          <div><span>平均频率</span><strong>{{ formatRate(data.summary.requestsPerHour) }}</strong></div>
          <div><span>429 次数</span><strong class="request-log-warn">{{ data.summary.rateLimited }}</strong></div>
          <div><span>失败 / HTTP 错误</span><strong>{{ data.summary.failed }}</strong></div>
          <div><span>平均耗时</span><strong>{{ formatDuration(data.summary.averageDurationMs) }}</strong></div>
        </div>
        <div class="request-log-filters">
          <Select
            v-model:value="days"
            aria-label="请求日志时间范围"
            :options="[1, 3, 7, 14, 30, 90].map((d) => ({ label: `近 ${d} 天`, value: d }))"
            @change="applyFilters"
          />
          <Select v-model:value="status" aria-label="请求结果" :options="statusOptions" @change="applyFilters" />
          <Input v-model:value="sourceId" placeholder="来源 ID，如 official_sites" aria-label="来源 ID" @press-enter="applyFilters" />
          <Input v-model:value="host" placeholder="目标主机，如 shop.example" aria-label="目标主机" @press-enter="applyFilters" />
          <Input.Search v-model:value="query" placeholder="任务、编号、环节或路径" aria-label="搜索请求日志" @search="applyFilters" />
        </div>
        <p class="source-coverage">{{ data.start }} 至 {{ data.end }} · {{ data.coverage }}</p>
        <div class="request-log-task-grid">
          <div>
            <div class="source-heading"><h3>按任务频率</h3><span>最多显示 12 项</span></div>
            <table class="request-log-table">
              <thead><tr><th>任务</th><th>次数</th><th>频率</th><th>429</th><th>平均耗时</th></tr></thead>
              <tbody>
                <tr v-for="group in taskGroups" :key="group.key">
                  <td>{{ group.key }}</td><td>{{ group.count }}</td><td>{{ formatRate(group.requestsPerHour) }}</td><td>{{ group.rateLimited }}</td><td>{{ formatDuration(group.averageDurationMs) }}</td>
                </tr>
              </tbody>
            </table>
            <Empty v-if="!taskGroups.length" description="当前范围没有请求记录" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
          </div>
          <div>
            <div class="source-heading"><h3>按目标主机</h3><span>最多显示 12 项</span></div>
            <table class="request-log-table">
              <thead><tr><th>主机</th><th>次数</th><th>频率</th><th>失败</th></tr></thead>
              <tbody>
                <tr v-for="group in data.byHost.slice(0, 12)" :key="group.key">
                  <td>{{ group.key || '未记录' }}</td><td>{{ group.count }}</td><td>{{ formatRate(group.requestsPerHour) }}</td><td>{{ group.failed }}</td>
                </tr>
              </tbody>
            </table>
            <Empty v-if="!data.byHost.length" description="当前范围没有主机记录" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
          </div>
        </div>
        <div class="source-heading request-log-detail-heading"><h3>请求明细</h3><span>{{ data.total }} 条</span></div>
        <div class="source-table-scroll" :aria-busy="busy">
          <table class="request-log-table request-log-detail-table">
            <thead><tr><th>开始时间</th><th>任务 / 编号</th><th>来源 / 主机</th><th>路径</th><th>结果</th><th>耗时</th><th>尝试</th></tr></thead>
            <tbody>
              <tr v-for="entry in data.entries" :key="entry.id">
                <td>{{ usageTime(entry.startedAt) }}</td>
                <td><strong>{{ entry.task }}</strong><small>{{ entry.jobId || '未记录任务编号' }} · {{ entry.step }}</small><small v-if="entry.requestId && entry.requestId !== entry.jobId">请求 {{ entry.requestId }}</small></td>
                <td>{{ entry.sourceId }}<small>{{ entry.host || '未记录主机' }}</small></td>
                <td><code>{{ entry.path || '未记录路径' }}</code></td>
                <td><Tag :color="outcomeColor(entry)">{{ outcomeLabel(entry) }}</Tag><small v-if="entry.retryAfterSeconds !== null">冷却 {{ entry.retryAfterSeconds }} 秒</small><small v-if="entry.rateLimitRemaining">剩余 {{ entry.rateLimitRemaining }}</small></td>
                <td>{{ formatDuration(entry.durationMs) }}</td>
                <td>{{ entry.attempt }}{{ entry.retry ? ' · 重试' : '' }}</td>
              </tr>
            </tbody>
          </table>
          <Empty v-if="!data.entries.length" description="当前筛选下没有请求记录" :image="Empty.PRESENTED_IMAGE_SIMPLE" />
        </div>
        <Pagination v-model:current="page" :total="data.total" :page-size="data.pageSize" :show-size-changer="false" show-less-items @change="load" />
      </template>
    </template>
  </section>
</template>

<style scoped>
.request-log-dashboard { margin-top: 28px; padding: 24px; border: 1px solid #dfe8e5; border-radius: 16px; background: #fff; }
.request-log-overview { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
.request-log-overview > div { padding: 14px; border-radius: 10px; background: #f4f8f6; }
.request-log-overview span, .request-log-overview strong { display: block; }
.request-log-overview span { color: #687a75; font-size: 12px; }
.request-log-overview strong { margin-top: 5px; font-size: 20px; }
.request-log-warn { color: #b86b12; }
.request-log-filters { display: grid; grid-template-columns: 130px 130px 1fr 1fr minmax(220px, 1.5fr); gap: 10px; margin: 18px 0 10px; }
.request-log-task-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 20px 0; }
.request-log-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.request-log-table th, .request-log-table td { padding: 9px 8px; border-bottom: 1px solid #edf1ef; text-align: left; vertical-align: top; }
.request-log-table th { color: #687a75; font-size: 12px; font-weight: 600; }
.request-log-table small { display: block; margin-top: 4px; color: #7d8e89; font-size: 11px; }
.request-log-table code { color: #3d5a53; word-break: break-all; }
.request-log-detail-heading { margin-top: 24px; }
.request-log-detail-table { min-width: 980px; }
@media (max-width: 900px) {
  .request-log-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .request-log-filters, .request-log-task-grid { grid-template-columns: 1fr; }
}
</style>
