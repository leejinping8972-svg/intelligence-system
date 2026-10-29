<script setup lang="ts">
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
import { useRoute, useRouter } from 'vue-router';

import { Alert, Button, Input, Select, Table, Tag } from 'ant-design-vue';

import { cloudRequest } from './cloud-workspace';
import MarketCollectionDialog from './components/MarketCollectionDialog.vue';
import NewResearchDialog from './components/NewResearchDialog.vue';
import PageHeader from './components/PageHeader.vue';
import { reportStatus, reportTopics } from './consumer-reports';
import { marketName, state } from './data';
import { serverMode, session } from './session';
const route = useRoute();
  const router = useRouter();
const associatedIds = ref<string[]>([]);
  const busy = ref(false);
  const error = ref('');
  const keyword = ref(
    typeof route.query.keywordId === 'string' ? route.query.keywordId : '',
  );
  const page = ref(1);
  const pageSize = ref(10);
  const reports = ref<ResearchReport[]>([]);
  const review = ref('ALL');
  const reportType = ref('ALL');
  const search = ref('');
  const topic = ref('');
  const topicOptions = ref<string[]>([]);
  const total = ref(0);
const keywordOptions = computed(() =>
  [
    ...new Set([
      ...state.keywords
        .filter((k) => state.market === 'ALL' || k.market === state.market)
        .map((k) => k.id),
      ...associatedIds.value,
    ]),
  ].map((id) => ({
    value: id,
    label: state.keywords.find((k) => k.id === id)?.term || id,
  })),
);
const generationKeywords = computed(() =>
  state.keywords.filter((k) => k.id === keyword.value),
);
let active = true;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
async function load() {
  if (!serverMode) return;
  stop();
  const t = ++token;
  busy.value = true;
  try {
    const r = await cloudRequest<{
      reports: ResearchReport[];
      total: number;
      topicOptions: string[];
      keywordIds: string[];
    }>('server_insight_snapshot', {
      kind: 'consumer',
      summary: true,
      paginated: true,
      market: state.market,
      keywordId: keyword.value,
      topic: topic.value,
      search: search.value,
      review: review.value,
      reportType: reportType.value,
      page: page.value,
      pageSize: pageSize.value,
    });
    if (t !== token) return;
    reports.value = r.reports;
    total.value = r.total;
    topicOptions.value = r.topicOptions || [];
    associatedIds.value = r.keywordIds || [];
    error.value = '';
    if (
      active &&
      r.reports.some((r) => ['queued', 'running'].includes(r.status))
    )
      timer = setTimeout(() => void load(), 10000);
  } catch (e) {
    if (t === token) error.value = e instanceof Error ? e.message : '读取失败';
  } finally {
    if (t === token) busy.value = false;
  }
}
watch([keyword, topic, review, reportType, () => state.market, pageSize], () => {
  page.value = 1;
  void load();
});
watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});
watch(
  () => route.query.keywordId,
  (value) => {
    keyword.value = typeof value === 'string' ? value : '';
  },
);
watch(
  () => route.query.report,
  (id) => {
    if (typeof id === 'string')
      void router.replace(
        `/consumer-insights/reports/${encodeURIComponent(id)}`,
      );
  },
  { immediate: true },
);
onMounted(() => void load());
onActivated(() => {
  active = true;
  void load();
});
function deactivate() {
  active = false;
  token++;
  stop();
  if (searchTimer) clearTimeout(searchTimer);
}
onDeactivated(deactivate);
onUnmounted(deactivate);
function reset() {
  search.value = '';
  keyword.value = '';
  topic.value = '';
  review.value = 'ALL';
  reportType.value = 'ALL';
  page.value = 1;
  void load();
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="研究档案"
      description="按关键词查看公开讨论的话题方向、样本热度和来源。"
    >
      <MarketCollectionDialog v-if="session.user?.role === 'admin'" @submitted="load" />
      <NewResearchDialog :keywords="generationKeywords" :site-ids="typeof route.query.site === 'string' ? [route.query.site] : []" :product-ids="typeof route.query.product === 'string' ? [route.query.product] : []" @submitted="load" />
    </PageHeader>
    <Alert
      v-if="!serverMode"
      type="info"
      message="请登录服务器版采集公开讨论并生成报告。"
      show-icon
    />
    <Alert v-if="error" type="error" :message="error" show-icon />
    <section class="hci-panel">
      <div class="insight-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索报告或话题"
          aria-label="搜索报告或话题"
          allow-clear
        />
        <Select
          v-model:value="reportType"
          :options="[
            { label: '全部报告类型', value: 'ALL' },
            { label: '国家市场报告', value: 'market' },
            { label: '人群画像报告', value: 'persona' },
            { label: '消费者话题报告', value: 'consumer' },
          ]"
          aria-label="报告类型筛选"
        />
        <Select
          v-model:value="keyword"
          show-search
          option-filter-prop="label"
          :options="[{ label: '全部关联关键词', value: '' }, ...keywordOptions]"
          aria-label="关联关键词筛选"
        />
        <Select
          v-model:value="topic"
          show-search
          :options="[
            { label: '全部热门话题', value: '' },
            ...topicOptions.map((value) => ({ label: value, value })),
          ]"
          aria-label="热门话题筛选"
        />
        <Select
          v-model:value="review"
          :options="[
            { label: '全部审阅状态', value: 'ALL' },
            { label: '待审阅', value: 'pending' },
            { label: '已入选', value: 'selected' },
            { label: '已排除', value: 'excluded' },
          ]"
          aria-label="审阅状态筛选"
        />
        <Button @click="reset">重置筛选</Button><Button :loading="busy" @click="load">刷新</Button>
      </div>
      <p class="hci-subtle">
        {{ marketName(state.market) }} · {{ total }} 份报告 ·
        热度为已采样文本中的话题占比
      </p>
      <Table
        size="small"
        row-key="id"
        :data-source="reports"
        :loading="busy"
        :scroll="{ x: 1150 }"
        :columns="[
          { title: '报告 / 关联词', key: 'title', width: 230 },
          { title: '重点话题 / 样本热度', key: 'topics', width: 330 },
          { title: '来源范围', key: 'scope', width: 160 },
          { title: '状态', key: 'status', width: 140 },
          { title: '操作', key: 'action', width: 110 },
        ]"
        :pagination="{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
          onChange: (p, s) => {
            page = p;
            pageSize = s;
            void load();
          },
        }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'title'">
