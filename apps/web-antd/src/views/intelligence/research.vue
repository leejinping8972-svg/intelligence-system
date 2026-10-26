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
  Spin,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { cloudWorkspace, loadWorkspaceDetail, syncCloudWorkspace } from './cloud-workspace';
import { serverMode } from './session';
import { useOverviewSnapshot, useWorkspaceList } from './workspace-queries';
import WorkspaceReadStatus from './components/WorkspaceReadStatus.vue';
import { researchSourceTags } from './competitor-monitor';
import CompactTags from './components/CompactTags.vue';
import KeywordRelatedQueries from './components/KeywordRelatedQueries.vue';
import KeywordNamesDialog from './components/KeywordNamesDialog.vue';
import KeywordTrendComparison from './components/KeywordTrendComparison.vue';
import KeywordTrendDialog from './components/KeywordTrendDialog.vue';
import PageHeader from './components/PageHeader.vue';
import CoreListControls from './components/CoreListControls.vue';
import CoreMetricsPanel from './components/CoreMetricsPanel.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
const core = useCoreList('keywords');
const { preset: corePreset, period: corePeriod } = core;
import KeywordTrendsControl from './components/KeywordTrendsControl.vue';
import SocialTrendCell from './components/SocialTrendCell.vue';
import { keywordChineseName } from './keyword-names';
import { emptyScoreFilter, matchesScore } from './resource-list';
import PublicContentLauncher from './components/PublicContentLauncher.vue';
import ScoreRangeFilter from './components/ScoreRangeFilter.vue';
import SemrushHotwordsSidebar from './components/SemrushHotwordsSidebar.vue';
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
import {
  rememberSelection,
  requireCompleteSelection,
  resolveSelection,
} from './keyword-selection';
import { keywordSourceStatus } from './site-discovery';

