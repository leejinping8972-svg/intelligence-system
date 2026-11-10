<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { adjacentTrendPeriods } from '../product-trend-period';

const props = defineProps<{
  points: { date: string; value: number | null; partial?: boolean }[];
  metricLabel: string;
  period?: 'day' | 'month';
}>();
const activeIndex = ref<number | null>(null);
const chart = computed(() => {
  const valid = props.points
    .map((p) => p.value)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const min = valid.length > 0 ? Math.min(...valid) : 0;
  const max = valid.length > 0 ? Math.max(...valid) : 0;
  const range = max - min || 1;
  return {
    min,
    max,
    dots: props.points.map((p, i) => ({
      ...p,
      x: 55 + (i * 600) / Math.max(1, props.points.length - 1),
      y:
        p.value === null || !Number.isFinite(p.value)
          ? null
          : 150 - ((p.value - min) * 115) / range,
    })),
  };
});
const active = computed(() =>
  activeIndex.value === null ? undefined : chart.value.dots[activeIndex.value],
);
const tooltip = computed(() =>
  !active.value || active.value.y === null
    ? undefined
    : {
        x: Math.max(55, Math.min(360, active.value.x - 150)),
        y: Math.max(4, active.value.y - 68),
      },
);
const pointLabel = (point: {
  date: string;
  value: number | null;
  partial?: boolean;
}) =>
  `${point.date} · ${props.metricLabel}：${point.value}${point.partial ? '（可能未完整）' : ''}`;
watch(
  () => [props.points, props.metricLabel],
  () => {
    activeIndex.value = null;
  },
);
</script>

<template>
  <svg
    v-if="chart.dots.some((p) => p.y !== null)"
    viewBox="0 0 700 195"
    role="img"
    :aria-label="`${metricLabel}趋势，详细值见下表`"
    class="product-watch-chart"
    @mouseleave="activeIndex = null"
    @keydown.esc="activeIndex = null"
  >
    <path d="M55 20V155H660" fill="none" stroke="#b8c0cc" />
    <text x="4" y="40" font-size="12" fill="currentColor">{{ chart.max }}</text>
    <text x="4" y="153" font-size="12" fill="currentColor">
      {{ chart.min }}
    </text>
    <template v-for="(point, i) in chart.dots" :key="point.date">
      <line
        v-if="
          i &&
          point.y !== null &&
          chart.dots[i - 1]?.y !== null &&
          adjacentTrendPeriods(
            chart.dots[i - 1]!.date,
            point.date,
            period || 'day',
          )
        "
        :x1="chart.dots[i - 1]?.x"
        :y1="chart.dots[i - 1]?.y ?? 0"
        :x2="point.x"
        :y2="point.y"
        stroke="#4263eb"
        stroke-width="2"
      />
      <g
        v-if="point.y !== null"
        class="trend-point"
        tabindex="0"
        :aria-label="pointLabel(point)"
        @mouseenter="activeIndex = i"
        @mouseleave="activeIndex = null"
        @focus="activeIndex = i"
        @blur="activeIndex = null"
        @click="activeIndex = i"
      >
        <circle :cx="point.x" :cy="point.y" r="10" fill="transparent" />
        <circle
          :cx="point.x"
          :cy="point.y"
          :r="activeIndex === i ? 4.5 : 3"
          :fill="point.partial ? '#d99b28' : '#4263eb'"
        />
      </g>
    </template>
    <text x="55" y="183" font-size="12" fill="currentColor">
      {{ points[0]?.date }}
    </text>
    <text x="660" y="183" text-anchor="end" font-size="12" fill="currentColor">
      {{ points.at(-1)?.date }}
    </text>
    <g
      v-if="active && tooltip"
      role="tooltip"
      class="trend-tooltip"
      :transform="`translate(${tooltip.x},${tooltip.y})`"
    >
      <rect
        width="300"
        :height="active.partial ? 68 : 50"
        rx="5"
        fill="#17233d"
      />
      <text x="10" y="19" fill="white" font-size="12">{{ active.date }}</text>
      <text x="10" y="38" fill="white" font-size="12">
        {{ metricLabel }}：{{ active.value }}
      </text>
      <text v-if="active.partial" x="10" y="57" fill="#ffd591" font-size="12">
        可能未完整
      </text>
    </g>
  </svg>
</template>

<style scoped>
.product-watch-chart {
  width: 100%;
  max-height: 240px;
}
.trend-point {
  cursor: pointer;
  outline: none;
}
.trend-point:focus-visible circle:last-child {
  stroke: #17233d;
  stroke-width: 2;
}
.trend-tooltip {
  pointer-events: none;
}
</style>
