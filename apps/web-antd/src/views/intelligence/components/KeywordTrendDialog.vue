<script setup lang="ts">
import type { Keyword } from '../data';

import { computed, ref } from 'vue';

import { Alert, Button, Modal, Spin, Tag } from 'ant-design-vue';

import { trendOption } from '../charts';
import { loadWorkspaceDetail } from '../cloud-workspace';
import { marketName, state } from '../data';
import { keywordTrendPreview } from '../keyword-trend-preview';
import Chart from './Chart.vue';
import GoogleTrendInsights from './GoogleTrendInsights.vue';
import KeywordTrendComparison from './KeywordTrendComparison.vue';

const props = defineProps<{ keyword: Keyword }>();
const open = ref(false);
const loading = ref(false);
const error = ref('');
const preview = computed(() => keywordTrendPreview(props.keyword));
const keyword = computed(() => open.value ? state.keywords.find((row) => row.id === props.keyword.id) || props.keyword : props.keyword);
async function show() {
  open.value = true;
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try { await loadWorkspaceDetail('keywords', props.keyword.id); }
  catch (cause) { error.value = (cause as Error).message; }
  finally { loading.value = false; }
}
const dateRange = computed(() => {
  const points = keyword.value.trendPoints || [];
  if (points.length === 0) return '日期范围未记录';
  return `${points[0]?.date || '—'} 至 ${points.at(-1)?.date || '—'}`;
});
</script>

<template>
  <button type="button" class="hci-link trend-preview" :aria-label="`${keyword.term} 一年趋势，点击放大`" @click="show">
    <svg v-if="preview.count" viewBox="0 0 168 44" role="img" :aria-label="`${preview.range}，Google 相对热度 0–100`">
      <title>{{ preview.range }} · Google 相对热度 0–100</title>
      <line x1="4" y1="40" x2="164" y2="40" stroke="currentColor" opacity="0.15" />
      <polyline :points="preview.coordinates" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <circle v-if="preview.count === 1" :cx="preview.first?.[0]" :cy="preview.first?.[1]" r="2" fill="currentColor" />
    </svg>
    <span>一年曲线 · 点击放大</span>
  </button>
  <Modal
    v-model:open="open"
    width="min(1040px, calc(100vw - 32px))"
    :footer="null"
    destroy-on-close
  >
    <template #title>{{ keyword.term }} · 一年趋势</template>
    <div v-if="open" class="trend-dialog-body" :aria-busy="loading">
      <Spin v-if="loading" tip="正在加载完整趋势…"><div style="height: 40px"></div></Spin>
      <Alert v-if="error" type="error" :message="error" show-icon><template #action><Button size="small" @click="show">重试</Button></template></Alert>
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
.trend-preview { display: grid; gap: 2px; width: 168px; max-width: 100%; text-align: left; font-size: 12px; }
.trend-preview svg { display: block; width: 100%; height: 44px; color: var(--ant-color-success, #198771); }
.trend-preview:focus-visible { outline: 2px solid var(--ant-color-primary, #1677ff); outline-offset: 2px; }
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
