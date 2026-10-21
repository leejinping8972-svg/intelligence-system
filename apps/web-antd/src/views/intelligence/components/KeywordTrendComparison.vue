<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Tooltip } from 'ant-design-vue';

import {
  formatTrendComparison,
  fourPeriodComparisons,
} from '../trend-comparison';
const props = defineProps<{ keyword: Keyword }>();
const comparisons = computed(() => fourPeriodComparisons(props.keyword));
const capturedAt = computed(() => props.keyword.trendDailyCollectedAt || props.keyword.trendCollectedAt || props.keyword.trendHistoryCollectedAt);
</script>
<template>
  <div class="keyword-trend-comparison">
    <Tooltip
      v-for="value in comparisons"
      :key="value.key"
      :title="`${value.reason}；${value.start ? `${value.start} 至 ${value.end}` : '待采集'}。Google按原始UTC日期，本周从周一、本月从1日起，比较上一周/月同期；近3/6个月比较此前等长周期。热度为原始查询尺度0–100的日数加权均值，非搜索量。不同来源不比较绝对值。`"
    >
      <p
        :class="
          value.change === null
            ? 'hci-subtle'
            : value.change >= 0
              ? 'hci-positive'
              : 'hci-negative'
        "
      >
        {{ formatTrendComparison(value) }}
      </p>
    </Tooltip>
    <span v-if="capturedAt" class="hci-subtle">
      截至 {{ new Date(capturedAt).toLocaleDateString('zh-CN', { timeZone: 'UTC' }) }}
    </span>
  </div>
</template>
<style scoped>
.keyword-trend-comparison {
  font-variant-numeric: tabular-nums;
}

.keyword-trend-comparison p {
  margin: 2px 0;
  white-space: nowrap;
}
</style>
