<script setup lang="ts">
import type { FreeSourceData } from './public-sources';
import type { PublicCollectorData, RadarFinding, RadarSourceCoverage } from './radar-engine';

import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Drawer,
  Empty,
  message,
  Modal,
  Progress,
  Segmented,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { cloudRequest } from './cloud-workspace';
import Chart from './components/Chart.vue';
import DailyDiscoveryPlan from './components/DailyDiscoveryPlan.vue';
import PageHeader from './components/PageHeader.vue';
import { download, marketName, state } from './data';
import {
  buildCollectedRadarFindings,
  buildFreeSourceRadarFindings,
  buildRadarFindings,
  buildRadarReport,
  buildSourceCoverage,
  RADAR_RULES_VERSION,
} from './radar-engine';
import { serverMode } from './session';
import { radarStatistics } from './statistics-engine';
import { useStatistics } from './statistics-queries';

const router = useRouter();
const windowDays = ref(7);
const findingType = ref('all');
const includeDemo = ref(false);
const selected = ref<RadarFinding>();
watch(() => state.market, () => { selected.value = undefined; });
const reportOpen = ref(false);
const sourceOpen = ref(false);
const collectorData = ref<null | PublicCollectorData>(null);
const freeSourceData = ref<FreeSourceData | null>(null);
const page = ref(1); const pageSize = ref(20);
watch(() => [state.market, windowDays.value, findingType.value], () => { page.value = 1; selected.value = undefined; reportOpen.value = false; });
const remote = useStatistics<RadarFinding>(computed(() => ({ kind: 'radar', market: state.market, days: windowDays.value, type: findingType.value, page: page.value, pageSize: pageSize.value })));
const rulesUpdating = computed(() => serverMode && !!remote.snapshot.value && (remote.snapshot.value.rulesStale || remote.snapshot.value.radarRulesVersion !== RADAR_RULES_VERSION));
const awaitingSnapshot = computed(() => serverMode && (!remote.snapshot.value || rulesUpdating.value));
watch(remote.pagination, value => { page.value = value.page; });

const allFindings = computed(() => serverMode ? awaitingSnapshot.value ? [] : remote.rows.value : [
  ...buildCollectedRadarFindings(collectorData.value, windowDays.value),
  ...buildFreeSourceRadarFindings(freeSourceData.value, windowDays.value),
  ...buildRadarFindings(state, windowDays.value, includeDemo.value),
]);
const findings = computed(() =>
  allFindings.value.filter(
    (item) =>
      (state.market === 'ALL' || item.market === state.market) &&
      (findingType.value === 'all' || item.type === findingType.value),
  ),
);
const sourceCoverage = computed(() =>
  serverMode ? (remote.snapshot.value?.coverage as RadarSourceCoverage[] || []) : buildSourceCoverage(state, collectorData.value, freeSourceData.value),
);
const serverReport = ref('');
watch(rulesUpdating, (value) => {
  if (value) { selected.value = undefined; reportOpen.value = false; serverReport.value = ''; }
});
const report = computed(() =>
  serverMode ? serverReport.value : buildRadarReport(findings.value, windowDays.value, marketName(state.market), state.branding.appName),
);
const summary = computed(() => serverMode ? awaitingSnapshot.value ? undefined : remote.snapshot.value?.summary : radarStatistics(findings.value));
const counts = computed(() => serverMode ? summary.value?.counts || { ad: 0, product: 0, concept: 0, ingredient: 0, verified: 0 } : ({
  ad: findings.value.filter((item) => item.type === 'ad').length,
  product: findings.value.filter((item) => item.type === 'product').length,
  concept: findings.value.filter((item) => item.type === 'concept').length,
  ingredient: findings.value.filter((item) => item.type === 'ingredient')
    .length,
  verified: findings.value.filter((item) => item.confidenceScore >= 70).length,
}));
const averageScore = computed(() => {
  if (serverMode) return summary.value?.averageScore ?? null;
  const values = findings.value
    .map((item) => item.businessScore)
    .filter((value): value is number => value !== null);
  return values.length > 0
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
});
const demoCount = computed(
  () => findings.value.filter((item) => item.status === 'demo').length,
);

