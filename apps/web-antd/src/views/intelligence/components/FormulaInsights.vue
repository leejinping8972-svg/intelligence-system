<script setup lang="ts">
import { computed, ref } from 'vue';

import { Alert, Button, Modal, Progress, Table, Tag } from 'ant-design-vue';

import { state } from '../data';

const open = ref(false);
function formulaOf(product: (typeof state.products)[number]) {
  if (product.formula?.fingerprint) return product.formula;
  const ingredients = product.ingredientInsights
    .map((item) => item.name.trim())
    .filter(Boolean)
    .map((name) => ({ name, amount: '', raw: name }));
  const names = [
    ...new Set(ingredients.map((item) => item.name.toLowerCase())),
  ].toSorted();
  let status: 'observed' | 'unknown' | 'verified' = 'unknown';
  if (ingredients.length > 0)
    status = product.reviewed ? 'verified' : 'observed';
  return {
    status,
    fingerprint: names.join('|'),
    ingredients,
    evidenceUrl: product.evidenceUrl || '',
    collectedAt: product.lastCollectedAt || '',
  };
}
const scopedProducts = computed(() =>
  state.products.filter(
    (product) => state.market === 'ALL' || product.market === state.market,
  ),
);
const coverage = computed(() => {
  const total = scopedProducts.value.length;
  const observed = scopedProducts.value.filter(
    (product) =>
      formulaOf(product).status !== 'unknown' && formulaOf(product).fingerprint,
  ).length;
  const verified = scopedProducts.value.filter(
    (product) => formulaOf(product).status === 'verified',
  ).length;
  return {
    total,
    observed,
    verified,
    percent: total ? Math.round((observed / total) * 100) : 0,
  };
});
const rows = computed(() => {
  const groups = new Map<string, any>();
  for (const product of scopedProducts.value) {
    const formula = formulaOf(product);
    if (!formula?.fingerprint || formula.status === 'unknown') continue;
    const item = groups.get(formula.fingerprint) || {
      key: formula.fingerprint,
      ingredients: formula.ingredients.map((ingredient) => ingredient.name),
      productIds: [] as string[],
      brands: new Set<string>(),
      markets: new Set<string>(),
      verified: 0,
      signal: 0,
    };
    item.productIds.push(product.id);
    item.brands.add(product.brand);
    item.markets.add(product.market);
    if (formula.status === 'verified') item.verified += 1;
    item.signal +=
      Number(product.sourceMetrics?.monthlySales || 0) +
      Number(product.sourceMetrics?.reportedSales || 0) +
      Math.log10(1 + Number(product.sourceMetrics?.reviewCount || 0)) * 10;
    groups.set(formula.fingerprint, item);
  }
  return [...groups.values()]
    .map((item) => ({
      ...item,
      brands: [...item.brands],
      markets: [...item.markets],
      products: item.productIds.length,
      score: Math.round(
        item.productIds.length * 20 +
          item.brands.size * 10 +
          Math.min(50, Math.log10(1 + item.signal) * 15),
      ),
    }))
    .toSorted((a, b) => b.score - a.score || b.products - a.products);
});
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
    sorter: (a: any, b: any) => a.score - b.score,
  },
];
</script>

<template>
  <Button @click="open = true">热门配方</Button>
  <Modal v-model:open="open" title="热门配方证据" :width="960" :footer="null">
    <Alert
      type="info"
      show-icon
      message="排名按出现商品数、品牌数和平台销量/评论快照生成；只展示采集到的公开配方，不把缺失字段推断为成分。‘已核验’仅指人工核验过的商品。"
    />
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
      :pagination="{ pageSize: 10 }"
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
