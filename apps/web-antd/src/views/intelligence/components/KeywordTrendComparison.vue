<script setup lang="ts">
import type { Keyword } from '../data';

import { computed } from 'vue';

import { Tooltip } from 'ant-design-vue';

import {
  formatTrendComparison,
  rollingTrendComparison,
} from '../trend-comparison';
const props = defineProps<{ keyword: Keyword; compact?: boolean }>();
const comparisons = computed(() =>
  [30, 90, 180].map((days) => {
    const fresh = props.keyword.trendRollingSummary?.find(
      (item) => item.label === `近${days}天`,
    );
    if (fresh) return fresh;
    const summary = props.keyword.coreSummary?.periods?.[days as 30 | 90 | 180];
    if (summary) {
      const heat = summary.find((metric) => metric.key === 'relativeHeat');
      const change = summary.find((metric) => metric.key === 'trendChange');
      return {
        key: String(days),
        label: `近${days}天`,
        heat: typeof heat?.value === 'number' ? heat.value : null,
        change: typeof change?.value === 'number' ? change.value : null,
        currentMean: null,
        previousMean: null,
        start: undefined,
        end: undefined,
        reason: heat?.reason || '按等长滚动窗口比较',
      };
    }
    return rollingTrendComparison(props.keyword, days as 30 | 90 | 180);
  }),
);
const capturedAt = computed(
  () =>
    props.keyword.trendDailyCollectedAt ||
    props.keyword.trendCollectedAt ||
    props.keyword.trendHistoryCollectedAt,
);
const visibleComparisons = computed(() =>
  props.compact ? comparisons.value.slice(0, 1) : comparisons.value,
);
const completeSummary = computed(() =>
  comparisons.value.map(formatTrendComparison).join('；'),
);
</script>
<template>
  <div class="keyword-trend-comparison">
    <Tooltip
      v-for="value in visibleComparisons"
      :key="value.key"
      :title="`${completeSummary}；${value.reason}；${value.start ? `${value.start} 至 ${value.end}` : '待采集'}。热度为0–100相对值，非搜索量。`"
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
    <span v-if="capturedAt && !compact" class="hci-subtle">
      截至
      {{
        new Date(capturedAt).toLocaleDateString('zh-CN', { timeZone: 'UTC' })
      }}
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
