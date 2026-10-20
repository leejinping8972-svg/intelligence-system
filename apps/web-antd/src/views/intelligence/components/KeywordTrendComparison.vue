<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Tooltip } from 'ant-design-vue';

import { formatTrendComparison, trendComparisons } from '../trend-comparison';
const props = defineProps<{ keyword: Keyword }>();
const comparisons = computed(() => trendComparisons(props.keyword));
</script>
<template>
  <div class="keyword-trend-comparison">
    <Tooltip
      v-for="value in comparisons"
      :key="value.key"
      :title="`${value.reason}；${value.start ? `${value.start} 至 ${value.end}` : '待采集'}。热度为Google Trends原始查询尺度0–100的日数加权均值；变化率使用同次采样的前后期均值。不同采样、不同国家不可直接比较绝对需求。`"
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
