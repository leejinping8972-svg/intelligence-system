<script setup lang="ts">
import type { PublicSignal } from './public-sources';

import { computed, onMounted, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import Chart from './components/Chart.vue';
import PageHeader from './components/PageHeader.vue';
import { serverMode } from './session';
import { csvValue, download, marketOptions, state } from './data';
import {
  kindMeta,
  publicMarketName,
  sourceMeta,
  sourceStatus,
} from './public-sources';
import type { FreeSourceData, PublicSignalKind } from './public-sources';

const data = ref<FreeSourceData>();
const loading = ref(true);
const loadError = ref('');
const sourceFilter = ref('ALL');
const kindFilter = ref('ALL');
const search = ref('');
const selected = ref<PublicSignal>();
const page = ref(1);
const pageSize = ref(10);
watch([search, sourceFilter, kindFilter, () => state.market], () => {
  page.value = 1;
});
function changePage(nextPage: number, size: number) {
  page.value = size === pageSize.value ? nextPage : 1;
  pageSize.value = size;
}

const runs = computed(() => data.value?.sourceRuns || []);
const sourceOptions = computed(() => [
  { label: '全部来源', value: 'ALL' },
  ...runs.value.map((run) => ({
    label: sourceMeta[run.source]?.label || run.source,
    value: run.source,
  })),
]);
const kindOptions = [
  { label: '全部信号', value: 'ALL' },
  ...Object.entries(kindMeta).map(([value, meta]) => ({
    label: meta.label,
    value,
  })),
];

const signals = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return (data.value?.signals || []).filter((signal) => {
    const marketMatch =
      state.market === 'ALL' ||
      signal.market === state.market ||
      signal.market === 'GLOBAL';
    const sourceMatch =
      sourceFilter.value === 'ALL' || signal.source === sourceFilter.value;
    const kindMatch =
      kindFilter.value === 'ALL' || signal.kind === kindFilter.value;
    const searchMatch =
      !needle ||
      [
        signal.title,
        signal.summary,
        signal.query,
        signal.brand,
        ...(signal.ingredients || []),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle);
    return marketMatch && sourceMatch && kindMatch && searchMatch;
  });
});

const summary = computed(() => ({
  sources: runs.value.filter((run) => run.status === 'success').length,
  products: signals.value.filter((item) => item.kind === 'product').length,
  science: signals.value.filter((item) =>
    ['research', 'trial', 'ingredient_profile'].includes(item.kind),
  ).length,
  regulatory: signals.value.filter((item) =>
    ['regulatory', 'safety_aggregate'].includes(item.kind),
  ).length,
}));

const sourceChart = computed(() => ({
  color: ['#198771'],
  tooltip: { trigger: 'axis' },
  grid: { left: 110, right: 22, top: 8, bottom: 28 },
  xAxis: { type: 'value', minInterval: 1 },
  yAxis: {
    type: 'category',
    data: runs.value.map((run) => sourceMeta[run.source]?.label || run.source),
  },
  series: [
    {
      type: 'bar',
      data: runs.value.map((run) => run.count),
      barMaxWidth: 18,
      itemStyle: { borderRadius: [0, 6, 6, 0] },
    },
  ],
}));

const kindChart = computed(() => {
  const groups = new Map<string, number>();
  for (const signal of signals.value) {
    const label = kindMeta[signal.kind]?.label || signal.kind;
    groups.set(label, (groups.get(label) || 0) + 1);
  }
  return {
    color: ['#198771', '#647cc4', '#dc9c43', '#8b5fbf', '#d46b62', '#4b99a7'],
    tooltip: { trigger: 'item' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '43%'],
        label: { formatter: '{b}\n{c}' },
        data: [...groups].map(([name, value]) => ({ name, value })),
      },
    ],
  };
});

const columns = [
  { title: '信号', key: 'signal', width: 320 },
  { title: '来源', key: 'source', width: 150 },
  { title: '类型', key: 'kind', width: 110 },
  { title: '市场', key: 'market', width: 90 },
  { title: '主题', dataIndex: 'query', width: 110 },
  { title: '来源日期', dataIndex: 'observedAt', width: 115 },
  { title: '操作', key: 'action', width: 80, fixed: 'right' as const },
];

