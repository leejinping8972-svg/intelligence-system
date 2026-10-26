<script setup lang="ts">
import type { EchartsUIType } from '@vben/plugins/echarts';

import type { SourceUsageSnapshot, UsageSource } from '../source-usage';

import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { createIconifyIcon } from '@vben/icons';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Pagination,
  Progress,
  Select,
  Skeleton,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { adminRequest, session } from '../session';
import { billingLabels, usageNumber, usageStep, usageTime } from '../source-usage';

const RefreshIcon = createIconifyIcon('lucide:refresh-cw');
const SettingsIcon = createIconifyIcon('lucide:settings-2');
const SearchIcon = createIconifyIcon('lucide:search');
const ArrowIcon = createIconifyIcon('lucide:arrow-up-right');
const data = ref<SourceUsageSnapshot>();
const busy = ref(false);
const error = ref('');
const days = ref(14);
const sourceId = ref('');
const billing = ref('');
const query = ref('');
const dateRange = ref<[string, string]>();
const undated = ref(false);
const page = ref(1);
const selected = ref<UsageSource>();
const manualRemaining = ref<number>();
const manualTotal = ref<number>();
const expiresAt = ref<string>();
const preferManual = ref(false);
const saving = ref(false);
const quotaBusy = ref(false);
const chartRef = ref<EchartsUIType>();
const { renderEcharts } = useEcharts(chartRef);
const chartSource = ref('semrush');
const chartProvider = computed(() =>
  data.value?.sources.find((s) => s.id === chartSource.value),
);
const isAdmin = computed(() => session.user?.role === 'admin');
const options = computed(
  () => data.value?.sources.map((s) => ({ label: s.name, value: s.id })) || [],
);
const activeToday = computed(
  () => data.value?.sources.filter((s) => s.today > 0).length || 0,
);
const unknownCount = computed(
  () =>
    (data.value?.sources.reduce((sum, s) => sum + s.unknown, 0) || 0) +
    (data.value?.unattributed || 0),
);
const totals = computed(() => [
  {
    label: '已配置来源',
    value: `${data.value?.sources.filter((s) => s.configured).length || 0} / ${data.value?.sources.length || 0}`,
  },
  { label: '今日已确认消耗', value: `${activeToday.value} 个来源` },
  { label: '扣费待确认', value: `${unknownCount.value} 条` },
  { label: '历史未定日期', value: `${data.value?.undated || 0} 条` },
]);
let revision = 0;
async function load() {
  if (!isAdmin.value) return;
  const current = ++revision;
  busy.value = true;
  error.value = '';
  try {
    const result = await adminRequest<SourceUsageSnapshot>(
      'server_source_usage',
      {
        days: days.value,
        sourceId: sourceId.value,
        billing: billing.value,
        query: query.value.trim(),
        page: page.value,
        undated: undated.value,
        ...(dateRange.value
          ? { start: dateRange.value[0], end: dateRange.value[1] }
          : {}),
      },
    );
    if (current === revision) {
      data.value = result;
      await draw();
    }
  } catch (cause) {
    if (current === revision)
      error.value = cause instanceof Error ? cause.message : '消耗记录读取失败';
  } finally {
    if (current === revision) busy.value = false;
  }
}
async function draw() {
  await nextTick();
  if (!data.value) return;
  const provider = chartProvider.value;
  renderEcharts({
    animation: false,
    grid: { top: 24, right: 24, bottom: 30, left: 64 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v: unknown) => `${v} ${provider?.unit || ''}`,
    },
    xAxis: {
      type: 'category',
      data: data.value.daily.map((d) => d.day.slice(5)),
      boundaryGap: true,
    },
    yAxis: {
      type: 'value',
      min: 0,
      name: provider?.unit,
      splitLine: { lineStyle: { color: '#e8edf1' } },
    },
    series: [
      {
        name: '已确认消耗',
        type: 'bar',
        barMaxWidth: 26,
        itemStyle: { color: '#17856d', borderRadius: [3, 3, 0, 0] },
        data: data.value.daily.map((d) => {
          const point = d.sources.find((s) => s.sourceId === chartSource.value);
          return point?.unknown && !point.amount ? null : point?.amount || 0;
        }),
      },
    ],
  });
}
async function applyFilters() {
  page.value = 1;
  await load();
}
function openSource(source: UsageSource) {
  selected.value = source;
  manualRemaining.value = source.manualQuota?.remaining ?? undefined;
  manualTotal.value = source.manualQuota?.total ?? undefined;
  expiresAt.value = source.manualQuota?.expiresAt || undefined;
  preferManual.value = source.preferManual;
}
async function saveQuota() {
  if (!selected.value || saving.value) return;
  saving.value = true;
  try {
    await adminRequest('server_source_quota_save', {
      sourceId: selected.value.id,
      remaining: manualRemaining.value ?? null,
      total: manualTotal.value ?? null,
      expiresAt: expiresAt.value,
      preferManual: preferManual.value,
    });
    message.success('额度登记已保存');
    await load();
    selected.value = data.value?.sources.find(
      (s) => s.id === selected.value?.id,
    );
  } catch (cause) {
    message.error(cause instanceof Error ? cause.message : '保存失败');
  } finally {
    saving.value = false;
  }
}
async function refreshQuota(source: UsageSource, quiet = false) {
  if (quotaBusy.value) return;
  quotaBusy.value = true;
  try {
    const result = await adminRequest<{ available: boolean; message: string }>(
      'server_source_quota_refresh',
      { sourceId: source.id },
    );
    if (!quiet) {
      if (result.available) message.success(result.message);
      else message.warning(result.message);
    }
  } catch (cause) {
    if (!quiet)
      message.error(cause instanceof Error ? cause.message : '余额读取失败');
  } finally {
    quotaBusy.value = false;
  }
  if (!quiet) {
    await load();
    if (selected.value)
      selected.value = data.value?.sources.find(
        (s) => s.id === selected.value?.id,
      );
  }
}
async function closeEditor() {
  selected.value = undefined;
  await load();
}
function spend(value: number, unknown: number, records: number) {
  return !records
    ? '未记录'
    : unknown && !value
      ? '待确认'
      : `${usageNumber(value)}${unknown ? '+' : ''}`;
}
async function viewDetails(source: UsageSource) {
  sourceId.value = source.id;
  chartSource.value = source.id;
  undated.value = false;
  query.value = '';
  billing.value = '';
  await applyFilters();
  document
    .querySelector('#source-usage-details')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function filterTask(jobId: string) {
  query.value = jobId;
  sourceId.value = '';
  await applyFilters();
}
watch(chartSource, () => void draw());
onMounted(async () => {
  await load();
  for (const source of data.value?.sources || [])
    if (source.automatic && source.configured && !source.quota)
      await refreshQuota(source, true);
  await load();
});
</script>

<template>
  <section class="source-dashboard" aria-label="数据源消耗看板">
    <Alert
      v-if="!isAdmin"
      type="info"
      message="数据源配置与消耗记录仅管理员可查看"
      show-icon
    />
    <template v-else>
      <div class="source-heading">
        <div>
          <h2>数据源消耗看板</h2>
          <p>
            全部市场 · 账户额度 · 北京时间 ·
            {{
              data?.checkedAt
                ? `更新于 ${usageTime(data.checkedAt)}`
                : '正在读取'
            }}
          </p>
        </div>
        <Tooltip title="刷新系统消耗记录">
<Button :loading="busy" aria-label="刷新消耗记录" @click="load">
<template #icon><RefreshIcon /></template>
</Button>
</Tooltip>
      </div>
      <Alert
        v-if="error"
        :message="error"
        description="已有数据保留为上次结果"
        type="error"
        show-icon
      />
      <div class="source-overview">
        <div v-for="item in totals" :key="item.label">
          <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
        </div>
      </div>
      <Skeleton v-if="!data && busy" active :paragraph="{ rows: 5 }" />
      <div class="source-grid">
        <article
          v-for="source in data?.sources"
          :key="source.id"
          class="source-card"
          :data-source="source.id"
        >
          <button
            class="source-card-open"
            :aria-label="`编辑 ${source.name} 配置`"
            @click="openSource(source)"
          >
            <div class="source-card-heading">
              <span class="source-mark" :class="`source-mark-${source.id}`">{{
                source.mark
              }}</span>
              <h3>{{ source.name }}</h3>
              <SettingsIcon class="source-edit" />
            </div>
            <div class="source-status">
              <Tag
                :color="source.free || source.configured ? 'green' : 'default'"
                >
{{
                  source.free
                    ? '公开来源'
                    : source.inactive
                      ? '导入 / 待接入'
                      : source.configured
                        ? '已配置'
                        : '待配置'
                }}
</Tag><span>{{ source.unit }}</span>
            </div>
            <p class="source-description">{{ source.description }}</p>
            <div class="source-metrics">
              <div>
                <span>今日消耗</span><strong>{{
                  spend(source.today, source.todayUnknown, source.records)
                }}</strong>
              </div>
              <div>
                <span>累计消耗</span><strong>{{
                  spend(source.cumulative, source.unknown, source.records)
                }}</strong>
              </div>
              <div>
                <span>剩余额度</span><strong
                  :class="{ 'source-warning': source.quota?.remaining === 0 }"
                  >{{ usageNumber(source.quota?.remaining) }}</strong>
              </div>
            </div>
            <Progress
              v-if="source.quota?.total && source.quota.remaining !== null"
              :percent="
                Math.max(
                  0,
                  Math.min(
                    100,
                    100 - (source.quota.remaining / source.quota.total) * 100,
                  ),
                )
              "
              :show-info="false"
              :stroke-color="
                source.quota.remaining / source.quota.total < 0.1
                  ? '#c67714'
                  : '#17856d'
              "
              size="small"
            />
            <div class="source-quota-note">
              {{
                source.quota
                  ? `${source.quota.origin === 'manual' ? '手动登记' : '账户快照'} · ${usageTime(source.quota.updatedAt)}`
                  : source.free
                    ? '公开接口 · 未设置额度'
                    : source.quotaMessage
              }}<span v-if="source.quota?.expiresAt">
                · 到期 {{ source.quota.expiresAt }}</span>
            </div>
          </button>
          <div class="source-card-footer">
            <span :class="{ 'source-warning': source.unknown }">{{
              source.unknown
                ? `${source.unknown} 条扣费待确认`
                : source.cached
                  ? `${source.cached} 条缓存复用`
                  : '仅已确认消耗'
            }}</span><Button type="link" size="small" @click="viewDetails(source)">
消耗明细<ArrowIcon />
</Button>
          </div>
        </article>
      </div>
      <div class="source-trend">
        <div class="source-heading">
          <div>
            <h2>每日消耗</h2>
            <p>
              {{ chartProvider?.name }} · {{ chartProvider?.unit }} ·
              {{ data?.start }} 至 {{ data?.end }}
            </p>
          </div>
          <Select
            v-model:value="chartSource"
            aria-label="趋势数据源"
            :options="options"
            class="source-select"
          />
        </div>
        <EchartsUI ref="chartRef" class="source-chart" />
        <p v-if="chartProvider?.unknown" class="source-coverage">
          {{ chartProvider.unknown }} 条记录扣费待确认，图表仅展示已确认部分。
        </p>
      </div>
      <div class="source-detail" id="source-usage-details">
        <div class="source-heading">
          <h2>消耗明细</h2>
          <span>{{ data?.total || 0 }} 条记录</span>
        </div>
        <div class="source-filters">
          <Select
            v-model:value="sourceId"
            aria-label="筛选数据源"
            :options="[
              { label: '全部数据源', value: '' },
              ...options,
              { label: '来源待核验', value: 'unattributed' },
            ]"
            class="source-select"
            @change="applyFilters"
          />
          <Select
            v-model:value="days"
            aria-label="统计时间范围"
            :options="
              [7, 14, 30, 90].map((d) => ({ label: `近 ${d} 天`, value: d }))
            "
            @change="
              dateRange = undefined;
              applyFilters();
            "
          />
          <DatePicker.RangePicker
            v-model:value="dateRange"
            value-format="YYYY-MM-DD"
            :disabled="undated"
            @change="applyFilters"
          />
          <Select
            v-model:value="billing"
            aria-label="扣费状态"
            :options="[
              { label: '全部状态', value: '' },
              ...Object.entries(billingLabels).map(([value, label]) => ({
                label,
                value,
              })),
            ]"
            @change="applyFilters"
          />
          <Input.Search
            v-model:value="query"
            placeholder="任务名称、编号或环节"
            aria-label="搜索任务或环节"
            :maxlength="160"
            @search="applyFilters"
            >
