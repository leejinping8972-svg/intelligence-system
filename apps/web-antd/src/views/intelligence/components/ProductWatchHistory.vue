<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Alert, Empty, Select, Table } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { serverMode } from '../session';
const props = defineProps<{ productId: string }>();
type Point = { date: string; value: number | null; partial?: boolean };
type Snapshot = {
  day: string;
  at: string;
  price: number | null;
  currency?: string;
  monthlySales: number | null;
  status: string;
  reason?: string;
  dailyError?: string;
  changes?: { field: string; before: unknown; after: unknown }[];
};
const snapshots = ref<Snapshot[]>([]);
const daily = ref<Point[]>([]);
const error = ref('');
const loading = ref(false);
const metric = ref('price');
const currencies = computed(() => [
  ...new Set(
    snapshots.value
      .filter((s) => s.price !== null)
      .map((s) => s.currency)
      .filter(Boolean),
  ),
]);
const options = computed(() => [
  ...currencies.value.map((c) => ({
    value: `price:${c}`,
    label: `价格（${c}）`,
  })),
  { value: 'daily', label: 'Sorftime每日销量' },
  { value: 'monthly', label: '来源月销量快照' },
]);
const points = computed<Point[]>(() =>
  metric.value === 'daily'
    ? daily.value
    : snapshots.value.map((s) => ({
        date: s.day,
        value:
          s.status !== 'completed'
            ? null
            : metric.value === 'monthly'
              ? s.monthlySales
              : s.currency === metric.value.split(':')[1]
                ? s.price
                : null,
      })),
);
const chart = computed(() => {
  const valid = points.value
    .map((p) => p.value)
    .filter((v): v is number => v !== null);
  const min = Math.min(...valid),
    max = Math.max(...valid),
    range = max - min || 1;
  return {
    min,
    max,
    dots: points.value.map((p, i) => ({
      ...p,
      x: 55 + (i * 600) / Math.max(1, points.value.length - 1),
      y: p.value === null ? null : 150 - ((p.value - min) * 115) / range,
    })),
  };
});
const changes = computed(() =>
  [...snapshots.value]
    .reverse()
    .filter((s) => s.changes?.length || s.reason || s.dailyError),
);
const fields: Record<string, string> = {
  title: '名称',
  brand: '品牌',
  imageUrl: '主图',
  size: '规格',
  ingredient: '成分',
  claim: '卖点',
  sourceUrl: '链接',
  sellingPoints: '卖点资料',
  attributes: '商品属性',
  descriptions: '商品描述',
};
async function load() {
  if (!serverMode) return;
  const id = props.productId;
  loading.value = true;
  try {
    const result = await cloudRequest<{
      snapshots: Snapshot[];
      dailySales: Point[];
    }>('server_product_watch_history', { productId: id });
    if (id !== props.productId) return;
    snapshots.value = result.snapshots;
    daily.value = result.dailySales;
    metric.value = options.value[0]?.value || 'daily';
    error.value = '';
  } catch (e) {
    if (id === props.productId)
      error.value = e instanceof Error ? e.message : '趋势读取失败';
  } finally {
    if (id === props.productId) loading.value = false;
  }
}
watch(() => props.productId, load, { immediate: true });
</script>
<template>
  <section>
    <Alert v-if="error" type="error" :message="error" show-icon />
    <p>
      最近90次每日观察。每日销量为Sorftime提供的数据，非卖家核实订单；月销量快照的变化不代表当天销量。价格按币种分别展示，缺失数据不补零。
    </p>
    <Empty
      v-if="!snapshots.length && !loading"
      description="尚无持续观察记录，请在监控中心启用商品持续监控"
    />
    <template v-else>
      <label for="product-watch-metric">趋势指标</label>
      <Select
        id="product-watch-metric"
        v-model:value="metric"
        :options="options"
        aria-label="观察趋势指标"
        style="width: 100%"
      />
      <svg
        v-if="chart.dots.some((p) => p.value !== null)"
        viewBox="0 0 700 195"
        role="img"
        :aria-label="`${options.find((o) => o.value === metric)?.label}趋势，详细值见下表`"
        style="width: 100%; max-height: 240px"
      >
        <path d="M55 20V155H660" fill="none" stroke="#b8c0cc" />
        <text x="4" y="40" font-size="12" fill="currentColor">
          {{ chart.max }}
        </text>
        <text x="4" y="153" font-size="12" fill="currentColor">
          {{ chart.min }}
        </text>
        <template v-for="(point, i) in chart.dots" :key="point.date">
          <line
            v-if="
              i &&
              point.y !== null &&
              chart.dots[i - 1]?.y !== null &&
              Date.parse(point.date) - Date.parse(chart.dots[i - 1]!.date) ===
                86400000
            "
            :x1="chart.dots[i - 1]?.x"
            :y1="chart.dots[i - 1]?.y ?? 0"
            :x2="point.x"
            :y2="point.y"
            stroke="#4263eb"
            stroke-width="2"
          />
          <circle
            v-if="point.y !== null"
            :cx="point.x"
            :cy="point.y"
            r="3"
            :fill="point.partial ? '#d99b28' : '#4263eb'"
          >
            <title>
              {{ point.date }}：{{ point.value
              }}{{ point.partial ? '（可能未完整）' : '' }}
            </title>
          </circle>
        </template>
        <text x="55" y="183" font-size="12" fill="currentColor">
          {{ points[0]?.date }}
        </text>
        <text
          x="660"
          y="183"
          text-anchor="end"
          font-size="12"
          fill="currentColor"
        >
          {{ points.at(-1)?.date }}
        </text>
      </svg>
      <Table
        size="small"
        row-key="date"
        :data-source="[...points].reverse()"
        :loading="loading"
        :pagination="{ pageSize: 10 }"
        :columns="[
          { title: '日期', dataIndex: 'date' },
          { title: '来源值', key: 'value' },
        ]"
      >
        <template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'value'"
            >{{ record.value === null ? '无数据' : record.value
            }}{{ record.partial ? ' · 可能未完整' : '' }}</template
          ></template
        >
      </Table>
      <h4>商品信息更新与采集状态</h4>
      <p v-if="!changes.length">
        暂无已观察到的信息变化或采集异常；首次采集建立对比基线。
      </p>
      <div v-for="row in changes" :key="row.day" style="margin: 12px 0">
        <b>{{ row.day }}</b>
        <p v-if="row.reason || row.dailyError">
          {{ row.reason || row.dailyError }}
        </p>
        <p v-for="change in row.changes" :key="change.field">
          {{ fields[change.field] || change.field }}：{{ change.before }} →
          {{ change.after }}
        </p>
      </div>
    </template>
  </section>
</template>
