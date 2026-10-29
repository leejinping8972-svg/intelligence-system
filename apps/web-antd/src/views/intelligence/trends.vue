<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Empty,
  message,
  Radio,
  Select,
  Tag,
} from 'ant-design-vue';

import { trendOption } from './charts';
import Chart from './components/Chart.vue';
import GoogleTrendInsights from './components/GoogleTrendInsights.vue';
import KeywordTrendComparison from './components/KeywordTrendComparison.vue';
import PageHeader from './components/PageHeader.vue';
import {
  audit,
  exportCsv,
  filteredKeywords,
  marketName,
  openCapturedTrend,
  state,
} from './data';
import { discoverSites, trendRecordFields } from './site-discovery';
import { trendComparisons } from './trend-comparison';
import type { Keyword } from './data';
import { loadWorkspaceDetail } from './cloud-workspace';
import { useWorkspaceList } from './workspace-queries';
import { serverMode } from './session';
const route = useRoute();
const router = useRouter();
const selected = ref('');
const search = ref(typeof route.query.term === 'string' ? route.query.term : '');
const remote = useWorkspaceList<Keyword>('keywords', computed(() => ({ market: state.market, search: search.value })), ref(1), ref(30));
const detailLoading = ref(false), detailError = ref('');
let detailTicket = 0;
watch(() => remote.rows.value, rows => { if (serverMode && !selected.value && rows.length) selected.value = rows[0]!.id; });
watch(selected, async id => {
  const ticket = ++detailTicket;
  if (!serverMode || !id) return;
  detailLoading.value = true;
  detailError.value = '';
  try { await loadWorkspaceDetail('keywords', id); }
  catch (error) { if (ticket === detailTicket) detailError.value = (error as Error).message; }
  finally { if (ticket === detailTicket) detailLoading.value = false; }
});
let searchTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => { detailTicket++; if (searchTimer) clearTimeout(searchTimer); });
function searchKeywords(term: string) {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { search.value = term; }, 250);
}
const days = ref(365);
const refreshing = ref(false);
watch(
  () => [route.query.keyword, route.query.term, route.query.market],
  ([value, term, market]) => {
    if (serverMode) {
      if (['ALL', 'US', 'MX', 'VN'].includes(String(market))) state.market = String(market) as typeof state.market;
      if (typeof value === 'string') selected.value = value;
      else if (typeof term === 'string') search.value = term;
      return;
    }
    const k =
      state.keywords.find((k) => k.id === value) ||
      (typeof term === 'string' && typeof market === 'string'
        ? openCapturedTrend(term, market)
        : undefined);
    if (k) {
      selected.value = k.id;
      state.market = k.market;
    }
  },
  { immediate: true },
);
const keyword = computed(
  () =>
    serverMode ? state.keywords.find(k => k.id === selected.value && !k.listSummary && (state.market === 'ALL' || k.market === state.market)) : filteredKeywords.value.find((k) => k.id === selected.value) ||
    filteredKeywords.value[0],
);
watch(
  () => state.market,
  () => {
    if (serverMode) { selected.value = typeof route.query.keyword === 'string' && route.query.market === state.market ? route.query.keyword : ''; return; }
    if (!filteredKeywords.value.some((item) => item.id === selected.value))
      selected.value = filteredKeywords.value[0]?.id || '';
  },
);
const dailySeries = computed(() => {
  const record = keyword.value;
  if (!record) return [];
  if (record.trendDailyPoints?.length)
    return record.trendDailyPoints
      .filter((point) => !point.isPartial)
      .map((point) => point.value);
  return !record.trendResolution || record.trendResolution === 'day'
    ? record.series
    : [];
});
const comparison = computed(() =>
  keyword.value ? trendComparisons(keyword.value)[0]! : null,
);
const recent = computed(() =>
  comparison.value?.currentMean === null || !comparison.value
    ? '—'
    : Math.round(comparison.value.currentMean * 10) / 10,
);
const previous = computed(() =>
  comparison.value?.previousMean === null || !comparison.value
    ? '—'
    : Math.round(comparison.value.previousMean * 10) / 10,
);
const growth = computed(() =>
  comparison.value?.change === null || !comparison.value
    ? '—'
    : comparison.value.change.toFixed(1),
);
const resolutionLabel = computed(
  () =>
    ({ day: '日', week: '周', month: '月', unknown: '未知' })[
      keyword.value?.trendResolution || 'unknown'
    ],
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
  const change = comparison.value?.change ?? null;
  if (dailySeries.value.length < 60)
    return (
      keyword.value.trendDailyMessage ||
      '一年曲线已采集；有效日数据不足60天，暂不能计算30天变化'
    );
  if (keyword.value.series.every((value) => value === 0))
    return '过去一年相对热度均为0，Google Trends未观察到足够搜索样本';
  if (
    change === null &&
    previous.value === 0 &&
    typeof recent.value === 'number' &&
    recent.value > 0
  )
    return '此前30天均值为0，最近30天已出现搜索信号，无法计算百分比变化';
  if (change === null && previous.value === 0)
    return '此前30天基期为0，无法计算百分比变化';
  if (change === null) return '当前序列暂不能计算30天变化';
  if (change !== null && change >= 20)
    return '最近30天热度明显上升，建议优先核验供给与竞品动作';
  if (change !== null && change >= 5)
    return '最近30天热度温和上升，可继续观察商品和广告增量';
  if (change !== null && change <= -20)
    return '最近30天热度明显下降，应谨慎扩大选品投入';
  if (change !== null && change <= -5)
    return '最近30天热度有所回落，建议结合季节性继续验证';
  return '最近两个30天窗口整体平稳';
});
function exportTrend() {
  const record = keyword.value;
  if (record)
    exportCsv(
      `${record.term}-趋势.csv`,
      record.series.map((v, i) => ({
        序号: i + 1,
        日期: record.trendPoints?.[i]?.date || '',
        粒度: record.trendResolution || 'unknown',
        查询范围: record.trendPeriod || '旧版序列',
        采集时间: record.trendCollectedAt || record.updatedAt || '',
        关键词: record.term,
        国家: record.market,
        指数: v,
        来源: record.source,
        性质: record.dataNature === 'collected' ? '真实采集' : '虚构演示',
      })),
    );
}
async function refreshTrend() {
  const record = keyword.value;
  if (!record) return;
  if (!state.settings.researchApiUrl || !state.settings.researchAccessKey) {
    message.warning('请先到数据源与设置配置研究服务');
    return;
  }
  refreshing.value = true;
  try {
    const result = await discoverSites({
      apiUrl: state.settings.researchApiUrl,
      accessKey: state.settings.researchAccessKey,
      keywords: [record.term],
      markets: [record.market],
      maxSites: 1,
      productsPerSite: 1,
      sources: ['google_trends'],
    });
    const trend = result.trends?.[0];
    if (!trend?.series.length) {
      record.trendStatus = 'failed';
      record.trendMessage = trend?.message || '趋势接口未返回数据';
      message.warning(record.trendMessage);
      return;
    }
    Object.assign(record, trendRecordFields(trend), {
      updatedAt: result.generatedAt,
    });
    audit(
      '更新一年趋势',
      `${record.term} / ${trend.points.length}个时点`,
      record.market,
    );
    if (trend.dailyPoints?.length)
      message.success('已更新一年趋势，30天指标按独立日数据计算');
    else message.warning('一年曲线已保存；30天日数据暂未返回，详见页面说明');
  } catch (error) {
    record.trendStatus = 'failed';
    record.trendMessage =
      error instanceof Error ? error.message : '趋势更新失败';
    message.error(record.trendMessage);
  } finally {
    refreshing.value = false;
  }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="趋势洞察"
      description="识别持续变化，保留每条曲线的国家、来源和查询尺度。"
    >
      <Button :disabled="!keyword" :loading="refreshing" @click="refreshTrend">
        更新一年趋势
</Button><Button @click="exportTrend">导出时序</Button>
      <a
        v-if="keyword?.trendSourceUrl"
        :href="keyword.trendSourceUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="hci-link"
        >Google 原始页面</a>
    </PageHeader>
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Select
          :value="selected || keyword?.id"
          show-search
          :filter-option="serverMode ? false : undefined"
          :loading="remote.loading.value || detailLoading"
          option-filter-prop="label"
          :options="
            (serverMode ? [...new Map([...(keyword ? [keyword] : []), ...remote.rows.value].map(k => [k.id, k])).values()] : filteredKeywords).map((k) => ({
              label: `${k.term} · ${k.market}`,
              value: k.id,
            }))
          "
          style="min-width: 290px"
          @change="(v: any) => (selected = v)"
          @search="searchKeywords"
        />
        <div class="hci-toolbar-end">
          <Radio.Group v-model:value="days">
            <Radio.Button :value="30">近30天</Radio.Button><Radio.Button :value="90">近90天</Radio.Button><Radio.Button :value="180">近180天</Radio.Button><Radio.Button :value="365">过去一年</Radio.Button>
          </Radio.Group>
        </div>
      </div>
      <Alert v-if="detailError || remote.error.value" type="error" :message="detailError || remote.error.value" show-icon />
      <p v-if="detailLoading" role="status">正在加载关键词完整趋势…</p>
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
              {{
                (keyword.trendCollectedAt || keyword.updatedAt)?.slice(0, 10) ||
                '未采集'
              }}
              · {{ resolutionLabel }}粒度
            </p>
          </div>
          <Tag :color="keyword.dataNature === 'collected' ? 'green' : 'orange'">
            {{ keyword.dataNature === 'collected' ? '真实采集' : '演示序列' }}
          </Tag>
        </div>
        <Alert
          v-if="keyword.trendMessage || keyword.trendDailyMessage"
          :message="keyword.trendMessage"
          :description="keyword.trendDailyMessage"
          type="info"
          show-icon
          style="margin-bottom: 16px"
        />
        <Empty
          v-if="!keyword.series.length"
          description="尚无趋势数据，请点击“更新一年趋势”或在关键词研究中一键补齐信息"
        /><Chart
          v-else
          :options="trendOption(keyword, days)"
          :aria-label="`${keyword.term} Google Trends 相对搜索热度曲线`"
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
            <p class="hci-subtle">最近30天均值</p>
            <div class="hci-stat-value">{{ recent }}</div>
          </div>
          <div>
            <p class="hci-subtle">此前30天均值</p>
            <div class="hci-stat-value">{{ previous }}</div>
          </div>
          <div>
            <p class="hci-subtle">同序列变化</p>
            <div
              class="hci-stat-value"
              :class="
                (comparison?.change ?? 0) >= 0 ? 'hci-positive' : 'hci-negative'
              "
            >
              {{ growth }}{{ comparison?.change === null ? '' : '%' }}
            </div>
          </div>
        </div>
        <KeywordTrendComparison :keyword="keyword" />
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
        <GoogleTrendInsights :keyword="keyword" style="margin-top: 20px" />
      </template>
    </section>
    <div class="hci-demo-note">
      0–100为同一查询中的相对热度，不代表搜索次数；不同国家与不同查询批次不能直接比较绝对需求。真实序列来自Google
      Trends公开网页接口或官网导出的真实序列。过去一年通常返回周数据，按实际日期展示；30天指标另取日数据计算，日数据失败不会清除已采集的一年曲线。
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
