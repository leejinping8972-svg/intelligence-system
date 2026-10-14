<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Button, Empty, Radio, Select, Tag } from 'ant-design-vue';

import { trendOption } from './charts';
import Chart from './components/Chart.vue';
import PageHeader from './components/PageHeader.vue';
import { exportCsv, filteredKeywords, marketName, state } from './data';
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
  xs.length > 0
    ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10
    : 0;
const recent = computed(() =>
  keyword.value ? avg(keyword.value.series.slice(-28)) : 0,
);
const previous = computed(() =>
  keyword.value ? avg(keyword.value.series.slice(-56, -28)) : 0,
);
const growth = computed(() =>
  typeof keyword.value?.growth === 'number'
    ? keyword.value.growth.toFixed(1)
    : '—',
);
const latest = computed(() => keyword.value?.series.at(-1) ?? 0);
const peak = computed(() =>
  keyword.value?.series.length ? Math.max(...keyword.value.series) : 0,
);
const trough = computed(() =>
  keyword.value?.series.length ? Math.min(...keyword.value.series) : 0,
);
const trendConclusion = computed(() => {
  if (!keyword.value?.series.length) return '尚未采集真实趋势序列';
  if (keyword.value.growth === null) return '序列不足56天，暂不能计算28天变化';
  if (keyword.value.growth >= 20)
    return '最近28天热度明显上升，建议优先核验供给与竞品动作';
  if (keyword.value.growth >= 5)
    return '最近28天热度温和上升，可继续观察商品和广告增量';
  if (keyword.value.growth <= -20)
    return '最近28天热度明显下降，应谨慎扩大选品投入';
  if (keyword.value.growth <= -5)
    return '最近28天热度有所回落，建议结合季节性继续验证';
  return '最近两个28天窗口整体平稳';
});
function exportTrend() {
  const record = keyword.value;
  if (record)
    exportCsv(
      `${record.term}-趋势.csv`,
      record.series.map((v, i) => ({
        序号: i + 1,
        关键词: record.term,
        国家: record.market,
        指数: v,
        来源: record.source,
        性质: record.dataNature === 'collected' ? '真实采集' : '虚构演示',
      })),
    );
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="趋势洞察"
      description="识别持续变化，保留每条曲线的国家、来源和查询尺度。"
      >
<Button @click="exportTrend">导出时序</Button>
</PageHeader>
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
          <Radio.Group v-model:value="days">
<Radio.Button :value="30">近30天</Radio.Button><Radio.Button :value="90">近90天</Radio.Button>
</Radio.Group>
        </div>
      </div>
      <template v-if="keyword">
<div class="hci-panel-head">
          <div>
            <h2>{{ keyword.term }}</h2>
            <p>
              {{ marketName(keyword.market) }} ·
              {{
                keyword.dataNature === 'collected'
                  ? 'Google Trends相对搜索热度'
                  : '演示相对搜索热度'
              }}
              ·
              {{ keyword.updatedAt?.slice(0, 10) || '2026-10-13' }}
            </p>
          </div>
          <Tag :color="keyword.dataNature === 'collected' ? 'green' : 'orange'">
            {{ keyword.dataNature === 'collected' ? '真实采集' : '演示序列' }}
          </Tag>
        </div>
        <Empty
          v-if="!keyword.series.length"
          description="尚无趋势数据，请在关键词研究中勾选后点击“补齐28天趋势”"
        /><Chart
          v-else
          :options="trendOption(keyword, days)"
          class="hci-chart-large"
        />
        <div
          class="hci-stats"
          v-if="keyword.series.length"
          style="
            grid-template-columns: repeat(3, 1fr);
            margin-top: 24px;
            margin-bottom: 0;
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
            <div
              class="hci-stat-value"
              :class="
                (keyword.growth ?? 0) >= 0 ? 'hci-positive' : 'hci-negative'
              "
            >
              {{ growth }}{{ keyword.growth === null ? '' : '%' }}
            </div>
          </div>
        </div>
        <div v-if="keyword.series.length" class="hci-field-notes">
          <div>
            <b>趋势判断</b>
            <span>{{ trendConclusion }}</span>
          </div>
          <div>
            <b>序列范围</b>
            <span>最新 {{ latest }} · 峰值 {{ peak }} · 谷值 {{ trough }} · 共
              {{ keyword.series.length }} 个时点</span>
          </div>
        </div>
</template>
    </section>
    <div class="hci-demo-note">
      0–100为同一查询中的相对热度，不代表搜索次数；不同国家与不同查询批次不能直接比较绝对需求。真实序列来自Google
      Trends公开网页接口，接口限流或低搜索量时会保留“数据不足”。
    </div>
    <section class="hci-panel">
      <div class="hci-panel-head"><h2>把趋势带入下一步研究</h2></div>
      <p class="hci-subtle" style="margin-bottom: 16px">
        查看相关独立站和商品，寻找支持或反驳增长假设的证据。
      </p>
      <Button
        @click="
          router.push({ path: '/sites', query: { keywordId: keyword?.id } })
        "
        >
发现相关独立站 →
</Button>
    </section>
  </main>
</template>