const columns = [
  { title: '候选', key: 'candidate', width: 280 },
  { title: '类型', key: 'type', width: 90 },
  { title: '市场', key: 'market', width: 90 },
  { title: '首次发现', dataIndex: 'firstSeenAt', width: 110 },
  { title: '证据完整度', key: 'confidence', width: 150 },
  { title: '线索评分', key: 'business', width: 130 },
  { title: '采用/关联', key: 'adoption', width: 100 },
  { title: '状态', key: 'status', width: 120 },
  { title: '操作', key: 'action', width: 80, fixed: 'right' as const },
];

const statusLabel: Record<string, string> = {
  confirmed: '来源日期已核验',
  demo: '演示样本',
  'newly-discovered': '近期新发现',
  pending: '待交叉验证',
};
const statusColor: Record<string, string> = {
  confirmed: 'green',
  demo: 'default',
  'newly-discovered': 'blue',
  pending: 'orange',
};
const typeLabel: Record<string, string> = {
  ad: '广告线索',
  product: '商品发现',
  concept: '卖点/话题',
  ingredient: '成分线索',
};

onMounted(async () => {
  if (serverMode) return;
  const [collectorResult, freeResult] = await Promise.allSettled([
    fetch(`${import.meta.env.BASE_URL}data/public-site-observations.json`),
    fetch(`${import.meta.env.BASE_URL}data/free-source-observations.json`),
  ]);
  if (collectorResult.status === 'fulfilled' && collectorResult.value.ok)
    collectorData.value = await collectorResult.value.json();
  if (freeResult.status === 'fulfilled' && freeResult.value.ok)
    freeSourceData.value = await freeResult.value.json();
});

