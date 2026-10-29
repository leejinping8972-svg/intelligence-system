<script setup lang="ts">
import type {
  CoreKind,
  CorePeriod,
  EvidenceMetric as MetricValue,
} from '../core-list-metrics';
import type { Ad, Keyword, Product, Site } from '../data';

import { computed, onMounted, ref } from 'vue';

import { Select, Table } from 'ant-design-vue';

import { coreListContext, loadCoreRates } from '../core-list-context';
import { coreMetrics } from '../core-list-metrics';
import { state } from '../data';
import { serverMode } from '../session';
import EvidenceMetric from './EvidenceMetric.vue';
import KeywordRelatedQueries from './KeywordRelatedQueries.vue';
const props = defineProps<{
  kind: CoreKind;
  record: Ad | Keyword | Product | Site;
}>();
const period = ref<CorePeriod>(30);
onMounted(() => {
  if (props.kind === 'products') void loadCoreRates();
});
const metrics = computed(() =>
  coreMetrics(props.kind, props.record, period.value, {
    ...state,
    complete: !serverMode,
    fx: coreListContext.fx,
  }),
);
const columns = [
  { title: '指标', dataIndex: 'label', width: 180 },
  { title: '值与证据', key: 'value', width: 380 },
];
</script>
<template>
  <section class="hci-detail-section">
    <div class="hci-panel-head">
      <h3>数据与来源</h3>
      <Select
        v-if="kind === 'products' || kind === 'keywords'"
        v-model:value="period"
        aria-label="详情统计周期"
        :options="[30, 90, 180, 365].map((d) => ({ value: d, label: `近${d}天` }))"
        style="width: 120px"
      />
    </div>
    <Table
      size="small"
      row-key="key"
      :columns="columns"
      :data-source="metrics"
      :pagination="false"
      :scroll="{ x: 560 }"
    >
      <template #bodyCell="{ column, record: row }">
        <KeywordRelatedQueries v-if="column.key === 'value' && kind === 'keywords' && (row.key === 'relatedTop' || row.key === 'relatedRising')" :keyword="record as Keyword" :kind="row.key" />
        <EvidenceMetric
          v-else-if="column.key === 'value'"
          :metric="row as MetricValue"
        />
      </template>
    </Table>
    <details v-if="record.coreEvidence?.history?.length">
      <summary>
        来源快照（当前{{ record.coreEvidence.history.length }} / 累计{{
          record.coreEvidence.historyCount ??
          record.coreEvidence.history.length
        }}）
      </summary>
      <pre class="core-history">{{
        JSON.stringify(record.coreEvidence.history, null, 2)
      }}</pre>
    </details>
  </section>
</template>
<style scoped>
.core-history {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 320px;
  overflow: auto;
  font-size: 12px;
}
</style>
