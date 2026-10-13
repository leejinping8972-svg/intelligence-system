<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Button, Select, Radio, Tag, Empty } from 'ant-design-vue';
import Chart from './components/Chart.vue';
import PageHeader from './components/PageHeader.vue';
import { filteredKeywords, state, marketName, exportCsv } from './data';
import { trendOption } from './charts';
const route = useRoute();
const router = useRouter();
const selected = ref('');
const days = ref(90);
watch(
  () => route.query.keyword,
  (value) => {
    const k = state.keywords.find((k) => k.id === value);
    if (k) {
      selected.value = k.id;
      state.market = k.market;
    }
  },
  { immediate: true },
);
const keyword = computed(
  () =>
    filteredKeywords.value.find((k) => k.id === selected.value) ||
    filteredKeywords.value[0],
);
const avg = (xs: number[]) =>
  xs.length
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
    : 0;
const recent = computed(() =>
  keyword.value ? avg(keyword.value.series.slice(-28)) : 0,
);
const previous = computed(() =>
  keyword.value ? avg(keyword.value.series.slice(-56, -28)) : 0,
);
const growth = computed(() =>
  keyword.value?.growth == null ? '—' : keyword.value.growth.toFixed(1),
);
function exportTrend() {
  if (keyword.value)
    exportCsv(
      '90天趋势-演示.csv',
      keyword.value.series.map((v, i) => ({
        序号: i + 1,
        关键词: keyword.value!.term,
        国家: keyword.value!.market,
        指数: v,
        性质: '虚构演示',
      })),
    );
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="趋势洞察"
      description="识别持续变化，保留每条曲线的国家、来源和查询尺度。"
      ><Button @click="exportTrend">导出时序</Button></PageHeader
    >
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Select
          :value="keyword?.id"
          show-search
          option-filter-prop="label"
          :options="
            filteredKeywords.map((k) => ({
              label: `${k.term} · ${k.market}`,
              value: k.id,
            }))
          "
          style="min-width: 290px"
          @change="(v: any) => (selected = v)"
        />
        <div class="hci-toolbar-end">
          <Radio.Group v-model:value="days"
            ><Radio.Button :value="30">近30天</Radio.Button
            ><Radio.Button :value="90">近90天</Radio.Button></Radio.Group
          >
        </div>
      </div>
      <template v-if="keyword"
        ><div class="hci-panel-head">
          <div>
            <h2>{{ keyword.term }}</h2>
            <p>
              {{ marketName(keyword.market) }} · 演示相对搜索热度 · 2026-10-13
            </p>
          </div>
          <Tag color="green">同序列观察</Tag>
        </div>
        <Empty
          v-if="keyword.growth === null"
          description="低量词：数据不足，不能计算趋势"
        /><Chart
          v-else
          :options="trendOption(keyword, days)"
          class="hci-chart-large"
        />
        <div
          class="hci-stats"
          v-if="keyword.growth !== null"
          style="
            margin-top: 24px;
            margin-bottom: 0;
            grid-template-columns: repeat(3, 1fr);
          "
        >
          <div>
            <p class="hci-subtle">最近28天均值</p>
            <div class="hci-stat-value">{{ recent }}</div>
          </div>
          <div>
            <p class="hci-subtle">此前28天均值</p>
            <div class="hci-stat-value">{{ previous }}</div>
          </div>
          <div>
            <p class="hci-subtle">同序列变化</p>
            <div class="hci-stat-value hci-positive">{{ growth }}%</div>
          </div>
        </div></template
      >
    </section>
    <div class="hci-demo-note">
      本页均为虚构时序。0–100为相对指数，不代表搜索次数；不同国家与不同查询批次不能直接相加或比较绝对需求。
    </div>
    <section class="hci-panel">
      <div class="hci-panel-head"><h2>把趋势带入下一步研究</h2></div>
      <p class="hci-subtle" style="margin-bottom: 16px">
        查看相关独立站和商品，寻找支持或反驳增长假设的证据。
      </p>
      <Button
        @click="
          router.push({ path: '/sites', query: { keyword: keyword?.term } })
        "
        >发现相关独立站 →</Button
      >
    </section>
  </main>
</template>
