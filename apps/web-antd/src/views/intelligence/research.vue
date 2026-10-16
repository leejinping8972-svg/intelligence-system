<script setup lang="ts">
import type { Keyword, Market } from './data';

import { computed, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import PageHeader from './components/PageHeader.vue';
import {
  audit,
  categories,
  exportCsv,
  filteredKeywords,
  marketName,
  markets,
  state,
} from './data';
import { keywordJob, startKeywordJob, stopKeywordJob } from './keyword-jobs';
import {
  assessKeyword,
  KEYWORD_MODEL_VERSION,
  KEYWORD_MODEL_WEIGHTS,
} from './keyword-scoring';

const route = useRoute();
const router = useRouter();
const open = ref(false);
const modelOpen = ref(false);
const error = ref('');
const search = ref('');
const category = ref('ALL');
const rating = ref('ALL');
const ratingStatus = ref('ALL');
const tagFilter = ref('ALL');
const timeRange = ref('ALL');
const reviewFilter = ref('ALL');
const favoritesOnly = ref(false);
const selectedIds = ref<string[]>([]);
const detailId = ref('');
const pageSize = ref(10);
const currentPage = ref(1);
const gradeColors: Record<string, string> = {
  A: 'green',
  B: 'blue',
  C: 'gold',
  D: 'default',
};
const form = reactive({
  seeds: '',
  markets: (state.market === 'ALL' ? ['US'] : [state.market]) as Market[],
  sources: ['google_autocomplete', 'amazon_autocomplete'],
  depth: 1,
  limit: Math.min(100, state.settings.trendLimit),
});
watch(
  () => route.query.new,
  (value) => {
    if (value === '1') open.value = true;
  },
  { immediate: true },
);
watch(open, (value) => {
  if (value) {
    form.markets = state.market === 'ALL' ? ['US'] : [state.market];
    error.value = '';
  }
});
const allRows = computed(() =>
  filteredKeywords.value.map((record) => ({
    ...record,
    assessment: assessKeyword(record),
  })),
);
const tagOptions = computed(() => [
  { label: '全部标签', value: 'ALL' },
  ...[...new Set(allRows.value.flatMap((record) => record.assessment.tags))]
    .toSorted()
    .map((value) => ({ label: value, value })),
]);
const rows = computed(() =>
  allRows.value.filter((record) => {
    const collectedAt = record.collectedAt;
    const age = collectedAt
      ? (Date.now() - Date.parse(collectedAt)) / 86_400_000
      : Infinity;
    return (
      `${record.term} ${record.seedTerm || ''} ${record.assessment.tags.join(
        ' ',
      )}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()) &&
      (category.value === 'ALL' || record.category === category.value) &&
      (rating.value === 'ALL' ||
        (rating.value === 'UNRATED'
          ? !record.assessment.grade
          : record.assessment.grade === rating.value)) &&
      (ratingStatus.value === 'ALL' ||
        record.assessment.status === ratingStatus.value) &&
      (tagFilter.value === 'ALL' ||
        record.assessment.tags.includes(tagFilter.value)) &&
      (timeRange.value === 'ALL' ||
        (age >= 0 && age <= Number(timeRange.value))) &&
      (reviewFilter.value === 'ALL' ||
        (record.reviewStatus || 'pending') === reviewFilter.value) &&
      (!favoritesOnly.value || record.favorite)
    );
  }),
);
const selected = computed(() =>
  state.keywords.filter((record) => selectedIds.value.includes(record.id)),
);
const detail = computed(() =>
  state.keywords.find((record) => record.id === detailId.value),
);
const assessment = computed(() =>
  detail.value ? assessKeyword(detail.value) : undefined,
);
const summary = computed(() => ({
  total: allRows.value.length,
  priority: allRows.value.filter((record) =>
    ['A', 'B'].includes(record.assessment.grade || ''),
  ).length,
  pending: allRows.value.filter((record) => !record.assessment.grade).length,
  selected: allRows.value.filter((record) => record.reviewStatus === 'selected')
    .length,
}));
watch(
  [
    search,
    category,
    rating,
    ratingStatus,
    tagFilter,
    timeRange,
    reviewFilter,
    favoritesOnly,
    () => state.market,
  ],
  () => {
    currentPage.value = 1;
    selectedIds.value = [];
  },
);
const rowSelection = computed(() => ({
  selectedRowKeys: selectedIds.value,
  onChange: (keys: (number | string)[]) => {
    selectedIds.value = keys.map(String);
  },
  getCheckboxProps: (record: Keyword) => ({
    disabled: record.dataNature === 'demo',
  }),
}));
const pagination = computed(() => ({
  current: currentPage.value,
  pageSize: pageSize.value,
  pageSizeOptions: ['10', '20', '50', '100'],
  showSizeChanger: true,
  showTotal: (total: number) => `共 ${total} 条`,
  onChange: (page: number, size: number) => {
    currentPage.value = page;
    pageSize.value = size;
  },
}));
const columns = [
  { title: '关键词 / 种子词', key: 'term', width: 250, fixed: 'left' as const },
  { title: '市场 / 品类', key: 'market', width: 150 },
  { title: '研究评级', key: 'grade', width: 110 },
  {
    title: '研究评分',
    key: 'score',
    width: 130,
    sorter: (a: Keyword, b: Keyword) =>
      (assessKeyword(a).score ?? -1) - (assessKeyword(b).score ?? -1),
  },
  { title: '分析标签', key: 'tags', width: 240 },
  { title: '一年趋势 / 28天变化', key: 'trend', width: 170 },
  { title: '来源', key: 'source', width: 180 },
  {
    title: '抓取时间',
    key: 'collectedAt',
    width: 170,
    sorter: (a: Keyword, b: Keyword) =>
      (Date.parse(a.collectedAt || '') || 0) -
      (Date.parse(b.collectedAt || '') || 0),
  },
  { title: '人工筛选', key: 'review', width: 120 },
  { title: '操作', key: 'actions', width: 145, fixed: 'right' as const },
];
function formatTime(value?: string) {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('zh-CN', { hour12: false });
}
function sourceLabels(value: string) {
  return [
    ...new Set(
      value
        .replaceAll(' · 实采', '')
        .split(' / ')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}
function reviewLabel(value?: string) {
  if (value === 'selected') return '已入选';
  if (value === 'excluded') return '已排除';
  return '待人工筛选';
}
function markRecords(
  records: Keyword[],
  status: 'excluded' | 'pending' | 'selected',
) {
  for (const record of records) {
    record.reviewStatus = status;
    record.assessment = assessKeyword(record);
    audit(
      '关键词人工筛选',
      `${record.term} / ${reviewLabel(status)}`,
      record.market,
    );
  }
  message.success(`已将${records.length}个词标为${reviewLabel(status)}`);
}
function toggleFavorite(record: Record<string, unknown>) {
  const current = state.keywords.find((item) => item.id === record.id);
  if (current) current.favorite = !current.favorite;
}
async function createResearch() {
  const seeds = [
    ...new Set(
      form.seeds
        .split(/[\n,，]/)
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
  if (
    seeds.length === 0 ||
    form.markets.length === 0 ||
    form.sources.length === 0
  ) {
    error.value = '请填写种子词，至少选择一个市场和找词渠道。';
    return;
  }
  if (
    !Number.isInteger(form.limit) ||
    form.limit < 1 ||
    form.limit > 100 ||
    seeds.length * form.markets.length > form.limit
  ) {
    error.value = '结果上限为1～100，不能少于种子词与市场的组合数。';
    return;
  }
  if (!state.settings.researchApiUrl || !state.settings.researchAccessKey) {
    error.value = '请先到数据源与设置填写研究服务地址和访问码。';
    return;
  }
  const config = {
    apiUrl: state.settings.researchApiUrl,
    accessKey: state.settings.researchAccessKey,
    seeds,
    markets: [...form.markets],
    sources: form.sources.filter(
      (source): source is 'amazon_autocomplete' | 'google_autocomplete' =>
        source === 'google_autocomplete' || source === 'amazon_autocomplete',
    ),
    depth: form.depth,
    limit: form.limit,
  };
  open.value = false;
  state.market =
    config.markets.length === 1 ? config.markets[0] || 'US' : 'ALL';
  const job = startKeywordJob(config);
  message.success('关键词任务已提交，可在任务中心查看进度');
  await router.push('/monitor?tab=tasks');
  try {
    await job;
  } catch (error) {
    message.error(error instanceof Error ? error.message : '关键词研究未完成');
  }
}
async function refreshSelected() {
  if (selected.value.length === 0 || selected.value.length > 100) {
    message.warning('请勾选1～100个关键词');
    return;
  }
  if (!state.settings.researchAccessKey || !state.settings.researchApiUrl) {
    message.warning('请先在数据源与设置配置研究服务');
    return;
  }
  const records = [...selected.value];
  try {
    await startKeywordJob(
      {
        apiUrl: state.settings.researchApiUrl,
        accessKey: state.settings.researchAccessKey,
        seeds: [],
        markets: [...new Set(records.map((record) => record.market))],
        sources: ['google_autocomplete'],
        depth: 1,
        limit: records.length,
      },
      records,
    );
    message.success('趋势与评分已更新，缺失证据会在评分详情中说明');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '趋势更新失败');
  }
}
function exportKeywords() {
  exportCsv(
    '关键词研究与评级.csv',
    rows.value.map((record) => ({
      关键词: record.term,
      种子词: record.seedTerm || '',
      市场: record.market,
      品类: record.category,
      评级: record.assessment.grade || '待评级',
      评级状态: { rated: '正式评级', provisional: '暂评', pending: '待评级' }[
        record.assessment.status
      ],
      评分: record.assessment.score ?? '',
      数据覆盖率: `${record.assessment.coverage}%`,
      标签: record.assessment.tags.join('、'),
      决策建议: record.assessment.recommendation,
      来源: record.source,
      抓取时间: record.collectedAt || '',
      趋势抓取时间: record.trendCollectedAt || '',
      评分模型: record.assessment.version,
      人工筛选: reviewLabel(record.reviewStatus),
      备注: record.reviewNote || '',
    })),
  );
}
const metricsForm = reactive({
  monthlySearchVolume: undefined as number | undefined,
  difficulty: undefined as number | undefined,
  top3Share: undefined as number | undefined,
  source: '',
  date: '',
  note: '',
});
function openDetail(value: Record<string, unknown>) {
  const record = state.keywords.find((item) => item.id === value.id);
  if (!record) return;
  detailId.value = record.id;
  metricsForm.monthlySearchVolume =
    record.metrics?.monthlySearchVolume ?? undefined;
  metricsForm.difficulty = record.metrics?.difficulty ?? undefined;
  metricsForm.top3Share = record.metrics?.top3Share ?? undefined;
  metricsForm.source = record.metrics?.source || '';
  metricsForm.date =
    record.metrics?.collectedAt.slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  metricsForm.note = record.reviewNote || '';
}
function saveMetrics() {
  const record = detail.value;
  if (!record) return;
  const anyMetric = [
    metricsForm.monthlySearchVolume,
    metricsForm.difficulty,
    metricsForm.top3Share,
  ].some((value) => typeof value === 'number');
  if (
    anyMetric &&
    (!metricsForm.source.trim() ||
      !Number.isFinite(Date.parse(metricsForm.date)))
  ) {
    message.warning('补充指标时，请填写平台来源和数据日期');
    return;
  }
  if (
    (typeof metricsForm.monthlySearchVolume === 'number' &&
      metricsForm.monthlySearchVolume < 0) ||
    [metricsForm.difficulty, metricsForm.top3Share].some(
      (value) => typeof value === 'number' && (value < 0 || value > 100),
    )
  ) {
    message.warning('搜索量不能为负数，难度和份额应为0～100');
    return;
  }
  record.metrics = anyMetric
    ? {
        market: record.market,
        source: metricsForm.source.trim(),
        collectedAt: metricsForm.date,
        monthlySearchVolume: metricsForm.monthlySearchVolume ?? undefined,
        difficulty: metricsForm.difficulty ?? undefined,
        top3Share: metricsForm.top3Share ?? undefined,
      }
    : undefined;
  record.reviewNote = metricsForm.note.trim();
  record.assessment = assessKeyword(record);
  audit(
    '补充关键词评分依据',
    `${record.term} / ${metricsForm.source || '清空补充指标'}`,
    record.market,
  );
  message.success('评分依据已保存并重新评级');
}
</script>

<template>
  <main class="hci-page">
    <PageHeader
      title="关键词研究"
      description="第一步：发现需求、核验趋势、评级打标，人工决定哪些词值得深入研究。"
    >
      <Button @click="modelOpen = true">评分模型</Button>
      <Button :disabled="!rows.length" @click="exportKeywords">导出结果</Button>
      <Button
        type="primary"
        :disabled="keywordJob.running"
        @click="open = true"
      >
        ＋ 新建关键词研究
      </Button>
    </PageHeader>
    <div class="hci-demo-note keyword-stage-note">
      <b>1 关键词研究与评级</b><span>→ 人工选词</span><span>2 独立站研究</span><span>→ 人工选站</span><span>3 商品研究</span>
    </div>
    <Alert
      v-if="keywordJob.running"
      type="info"
      show-icon
      class="keyword-job-note"
    >
      <template #message>
        {{ keywordJob.phase }} · 已发现 {{ keywordJob.discovered }} 个词 ·
        已查询趋势 {{ keywordJob.trended }} 个词
      </template>
      <template #description>
        {{ keywordJob.message }}。任务完成前请保持系统页面打开。
        <Button type="link" @click="router.push('/monitor?tab=tasks')">
          查看进度
        </Button>
        <Button type="link" @click="stopKeywordJob">停止后续请求</Button>
      </template>
    </Alert>
    <div class="keyword-summary">
      <div>
        <span>当前市场关键词</span><b>{{ summary.total }}</b>
      </div>
      <div>
        <span>A / B 研究候选（含暂评）</span><b>{{ summary.priority }}</b>
      </div>
      <div>
        <span>证据不足 · 待评级</span><b>{{ summary.pending }}</b>
      </div>
      <div>
        <span>人工已入选</span><b>{{ summary.selected }}</b>
      </div>
    </div>
    <section class="hci-panel">
      <div class="hci-toolbar keyword-filters">
        <Input.Search
          v-model:value="search"
          placeholder="搜索关键词、种子词或标签"
          allow-clear
          aria-label="搜索关键词"
        />
        <Select
          v-model:value="category"
          aria-label="按研究品类筛选"
          :options="[
            { label: '全部品类', value: 'ALL' },
            ...categories.map((value) => ({ label: value, value })),
          ]"
        />
        <Select
          v-model:value="rating"
          aria-label="按评级筛选"
          :options="[
            { label: '全部评级', value: 'ALL' },
            ...['A', 'B', 'C', 'D'].map((value) => ({
              label: `${value} 类（含暂评）`,
              value,
            })),
            { label: '待评级', value: 'UNRATED' },
          ]"
        />
        <Select
          v-model:value="ratingStatus"
          aria-label="按评级状态筛选"
          :options="[
            { label: '全部评级状态', value: 'ALL' },
            { label: '正式评级', value: 'rated' },
            { label: '暂评（证据不完整）', value: 'provisional' },
            { label: '待评级', value: 'pending' },
          ]"
        />
        <Select
          v-model:value="tagFilter"
          :options="tagOptions"
          aria-label="按分析标签筛选"
          show-search
          option-filter-prop="label"
        />
        <Select
          v-model:value="timeRange"
          aria-label="按抓取时间筛选"
          :options="[
            { label: '全部抓取时间', value: 'ALL' },
            { label: '最近24小时', value: '1' },
            { label: '最近7天', value: '7' },
            { label: '最近30天', value: '30' },
          ]"
        />
        <Select
          v-model:value="reviewFilter"
          aria-label="按人工筛选状态筛选"
          :options="[
            { label: '全部人工状态', value: 'ALL' },
            { label: '待人工筛选', value: 'pending' },
            { label: '已入选', value: 'selected' },
            { label: '已排除', value: 'excluded' },
          ]"
        />
        <Checkbox v-model:checked="favoritesOnly">仅看收藏</Checkbox>
        <Button
          @click="
            search = '';
            category = 'ALL';
            rating = 'ALL';
            ratingStatus = 'ALL';
            tagFilter = 'ALL';
            timeRange = 'ALL';
            reviewFilter = 'ALL';
            favoritesOnly = false;
          "
        >
          重置筛选
        </Button>
      </div>
      <div class="hci-toolbar">
        <span class="hci-subtle">已选 {{ selected.length }} 个关键词</span>
        <Button
          :disabled="!selected.length || keywordJob.running"
          :loading="keywordJob.running"
          @click="refreshSelected"
        >
          补齐趋势与重评
        </Button>
        <Button
          type="primary"
          :disabled="!selected.length"
          @click="markRecords(selected, 'selected')"
        >
          标为入选
        </Button>
        <Button
          :disabled="!selected.length"
          @click="markRecords(selected, 'excluded')"
        >
          标为排除
        </Button>
        <span class="hci-toolbar-end hci-subtle">{{ rows.length }} 条筛选结果</span>
      </div>
      <Table
        :data-source="rows"
        :columns="columns"
        :row-selection="rowSelection"
        row-key="id"
        :pagination="pagination"
        :scroll="{ x: 1770 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'term'">
            <button class="hci-link keyword-term" @click="openDetail(record)">
              {{ record.term }}
            </button>
            <p class="hci-subtle">种子：{{ record.seedTerm || '历史记录' }}</p>
          </template>
          <template v-else-if="column.key === 'market'">
            <Tag>{{ marketName(record.market) }}</Tag>
            <p class="hci-subtle">{{ record.category }}</p>
          </template>
          <template v-else-if="column.key === 'grade'">
            <Tag :color="gradeColors[record.assessment.grade] || 'default'">
              {{ record.assessment.grade || '待评级' }}
            </Tag>
            <p class="hci-subtle">
              {{
                record.assessment.status === 'provisional'
                  ? '暂评'
                  : record.assessment.status === 'rated'
                    ? '正式评级'
                    : '证据不足'
              }}
            </p>
          </template>
          <template v-else-if="column.key === 'score'">
            <button class="hci-link" @click="openDetail(record)">
              {{ record.assessment.score ?? '—'
              }}{{ record.assessment.score === null ? '' : ' / 100' }}
            </button>
            <p class="hci-subtle">覆盖 {{ record.assessment.coverage }}%</p>
          </template>
          <template v-else-if="column.key === 'tags'">
            <div class="keyword-tags">
              <Tag v-for="tag in record.assessment.tags" :key="tag">
                {{ tag }}
              </Tag>
            </div>
          </template>
          <template v-else-if="column.key === 'trend'">
            <button
              v-if="record.series.length"
              class="hci-link"
              @click="
                router.push({ path: '/trends', query: { keyword: record.id } })
              "
            >
              查看一年曲线
            </button>
            <Tooltip v-else :title="record.trendMessage || '尚未采集趋势'">
              <Tag
                :color="record.trendStatus === 'failed' ? 'orange' : 'default'"
              >
                {{
                  record.trendStatus === 'pending'
                    ? '等待趋势'
                    : record.trendStatus === 'failed'
                      ? '趋势请求失败'
                      : '尚未采集'
                }}
              </Tag>
            </Tooltip>
            <p
              v-if="record.growth !== null"
              :class="record.growth >= 0 ? 'hci-positive' : 'hci-negative'"
            >
              28天 {{ record.growth > 0 ? '+' : '' }}{{ record.growth }}%
            </p>
            <Tooltip
              v-else
              :title="
                record.trendDailyMessage || '缺少有效日数据或基期为0，暂不计算'
              "
            >
              <p class="hci-subtle">28天变化待补证据</p>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'source'">
            <div class="keyword-tags">
              <Tag v-for="source in sourceLabels(record.source)" :key="source">
                {{ source }}
              </Tag>
            </div>
          </template>
          <template v-else-if="column.key === 'collectedAt'">
            <span>{{ formatTime(record.collectedAt) }}</span><Tooltip :title="formatTime(record.trendCollectedAt)">
              <p class="hci-subtle">
                趋势日期 {{ record.trendCollectedAt?.slice(0, 10) || '未记录' }}
              </p>
            </Tooltip>
          </template>
          <template v-else-if="column.key === 'review'">
            <Tag
              :color="
                record.reviewStatus === 'selected'
                  ? 'green'
                  : record.reviewStatus === 'excluded'
                    ? 'default'
                    : 'blue'
              "
            >
              {{ reviewLabel(record.reviewStatus) }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <Button type="link" @click="openDetail(record)">评分详情</Button><Button type="link" @click="toggleFavorite(record)">
              {{ record.favorite ? '已收藏' : '收藏' }}
            </Button>
          </template>
        </template>
      </Table>
    </section>
    <div class="hci-field-notes">
      <div>
        <b>分阶段决策</b><span>本页只发现关键词、补齐趋势和评分。标为入选仅记录人工决定，不会发起独立站或商品采集。</span>
      </div>
      <div>
        <b>评级与证据</b><span>A ≥80，B 65～79，C 50～64，D
          &lt;50。关键趋势不足则待评级；数据未覆盖完整时仅给暂评，缺失数据不按0分处理。</span>
      </div>
    </div>

    <Modal
      v-model:open="open"
      title="新建关键词研究 · 第一步"
      :width="720"
      ok-text="开始找词与评级"
      cancel-text="取消"
      :confirm-loading="keywordJob.running"
      @ok="createResearch"
    >
      <Alert
        message="发现关键词 → 采集一年趋势 → 分类、评分与打标 → 等待人工筛选"
        type="info"
        show-icon
        style="margin: 16px 0"
      />
      <Form layout="vertical">
        <Form.Item label="种子关键词（每行一个）" required>
          <Input.TextArea
            v-model:value="form.seeds"
            :rows="3"
            :maxlength="4000"
            placeholder="magnesium glycinate&#10;probiotics for women"
          />
        </Form.Item>
        <Form.Item label="目标市场" required>
          <Checkbox.Group
            v-model:value="form.markets"
            :options="
              markets.map((market) => ({
                label: market.name,
                value: market.code,
              }))
            "
          />
        </Form.Item>
        <Form.Item label="关键词发现渠道" required>
          <Checkbox.Group
            v-model:value="form.sources"
            :options="[
              { label: 'Google 联想词', value: 'google_autocomplete' },
              { label: 'Amazon 联想词', value: 'amazon_autocomplete' },
            ]"
          />
          <p class="hci-subtle">
            Amazon 联想支持美国和墨西哥。Similarweb、Semrush、Sorftime
            尚未配置为自动数据源，暂不发起这些平台的调用。
          </p>
        </Form.Item>
        <div class="hci-form-grid">
          <Form.Item label="扩词深度">
            <Select
              v-model:value="form.depth"
              :options="[
                { label: '一级：从种子词获取联想（推荐）', value: 1 },
                { label: '二级：对首轮联想继续扩词', value: 2 },
              ]"
            />
          </Form.Item>
          <Form.Item label="结果总数上限（包含种子词，所有市场合计）">
            <InputNumber
              v-model:value="form.limit"
              :min="1"
              :max="100"
              :precision="0"
            />
          </Form.Item>
        </div>
        <Form.Item label="趋势与评分">
          <p>
            每个入库关键词均单独查询过去一年 Google
            Trends，并尝试补齐28天日数据；随后计算五维评分、评级和标签。
          </p>
        </Form.Item>
      </Form>
      <Alert v-if="error" :message="error" type="error" show-icon />
      <p class="hci-subtle">
        本阶段使用现有免费公开接口，可能限流。搜索量和竞争指标可在评分详情中补充，来源与日期会保留。任务记录和结果仍保存在本浏览器，请在完成前保持系统页面打开。
      </p>
    </Modal>

    <Modal
      v-model:open="modelOpen"
      title="关键词研究评分模型"
      :width="740"
      :footer="null"
    >
      <p class="hci-subtle">
        模型 {{ KEYWORD_MODEL_VERSION }} ·
        评估是否值得深入研究，权重为初始业务规则，后续需用人工评审样本校准。
      </p>
      <div
        v-for="dimension in KEYWORD_MODEL_WEIGHTS"
        :key="dimension.key"
        class="hci-market-row"
      >
        <b>{{ dimension.label }}</b><span>{{ dimension.weight }}%</span>
      </div>
      <div class="hci-evidence">
        A ≥80，B 65～79，C 50～64，D
        &lt;50。缺失维度不补0，按已覆盖权重归一化；有有效趋势且覆盖至少60%时允许暂评。全部维度齐备才显示正式评级；关键趋势缺失则待评级。
      </div>
      <p>
        Google Trends
        仅用于走势，不代替搜索量。需求规模按同市场固定参考上沿评分：美国10万/月，墨西哥与越南5万/月；当前批次增减不会改变该参考。竞争维度中，关键词难度与前三站点搜索份额各占一半。
      </p>
      <p class="hci-subtle">
        只有一年数据不能确认年度季节性，因此不会自动下“季节性已证实”的结论。Semrush、Similarweb指标当前需手动录入，并注明来源、国家与日期；180天以前的数据不纳入当前评级。
      </p>
    </Modal>

    <Drawer
      :open="!!detail"
      title="关键词评分与人工决策"
      :width="720"
      @close="detailId = ''"
    >
      <template v-if="detail && assessment">
        <h2 class="keyword-detail-title">{{ detail.term }}</h2>
        <p class="hci-subtle">
          {{ marketName(detail.market) }} · {{ detail.category }} ·
          {{ assessment.version }}
        </p>
        <div class="hci-toolbar">
          <Tag :color="gradeColors[assessment.grade || '']">
            {{ assessment.grade || '待评级'
            }}{{ assessment.status === 'provisional' ? ' · 暂评' : '' }}
          </Tag>
          <b>{{ assessment.score ?? '—' }} / 100</b><span>数据覆盖 {{ assessment.coverage }}%</span>
        </div>
        <Alert
          :message="assessment.recommendation"
          :description="
            assessment.status === 'provisional'
              ? '当前仅为基于已覆盖维度的暂评，缺失证据请逐项补充。'
              : assessment.status === 'pending'
                ? '未将接口失败或缺失指标作为低分处理。'
                : '当前五个维度的数据已齐备。'
          "
          type="info"
          show-icon
        />
        <div class="keyword-tags" style="margin: 16px 0">
          <Tag v-for="tag in assessment.tags" :key="tag">{{ tag }}</Tag>
        </div>
        <div
          v-for="dimension in assessment.dimensions"
          :key="dimension.key"
          class="keyword-dimension"
        >
          <div>
            <b>{{ dimension.label }} · 权重 {{ dimension.weight }}%</b><strong>{{ dimension.score ?? '待补充'
              }}{{ dimension.score === null ? '' : ' / 100' }}</strong>
          </div>
          <p class="hci-subtle">{{ dimension.evidence }}</p>
          <span class="hci-subtle">已覆盖权重 {{ dimension.coveredWeight }} /
            {{ dimension.weight }}</span>
        </div>
        <p class="hci-subtle">
          关键词抓取：{{ formatTime(detail.collectedAt) }}<br />趋势抓取：{{
            formatTime(detail.trendCollectedAt)
          }}
        </p>
        <Button
          @click="
            router.push({ path: '/trends', query: { keyword: detail.id } })
          "
        >
          查看一年趋势与原始来源
        </Button>
        <h3 style="margin-top: 24px">补充平台指标与审核备注</h3>
        <p class="hci-subtle">
          填入同国家、同时间口径的平台数据。留空表示未知；0表示平台明确返回0。
        </p>
        <Form layout="vertical">
          <div class="hci-form-grid">
            <Form.Item label="目标国家月搜索量">
              <InputNumber
                v-model:value="metricsForm.monthlySearchVolume"
                :min="0"
                :precision="0"
              />
            </Form.Item>
            <Form.Item label="关键词难度（0～100）">
              <InputNumber
                v-model:value="metricsForm.difficulty"
                :min="0"
                :max="100"
              />
            </Form.Item>
            <Form.Item label="前三站点搜索份额（%，可选）">
              <InputNumber
                v-model:value="metricsForm.top3Share"
                :min="0"
                :max="100"
              />
            </Form.Item>
            <Form.Item label="指标日期">
              <Input v-model:value="metricsForm.date" type="date" />
            </Form.Item>
          </div>
          <Form.Item label="平台来源 / 报告依据">
            <Input
              v-model:value="metricsForm.source"
              placeholder="例如 Semrush 导出报告 / Similarweb 报告链接"
              :maxlength="500"
            />
          </Form.Item>
          <Form.Item label="人工筛选备注">
            <Input.TextArea
              v-model:value="metricsForm.note"
              :rows="3"
              :maxlength="1000"
              placeholder="记录入选、排除或需要补充核验的原因"
            />
          </Form.Item>
        </Form>
        <div class="hci-toolbar">
          <Button type="primary" @click="saveMetrics">保存依据并重评</Button><Button @click="markRecords([detail], 'selected')">标为入选</Button><Button @click="markRecords([detail], 'excluded')">标为排除</Button><Button @click="markRecords([detail], 'pending')">恢复待筛选</Button>
        </div>
      </template>
    </Drawer>
  </main>
</template>

<style scoped>
.keyword-stage-note {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
}

.keyword-job-note {
  margin-bottom: 20px;
}

.keyword-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.keyword-summary > div {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px;
  background: var(--hci-paper);
  border: 1px solid var(--hci-border, #e6ebee);
  border-radius: 12px;
}

.keyword-summary span {
  color: var(--hci-muted, #64748b);
}

.keyword-summary b {
  font-size: 25px;
}

.keyword-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.keyword-tags :deep(.ant-tag) {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.keyword-term {
  text-align: left;
  overflow-wrap: anywhere;
}

.keyword-detail-title {
  margin-bottom: 12px;
  font-size: 22px;
}

.keyword-dimension {
  padding: 16px 0;
  border-bottom: 1px solid var(--hci-border, #e6ebee);
}

.keyword-dimension > div {
  display: flex;
  gap: 16px;
  justify-content: space-between;
}

.keyword-dimension p {
  margin: 8px 0;
}

:global(.dark) .keyword-summary > div {
  background: var(--hci-paper);
}

@media (max-width: 760px) {
  .keyword-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
