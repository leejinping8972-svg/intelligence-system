<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Alert, Button, Spin, Table, Tag } from 'ant-design-vue';

import { state } from '../data';
import { serverMode } from '../session';
import { useStatistics } from '../statistics-queries';
import CollectionTime from './CollectionTime.vue';

interface WeeklyRow {
  weekStart: string;
  weekEnd: string;
  discoveredProducts: number;
  newProducts: number;
  discoveredAds: number;
  newAds: number;
}
const page = ref(1);
const pageSize = ref(12);
const remote = useStatistics<WeeklyRow>(computed(() => ({
  kind: 'weekly-summary', market: state.market, page: page.value, pageSize: pageSize.value,
})));
const busy = computed(() => serverMode && (remote.loading.value || (!remote.snapshot.value && !remote.error.value)));
const currentWeek = computed(() => {
  // Re-evaluate the calendar label whenever a snapshot arrives, including stale snapshots.
  void remote.snapshot.value;
  return new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
});
const columns = [
  { title: '统计周（北京时间）', key: 'week', width: 280 },
  { title: '新发现产品', dataIndex: 'discoveredProducts', key: 'discoveredProducts', width: 150, align: 'right' as const },
  { title: '新品', dataIndex: 'newProducts', key: 'newProducts', width: 130, align: 'right' as const },
  { title: '新发现广告', dataIndex: 'discoveredAds', key: 'discoveredAds', width: 150, align: 'right' as const },
  { title: '新广告', dataIndex: 'newAds', key: 'newAds', width: 130, align: 'right' as const },
];
watch(() => state.market, () => { page.value = 1; });
function change(pagination: { current?: number; pageSize?: number }) {
  page.value = pagination.pageSize !== pageSize.value ? 1 : pagination.current || 1;
  pageSize.value = pagination.pageSize || 12;
}
</script>

<template>
  <section class="hci-panel weekly-summary" aria-labelledby="weekly-summary-title" :aria-busy="busy">
    <div class="hci-panel-head weekly-summary-head">
      <div>
        <h2 id="weekly-summary-title">每周数据汇总</h2>
        <p>北京时间周一至周日 · 最近一周在前 · 本周持续累计</p>
      </div>
      <Button :loading="remote.loading.value" @click="remote.reload(true)">刷新</Button>
    </div>
    <Alert v-if="remote.error.value" type="error" :message="remote.error.value" show-icon />
    <p v-if="remote.snapshot.value" class="hci-subtle weekly-summary-note">
      汇总更新于 <CollectionTime :at="remote.snapshot.value.generatedAt" />
      <span>· 后台每 5 分钟按已有数据更新</span>
      <span v-if="remote.snapshot.value.indexing">· 后台数据更新中，当前汇总将自动补充</span>
    </p>
    <Table
      row-key="weekStart"
      size="small"
      :columns="columns"
      :data-source="remote.rows.value"
      :loading="remote.loading.value"
      :scroll="{ x: 840 }"
      :pagination="{
        total: remote.total.value, current: remote.pagination.value.page, pageSize,
        showSizeChanger: true, pageSizeOptions: ['12', '26', '52', '100'],
        showTotal: (total: number) => `共 ${total} 周`,
      }"
      @change="change"
    >
      <template #emptyText>
        <div class="weekly-summary-empty" role="status" aria-live="polite">
          <Spin v-if="busy && !remote.loading.value" size="small" />
          <span>{{ !serverMode ? '连接服务后查看每周数据汇总' : remote.error.value ? '每周汇总读取失败，请点击刷新重试' : '正在生成每周汇总，完成后自动显示。' }}</span>
        </div>
      </template>
      <template #bodyCell="{ column, record, text }">
        <span v-if="column.key === 'week'" class="weekly-summary-period">
          {{ record.weekStart }} ～ {{ record.weekEnd }}
          <Tag v-if="record.weekStart <= currentWeek && record.weekEnd >= currentWeek" color="blue">本周</Tag>
        </span>
        <span v-else class="weekly-summary-count">{{ text.toLocaleString('zh-CN') }}</span>
      </template>
    </Table>
    <p class="hci-subtle weekly-summary-rules">
      按首次发现日期归周，重复抓取不重复计数。新品为其中已进入新品池、首次抓取时上架不超过 7 天的产品；新广告为其中首次抓取时开始投放不超过 7 天的广告。日期按北京时间比较，缺少有效日期或来源依据不计入新品 / 新广告；新品池已标注的曝光日期沿用替代口径。
    </p>
  </section>
</template>

<style scoped>
.weekly-summary { min-width: 0; margin-bottom: 20px; }
.weekly-summary-note { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-bottom: 12px; }
.weekly-summary-period { display: inline-flex; align-items: center; gap: 10px; white-space: nowrap; }
.weekly-summary-count { font-variant-numeric: tabular-nums; }
.weekly-summary-empty { display: flex; min-height: 64px; align-items: center; justify-content: center; gap: 8px; }
.weekly-summary-rules { margin-top: 12px; line-height: 1.7; }
@media (max-width: 640px) {
  .weekly-summary-head { align-items: flex-start; gap: 12px; }
  .weekly-summary-head h2 { white-space: nowrap; }
}
</style>
