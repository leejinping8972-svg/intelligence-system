<script setup lang="ts">
import type { Keyword } from './data';
import type { ResearchReport } from './research-reports';
import SemrushSitesDialog from './components/SemrushSitesDialog.vue';

import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Drawer,
  Input,
  message,
  Select,
  Table,
  Tooltip,
} from 'ant-design-vue';

import {
  cancelCloudJob,
  cloudRequest,
  cloudWorkspace,
  saveKeywordReviews,
} from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import CoreListControls from './components/CoreListControls.vue';
import CoreMetricsPanel from './components/CoreMetricsPanel.vue';
import EvidenceMetric from './components/EvidenceMetric.vue';
import { useCoreList } from './use-core-list';
import { useListFilterMemory } from './list-filter-memory';
const listMemory = useListFilterMemory('selected-keywords');
const core = useCoreList('keywords');
const { period: corePeriod } = core;
listMemory.bind('period', corePeriod);
const evidenceKeyword = ref<Keyword>();
import KeywordRelatedQueries from './components/KeywordRelatedQueries.vue';
import KeywordNamesDialog from './components/KeywordNamesDialog.vue';
import { keywordChineseName } from './keyword-names';
import SelectionBar from './components/SelectionBar.vue';
import KeywordTrendComparison from './components/KeywordTrendComparison.vue';
import KeywordTrendsControl from './components/KeywordTrendsControl.vue';
import SocialTrendCell from './components/SocialTrendCell.vue';
import { useFilteredSelection } from './resource-list';
import DailyDiscoveryPlan from './components/DailyDiscoveryPlan.vue';
import AdsCollectDialog from './components/AdsCollectDialog.vue';
import ConsumerReportDialog from './components/ConsumerReportDialog.vue';
import KeywordTrendDialog from './components/KeywordTrendDialog.vue';
import PlatformProductsDialog from './components/PlatformProductsDialog.vue';
import {
  latestKeywordReports,
  reportStatus,
  reportTopics,
} from './consumer-reports';
import { audit, exportCsv, filteredKeywords, marketName, state } from './data';
import { assessKeyword } from './keyword-scoring';
import { platformProductSelection } from './platform-product-selection';
import { serverMode } from './session';
import { useOverviewSnapshot, useWorkspaceList } from './workspace-queries';
import WorkspaceReadStatus from './components/WorkspaceReadStatus.vue';
import CollectionTime from './components/CollectionTime.vue';
import { collectionTimeOrder } from './resource-metadata';