<template #prefix><SearchIcon /></template>
</Input.Search>
          <Checkbox v-model:checked="undated" @change="applyFilters">
历史未定日期
</Checkbox>
        </div>
        <p class="source-coverage">{{ data?.coverage }}</p>
        <div class="source-table-scroll" :aria-busy="busy">
          <table class="source-table">
            <thead>
              <tr>
                <th>发生时间</th>
                <th>数据源</th>
                <th>任务 / 编号</th>
                <th>产生环节</th>
                <th>消耗</th>
                <th>扣费状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in data?.entries" :key="entry.id">
                <td>{{ usageTime(entry.at) }}</td>
                <td>
                  {{ data?.sources.find((s) => s.id === entry.sourceId)?.name || '来源待核验' }}
                </td>
                <td>
                  <strong>{{ entry.task }}</strong><Tooltip :title="`按该任务筛选消耗：${entry.jobId}`">
<button
                      class="source-task-link"
                      :disabled="!entry.jobId"
                      @click="filterTask(entry.jobId)"
                    >
                      {{ entry.jobId || '未记录任务编号'
                      }}<SearchIcon />
</button>
</Tooltip>
                </td>
                <td>
                  <span>{{ usageStep(entry) }}</span><small v-if="usageStep(entry) !== entry.step">{{ entry.step }}</small><small>{{ entry.market }} · {{ entry.status }}</small>
                </td>
                <td class="source-amount">
                  {{
                    entry.amount === null
                      ? '待确认'
                      : `${usageNumber(entry.amount)} ${data?.sources.find((s) => s.id === entry.sourceId)?.unit || ''}`
                  }}
                </td>
                <td>
                  <Tag
                    :color="
                      entry.billing === 'unknown' || entry.billing === 'partial'
                        ? 'orange'
                        : entry.billing === 'cached'
                          ? 'default'
                          : 'green'
                    "
                    >
{{ billingLabels[entry.billing] }}
</Tag>
                </td>
              </tr>
            </tbody>
          </table>
          <Empty
            v-if="data && !data.entries.length"
            description="当前筛选下没有记录"
            :image="Empty.PRESENTED_IMAGE_SIMPLE"
          />
        </div>
        <Pagination
          v-model:current="page"
          :total="data?.total || 0"
          :page-size="25"
          :show-size-changer="false"
          show-less-items
          @change="load"
        />
      </div>
      <Modal
        :open="!!selected"
        :title="`${selected?.name || ''} · 配置`"
        :width="800"
        :footer="null"
        :destroy-on-close="true"
        @cancel="closeEditor"
      >
        <template v-if="selected">
          <p class="source-modal-intro">{{ selected.description }}</p>
          <div class="source-configuration">
            <slot name="configuration" :source-id="selected.id"></slot>
          </div>
          <div class="source-quota-editor">
            <div class="source-heading">
              <h3>
                额度管理 <small>{{ selected.unit }}</small>
              </h3>
              <Button
                v-if="selected.automatic"
                :loading="quotaBusy"
                @click="refreshQuota(selected)"
                >