const activityOption = computed(() => {
  const anchor = new Date(serverMode && remote.snapshot.value ? remote.snapshot.value.generatedAt : Date.now());
  const dates = Array.from({ length: windowDays.value }, (_, index) => new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - windowDays.value + index + 1)));
  const labels = dates.map((date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}`);
  const series = (type: string) =>
    dates.map((date) => {
      const key = date.toISOString().slice(0, 10);
      return serverMode ? summary.value?.activity[key]?.[type] || 0 : findings.value.filter(
        (item) => item.type === type && item.firstSeenAt.slice(0, 10) === key,
      ).length;
    });
  return {
    color: ['#198771', '#647cc4', '#dc9c43', '#9c6ac4'],
    tooltip: { trigger: 'axis' },
    legend: { data: ['商品发现', '卖点/话题', '成分线索', '广告线索'], bottom: 0 },
    grid: { left: 32, right: 14, top: 20, bottom: 42 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: '#e6ebee' } },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#e9eef1', type: 'dashed' } },
    },
    series: [
      { name: '广告线索', type: 'bar', stack: 'total', data: series('ad') },
      { name: '商品发现', type: 'bar', stack: 'total', data: series('product') },
      { name: '卖点/话题', type: 'bar', stack: 'total', data: series('concept') },
      {
        name: '成分线索',
        type: 'bar',
        stack: 'total',
        data: series('ingredient'),
      },
    ],
  };
});

const typeOption = computed(() => ({
  color: ['#198771', '#647cc4', '#dc9c43'],
  tooltip: { trigger: 'item' },
  legend: { bottom: 0 },
  series: [
    {
      type: 'pie',
      radius: ['46%', '70%'],
      center: ['50%', '45%'],
      label: { formatter: '{b}\n{c}' },
      data: [
        { name: '商品发现', value: counts.value.product },
        { name: '广告线索', value: counts.value.ad },
        { name: '卖点/话题', value: counts.value.concept },
        { name: '成分线索', value: counts.value.ingredient },
      ],
    },
  ],
}));

async function loadReport() {
  if (!serverMode) return true;
  const scope = JSON.stringify([state.market, windowDays.value, findingType.value]);
  try {
    const result = await cloudRequest<{ report: string }>('server_workspace_statistics', { kind: 'radar', market: state.market, days: windowDays.value, type: findingType.value, report: true, appName: state.branding.appName });
    if (!result.report) throw new Error('雷达汇总尚在生成，请稍后重试');
    if (scope !== JSON.stringify([state.market, windowDays.value, findingType.value])) return false;
    serverReport.value = result.report;
    return true;
  } catch (error) { message.error((error as Error).message); return false; }
}
async function showReport() { if (await loadReport()) reportOpen.value = true; }
async function exportReport() {
  if (!await loadReport()) return;
  download(
    `新品雷达-${marketName(state.market)}-${windowDays.value}天.txt`,
    report.value,
  );
}

function selectFinding(record: unknown) {
  selected.value = record as RadarFinding;
}

function openRelated(item: RadarFinding) {
  if (item.type === 'ad') {
    router.push({ path: '/ads', query: { ad: item.id.replace('radar-ad-', '') } });
    return;
  }
  if (item.type === 'product') {
    const productId = item.id.replace('radar-product-', '');
    router.push({ path: '/products', query: { product: productId } });
    return;
  }
  router.push({ path: '/research', query: { q: item.title } });
}
</script>

<template>
  <main class="hci-page">
    <PageHeader
      title="新品雷达"
      description="商品记录、卖点表达、成分标签与相关需求证据。"
    >
      <Button @click="sourceOpen = true">数据来源</Button>
      <DailyDiscoveryPlan />
      <Button @click="router.push('/signals')">公共情报源</Button>
      <Button @click="router.push('/imports')">导入真实数据</Button>
      <Button type="primary" :disabled="awaitingSnapshot" @click="showReport">生成分析报告</Button>
    </PageHeader>
    <Alert v-if="remote.error.value" type="error" :message="remote.error.value" show-icon />
    <p v-if="serverMode" class="hci-subtle" role="status">{{ rulesUpdating ? '判定口径更新中…' : remote.snapshot.value ? `数据更新于 ${new Date(remote.snapshot.value.generatedAt).toLocaleString('zh-CN')}` : remote.loading.value ? '正在加载雷达汇总…' : '雷达汇总更新中…' }}<span v-if="remote.snapshot.value?.publicDataStale"> · 公共情报源暂不可用，保留上次结果</span></p>

    <Alert
      v-if="demoCount"
      class="hci-radar-alert"
      type="warning"
      show-icon
      message="当前结果包含演示样本"
      description="演示样本只验证计算和交互。关闭“包含演示样本”后，正式报告只使用人工导入或公开采集的数据。"
    />

    <div class="hci-radar-filterbar">
      <div>
        <span>观察窗口</span>
        <Segmented
          v-model:value="windowDays"
          :options="[
            { label: '3天', value: 3 },
            { label: '7天', value: 7 },
            { label: '14天', value: 14 },
            { label: '30天', value: 30 },
          ]"
        />
      </div>
      <div>
        <span>候选类型</span>
        <Select
          v-model:value="findingType"
          :options="[
            { label: '全部类型', value: 'all' },
            { label: '新品', value: 'product' },
            { label: '新广告', value: 'ad' },
            { label: '新概念', value: 'concept' },
            { label: '新成分', value: 'ingredient' },
          ]"
          style="width: 130px"
        />
      </div>
      <label v-if="!serverMode" class="hci-radar-demo-toggle">
        <Switch v-model:checked="includeDemo" size="small" />
        <span>包含演示样本</span>
      </label>
    </div>

    <section class="hci-stats hci-radar-stats">
      <button class="hci-stat" @click="findingType = 'ad'">
        <div class="hci-stat-label"><span>新广告线索</span><Tag>投放证据</Tag></div>
        <div class="hci-stat-value">{{ awaitingSnapshot ? '...' : counts.ad }}</div>
        <div class="hci-stat-foot">区分近期投放与首次发现</div>
      </button>
      <button class="hci-stat" @click="findingType = 'product'">
        <div class="hci-stat-label">
          <span>商品发现</span><Tag>来源记录</Tag>
        </div>
        <div class="hci-stat-value">{{ awaitingSnapshot ? '...' : counts.product }}</div>
        <div class="hci-stat-foot">来源确认90天内上架：{{ awaitingSnapshot ? '...' : summary?.confirmedProducts ?? '待更新' }} 项</div>
      </button>
      <button class="hci-stat" @click="findingType = 'concept'">
        <div class="hci-stat-label">
          <span>卖点/话题线索</span><Tag>待验证</Tag>
        </div>
        <div class="hci-stat-value">{{ awaitingSnapshot ? '...' : counts.concept }}</div>
        <div class="hci-stat-foot">商品表达与内容话题</div>
      </button>
      <button class="hci-stat" @click="findingType = 'ingredient'">
        <div class="hci-stat-label">
          <span>成分线索</span><Tag>标签证据</Tag>
        </div>
        <div class="hci-stat-value">{{ awaitingSnapshot ? '...' : counts.ingredient }}</div>
        <div class="hci-stat-foot">标签出现不代表新原料</div>
      </button>
      <button class="hci-stat" @click="findingType = 'all'">
        <div class="hci-stat-label">
          <span>平均线索分</span><Tag>待验证</Tag>
        </div>
        <div class="hci-stat-value">{{ awaitingSnapshot ? '...' : averageScore ?? '—' }}</div>
        <div class="hci-stat-foot">可评分：{{ awaitingSnapshot ? '...' : summary?.scored ?? '待更新' }} 项</div>
      </button>
    </section>

    <Spin :spinning="awaitingSnapshot">
    <section class="hci-two-col">
      <div class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>发现活动</h2>
            <p>按首次发现时间统计，不等同于确认上市日期。</p>
          </div>
        </div>
        <Chart :options="activityOption" />
      </div>
      <div class="hci-panel">
        <div class="hci-panel-head">
          <div>
            <h2>候选结构</h2>
            <p>{{ marketName(state.market) }} · 最近{{ windowDays }}天</p>
          </div>
        </div>
        <Chart :options="typeOption" />
      </div>
    </section>
    </Spin>

    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>候选清单</h2>
          <p>缺少直接关联的有效趋势或近期广告时，线索评分为数据不足。</p>
        </div>
        <span class="hci-subtle">{{ awaitingSnapshot ? '...' : serverMode ? remote.total.value : findings.length }} 项结果</span>
      </div>
      <div v-if="findings.length || (serverMode && (remote.loading.value || awaitingSnapshot))" class="hci-data-table">
        <Table
          :columns="columns"
          :data-source="findings"
          :loading="remote.loading.value || awaitingSnapshot"
          :pagination="serverMode ? { current: page, pageSize, total: awaitingSnapshot ? 0 : remote.total.value, showSizeChanger: true, pageSizeOptions: ['20', '50', '100'], onChange: (p: number, size: number) => { page = p; pageSize = size; } } : { pageSize: 8, hideOnSinglePage: true }"
          :scroll="{ x: 1150 }"
          row-key="id"
          size="middle"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'candidate'">
              <button
                class="hci-radar-candidate"
                @click="selectFinding(record)"
              >
                <b>{{ record.title }}</b>
                <span>{{ record.subtitle }}</span>
              </button>
            </template>
            <template v-else-if="column.key === 'type'">
              <Tag>{{ typeLabel[record.type] }}</Tag>
            </template>
            <template v-else-if="column.key === 'market'">
              {{ marketName(record.market) }}
            </template>
            <template v-else-if="column.key === 'confidence'">
              <div class="hci-radar-score">
                <Progress
                  :percent="record.confidenceScore"
                  :show-info="false"
                  size="small"
                  stroke-color="#198771"
                />
                <b>{{ record.confidenceScore }}</b>
              </div>
            </template>
            <template v-else-if="column.key === 'business'">
              <Tooltip
                :title="
                  record.businessScore === null
                    ? '缺少关键业务数据，暂不评分'
                    : '直接关联的趋势、近期广告及品牌采用线索；不含成本、利润或供应链验证'
                "
              >
                <b class="hci-metric-number">{{
                  record.businessScore ?? '数据不足'
                }}</b>
              </Tooltip>
            </template>
            <template v-else-if="column.key === 'adoption'">
              {{ record.adoptionCount }}
              {{ record.type === 'ad' ? '个关键词' : record.type === 'product' ? '个商品' : '个品牌' }}
            </template>
            <template v-else-if="column.key === 'status'">
              <Tag :color="statusColor[record.status]">
                {{ statusLabel[record.status] }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'action'">
              <Button type="link" size="small" @click="selectFinding(record)">
                证据
              </Button>
            </template>
          </template>
        </Table>
      </div>
      <Empty
        v-else
        description="当前条件没有真实数据，请导入商品、关键词、趋势或广告资料"
      >
        <Button type="primary" @click="router.push('/imports')">去导入</Button>
      </Empty>
    </section>

    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>真实数据覆盖</h2>
          <p>演示样本不计入覆盖率；正式结论必须能够回到来源证据。</p>
        </div>
        <Button size="small" @click="sourceOpen = true">查看采集边界</Button>
      </div>
      <div class="hci-radar-sources">
        <div v-for="source in sourceCoverage" :key="source.key">
          <span class="hci-source-mark">{{ source.label.slice(0, 1) }}</span>
          <div>
            <b>{{ source.label }}</b>
            <p>{{ source.note }}</p>
            <small>最后更新：{{ source.lastUpdated }}</small>
          </div>
          <div class="hci-radar-source-status">
            <Tag
              :color="
                source.status === 'available'
                  ? 'green'
                  : source.status === 'partial'
                    ? 'orange'
                    : 'default'
              "
            >
              {{ source.count }} 条真实记录
            </Tag>
            <small>{{ source.automated ? '自动采集' : '导入/待接入' }}</small>
          </div>
        </div>
      </div>
    </section>

    <Drawer
      :open="!!selected"
      width="620"
      title="候选证据与判断"
      @close="selected = undefined"
    >
      <template v-if="selected">
        <div class="hci-radar-drawer-head">
          <div>
            <Tag>{{ typeLabel[selected.type] }}</Tag>
            <Tag :color="statusColor[selected.status]">
              {{ statusLabel[selected.status] }}
            </Tag>
            <h2>{{ selected.title }}</h2>
            <p>{{ selected.subtitle }}</p>
          </div>
          <div class="hci-radar-dual-score">
            <span><b>{{ selected.confidenceScore }}</b>证据完整度</span>
            <span><b>{{ selected.businessScore ?? '—' }}</b>线索评分</span>
          </div>
        </div>

        <h3 class="hci-radar-section-title">为什么进入雷达</h3>
        <ul class="hci-radar-reasons">
          <li v-for="reason in selected.rationale" :key="reason">
            {{ reason }}
          </li>
        </ul>

        <h3 class="hci-radar-section-title">来源证据</h3>
        <div class="hci-radar-evidence">
          <article v-for="evidence in selected.evidence" :key="evidence.id">
            <div>
              <Tag>{{ evidence.kind }}</Tag>
              <b>{{ evidence.source }}</b>
              <time>{{ evidence.observedAt }}</time>
            </div>
            <p>{{ evidence.detail }}</p>
            <a
              v-if="evidence.url && !evidence.url.includes('.example')"
              :href="evidence.url"
              target="_blank"
              rel="noreferrer"
              >打开来源 ↗</a>
            <span v-else class="hci-subtle">演示来源，不提供外链</span>
          </article>
        </div>

        <template v-if="selected.gaps.length">
          <h3 class="hci-radar-section-title">还缺什么</h3>
          <Alert
            v-for="gap in selected.gaps"
            :key="gap"
            :message="gap"
            type="warning"
            show-icon
            class="hci-radar-gap"
          />
        </template>

        <div class="hci-radar-drawer-actions">
          <Button @click="router.push('/reviews')">进入人工审核</Button>
          <Button type="primary" @click="openRelated(selected)">
            查看关联数据
          </Button>
        </div>
      </template>
    </Drawer>

    <Modal
      v-model:open="reportOpen"
      title="新品雷达分析报告"
      width="760px"
      ok-text="导出报告"
      cancel-text="关闭"
      @ok="exportReport"
    >
      <pre class="hci-radar-report">{{ report }}</pre>
    </Modal>

    <Drawer
      v-model:open="sourceOpen"
      width="560"
      title="数据来源与自动采集边界"
    >
      <div class="hci-radar-source-guide">
        <article>
          <Tag color="green">可自动</Tag>
          <h3>品牌官网与独立站</h3>
          <p>
            读取站点地图、新品集合页、商品页结构化数据和品牌公告，低频采集并保存变化证据。
          </p>
        </article>
        <article>
          <Tag color="blue">可导入</Tag>
          <h3>Google Trends网页数据</h3>
          <p>
            导入同一市场、同一查询批次下载的时序文件；不同批次的0至100指数不直接相加。
          </p>
        </article>
        <article>
          <Tag color="orange">需授权</Tag>
          <h3>广告、Amazon与商业数据库</h3>
          <p>
            使用已授权API或账号导出文件。只有广告证据时标记为“新广告信号”，不会确认新品。
          </p>
        </article>
        <article>
          <Tag>停止采集</Tag>
          <h3>受限页面</h3>
          <p>
            遇到登录、403、429、验证码或站点禁止访问时自动停止，并切换为人工导入。
          </p>
        </article>
      </div>
    </Drawer>
  </main>
</template>
<style scoped>
@media (min-width: 1280px) {
  .hci-radar-stats {
    grid-template-columns: repeat(5, minmax(0, 1fr));
  }
}
</style>
