<script setup lang="ts">
import type { Keyword } from './data';
import type { ResearchReport } from './research-reports';

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
  Input,
  message,
  Select,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import {
  cancelCloudJob,
  cloudRequest,
  cloudWorkspace,
  syncCloudWorkspace,
} from './cloud-workspace';
import AdsCollectDialog from './components/AdsCollectDialog.vue';
import ConsumerReportDialog from './components/ConsumerReportDialog.vue';
import DailyDiscoveryPlan from './components/DailyDiscoveryPlan.vue';
import KeywordNamesDialog from './components/KeywordNamesDialog.vue';
import KeywordTrendComparison from './components/KeywordTrendComparison.vue';
import KeywordTrendDialog from './components/KeywordTrendDialog.vue';
import PageHeader from './components/PageHeader.vue';
import PlatformProductsDialog from './components/PlatformProductsDialog.vue';
import SelectionBar from './components/SelectionBar.vue';
import {
  latestKeywordReports,
  reportStatus,
  reportTopics,
} from './consumer-reports';
import { audit, filteredKeywords, marketName, state } from './data';
import { keywordChineseName } from './keyword-names';
import { assessKeyword } from './keyword-scoring';
import { platformProductSelection } from './platform-product-selection';
import { useFilteredSelection } from './resource-list';

const router = useRouter();
const ids = ref<string[]>([]);
const search = ref('');
const status = ref('ALL');
const page = ref(1);
const pageSize = ref(20);
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
const colors: Record<string, string> = {
  queued: 'blue',
  running: 'processing',
  completed: 'green',
  partial: 'gold',
  empty: 'default',
  failed: 'red',
  cancelled: 'default',
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
const rows = computed(() =>
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
const columns = [
  { title: '关键词 / 种子词', key: 'term', width: 220, fixed: 'left' as const },
  { title: '市场 / 品类', key: 'market', width: 115 },
  {
    title: '研究评分',
    key: 'score',
    width: 105,
    defaultSortOrder: 'descend' as const,
    sorter: (a: { score: null | number }, b: { score: null | number }) =>
      (a.score ?? -1) - (b.score ?? -1),
  },
  { title: '趋势热度 / 周期变化', key: 'trend', width: 215 },
  { title: '消费者重点话题 / 样本热度', key: 'consumer', width: 290 },
  { title: '站点采集状态', key: 'status', width: 145 },
  { title: '广告采集状态', key: 'ads', width: 145 },
  { title: '关联站点', key: 'sites', width: 100 },
  { title: '采集时间 / 说明', key: 'time', width: 260 },
  { title: '操作', key: 'actions', width: 180, fixed: 'right' as const },
];
async function remove(r: Keyword) {
  r.reviewStatus = 'pending';
  audit('移出入选关键词', r.term);
  try {
    await syncCloudWorkspace();
    message.success('已移出入选列表，采集结果保留');
  } catch (error) {
    message.error((error as Error).message);
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
const time = (r: Keyword) =>
  r.siteCollection?.finishedAt ||
  r.siteCollection?.startedAt ||
  r.siteCollection?.submittedAt;
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
    </PageHeader>
    <Alert
      type="info"
      show-icon
      message="一次提交同时使用 Brave Search 搜索与 ScrapeCreators 广告落地页发现独立站，核验后按市场、域名合并，保留各自来源。任务在服务器后台执行，商品详情可通过平台商品流程补齐。"
      style="margin-bottom: 20px"
    />
    <section class="hci-panel">
      <div class="selected-summary">
        <b>当前市场入选 {{ selected.length }} 个词</b><span>已完成 {{ completed }} 个 · 等待或采集中
          {{ selected.filter(active).length }} 个</span>
      </div>
      <Alert v-if="reportError" type="error" :message="reportError" show-icon />
      <div class="selected-toolbar">
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
        <Input
          v-model:value="search"
          placeholder="搜索入选关键词、种子词或品类"
          aria-label="搜索入选关键词"
          allow-clear
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
        :total="selectable.length"
        @all="selectAll"
        @clear="clear"
      >
        <KeywordNamesDialog :ids="ids" />
      </SelectionBar>
      <Table
        class="hci-resource-table"
        size="small"
        :columns="columns"
        :data-source="rows"
        :loading="
          cloudWorkspace.syncing && !cloudWorkspace.ready && rows.length === 0
        "
        row-key="id"
        :scroll="{ x: 1890 }"
        :row-selection="rowSelection"
        :pagination="{
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
          <template v-if="column.key === 'term'">
            <b>{{ record.term }}</b>
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
          <template v-else-if="column.key === 'status'">
            <Tag :color="colors[record.siteCollection?.status || 'pending']">
              {{ labels[record.siteCollection?.status || 'pending'] }}
            </Tag>
            <p v-if="record.siteCollection?.target" class="hci-subtle">
              本次 {{ record.siteCollection.count || 0 }}/{{
                record.siteCollection.target
              }}
              家
            </p>
          </template>
          <template v-else-if="column.key === 'sites'">
            <Button
              type="link"
              :disabled="!record.siteIds?.length"
              @click="
                router.push({ path: '/sites', query: { keywordId: record.id } })
              "
            >
              {{ record.siteIds?.length || 0 }} 家站点
            </Button>
          </template>
          <template v-else-if="column.key === 'ads'">
            <Tag :color="colors[record.adCollection?.status || 'pending']">
              {{ labels[record.adCollection?.status || 'pending'] }}
</Tag><Button
              type="link"
              @click="
                router.push({ path: '/ads', query: { keywordId: record.id } })
              "
            >
              {{
                state.ads.filter((ad) => ad.keywordIds?.includes(record.id))
                  .length
              }}
              条广告
            </Button>
          </template>
          <template v-else-if="column.key === 'trend'">
            <KeywordTrendDialog
              v-if="record.series.length"
              :keyword="record as Keyword"
            />
            <KeywordTrendComparison :keyword="record as Keyword" />
          </template>
          <template v-else-if="column.key === 'time'">
            <span>{{
              time(record as Keyword)
                ? new Date(time(record as Keyword)!).toLocaleString('zh-CN')
                : '—'
            }}</span>
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