<template #icon><RefreshIcon /></template>获取账户额度
</Button>
            </div>
            <p class="source-coverage">{{ selected.quotaMessage }}</p>
            <div class="source-current-quota">
              剩余额度
              <strong>{{ usageNumber(selected.quota?.remaining) }}</strong><span v-if="selected.quota">{{
                  selected.quota.origin === 'manual' ? '手动登记' : '账户快照'
                }}
                · {{ usageTime(selected.quota.updatedAt) }}</span>
            </div>
            <Form layout="vertical" @submit.prevent>
              <div class="source-quota-fields">
                <Form.Item label="手动剩余额度">
<InputNumber
                    v-model:value="manualRemaining"
                    aria-label="手动剩余额度"
                    :min="0"
                    :max="Number.MAX_SAFE_INTEGER"
                    placeholder="未获取时填写"
/>
</Form.Item><Form.Item label="总额度（可选）">
<InputNumber
                    v-model:value="manualTotal"
                    aria-label="总额度（可选）"
                    :min="0"
                    :max="Number.MAX_SAFE_INTEGER"
                    placeholder="用于显示消耗比例"
/>
</Form.Item><Form.Item label="到期日期（可选）">
<DatePicker
                    v-model:value="expiresAt"
                    aria-label="到期日期（可选）"
                    value-format="YYYY-MM-DD"
                />