const route = useRoute();
const router = useRouter();
const open = ref(false);
const modelOpen = ref(false);
const supplementSubmitting = ref(false);
const researchError = ref('');
const checkingSource = ref(false);
const search = ref('');
const category = ref('ALL');
const rating = ref('ALL');
const ratingStatus = ref('ALL');
const scoreFilter = ref(emptyScoreFilter());
const tagFilter = ref<string[]>([]);
const timeRange = ref('ALL');
const reviewFilter = ref('ALL');
const favoritesOnly = ref(false);
const selectedIds = ref<string[]>([]);
const selectionSnapshots = ref<ReturnType<typeof rememberSelection>>(new Map());
function clearSelection() {
  selectedIds.value = [];
  selectionSnapshots.value = new Map();
}
const detailId = ref('');
const detailLoading = ref(false);
const detailError = ref('');
let detailSequence = 0;
function closeDetail() { detailSequence += 1; detailId.value = ''; detailLoading.value = false; detailError.value = ''; }
watch(
  () => state.market,
  () => {
    closeDetail();
    tagFilter.value = [];
  },
);
const pageSize = ref(10);
const currentPage = ref(1);
const remote = useWorkspaceList<Keyword>('keywords', computed(() => ({
  market: state.market, search: search.value, category: category.value,
  rating: rating.value, ratingStatus: ratingStatus.value, score: scoreFilter.value,
  tags: tagFilter.value, timeRange: timeRange.value, review: reviewFilter.value, favorite: favoritesOnly.value,
})), currentPage, pageSize);
const overview = useOverviewSnapshot();
const gradeColors: Record<string, string> = {
  A: 'green',
  B: 'blue',
  C: 'gold',
  D: 'default',
};
const form = reactive({
  seeds: '',
  markets: (state.market === 'ALL' ? ['US'] : [state.market]) as Market[],
  sources: ['google_autocomplete', 'amazon_autocomplete', 'semrush'],
  depth: 1,
  limit: Math.min(100, state.settings.trendLimit),
});
const automaticSorftimeCalls = computed(() => {
  const seedCount = new Set(
    form.seeds
      .split(/[\n,，]/)
      .map((seed) => seed.normalize('NFKC').replaceAll(/\s+/g, ' ').trim())
      .filter(Boolean),
  ).size;
  const remaining = Number(form.limit) - seedCount * form.markets.length;
  const supported =
    seedCount *
    form.markets.filter((market) => market === 'US' || market === 'MX').length;
  if (!supported || remaining <= 0) return 0;
  return form.depth === 2
    ? Math.min(Number(form.limit), supported + remaining)
    : supported;
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
    researchError.value = '';
  }
});
const allRows = computed(() =>
  filteredKeywords.value.map((record) => {
    const assessment = assessKeyword(record);
    return {
      ...record,
      assessment: {
        ...assessment,
        tags: [
          ...new Set([
            ...assessment.tags,
            ...researchSourceTags(record.source),
          ]),
        ],
      },
    };
  }),
);
const tagOptions = computed(() =>
  (serverMode ? remote.facets.value.tag || [] : [...new Set(allRows.value.flatMap((record) => record.assessment.tags))])
    .toSorted()
    .map((value) => ({ label: value, value })),
);
const localRows = computed(() =>
  allRows.value.filter((record) => {
    const collectedAt = record.collectedAt;
    const age = collectedAt
      ? (Date.now() - Date.parse(collectedAt)) / 86_400_000
      : Infinity;
    return (
      `${record.term} ${keywordChineseName(record)} ${record.seedTerm || ''} ${record.assessment.tags.join(
        ' ',
      )}`
        .toLocaleLowerCase()
        .includes(search.value.toLocaleLowerCase()) &&
      matchesScore(record.assessment.score, scoreFilter.value) &&
      (category.value === 'ALL' || record.category === category.value) &&
      (rating.value === 'ALL' ||
        (rating.value === 'UNRATED'
          ? !record.assessment.grade
          : record.assessment.grade === rating.value)) &&
      (ratingStatus.value === 'ALL' ||
        record.assessment.status === ratingStatus.value) &&
      (tagFilter.value.length === 0 ||
        tagFilter.value.some((tag) => record.assessment.tags.includes(tag))) &&
      (timeRange.value === 'ALL' ||
        (age >= 0 && age <= Number(timeRange.value))) &&
      (reviewFilter.value === 'ALL' ||
        (record.reviewStatus || 'pending') === reviewFilter.value) &&
      (!favoritesOnly.value || record.favorite)
    );
  }),
);
const rows = computed(() => serverMode ? remote.rows.value.map((record) => ({ ...record, assessment: assessKeyword(record) })) : localRows.value);
const selection = computed(() =>
  resolveSelection(selectedIds.value, selectionSnapshots.value, state.keywords),
);
const selected = computed(() => selection.value.records);
async function selectFiltered() {
  let records: Keyword[];
  try { records = serverMode ? await remote.selectAll() : rows.value.filter((r) => r.dataNature !== 'demo'); }
  catch (error) { message.error((error as Error).message); return; }
  selectedIds.value = records.map((r) => r.id);
  selectionSnapshots.value = rememberSelection(selectedIds.value, records);
}
const detail = computed(() =>
  state.keywords.find((record) => record.id === detailId.value),
);
const assessment = computed(() =>
  detail.value ? assessKeyword(detail.value) : undefined,
);
const summary = computed(() => serverMode ? overview.snapshot.value?.keywords || { total: 0, priority: 0, pending: 0, selected: 0 } : ({
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
    scoreFilter,
    tagFilter,
    timeRange,
    reviewFilter,
    favoritesOnly,
    () => state.market,
  ],
  () => {
    currentPage.value = 1;
    clearSelection();
  },
);
let selectingAllRows = false;
const rowSelection = computed(() => ({
  onSelectAll: (checked: boolean) => {
    selectingAllRows = true;
    if (checked) selectFiltered();
    else clearSelection();
    queueMicrotask(() => {
      selectingAllRows = false;
    });
  },
  preserveSelectedRowKeys: true,
  selectedRowKeys: selection.value.tableKeys,
  onChange: (keys: (number | string)[], records: Keyword[]) => {
    if (selectingAllRows) return;
    selectedIds.value = keys.map(String);
    selectionSnapshots.value = rememberSelection(
      selectedIds.value,
      [...state.keywords, ...records.filter(Boolean)],
      selectionSnapshots.value,
    );
  },
  getCheckboxProps: (record: Keyword) => ({
    disabled: supplementSubmitting.value || record.dataNature === 'demo',
  }),
}));
const pagination = computed(() => ({
  total: serverMode ? remote.total.value : rows.value.length,
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
    defaultSortOrder: 'descend' as const,
    width: 130,
    sorter: serverMode ? true : (a: Keyword, b: Keyword) =>
      (assessKeyword(a).score ?? -1) - (assessKeyword(b).score ?? -1),
  },
  { title: '分析标签', key: 'tags', width: 240 },
  { title: '谷歌趋势', key: 'trend', width: 200 },
  { title: 'TK趋势', key: 'tiktok', width: 185 },
  { title: 'INS趋势', key: 'instagram', width: 185 },
  { title: 'FB趋势', key: 'facebook', width: 185 },
  { title: '来源', key: 'source', width: 180 },
  {
    title: '抓取时间',
    key: 'collectedAt',
    width: 170,
    sorter: serverMode ? true : (a: Keyword, b: Keyword) =>
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
  for (const item of records) {
    const record = state.keywords.find((row) => row.id === item.id) || item;
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
  if (checkingSource.value || keywordJob.running) return;
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
    researchError.value = '请填写种子词，至少选择一个市场和找词渠道。';
    return;
  }
  if (
    !Number.isInteger(form.limit) ||
    form.limit < 1 ||
    form.limit > 100 ||
    seeds.length * form.markets.length > form.limit
  ) {
    researchError.value = '结果上限为1～100，不能少于种子词与市场的组合数。';
    return;
  }
  if (!state.settings.researchApiUrl || !state.settings.researchAccessKey) {
    researchError.value = '请先到数据源与设置填写研究服务地址和访问码。';
    return;
  }
  if (form.sources.includes('sorftime')) {
    if (!form.markets.some((market) => market === 'US' || market === 'MX')) {
      researchError.value =
        'Sorftime 当前接入 Amazon 美国、墨西哥；越南请使用其他渠道。';
      return;
    }
    checkingSource.value = true;
    try {
      const status = await keywordSourceStatus(
        state.settings.researchApiUrl,
        state.settings.researchAccessKey,
        true,
      );
      if (!status.sorftime.ready) {
        researchError.value = `${status.sorftime.message}。请前往数据源与设置配置。`;
        return;
      }
    } catch (error) {
      researchError.value =
        error instanceof Error ? error.message : 'Sorftime 连接检测失败';
      return;
    } finally {
      checkingSource.value = false;
    }
  }
  const config = {
    apiUrl: state.settings.researchApiUrl,
    accessKey: state.settings.researchAccessKey,
    seeds,
    markets: [...form.markets],
    sources: form.sources.filter(
      (
        source,
      ): source is
        | 'amazon_autocomplete'
        | 'google_autocomplete'
        | 'semrush'
        | 'sorftime' =>
        [
          'amazon_autocomplete',
          'google_autocomplete',
          'semrush',
          'sorftime',
        ].includes(source),
    ),
    depth: form.depth,
    limit: form.limit,
  };
  try {
    await startKeywordJob(config);
    open.value = false;
    state.market =
      config.markets.length === 1 ? config.markets[0] || 'US' : 'ALL';
    message.success('已提交腾讯云后台，关闭浏览器后也会继续运行');
    await router.push('/monitor?tab=tasks');
  } catch (error) {
    researchError.value =
      error instanceof Error ? error.message : '任务未提交成功，请重试';
  }
}
async function supplementSelected() {
  if (supplementSubmitting.value) return;
  if (selectedIds.value.length === 0 || selectedIds.value.length > 100) {
    message.warning('请勾选1～100个关键词');
    return;
  }
  if (!state.settings.researchAccessKey || !state.settings.researchApiUrl) {
    message.warning('请先在数据源与设置配置研究服务');
    return;
  }
  const submittedIds = [...selectedIds.value];
  const snapshots = new Map(selectionSnapshots.value);
  supplementSubmitting.value = true;
  try {
    while (cloudWorkspace.syncing)
      await new Promise((resolve) => setTimeout(resolve, 100));
    await syncCloudWorkspace();
    const records = requireCompleteSelection(
      submittedIds,
      snapshots,
      state.keywords,
    );
    const result = await startKeywordJob(
      {
        apiUrl: state.settings.researchApiUrl,
        accessKey: state.settings.researchAccessKey,
        seeds: [],
        markets: [...new Set(records.map((record) => record.market))],
        sources: ['semrush'],
        depth: 1,
        limit: submittedIds.length,
        expectedKeywordCount: submittedIds.length,
      },
      records,
    );
    message.success(
      `已勾选${submittedIds.length}个词，后台已接收${result.acceptedKeywords ?? records.length}个；指标与趋势补齐后自动重评`,
    );
    await router.push('/monitor?tab=tasks');
  } catch (error) {
    message.error(
      error instanceof Error ? error.message : '数据补齐任务提交失败',
    );
  } finally {
    supplementSubmitting.value = false;
  }
}
async function exportKeywords() {
  let records = rows.value;
  if (serverMode) try { records = (await remote.exportRows()).map((record) => ({ ...record, assessment: assessKeyword(record) })); }
  catch (cause) { message.error((cause as Error).message); return; }
  exportCsv(
    '关键词研究与评级.csv',
    records.map((record) => ({
      ...core.exportRecord(record),
      关键词: record.term,
      中文名称: keywordChineseName(record),
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
async function openDetail(value: Record<string, unknown>) {
  const ticket = ++detailSequence;
  const id = String(value.id);
  detailId.value = id;
  detailError.value = '';
  detailLoading.value = serverMode;
  try {
    if (serverMode) await loadWorkspaceDetail('keywords', id);
    if (ticket !== detailSequence || detailId.value !== id) return;
    const record = state.keywords.find((item) => item.id === id);
    if (record) fillMetrics(record);
  } catch (error) {
    if (ticket === detailSequence) detailError.value = (error as Error).message;
  } finally {
    if (ticket === detailSequence) detailLoading.value = false;
  }
}
function fillMetrics(record: Keyword) {
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
      <Button @click="router.push('/selected-keywords')">
        已入选关键词（{{ summary.selected }}）
      </Button>
      <Button @click="modelOpen = true">评分模型</Button>
      <SemrushHotwordsSidebar />
      <Button :disabled="!rows.length" @click="exportKeywords">导出结果</Button>
      <Button
        type="primary"
        :disabled="keywordJob.running"
        @click="open = true"
      >
        ＋ 新建关键词研究
      </Button>
    </PageHeader>
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
        任务由腾讯云后台执行，关闭浏览器后继续。{{ keywordJob.message }}
        <Button type="link" @click="router.push('/monitor?tab=tasks')">
          查看进度
        </Button>
        <Button
          type="link"
          @click="
            stopKeywordJob().catch((error) => message.error(error.message))
          "
        >
          取消后台任务
        </Button>
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
      <div class="hci-toolbar keyword-filters hci-filter-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索中英文关键词、种子词或标签"
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
          mode="multiple"
          placeholder="全部标签（可多选，匹配任意标签）"
          :max-tag-count="2"
          allow-clear
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
            scoreFilter = emptyScoreFilter();
            tagFilter = [];
            timeRange = 'ALL';
            reviewFilter = 'ALL';
            favoritesOnly = false;
          "
        >
          重置筛选
        </Button>
        <ScoreRangeFilter
          v-model="scoreFilter"
          label="关键词"
        /><KeywordNamesDialog :ids="selectedIds" />
        <KeywordTrendsControl :ids="selectedIds" :visible-ids="serverMode ? rows.map((r) => r.id) : undefined" />
      </div>
      <div class="hci-toolbar">
        <span class="hci-subtle">已勾选 {{ selectedIds.length }} 个关键词（跨页保留）</span>
        <Button
          :disabled="!rows.length || supplementSubmitting"
          @click="selectFiltered"
        >
          全选筛选结果（跨页）
        </Button>
        <Button
          :disabled="!selectedIds.length || supplementSubmitting"
          @click="clearSelection"
        >
          清空选择
        </Button>
        <Tooltip
          title="依次补充 Semrush 搜索量、自然搜索KD与意图，采集一年趋势及30天变化，再统一重评。优先复用 Semrush 缓存，报告查询使用现有账户额度。"
        >
          <span>
            <Button
              :disabled="
                !selectedIds.length ||
                selectedIds.length > 100 ||
                selection.missing.length > 0 ||
                keywordJob.running ||
                supplementSubmitting
              "
              :loading="supplementSubmitting"
              @click="supplementSelected"
            >
              一键补齐数据并重评
            </Button>
          </span>
        </Tooltip>
        <Button
          type="primary"
          :disabled="
            !selected.length ||
            selection.missing.length > 0 ||
            supplementSubmitting
          "
          @click="markRecords(selected, 'selected')"
        >
          标为入选
        </Button>
        <Button
          :disabled="
            !selected.length ||
            selection.missing.length > 0 ||
            supplementSubmitting
          "
          @click="markRecords(selected, 'excluded')"
        >
          标为排除
        </Button>
        <span class="hci-toolbar-end hci-subtle">{{ serverMode ? remote.total.value : rows.length }} 条筛选结果</span>
      </div>
      <Alert
        v-if="selection.missing.length"
        type="warning"
        show-icon
        :message="`选中的${selection.missing.length}个词已无法匹配，请刷新并重新选择；不会仅提交其余部分。`"
        style="margin-bottom: 16px"
      />
      <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
      <CoreListControls v-model:preset="corePreset" v-model:period="corePeriod" kind="keywords" />
      <Table
        @change="remote.tableChange"
        :data-source="rows"
        :columns="core.columns(columns)"
        class="hci-resource-table"
        size="small"
        :row-selection="rowSelection"
        row-key="id"
        :pagination="pagination"
        :loading="
          serverMode ? remote.loading.value : cloudWorkspace.syncing && !cloudWorkspace.ready && rows.length === 0
        "
        :scroll="{ x: 'max-content' }"
      >
        <template #bodyCell="{ column, record }">
          <KeywordRelatedQueries v-if="column.key === 'core:relatedTop' || column.key === 'core:relatedRising'" :keyword="record as Keyword" :kind="column.key === 'core:relatedTop' ? 'relatedTop' : 'relatedRising'" />
          <EvidenceMetric v-else-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Keyword, column.key)" />
          <template v-else-if="column.key === 'term'">
            <button class="hci-link keyword-term" @click="openDetail(record)">
              {{ record.term }}
            </button>
            <p class="hci-subtle">
              {{ record.termZh ? '中文' : '中文参考' }}：{{
                keywordChineseName({
                  term: record.term,
                  termZh: record.termZh,
                }) || '待补充'
              }}
            </p>
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
            <CompactTags :items="record.assessment.tags" label="分析标签" />
          </template>
          <template v-else-if="column.key === 'trend'">
            <KeywordTrendDialog
              v-if="record.series.length || record.trendPoints?.length"
              :keyword="record as Keyword"
            />
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
            <KeywordTrendComparison :keyword="record as Keyword" />
          </template>
          <template v-else-if="['tiktok', 'instagram', 'facebook'].includes(String(column.key))">
            <SocialTrendCell :keyword="record as Keyword" :source="String(column.key)" />
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
            <PublicContentLauncher
              :query="record.term"
              :market="record.market"
              :keyword-ids="[record.id]"
            />
            <Button type="link" @click="openDetail(record)">评分详情</Button><Button type="link" @click="toggleFavorite(record)">
              {{ record.favorite ? '已收藏' : '收藏' }}
            </Button>
          </template>
        </template>
      </Table>
    </section>
    <div class="hci-field-notes">
      <div>
        <b>分阶段决策</b><span>本页扩词、补齐平台指标与趋势后评分。标为入选后，在「已入选关键词」中发起独立站采集。</span>
      </div>
      <div>
        <b>评级与证据</b><span>A ≥80，B 65～79，C 50～64，D
          &lt;50。搜索量或关键趋势不足则待评级；数据未覆盖完整时仅给暂评，缺失数据不按0分处理。</span>
      </div>
    </div>

    <Modal
      v-model:open="open"
      title="新建关键词研究 · 第一步"
      :width="720"
      ok-text="开始找词与评级"
      cancel-text="取消"
      :confirm-loading="keywordJob.running || checkingSource"
      @ok="createResearch"
    >
      <Alert
        message="扩词与合并去重 → Semrush 指标（勾选时）→ 一年趋势 → 评级打标 → 人工入选"
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
              { label: 'Semrush 扩词与指标（使用账户额度）', value: 'semrush' },
              {
                label: 'Sorftime Amazon 延伸词（使用账户额度）',
                value: 'sorftime',
              },
            ]"
          />
          <p class="hci-subtle">
            Amazon 联想与 Sorftime 当前支持美国和墨西哥。Sorftime
            需先在数据源与设置中填写 MCP Token；其站内关键词不代表 Google
            搜索量。勾选 Semrush 后，通过 MCP
            获取相关词、长尾词、问题词，合并去重后补同市场搜索量、KD
            与意图；每词指标使用30天缓存。不会自动购买额度。
          </p>
        </Form.Item>
        <Form.Item
          v-if="form.sources.includes('sorftime')"
          label="Sorftime 按结果数量自动调用"
        >
          <p class="hci-subtle">
            以你设置的“结果总数上限”为准，按种子词、市场和扩词深度自动安排调用，不再单独填写次数。一次调用可能返回多个词，达到结果数量即停止；不保证来源一定返回足量关键词。账户额度不足或接口失败会保留原因，未知结果不自动重复调用。
          </p>
          <p>
            按当前配置最多安排 {{ automaticSorftimeCalls }} 次 Sorftime
            数据调用，实际按需执行；结果数量不等于调用次数。
          </p>
          <Button
            type="link"
            @click="
              open = false;
              router.push('/settings');
            "
          >
            前往填写或检测 MCP Token
          </Button>
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
            Trends，并尝试补齐30天日数据；勾选 Semrush
            后同步补搜索量、KD、意图，再计算五维评分、评级和标签。
          </p>
        </Form.Item>
      </Form>
      <Alert
        v-if="researchError"
        :message="researchError"
        type="error"
        show-icon
      />
      <p class="hci-subtle">
        Google／Amazon 联想和 Google Trends 为公开接口，可能限流；Sorftime
        使用你的账户额度。Semrush
        勾选后自动补充搜索量与自然搜索KD，也可在评分详情中手动补充，来源与日期会保留。提交成功后由腾讯云后台执行，任务和关键词结果保存到数据库，关闭浏览器后继续运行。
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
        &lt;50。缺失维度不补0，按已覆盖权重归一化；同市场搜索量与有效趋势齐备、覆盖至少80%时才允许暂评；再补齐
        KD
        后正式评级。搜索量或关键趋势缺失则待评级。手表等非保健品类目最高19分，医疗服务等非商品词最高39分；单独Omega有同名歧义，最高39分。
      </div>
      <p>
        业务相关性以关键词自身的保健品含义为依据，继承的分类与种子词不直接加分。鱼油等未明确成分的泛词最高59分，膳食补充剂等类目泛词最高49分；只有成分而缺少具体商品限定的短词最高69分。明确成分配合剂型、剂量或人群可获得更高评分；鱼油明确Omega-3/EPA/DHA，或同时明确剂型与剂量后，解除泛词限制。偏离种子成分最高59分，功效、副作用等内容查询最高64分。
      </p>
      <p>
        Google Trends
        仅用于走势，不代替搜索量。需求规模按同市场固定参考上沿评分：美国10万/月，墨西哥与越南5万/月；当前批次增减不会改变该参考。竞争维度按100−自然搜索KD计分；广告竞争度、CPC和前三站点份额仅作参考，不混为自然搜索难度。指标超过90天、趋势超过45天会提示补采。
      </p>
      <p class="hci-subtle">
        只有一年数据不能确认年度季节性，因此不会自动下“季节性已证实”的结论。Semrush
        勾选后自动扩词和补充指标；Similarweb
        暂不参与自动评分。记录国家、来源与获取日期，90天以前的搜索指标不纳入当前评级。Semrush
        商业／交易意图仅对已识别成分的商品需求在商品研究价值维度加10分（该维度封顶100），不解除类目或泛词限制。已识别品牌或导航意图关键词最高64分；搜索量明确为0最高49分。多条限制同时命中时取最低上限。
      </p>
    </Modal>

    <Drawer
      :open="!!detailId"
      title="关键词评分与人工决策"
      root-class-name="hci-resource-drawer"
      width="min(940px, 100vw)"
      @close="closeDetail"
    >
      <div v-if="detailLoading" role="status" aria-live="polite" aria-busy="true" style="padding: 32px 0">
        <h2 class="keyword-detail-title">{{ detail?.term }}</h2>
        <Spin tip="正在加载关键词详情…"><div style="height: 120px"></div></Spin>
      </div>
      <Alert v-else-if="detailError" type="error" message="关键词详情加载失败" :description="detailError" show-icon>
        <template #action><Button @click="openDetail({ id: detailId })">重试</Button></template>
      </Alert>
      <template v-else-if="detail && assessment">
        <CoreMetricsPanel kind="keywords" :record="detail" />
        <h2 class="keyword-detail-title hci-resource-title">
          {{ detail.term }}
        </h2>
        <p>
          {{ detail.termZh ? '中文名称' : '中文参考' }}：{{
            keywordChineseName(detail) || '待补充'
          }}
        </p>
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
        <div class="hci-dimension-grid">
          <div
            v-for="dimension in assessment.dimensions"
            :key="dimension.key"
            class="keyword-dimension hci-dimension-card"
          >
            <div>
              <b>{{ dimension.label }} · 权重 {{ dimension.weight }}%</b><strong>{{ dimension.score ?? '待补充'
                }}{{ dimension.score === null ? '' : ' / 100' }}</strong>
            </div>
            <p class="hci-subtle">{{ dimension.evidence }}</p>
            <span class="hci-subtle">已覆盖权重 {{ dimension.coveredWeight }} /
              {{ dimension.weight }}</span>
          </div>
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
        <section
          v-if="
            detail.semrushCollection ||
            detail.metrics?.source.includes('Semrush')
          "
          class="hci-evidence"
          style="margin-top: 20px"
        >
          <b>Semrush 指标与查询结果</b>
          <p>
            月搜索量 {{ detail.metrics?.monthlySearchVolume ?? '未知' }} ·
            自然搜索 KD {{ detail.metrics?.difficulty ?? '未知' }} · 搜索意图
            {{ detail.metrics?.intent || '未返回' }}
          </p>
          <p class="hci-subtle">
            来源 {{ detail.metrics?.source || '未返回' }} · 获取于
            {{ formatTime(detail.metrics?.collectedAt) }}；{{
              detail.semrushCollection?.message
            }}
          </p>
          <p class="hci-subtle">
            意图编码：0 信息型 / 1 导航型 / 2 商业型 / 3 交易型；广告竞争度与
            CPC 仅供参考，不代替自然搜索 KD。
          </p>
        </section>
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
