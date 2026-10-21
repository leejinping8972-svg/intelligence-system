<script setup lang="ts">
import type { Keyword } from '../data';

import { computed, ref } from 'vue';

import { Modal, Tag } from 'ant-design-vue';

import { trendOption } from '../charts';
import { marketName } from '../data';
import Chart from './Chart.vue';
import GoogleTrendInsights from './GoogleTrendInsights.vue';
import KeywordTrendComparison from './KeywordTrendComparison.vue';

const props = defineProps<{ keyword: Keyword }>();
const open = ref(false);
const dateRange = computed(() => {
  const points = props.keyword.trendPoints || [];
  if (points.length === 0) return '日期范围未记录';
  return `${points[0]?.date || '—'} 至 ${points.at(-1)?.date || '—'}`;
});
</script>

<template>
  <button type="button" class="hci-link" @click="open = true">
    查看一年曲线
  </button>
  <Modal
    v-model:open="open"
    width="min(1040px, calc(100vw - 32px))"
    :footer="null"
    destroy-on-close
  >
    <template #title>{{ keyword.term }} · 一年趋势</template>
    <div class="trend-dialog-body">
      <div class="trend-dialog-meta">
        <div>
          <b>{{ marketName(keyword.market) }}</b>
          <span>Google Trends 相对搜索热度 · {{ dateRange }}</span>
        </div>
        <Tag :color="keyword.dataNature === 'collected' ? 'green' : 'orange'">
          {{ keyword.dataNature === 'collected' ? '真实采集' : '非实采数据' }}
        </Tag>
      </div>
      <Chart
        :options="trendOption(keyword, 365)"
        :aria-label="`${keyword.term} 过去一年 Google Trends 相对搜索热度曲线`"
        class="trend-dialog-chart"
      />
      <KeywordTrendComparison :keyword="keyword" />
      <p class="hci-subtle trend-dialog-note">
        0–100
        是同一查询中的相对热度，不代表搜索次数；不同国家、不同查询批次不能直接比较绝对需求。
      </p>
      <GoogleTrendInsights :keyword="keyword" />
    </div>
  </Modal>
</template>

<style scoped>
.trend-dialog-body {
  display: grid;
  gap: 16px;
  max-height: min(76vh, 900px);
  padding-right: 4px;
  overflow-y: auto;
}

.trend-dialog-meta {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  justify-content: space-between;
}

.trend-dialog-meta div {
  display: grid;
  gap: 4px;
}

.trend-dialog-meta span,
.trend-dialog-note {
  color: var(--ant-color-text-secondary, #66737d);
}

.trend-dialog-chart {
  min-height: 340px;
}

.trend-dialog-note {
  margin: 0;
}

@media (max-width: 720px) {
  .trend-dialog-chart {
    min-height: 260px;
  }
}
</style>