</Form.Item>
              </div>
              <Checkbox v-if="selected.automatic" v-model:checked="preferManual">
优先使用手动登记额度
</Checkbox>
              <p v-if="expiresAt" class="source-coverage">
                额度到期：{{ expiresAt }}
              </p>
              <div class="source-modal-actions">
                <Button type="primary" :loading="saving" @click="saveQuota">
保存额度登记
</Button><Button @click="closeEditor">完成</Button>
              </div>
            </Form>
          </div>
        </template>
      </Modal>
    </template>
  </section>
</template>

<style scoped>
.source-dashboard {
  --source-border: #e2e7ed;
  --source-muted: #687583;
  color: hsl(var(--foreground));
}
.source-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 0 0 16px;
  flex-wrap: wrap;
}
.source-heading h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 650;
}
.source-heading h3 {
  margin: 0;
  font-size: 15px;
}
.source-heading p {
  margin: 4px 0 0;
  color: var(--source-muted);
  font-size: 12px;
}
.source-heading small {
  font-weight: 400;
  color: var(--source-muted);
}
.source-overview {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-bottom: 20px;
  border-block: 1px solid var(--source-border);
  padding-block: 18px;
  background: hsl(var(--background));
}
.source-overview > div {
  padding: 0 22px;
  border-right: 1px solid var(--source-border);
}
.source-overview > div:last-child {
  border: 0;
}
.source-overview span,
.source-overview strong {
  display: block;
}
.source-overview span {
  color: var(--source-muted);
  font-size: 12px;
}
.source-overview strong {
  font-size: 23px;
  font-weight: 600;
  margin-top: 7px;
  font-variant-numeric: tabular-nums;
}
.source-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.source-card {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--source-border);
  background: hsl(var(--background));
  border-radius: 6px;
  overflow: hidden;
  transition: border-color 0.15s;
}
.source-card:hover {
  border-color: #17856d;
}
.source-card-open {
  flex: 1;
  display: block;
  width: 100%;
  text-align: left;
  padding: 18px 18px 10px;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: inherit;
}
.source-card-open:focus-visible {
  outline: 2px solid #17856d;
  outline-offset: -3px;
}
.source-card-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.source-card-heading h3 {
  flex: 1;
  min-width: 0;
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  overflow-wrap: anywhere;
}
.source-mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border-radius: 6px;
  background: #e8f3ee;
  color: #16715e;
  font-size: 11px;
  font-weight: 700;
}
.source-mark-semrush,
.source-mark-firecrawl {
  background: #fff0e8;
  color: #b34c22;
}
.source-mark-scrapecreators,
.source-mark-youtube {
  background: #fcecf0;
  color: #b13b60;
}
.source-mark-analysis,
.source-mark-brave {
  background: #eaf1fd;
  color: #376eb8;
}
.source-edit {
  width: 16px;
  height: 16px;
  color: var(--source-muted);
}
.source-status {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--source-muted);
}
.source-description {
  min-height: 60px;
  font-size: 12px;
  line-height: 20px;
  margin: 10px 0 14px;
  color: var(--source-muted);
}
.source-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.source-metrics span {
  display: block;
  font-size: 11px;
  color: var(--source-muted);
}
.source-metrics strong {
  display: block;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
.source-quota-note {
  min-height: 32px;
  margin-top: 9px;
  color: var(--source-muted);
  font-size: 10px;
  line-height: 16px;
}
.source-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 7px 18px;
  border-top: 1px solid var(--source-border);
  font-size: 11px;
  color: var(--source-muted);
}
.source-card-footer :deep(.ant-btn) {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 0;
}
.source-warning {
  color: #ab650a;
}
.source-trend,
.source-detail {
  margin-top: 26px;
  padding: 20px 0;
  border-top: 1px solid var(--source-border);
}
.source-select {
  width: 190px;
}
.source-chart {
  height: 250px;
  width: 100%;
}
.source-filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.source-filters > :deep(.ant-input-group-wrapper) {
  width: 230px;
}
.source-filters > :deep(.ant-select) {
  min-width: 110px;
}
.source-coverage {
  font-size: 12px;
  color: var(--source-muted);
  margin: 12px 0;
  line-height: 1.7;
}
.source-table-scroll {
  width: 100%;
  overflow-x: auto;
  margin: 16px 0;
}
.source-table {
  width: 100%;
  min-width: 880px;
  border-collapse: collapse;
  text-align: left;
  font-size: 12px;
}
.source-table th {
  padding: 11px 12px;
  background: #f2f5f7;
  font-weight: 500;
  white-space: nowrap;
}
.source-table td {
  padding: 13px 12px;
  vertical-align: top;
  border-bottom: 1px solid var(--source-border);
  max-width: 220px;
  overflow-wrap: anywhere;
}
.source-table td:first-child {
  white-space: nowrap;
}
.source-table strong {
  display: block;
  font-weight: 500;
}
.source-table small {
  display: block;
  color: var(--source-muted);
  margin-top: 4px;
}
.source-task-link {
  display: flex;
  gap: 4px;
  align-items: center;
  color: #287b98;
  background: transparent;
  border: 0;
  padding: 3px 0;
  font-size: 10px;
  text-align: left;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.source-task-link :deep(svg) {
  flex-shrink: 0;
}
.source-amount {
  font-variant-numeric: tabular-nums;
}
.source-modal-intro {
  margin: 10px 0 20px;
  color: #687583;
  line-height: 1.7;
}
.source-configuration :deep(.hci-panel) {
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.source-quota-editor {
  padding-top: 20px;
  margin-top: 20px;
  border-top: 1px solid #e2e7ed;
}
.source-current-quota {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 10px;
  padding-bottom: 15px;
  font-size: 12px;
}
.source-current-quota strong {
  font-size: 24px;
}
.source-current-quota span {
  color: #687583;
}
.source-quota-fields {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}
.source-quota-fields :deep(.ant-input-number),
.source-quota-fields :deep(.ant-picker) {
  width: 100%;
}
.source-modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}
@media (min-width: 1800px) {
  .source-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 1150px) {
  .source-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 650px) {
  .source-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .source-overview {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    row-gap: 18px;
  }
  .source-overview > div {
    padding: 0 12px;
  }
  .source-overview strong {
    font-size: 20px;
  }
  .source-description {
    height: auto;
    min-height: 40px;
  }
  .source-quota-fields {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .source-filters > * {
    max-width: 100%;
  }
  .source-filters :deep(.ant-picker) {
    width: 100%;
  }
}
</style>
