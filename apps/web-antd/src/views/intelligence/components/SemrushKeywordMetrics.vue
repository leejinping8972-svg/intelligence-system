<script setup lang="ts">
import type { Keyword } from '../data';

import { computed, ref } from 'vue';
import { Modal } from 'ant-design-vue';

import { semrushTrendSummary } from '../../../../../../server/semrush-keyword-trends.mjs';
import { semrushMetricRows } from '../semrush-keyword-metrics';

const props = defineProps<{ keyword: Keyword; compact?: boolean }>();
const open = ref(false);
const metrics = computed(() =>
  props.keyword.metrics?.market === props.keyword.market &&
  /Semrush/i.test(props.keyword.metrics.source || '')
    ? props.keyword.metrics
    : undefined,
);
const summary = computed(() =>
  semrushTrendSummary(props.keyword.metrics, props.keyword.market),
);
const rows = computed(() => semrushMetricRows(props.keyword));
const coordinates = computed(() =>
  summary.value.values.map((v, i) => `${4 + i * 14},${44 - v * 0.4}`).join(' '),
);
const percent = (value: number | null) =>
  value === null
    ? '无法计算（此前均值为0）'
    : `${value > 0 ? '+' : ''}${value}%`;
const peak = computed(() =>
  summary.value.peakPositions.length
    ? summary.value.peakPositions
        .map((i) => `第${i}月${i === 12 ? '（最新月）' : ''}`)
        .join('、')
    : '未出现正热度',
);
</script>

<template>
  <template v-if="compact">
    <button
      type="button"
      class="semrush-preview"
      :aria-label="`${keyword.term} Semrush月度趋势，查看指标`"
      @click="open = true"
    >
      <svg
        v-if="summary.available"
        viewBox="0 0 162 48"
        role="img"
        aria-label="Semrush过去12个月相对搜索走势，由早到晚"
      >
        <line
          x1="4"
          y1="44"
          x2="158"
          y2="44"
          stroke="currentColor"
          opacity="0.2"
        />
        <polyline
          :points="coordinates"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
      </svg>
      <span>{{
        summary.available ? '12个月走势 · 查看指标' : '月度趋势未获取 · 查看'
      }}</span>
      <span v-if="summary.available" class="semrush-caption"
        >近3月
        {{
          summary.quarterChange === null
            ? '此前均值为0'
            : percent(summary.quarterChange)
        }}</span
      >
    </button>
    <Modal
      v-model:open="open"
      :footer="null"
      width="min(820px, calc(100vw - 24px))"
      :title="`${keyword.term} · Semrush搜索需求`"
    >
      <SemrushKeywordMetrics :keyword="keyword" />
    </Modal>
  </template>
  <section v-else class="semrush-panel" aria-label="Semrush月度搜索需求与指标">
    <div class="semrush-heading">
      <h3>Semrush · 月度搜索需求</h3>
      <span>{{ keyword.market }} · {{ metrics?.report || '报告待获取' }}</span>
    </div>
    <template v-if="summary.available">
      <svg
        class="semrush-chart"
        viewBox="0 0 162 48"
        role="img"
        aria-label="过去12个月相对搜索热度曲线，0至100，由早到晚"
      >
        <line
          x1="4"
          y1="44"
          x2="158"
          y2="44"
          stroke="currentColor"
          opacity="0.2"
        />
        <polyline
          :points="coordinates"
          fill="none"
          stroke="currentColor"
          stroke-width="1"
        />
      </svg>
      <div class="semrush-axis"><span>最早月</span><span>最新月</span></div>
      <dl class="semrush-stats">
        <div>
          <dt>最新月相对热度</dt>
          <dd>{{ summary.latestHeat }} / 100</dd>
        </div>
        <div>
          <dt>最新月较前一月</dt>
          <dd>{{ percent(summary.monthChange) }}</dd>
        </div>
        <div>
          <dt>近3月均值较前3月</dt>
          <dd>{{ percent(summary.quarterChange) }}</dd>
        </div>
        <div>
          <dt>近6月均值较前6月</dt>
          <dd>{{ percent(summary.halfChange) }}</dd>
        </div>
      </dl>
      <p>
        近12个月峰值位置：{{ peak }}。趋势采集日期：{{
          summary.collectedAt.slice(0, 10)
        }}。曲线报告：{{ metrics?.searchTrend?.report || '未记录' }}。
      </p>
      <details>
        <summary>查看12个月相对值</summary>
        <table class="semrush-values">
          <caption>
            按来源顺序由早到晚，未推算具体年月
          </caption>
          <thead>
            <tr>
              <th scope="col">月份位置</th>
              <th scope="col">相对热度</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(value, i) in summary.values" :key="i">
              <th scope="row">
                第{{ i + 1 }}月{{ i === 11 ? '（最新月）' : '' }}
              </th>
              <td>{{ value }}</td>
            </tr>
          </tbody>
        </table>
      </details>
    </template>
    <p v-else class="semrush-empty" role="status">{{ summary.message }}</p>
    <p class="semrush-note">
      过去12个月的相对搜索走势，按来源0–1值换算为0–100展示；逐月日期未返回。可判断近12个月升降，不能据此计算日/周变化、同比或实际搜索次数。
    </p>
    <dl class="semrush-fields">
      <div v-for="row in rows" :key="row.label">
        <dt>{{ row.label }}</dt>
        <dd>{{ row.value }}</dd>
        <small>{{ row.note }}</small>
      </div>
    </dl>
    <p class="semrush-note">
      指标来源：{{ metrics?.source || '待获取同市场Semrush数据' }} · 指标日期
      {{
        metrics?.collectedAt?.slice(0, 10) || '未记录'
      }}。各字段按实际回包展示；搜索结果数、CPC和广告竞争度仅辅助判断。
    </p>
  </section>
</template>

<style scoped>
.semrush-preview {
  display: grid;
  width: 164px;
  max-width: 100%;
  gap: 2px;
  padding: 0;
  color: var(--ant-color-primary, #1677ff);
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 12px;
}
.semrush-preview svg {
  display: block;
  width: 100%;
  height: 44px;
}
.semrush-preview:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 3px;
}
.semrush-caption,
.semrush-note,
.semrush-axis,
.semrush-heading span,
small {
  color: var(--ant-color-text-secondary, #66737d);
}
.semrush-panel {
  padding-top: 16px;
}
.semrush-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.semrush-heading h3 {
  margin: 0 0 12px;
  font-size: 16px;
}
.semrush-chart {
  display: block;
  width: 100%;
  max-height: 180px;
  color: var(--ant-color-primary, #1677ff);
}
.semrush-axis {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.semrush-stats,
.semrush-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 20px;
  margin: 16px 0;
}
dt {
  font-size: 12px;
  color: var(--ant-color-text-secondary, #66737d);
}
dd {
  margin: 4px 0;
  overflow-wrap: anywhere;
}
.semrush-stats dd {
  font-weight: 600;
}
.semrush-fields small {
  display: block;
  font-size: 12px;
}
.semrush-values {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  text-align: left;
}
.semrush-values th,
.semrush-values td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--ant-color-border-secondary, #eee);
}
.semrush-note {
  margin: 12px 0;
  font-size: 12px;
  line-height: 1.6;
}
.semrush-empty {
  padding: 12px;
  background: var(--ant-color-fill-quaternary, #fafafa);
}
@media (max-width: 480px) {
  .semrush-stats {
    grid-template-columns: 1fr;
  }
}
</style>