onMounted(async () => {
  try {
    const response = await fetch(
      `${import.meta.env.BASE_URL}data/free-source-observations.json`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data.value = await response.json();
  } catch {
    loadError.value = '公共数据文件暂时不可用，请稍后刷新或查看自动任务状态。';
  } finally {
    loading.value = false;
  }
});

function exportSignals() {
  const rows = [
    ['来源', '类型', '市场', '主题', '标题', '摘要', '来源日期', '链接'],
    ...signals.value.map((item) => [
      sourceMeta[item.source]?.label || item.source,
      kindMeta[item.kind]?.label || item.kind,
      publicMarketName(item.market),
      item.query,
      item.title,
      item.summary,
      item.observedAt,
      item.url,
    ]),
  ];
  download(
    `公共情报源-${new Date().toISOString().slice(0, 10)}.csv`,
    `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\n')}`,
    'text/csv;charset=utf-8',
  );
}

function metricEntries(signal?: PublicSignal) {
  if (!signal?.metrics) return [];
  return Object.entries(signal.metrics).filter(
    ([, value]) => value !== null && value !== '' && value !== undefined,
  );
}

function kindLabel(kind: string) {
  return kindMeta[kind as PublicSignalKind]?.label || kind;
}

function kindColor(kind: string) {
  return kindMeta[kind as PublicSignalKind]?.color || 'default';
}

function selectSignal(record: Record<string, any>) {
  selected.value = record as PublicSignal;
}
</script>

<template>
  <main class="hci-page">
    <PageHeader
      title="公共情报源"
      description="自动汇集可零成本使用的官方或公共数据，并保留来源、日期、口径与限制。"
    >
      <Select
        v-model:value="state.market"
        :options="marketOptions"
        style="width: 180px"
        aria-label="国家市场"
      />
      <Button @click="exportSignals">导出当前结果</Button>
    </PageHeader>

    <Alert
      type="info"
      show-icon
      message="公共信号用于发现与验证，不代表销量、功效或因果关系"
      description="DSLD收录日期不等于商品首发日期；论文和临床登记不等于功效成立；CAERS报告不能估计发生率；新闻与视频只反映传播。"
    />

    <div class="hci-signal-stats">
      <article>
        <span>自动运行来源</span><b>{{ summary.sources }}</b
        ><small>无需付费调用</small>
      </article>
      <article>
        <span>公开商品标签</span><b>{{ summary.products }}</b
        ><small>当前筛选范围</small>
      </article>
      <article>
        <span>科研与成分证据</span><b>{{ summary.science }}</b
        ><small>文献、临床、成分档案</small>
      </article>
      <article>
        <span>监管与安全线索</span><b>{{ summary.regulatory }}</b
        ><small>召回与公开报告汇总</small>
      </article>
    </div>

    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>免费数据源运行状态</h2>
          <p>
            最后采集：{{
              data?.generatedAt?.slice(0, 19).replace('T', ' ') || '尚未运行'
            }}
          </p>
        </div>
        <Tag color="green">每日自动更新</Tag>
      </div>
      <div class="hci-free-source-grid">
        <article v-for="run in runs" :key="run.source">
          <span class="hci-source-mark">{{
            sourceMeta[run.source]?.mark || '?'
          }}</span>
          <div>
            <h3>{{ sourceMeta[run.source]?.label || run.source }}</h3>
            <p>{{ sourceMeta[run.source]?.purpose }}</p>
            <small>{{
              serverMode &&
              run.source === 'YOUTUBE' &&
              run.status === 'needs_key'
                ? '本次采集尚未使用 YouTube Key；配置或更新后，由下一轮采集刷新状态'
                : run.note
            }}</small>
            <RouterLink
              v-if="serverMode && run.source === 'YOUTUBE'"
              class="hci-link"
              :to="{ path: '/settings', hash: '#youtube-provider' }"
              >配置 YouTube Key</RouterLink
            >
          </div>
          <div class="hci-free-source-state">
            <Tag :color="sourceStatus(run).color">{{
              sourceStatus(run).label
            }}</Tag>
            <b>{{ run.count }} 条</b>
            <a :href="run.documentation" target="_blank" rel="noreferrer"
              >官方说明</a
            >
          </div>
        </article>
      </div>
    </section>

    <div class="hci-equal-col">
      <section class="hci-panel hci-signal-chart">
        <div class="hci-panel-head"><h2>各来源本次采集量</h2></div>
        <Chart :options="sourceChart" />
      </section>
      <section class="hci-panel hci-signal-chart">
        <div class="hci-panel-head"><h2>当前信号结构</h2></div>
        <Chart :options="kindChart" />
      </section>
    </div>

    <section class="hci-panel">
      <div class="hci-panel-head">
        <div>
          <h2>公共信号明细</h2>
          <p>选择国家时会同时保留全球科研证据。</p>
        </div>
        <span>{{ signals.length }} 条结果</span>
      </div>
      <div class="hci-signal-filters">
        <Input
          v-model:value="search"
          allow-clear
          placeholder="搜索商品、品牌、成分、标题或主题"
        />
        <Select v-model:value="sourceFilter" :options="sourceOptions" />
        <Select v-model:value="kindFilter" :options="kindOptions" />
      </div>
      <Alert v-if="loadError" type="error" show-icon :message="loadError" />
      <Table
        v-else
        :loading="loading"
        :columns="columns"
        :data-source="signals"
        :row-key="(record: PublicSignal) => record.id"
        :scroll="{ x: 1080 }"
        :pagination="{
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total: number) => `共 ${total} 条`,
          onChange: changePage,
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'signal'">
            <button class="hci-link-button" @click="selectSignal(record)">
              <b>{{ record.title }}</b>
              <small>{{ record.summary || '暂无摘要' }}</small>
            </button>
          </template>
          <template v-else-if="column.key === 'source'">
            <Tag :color="sourceMeta[record.source]?.color || 'default'">
              {{ sourceMeta[record.source]?.label || record.source }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'kind'">
            <Tag :color="kindColor(record.kind)">
              {{ kindLabel(record.kind) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'market'">
            {{ publicMarketName(record.market) }}
          </template>
          <template v-else-if="column.key === 'action'">
            <Button size="small" @click="selectSignal(record)">详情</Button>
          </template>
        </template>
        <template #emptyText>
          <Empty description="当前条件没有公共信号" />
        </template>
      </Table>
    </section>

    <Drawer
      :open="!!selected"
      title="公共信号证据"
      width="min(620px, 94vw)"
      @close="selected = undefined"
    >
      <template v-if="selected">
        <div class="hci-signal-detail-head">
          <div>
            <Tag :color="kindMeta[selected.kind]?.color">
              {{ kindLabel(selected.kind) }}
            </Tag>
            <Tag>{{ publicMarketName(selected.market) }}</Tag>
          </div>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.summary }}</p>
        </div>
        <div class="hci-evidence">
          <b>来源</b>
          <p>{{ sourceMeta[selected.source]?.label || selected.source }}</p>
          <b>主题</b>
          <p>{{ selected.query }} · {{ selected.category }}</p>
          <b>来源日期</b>
          <p>{{ selected.observedAt }}</p>
          <template v-if="selected.brand">
            <b>品牌</b>
            <p>{{ selected.brand }}</p>
          </template>
          <template v-if="selected.ingredients?.length">
            <b>标签成分</b>
            <div class="hci-signal-tags">
              <Tag v-for="ingredient in selected.ingredients" :key="ingredient">
                {{ ingredient }}
              </Tag>
            </div>
          </template>
          <template v-if="metricEntries(selected).length">
            <b>来源指标</b>
            <p v-for="[key, value] in metricEntries(selected)" :key="key">
              {{ key }}：{{ Array.isArray(value) ? value.join(' / ') : value }}
            </p>
          </template>
        </div>
        <Alert
          style="margin-top: 16px"
          type="warning"
          show-icon
          message="解释限制"
          description="该记录只能支持页面标注的信号类型。需要商品官网、趋势、广告或供应链数据交叉验证后，才能进入商业决策。"
        />
        <Button
          type="primary"
          style="margin-top: 18px"
          :href="selected.url"
          target="_blank"
        >
          打开原始来源
        </Button>
      </template>
    </Drawer>
  </main>
</template>