<b>{{ record.title }}</b>
            <Tag v-if="record.reportType === 'market'" color="blue">
              国家{{
                record.period === 'week'
                  ? '周报'
                  : record.period === 'quarter'
                    ? '季报'
                    : '月报'
              }}
            </Tag>
            <p class="hci-subtle">
              {{
                (record.keywordIds || [])
                  .map(
                    (id: string) =>
                      state.keywords.find((k) => k.id === id)?.term || id,
                  )
                  .join('、') || '未关联关键词'
              }}
            </p>
            <p class="hci-subtle">
              {{ marketName(record.market) }} ·
              {{
                new Date(record.createdAt).toLocaleString('zh-CN', {
                  timeZone: 'Asia/Shanghai',
                })
              }}
            </p>
</template>
          <template v-else-if="column.key === 'topics'">
<div
              v-for="item in reportTopics(record as ResearchReport).slice(0, 3)"
              :key="item.key"
            >
              <b>{{ item.label }}</b> · {{ item.count }}条<span
                v-if="item.share !== null"
              >
                ({{ item.share }}%)</span>
            </div>
            <span
              v-if="!reportTopics(record as ResearchReport).length"
              class="hci-subtle"
              >{{
                ['queued', 'running'].includes(record.status)
                  ? '等待归纳话题'
                  : '暂无可归纳话题'
              }}</span>
</template>
          <template v-else-if="column.key === 'scope'">
{{ record.evidenceIds.length }} 条证据 ·
            {{ record.sourceCount ?? 0 }} 个来源
            <p class="hci-subtle">
              <template v-if="record.reportType === 'market'">
                商品 {{ record.marketSnapshot?.coverage?.products || 0 }} · 广告
                {{ record.marketSnapshot?.coverage?.activeMetaAds || 0 }} · 内容
                {{ record.marketSnapshot?.coverage?.tiktokContent || 0 }}
              </template>
              <template v-else>
              {{
                [
                  ...new Set(
                    reportTopics(record as ResearchReport).flatMap(
                      (t) => t.platforms,
                    ),
                  ),
                ].join('、') || '来源见报告'
              }}
              </template>
            </p>
</template>
          <template v-else-if="column.key === 'status'">
<Tag
              :color="record.status === 'completed' ? 'green' : 'default'"
              >
{{ reportStatus(record.status) }}
</Tag><Tag>
{{
              record.hasModelAnalysis ? 'AI归纳' : '规则统计'
            }}
</Tag>
</template>
          <Button
            v-else-if="column.key === 'action'"
            size="small"
            @click="router.push(`/consumer-insights/reports/${record.id}`)"
            >
查看报告
</Button>
        </template>
      </Table>
    </section>
  </main>
</template>
<style scoped>
.insight-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}

.insight-toolbar :deep(.ant-select),
.insight-toolbar :deep(.ant-input-search) {
  width: 210px;
  max-width: 100%;
}
</style>
