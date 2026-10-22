<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { Alert, Button, Modal, Progress, Table, Tag } from 'ant-design-vue';

import { state } from '../data';
import { formulaStatistics } from '../statistics-engine';
import type { FormulaRow } from '../statistics-engine';
import { useStatistics } from '../statistics-queries';
import { serverMode } from '../session';

const open = ref(false);
const page = ref(1), pageSize = ref(10);
watch(() => state.market, () => { page.value = 1; });
const remote = useStatistics<FormulaRow>(computed(() => ({ kind: 'formulas', market: state.market, page: page.value, pageSize: pageSize.value, enabled: open.value })));
watch(remote.pagination, value => { page.value = value.page; });
const scopedProducts = computed(() =>
  state.products.filter(
    (product) => state.market === 'ALL' || product.market === state.market,
  ),
);
const local = computed(() => serverMode ? null : formulaStatistics(scopedProducts.value));
const coverage = computed(() => serverMode ? (remote.snapshot.value?.coverage as { total: number; observed: number; verified: number; percent: number }) || { total: 0, observed: 0, verified: 0, percent: 0 } : local.value!.coverage);
const rows = computed(() => serverMode ? remote.rows.value : local.value!.rows);
const columns = [
  { title: '配方组合', key: 'ingredients', width: 360 },
  { title: '商品', dataIndex: 'products', width: 80 },
  { title: '品牌', key: 'brands', width: 90 },
  { title: '市场', key: 'markets', width: 120 },
  { title: '已核验', dataIndex: 'verified', width: 90 },
  {
    title: '证据热度',
    dataIndex: 'score',
    width: 100,
    sorter: serverMode ? undefined : (a: any, b: any) => a.score - b.score,
  },
];
</script>

<template>
  <Button @click="open = true">热门配方</Button>
  <Modal v-model:open="open" title="热门配方证据" :width="960" :footer="null">
    <Alert
      type="info"
      show-icon
      message="排名按出现商品数、品牌数及评论快照生成；只展示采集到的公开配方，不把缺失字段推断为成分。‘已核验’仅指人工核验过的商品。"
    />
    <Alert v-if="remote.error.value" type="error" :message="remote.error.value" show-icon />
    <div class="formula-coverage">
      <div>
        <strong>{{ coverage.observed }}/{{ coverage.total }}</strong>
        件商品有可观察配方；其中 {{ coverage.verified }} 件已核验
      </div>
      <Progress :percent="coverage.percent" size="small" />
    </div>
    <Table
      :columns="columns"
      :data-source="rows"
      :loading="remote.loading.value"
      :pagination="serverMode ? { current: page, pageSize, total: remote.total.value, showSizeChanger: true, onChange: (p: number, size: number) => { page = p; pageSize = size; } } : { pageSize: 10 }"
      size="small"
      :scroll="{ x: 820 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'ingredients'">
          <Tag v-for="name in record.ingredients" :key="name">{{ name }}</Tag>
        </template>
        <template v-else-if="column.key === 'brands'">
          {{ record.brands.length }}
        </template>
        <template v-else-if="column.key === 'markets'">
          {{ record.markets.join('、') }}
        </template>
      </template>
    </Table>
  </Modal>
</template>

<style scoped>
.formula-coverage {
  display: grid;
  grid-template-columns: minmax(260px, auto) minmax(180px, 1fr);
  gap: 16px;
  align-items: center;
  margin: 16px 0;
}
</style>
