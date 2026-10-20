<script setup lang="ts">
import type { Product } from '../data';

import { computed, ref } from 'vue';

import { Select, Table, Tag } from 'ant-design-vue';
const props = defineProps<{ product: Product }>();
const selected = ref(0);
const names: Record<string, string> = {
  sales_volume: '当前 ASIN 月销量',
  sales_rank: '大类排名',
  review_count: '评论数',
  shopping_rank: 'Shopping 排名',
  keywords_count: '搜索覆盖',
};
const stepNames: Record<string, string> = {
  detail: '基础详情',
  content: '图片与属性',
  trend_AsinSalesVolume: 'ASIN 月销量',
  trend_Rank: '大类排名历史',
  trend_ReviewCount: '评论数历史',
  trend: '商品历史',
};
const statusNames: Record<string, string> = {
  queued: '排队中',
  running: '采集中',
  completed: '已取得数据',
  empty: '平台暂无数据',
  failed: '请求失败',
  unknown: '请求结果待核对',
  cancelled: '已取消',
  unsupported: '来源不支持',
};
const series = computed(() => props.product.decisionData?.series || []);
const current = computed(() => series.value[selected.value] || series.value[0]);
const points = computed(() =>
  [...(current.value?.points || [])].sort((a, b) =>
    a.start.localeCompare(b.start),
  ),
);
const chart = computed(() => {
  const values = points.value.map((p) => p.value);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  return values
    .map(
      (value, i) =>
        `${12 + (i * 536) / Math.max(1, values.length - 1)},${105 - ((value - min) * 85) / range}`,
    )
    .join(' ');
});
</script>
<template>
  <section class="product-history">
    <h3>商品补全结果与实际历史</h3>
    <div
      v-for="(step, key) in product.dataCompletion || {}"
      :key="key"
      class="completion-step"
    >
      <b>{{ stepNames[key] || key }}</b>
      <Tag
        :color="
          step.status === 'completed'
            ? 'green'
            : ['failed', 'unknown'].includes(step.status)
              ? 'red'
              : 'default'
        "
        >
{{ statusNames[step.status] || step.status }}
</Tag>
      <p>
        {{ step.message
        }}<span v-if="step.at">
          · {{ new Date(step.at).toLocaleString('zh-CN', { hour12: false }) }}</span>
      </p>
    </div>
    <template v-if="series.length > 0">
      <Select
        v-model:value="selected"
        aria-label="商品历史指标"
        style="width: 100%; margin: 12px 0"
        :options="
          series.map((s, index) => ({
            value: index,
            label: `${s.provider} · ${names[s.metric] || s.metric} · ${({ day: '日', week: '周', month: '月' })[s.period]}`,
          }))
        "
      />
      <p>
        {{ current?.provider }} · {{ current?.market }} · 商品标识
        {{ current?.productId }}；共
        {{ points.length }} 个周期。未完成周期单独标记，不参与增长判断。
      </p>
      <svg
        v-if="points.length > 0"
        viewBox="0 0 560 120"
        role="img"
        :aria-label="`${names[current?.metric || ''] || '商品'}历史，${points.length}个周期`"
        style="width: 100%; height: 140px"
      >
        <path d="M12 10V106H548" fill="none" stroke="#d9dee5" />
        <polyline
          :points="chart"
          fill="none"
          stroke="#4263eb"
          stroke-width="2.5"
        />
      </svg>
      <Table
        size="small"
        row-key="start"
        :data-source="points"
        :pagination="{
          pageSize: 12,
          showSizeChanger: true,
          pageSizeOptions: ['12', '24', '50'],
        }"
        :columns="[
          { title: '周期', dataIndex: 'start' },
          { title: '截止', dataIndex: 'end' },
          { title: '平台值', dataIndex: 'value' },
          { title: '完整性', key: 'partial' },
        ]"
      >
        <template #bodyCell="{ column, record }">
<template v-if="column.key === 'partial'">
{{
            record.partial ? '本期未结束' : '完整周期'
          }}
</template>
</template>
      </Table>
    </template>
    <p v-else class="hci-subtle">
      尚无有效历史。上方逐项显示是否已经请求、空返回或失败原因；可点击补全商品数据。
    </p>
  </section>
</template>
<style scoped>
.product-history {
  margin-top: 20px;
}

.completion-step {
  padding: 10px 0;
  border-bottom: 1px solid #edf0f3;
}

.completion-step b {
  margin-right: 12px;
}

.completion-step p {
  margin: 6px 0;
  line-height: 1.6;
  color: #687385;
}
</style>
