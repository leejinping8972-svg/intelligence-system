<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Alert, Empty, Select, Table } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { serverMode } from '../session';
import ProductWatchChart from './ProductWatchChart.vue';
const props = defineProps<{ productId: string }>();
type Point = { date: string; value: number | null; partial?: boolean };
type MonthlySeries = {
  empty?: boolean;
  points?: Point[];
  currency?: string | null;
  collectedAt?: string;
  error?: string;
  checkedAt?: string;
  basis?: string;
};
type MonthlyTrends = {
  SalesVolume?: MonthlySeries;
  SalesAmount?: MonthlySeries;
};
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
const monthlyTrends = ref<MonthlyTrends>({});
const isMonthlyHistory = computed(() => metric.value.startsWith('history:'));
const selectedHistory = computed(() =>
  metric.value === 'history:SalesVolume'
    ? monthlyTrends.value.SalesVolume
    : monthlyTrends.value.SalesAmount,
);
const error = ref('');
const loading = ref(false);
const metric = ref('history:SalesVolume');
const currencies = computed(() => [
  ...new Set(
    snapshots.value
      .filter((s) => s.price !== null)
      .map((s) => s.currency)
      .filter(Boolean),
  ),
]);
const options = computed(() => [
  { value: 'history:SalesVolume', label: 'Sorftime历史月销量' },
  {
    value: 'history:SalesAmount',
    label: `Sorftime历史月销售额${monthlyTrends.value.SalesAmount?.currency ? `（${monthlyTrends.value.SalesAmount.currency}）` : '（币种未返回）'}`,
  },
  ...currencies.value.map((c) => ({
    value: `price:${c}`,
    label: `价格（${c}）`,
  })),
  { value: 'daily', label: 'Sorftime每日销量' },
  { value: 'monthly', label: '来源月销量快照' },
]);
const points = computed<Point[]>(() =>
  isMonthlyHistory.value
    ? selectedHistory.value?.points || []
    : metric.value === 'daily'
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
  snapshots.value = [];
  daily.value = [];
  monthlyTrends.value = {};
  error.value = '';
  loading.value = true;
  metric.value = 'history:SalesVolume';
  try {
    const result = await cloudRequest<{
      snapshots: Snapshot[];
      dailySales: Point[];
      monthlyTrends?: MonthlyTrends;
    }>('server_product_watch_history', { productId: id });
    if (id !== props.productId) return;
    snapshots.value = result.snapshots;
    daily.value = result.dailySales;
    monthlyTrends.value = result.monthlyTrends || {};
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
      历史月度直接使用Sorftime返回的月份；与每日保存的月销量快照分开展示，父子体聚合范围以来源为准。
    </p>
    <Empty
      v-if="!snapshots.length && !loading && !error"
      description="尚无持续观察记录，请在监控中心启用商品持续监控"
    />
    <template v-if="!error && (!loading || snapshots.length)">
      <label for="product-watch-metric">趋势指标</label>
      <Select
        id="product-watch-metric"
        v-model:value="metric"
        :options="options"
        aria-label="观察趋势指标"
        style="width: 100%"
      />
      <template v-if="isMonthlyHistory">
        <p v-if="selectedHistory?.collectedAt">
          来源：Sorftime · 最近成功采集：{{
            new Date(selectedHistory.collectedAt).toLocaleString('zh-CN', {
              timeZone: 'Asia/Shanghai',
            })
          }}（北京时间）；当前月份可能未完整。
        </p>
        <Alert
          v-if="selectedHistory?.error"
          type="warning"
          show-icon
          :message="`最近刷新失败：${selectedHistory.error}。已有历史保留。`"
        />
        <Alert
          v-else-if="selectedHistory?.empty && selectedHistory?.points?.length"
          type="warning"
          show-icon
          message="最近刷新未返回数据，保留上次成功采集的历史。"
        />
        <p v-if="!selectedHistory?.checkedAt">
          尚未采集历史月度。历史月销量与月销售额已默认纳入商品持续监控，将在下一轮新建任务首次采集，之后每7天刷新。当前范围为新品池内Amazon商品；请确保商品持续监控已启用。
        </p>
        <p
          v-else-if="
            !selectedHistory?.points?.length && !selectedHistory?.error
          "
        >
          Sorftime本次未返回历史月度数据，未将缺失补零。
        </p>
        <p v-if="metric === 'history:SalesAmount'">
          金额按来源市场币种展示，不用当前价格倒算历史销售额。
        </p>
      </template>
      <ProductWatchChart
        :points="points"
        :period="isMonthlyHistory ? 'month' : 'day'"
        :metric-label="
          options.find((o) => o.value === metric)?.label || '来源值'
        "
      />
      <Table
        size="small"
        row-key="date"
        :data-source="[...points].reverse()"
        :loading="loading"
        :pagination="{ pageSize: 10 }"
        :columns="[
          { title: isMonthlyHistory ? '月份' : '日期', dataIndex: 'date' },
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
