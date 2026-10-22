<script setup lang="ts">
import { Popover } from 'ant-design-vue';
import type { EvidenceMetric } from '../core-list-metrics';
import {
  metricNatureLabels,
  metricStatusLabels,
  metricText,
} from '../core-list-metrics';
defineProps<{ metric: EvidenceMetric }>();
</script>
<template>
  <Popover trigger="click" :title="metric.label" placement="bottomLeft">
    <template #content>
      <dl class="core-evidence-meta">
        <dt>来源 / 市场</dt>
        <dd>
          {{ metric.source }} · {{ metric.market }} · {{ metric.platform }}
        </dd>
        <dt>单位 / 性质</dt>
        <dd>{{ metric.unit }} · {{ metricNatureLabels[metric.nature] }}</dd>
        <dt>统计周期</dt>
        <dd>{{ metric.period }}</dd>
        <dt>起止 / 时区</dt>
        <dd>
          {{ metric.start || '未知' }} 至 {{ metric.end || '未知' }} ·
          {{ metric.timezone }}
        </dd>
        <dt>采集时间</dt>
        <dd>{{ metric.collectedAt || '未记录' }}</dd>
        <dt>可用状态</dt>
        <dd>
          {{ metricStatusLabels[metric.status] }} ·
          {{ metric.precision || '精度未提供' }}
        </dd>
        <dt>口径 / 缺失原因</dt>
        <dd>{{ metric.reason || '无' }}</dd>
        <dt v-if="metric.evidenceUrl">原始证据</dt>
        <dd v-if="metric.evidenceUrl">
          <a :href="metric.evidenceUrl" target="_blank" rel="noreferrer"
            >查看来源</a
          >
        </dd>
      </dl>
    </template>
    <button
      class="core-metric-cell"
      type="button"
      :aria-label="`${metric.label}：${metricText(metric)}，查看来源与口径`"
    >
      <span class="core-metric-value">{{ metricText(metric) }}</span>
      <small v-if="metric.value !== null"
        >{{ metric.unit }} · {{ metricNatureLabels[metric.nature] }}</small
      >
      <small v-else>{{ metric.reason }}</small>
    </button>
  </Popover>
</template>
<style scoped>
.core-metric-cell {
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 3px 0;
  width: 100%;
  min-width: 0;
}
.core-metric-value {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  font-weight: 500;
}
small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: #687078;
  font-size: 12px;
}
.core-evidence-meta {
  display: grid;
  grid-template-columns: 100px minmax(0, 1fr);
  gap: 7px 12px;
  max-width: min(520px, 80vw);
  margin: 0;
  font-size: 12px;
}
.core-evidence-meta dt {
  color: #687078;
}
.core-evidence-meta dd {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