const router = useRouter();
const ids = ref<string[]>([]);
const search = listMemory.field('search', '');
const status = listMemory.field('status', 'ALL');
const page = listMemory.field('page', 1);
const pageSize = listMemory.field('pageSize', 20);
const remote = useWorkspaceList<Keyword>('keywords', computed(() => ({ market: state.market, search: search.value, review: 'selected', status: status.value })), page, pageSize);
remote.sort.value = 'score';
listMemory.bind('sort', remote.sort);
listMemory.bind('order', remote.order);
const overview = useOverviewSnapshot();
const labels: Record<string, string> = {
  pending: '尚未采集',
  queued: '等待采集',
  running: '采集中',
  completed: '已完成',
  partial: '部分完成',
  empty: '未找到站点',
  failed: '采集失败',
  cancelled: '已取消',
};
const selected = computed(() =>
  filteredKeywords.value.filter((k) => k.reviewStatus === 'selected'),
);
const reportError = ref('');
const reports = ref<ResearchReport[]>([]);
const keywordReports = computed(() => latestKeywordReports(reports.value));
let reportActive = true;
let reportLoading = false;
let reportTimer: ReturnType<typeof setTimeout> | undefined;
async function loadReports() {
  if (!cloudWorkspace.ready || reportLoading) return;
  reportLoading = true;
  if (reportTimer) clearTimeout(reportTimer);
  try {
    reports.value = (
      await cloudRequest<{ reports: ResearchReport[] }>(
        'server_insight_snapshot',
        {
          summary: true,
          kind: 'consumer',
          latestByKeyword: true,
          keywordIds: selected.value.map((k) => k.id),
        },
      )
    ).reports;
    reportError.value = '';
  } catch (error) {
    reportError.value =
      error instanceof Error ? error.message : '洞察摘要读取失败';
  } finally {
    reportLoading = false;
    if (reportActive) reportTimer = setTimeout(() => void loadReports(), 15000);
  }
}
function stopReports() {
  reportActive = false;
  if (reportTimer) clearTimeout(reportTimer);
}
const rows = computed(() => serverMode ? remote.rows.value.map((k) => ({ ...k, score: assessKeyword(k).score })) :
  selected.value
    .filter(
      (k) =>
        (status.value === 'ALL' ||
          (k.siteCollection?.status || 'pending') === status.value) &&
        `${k.term} ${keywordChineseName(k)} ${k.seedTerm || ''} ${k.category}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .map((k) => ({ ...k, score: assessKeyword(k).score }))
    .toSorted((a, b) => (b.score ?? -1) - (a.score ?? -1)),
);
const { selectable, selectAll, clear, rowSelection } = useFilteredSelection(
  rows,
  ids,
  serverMode ? remote.selectAll : undefined,
);
const active = (r: Keyword) =>
  ['queued', 'running'].includes(r.siteCollection?.status || '');
const adActive = (r: Keyword) =>
  ['queued', 'running'].includes(r.adCollection?.status || '');
const collectionSelection = computed(() =>
  selected.value.filter((k) => ids.value.includes(k.id)),
);
const collectionBusy = computed(() =>
  collectionSelection.value.some((k) => active(k) || adActive(k)),
);
const platformSelection = computed(() =>
  platformProductSelection(selected.value, ids.value, cloudWorkspace.ready),
);
const completed = computed(
  () =>
    selected.value.filter((k) => k.siteCollection?.status === 'completed')
      .length,
);
onMounted(() => void loadReports());
onActivated(() => {
  reportActive = true;
  void loadReports();
});
onDeactivated(stopReports);
onUnmounted(stopReports);
watch(
  () => [cloudWorkspace.ready, selected.value.map((k) => k.id).join(',')],
  () => void loadReports(),
);
watch([search, status, () => state.market], () => {
  page.value = 1;
  ids.value = [];
});
watch(selected, () => {
  ids.value = ids.value.filter((id) => selected.value.some((k) => k.id === id));
});
function relatedCount(record: Keyword, collection: 'ads' | 'products' | 'sites') {
  if (serverMode) return record.relatedCounts?.[collection] || 0;
  if (collection === 'ads') return state.ads.filter((item) => item.keywordIds?.includes(record.id)).length;
  if (collection === 'products') return state.products.filter((item) => item.keywordIds?.includes(record.id) || record.productIds?.includes(item.id)).length;
  return state.sites.filter((item) => item.keywordIds?.includes(record.id) || record.siteIds?.includes(item.id)).length;
}
function relatedCollection(key: unknown): 'ads' | 'products' | 'sites' {
  if (key === 'relatedProducts') return 'products';
  if (key === 'relatedSites') return 'sites';
  return 'ads';
}
const columns = [
  { title: '关键词 / 种子词', key: 'term', width: 195, fixed: 'left' as const },
  { title: '市场 / 品类', key: 'market', width: 100 },
  {
    title: '研究评分',
    key: 'score',
    width: 88,
    sortDirections: ['descend', 'ascend'] as ('descend' | 'ascend')[],
    sorter: serverMode ? true : (a: { score: null | number }, b: { score: null | number }) =>
      (a.score ?? -1) - (b.score ?? -1),
  },
  { title: '趋势热度 / 周期变化', key: 'trend', width: 158 },
  { title: '消费者重点话题 / 样本热度', key: 'consumer', width: 230 },
  { title: 'TK趋势', key: 'tiktok', width: 118 },
  { title: 'INS趋势', key: 'instagram', width: 118 },
  { title: 'FB趋势', key: 'facebook', width: 118 },
  ...([
    { title: '关联商品', key: 'relatedProducts', width: 88 },
    { title: '关联广告', key: 'relatedAds', width: 88 },
    { title: '关联站点', key: 'relatedSites', width: 98 },
  ] as const).map((column) => ({
    ...column,
    sortDirections: ['descend', 'ascend'] as ('ascend' | 'descend')[],
    sorter: serverMode ? true : (a: Keyword, b: Keyword) => relatedCount(a, relatedCollection(column.key)) - relatedCount(b, relatedCollection(column.key)),
  })),
  {
    title: '采集时间（北京时间）/ 说明', key: 'collectedAt', width: 180,
    sortDirections: ['descend', 'ascend'] as ('ascend' | 'descend')[],
    sorter: serverMode ? true : (a: Keyword, b: Keyword) =>
      collectionTimeOrder(a.collectedAt) - collectionTimeOrder(b.collectedAt),
  },
  { title: '操作', key: 'actions', width: 135, fixed: 'right' as const },
];
const displayColumns = computed(() => core.columns(columns).map((column) => ({
  ...column,
  ...('sorter' in column ? {
    sortOrder: remote.sort.value === column.key ? remote.order.value as 'ascend' | 'descend' : null,
  } : {}),
})));
function tableChange(...args: Parameters<typeof remote.tableChange>) {
  const previousSort = `${remote.sort.value}:${remote.order.value}`;
  const sorter = Array.isArray(args[2]) ? args[2][0] || {} : args[2];
  remote.tableChange(args[0], args[1], sorter.order ? sorter : { columnKey: 'score', order: 'descend' });
  if (previousSort !== `${remote.sort.value}:${remote.order.value}`) page.value = 1;
}
const reviewSaving = ref(false);
async function remove(r: Keyword) {
  if (reviewSaving.value) return;
  reviewSaving.value = true;
  try {
    await saveKeywordReviews([r.id], 'pending');
    audit('移出入选关键词', r.term);
    if (serverMode) await remote.reload(true);
    message.success('已移出入选列表，采集结果保留');
  } catch (error) {
    message.error((error as Error).message);
  } finally {
    reviewSaving.value = false;
  }
}
async function cancel(r: Keyword) {
  try {
    const jobIds = new Set([
      ...(active(r) && r.siteCollection?.jobId ? [r.siteCollection.jobId] : []),
      ...(adActive(r) && r.adCollection?.jobId ? [r.adCollection.jobId] : []),
    ]);
    for (const id of jobIds) await cancelCloudJob(id);
    message.success('已取消该批次未完成任务');
  } catch (error) {
    message.error((error as Error).message);
  }
}
async function exportSelectedKeywords() {
  try {
    const records = serverMode ? await remote.exportRows(ids.value) : rows.value.filter((row) => !ids.value.length || ids.value.includes(row.id));
    exportCsv('入选关键词完整数据.csv', records.map((row) => ({ 关键词: row.term, ...core.exportRecord(row) })));
  } catch (cause) { message.error((cause as Error).message); }
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="已入选关键词"
      description="第二步：从人工入选的关键词出发，采集并核验独立站，查看进度与结果。"
    >
      <Button @click="router.push('/research')">返回关键词研究</Button>
      <Button @click="router.push('/monitor')">查看后台任务</Button>
      <DailyDiscoveryPlan />
      <KeywordTrendsControl :ids="ids" :visible-ids="serverMode ? rows.map((r) => r.id) : undefined" />
      <Button :disabled="!rows.length" @click="exportSelectedKeywords">完整导出</Button>
    </PageHeader>
    <Alert
      type="info"
      show-icon
      message="一次提交同时使用 Brave Search 搜索与 ScrapeCreators 广告落地页发现独立站，核验后按市场、域名合并，保留各自来源。任务在服务器后台执行，商品详情可通过平台商品流程补齐。"
      style="margin-bottom: 20px"
    />
    <section class="hci-panel">
      <div class="selected-summary">
        <b>当前市场入选 {{ serverMode ? overview.snapshot.value?.keywords.selected ?? '—' : selected.length }} 个词</b><span>已完成 {{ serverMode ? overview.snapshot.value?.keywords.completed ?? '—' : completed }} 个 · 等待或采集中
          {{ serverMode ? overview.snapshot.value?.keywords.active ?? '—' : selected.filter(active).length }} 个</span>
      </div>
      <Alert v-if="reportError" type="error" :message="reportError" show-icon />
      <div class="selected-toolbar hci-toolbar hci-filter-toolbar">
        <SemrushSitesDialog :terms="collectionSelection.map((k) => k.term)" />
        <ConsumerReportDialog
          :keywords="collectionSelection"
          :disabled="!ids.length || !cloudWorkspace.ready"
          @submitted="loadReports"
        />
        <PlatformProductsDialog
          :terms="platformSelection.terms"
          :market="platformSelection.market"
          :disabled="platformSelection.disabled"
          :disabled-reason="platformSelection.reason"
          label="获取平台商品与趋势"
        />
        <AdsCollectDialog
          :keyword-ids="collectionSelection.map((k) => k.id)"
          :disabled="!cloudWorkspace.ready || collectionBusy"
          :disabled-reason="
            collectionBusy
              ? '勾选的关键词仍有广告或站点任务，请等待完成或取消后再提交'
              : ''
          "
        />
        <Input.Search
          v-model:value="search"
          placeholder="搜索中英文入选关键词、种子词或品类"
          aria-label="搜索入选关键词"
          allow-clear
          enter-button="检索"
          @search="remote.reload(true)"
          style="width: 310px"
        />
        <Select
          v-model:value="status"
          aria-label="站点采集状态"
          style="width: 170px"
          :options="[
            { label: '全部采集状态', value: 'ALL' },
            ...Object.entries(labels).map(([value, label]) => ({
              value,
              label,
            })),
          ]"
        />
      </div>
      <SelectionBar
        :count="ids.length"
        :total="serverMode ? remote.total.value : selectable.length"
        @all="selectAll"
        @clear="clear"
      >
        <KeywordNamesDialog :ids="ids" />
      </SelectionBar>
      <WorkspaceReadStatus :error="remote.error.value" :loading="remote.loading.value" @retry="remote.reload(true)" />
      <CoreListControls v-model:period="corePeriod" kind="keywords" />
      <Table
        @change="tableChange"
        class="hci-resource-table keyword-compact-table"
        size="small"
        :columns="displayColumns"
        :data-source="rows"
        :loading="
          serverMode ? remote.loading.value : cloudWorkspace.syncing && !cloudWorkspace.ready && rows.length === 0
        "
        row-key="id"
        :scroll="{ x: 'max-content' }"
        :row-selection="rowSelection"
        :pagination="{
          total: serverMode ? remote.total.value : rows.length,
          current: page,
          pageSize,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          showTotal: (total) => `共 ${total} 个入选关键词`,
          onChange: (current, size) => {
            page = current;
            pageSize = size;
          },
        }"
      >
        <template #bodyCell="{ column, record }">
          <KeywordRelatedQueries v-if="column.key === 'core:relatedTop' || column.key === 'core:relatedRising'" :keyword="record as Keyword" :kind="column.key === 'core:relatedTop' ? 'relatedTop' : 'relatedRising'" />
          <EvidenceMetric v-else-if="String(column.key).startsWith('core:')" :metric="core.metric(record as Keyword, column.key)" />
          <template v-else-if="column.key === 'term'">
            <Button type="link" @click="evidenceKeyword = record as Keyword">{{ record.term }}</Button>
            <p class="hci-subtle">
              {{ record.termZh ? '中文' : '中文参考' }}：{{
                keywordChineseName({
                  term: record.term,
                  termZh: record.termZh,
                }) || '待补充'
              }}
            </p>
            <p class="hci-subtle">种子：{{ record.seedTerm || '—' }}</p>
          </template>
          <template v-else-if="column.key === 'market'">
            {{ marketName(record.market) }}
            <p class="hci-subtle">{{ record.category }}</p>
          </template>
          <template v-else-if="column.key === 'score'">
            {{ record.score === null ? '待评级' : `${record.score} / 100` }}
            <p class="hci-subtle">
              {{
                assessKeyword(record as Keyword).status === 'rated'
                  ? '证据完整'
                  : '含缺项，仅供筛选'
              }}
            </p>
          </template>
          <template v-else-if="column.key === 'consumer'">
            <template v-if="keywordReports.get(record.id)">
              <div
                v-for="topic in reportTopics(
                  keywordReports.get(record.id)!,
                ).slice(0, 3)"
                :key="topic.key"
              >
                <b>{{ topic.label }}</b> · {{ topic.count }}条
                <span v-if="topic.share !== null"> ({{ topic.share }}%)</span>
              </div>
              <p
                v-if="!reportTopics(keywordReports.get(record.id)!).length"
                class="hci-subtle"
              >
                {{ reportStatus(keywordReports.get(record.id)!.status) }} ·
                暂无话题摘要
              </p>
              <Button
                type="link"
                size="small"
                @click="
                  router.push(
                    `/consumer-insights/reports/${keywordReports.get(record.id)!.id}`,
                  )
                "
              >
                查看报告 ·
                {{ reportStatus(keywordReports.get(record.id)!.status) }}
              </Button>
            </template>
            <span v-else class="hci-subtle">尚未生成洞察</span>
            <ConsumerReportDialog
              compact
              label="生成报告"
              :keywords="[record as Keyword]"
              @submitted="loadReports"
            />
          </template>
          <template v-else-if="['relatedProducts', 'relatedAds', 'relatedSites'].includes(String(column.key))">
            <Button
              type="link"
              size="small"
              :disabled="relatedCount(record as Keyword, relatedCollection(column.key)) === 0"
              @click="
                router.push({ path: `/${relatedCollection(column.key)}`, query: { keywordId: record.id } })
              "
            >
              {{ relatedCount(record as Keyword, relatedCollection(column.key)) }} 条
            </Button>
          </template>
          <template v-else-if="column.key === 'trend'">
            <KeywordTrendDialog
              v-if="record.series.length || record.trendPoints?.length"
              :keyword="record as Keyword"
            />
            <KeywordTrendComparison :keyword="record as Keyword" />
          </template>
          <template v-else-if="['tiktok', 'instagram', 'facebook'].includes(String(column.key))">
            <SocialTrendCell :keyword="record as Keyword" :source="String(column.key)" />
          </template>
          <template v-else-if="column.key === 'collectedAt'">
            <CollectionTime :at="record.collectedAt" />
            <p class="hci-subtle">
              {{
                record.siteCollection?.message || '人工入选后尚未提交站点采集'
              }}
            </p>
          </template>
          <template v-else-if="column.key === 'actions'">
            <AdsCollectDialog
              compact
              :keyword-ids="[record.id]"
              :disabled="
                !cloudWorkspace.ready ||
                active(record as Keyword) ||
                adActive(record as Keyword)
              "
              :disabled-reason="
                active(record as Keyword) || adActive(record as Keyword)
                  ? '该关键词仍有广告或站点任务'
                  : ''
              "
            />
            <Tooltip
              v-if="active(record as Keyword) || adActive(record as Keyword)"
              title="将取消同一批次中所有尚未完成的关键词采集"
            >
              <Button type="link" @click="cancel(record as Keyword)">
                取消该批次
              </Button>
            </Tooltip>
            <Button
              type="link"
              @click="
                router.push({ path: '/sites', query: { keywordId: record.id } })
              "
            >
              查看站点
            </Button>
            <Button
              type="link"
              :disabled="
                active(record as Keyword) || adActive(record as Keyword)
              "
              @click="remove(record as Keyword)"
            >
              移出入选
            </Button>
          </template>
        </template>
      </Table>
    </section>
    <Drawer :open="!!evidenceKeyword" title="关键词数据与来源" width="min(940px, 100vw)" @close="evidenceKeyword = undefined"><CoreMetricsPanel v-if="evidenceKeyword" kind="keywords" :record="evidenceKeyword" /></Drawer>
  </main>
</template>
<style scoped>
.selected-summary,
.selected-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  align-items: center;
  margin-bottom: 20px;
}

.selected-summary {
  justify-content: space-between;
}

.selected-summary span {
  color: #7b8794;
}
</style>
