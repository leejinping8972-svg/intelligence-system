<script setup lang="ts">
import type {
  DiscoveryPlan,
  IngredientFinding,
  IngredientTrendReport,
} from './discovery-monitors';
import { computed, onMounted, ref, watch } from 'vue';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';
import { cloudRequest } from './cloud-workspace';
import PageHeader from './components/PageHeader.vue';
import DiscoveryPlanForm from './components/DiscoveryPlanForm.vue';
import { state } from './data';
interface Coverage {
  community: string;
  monitorId?: string;
  coveredThrough?: string;
  partial?: boolean;
  blocked?: { jobId: string; message: string };
  scan?: { cursor?: string };
}
interface Snapshot {
  reports: IngredientTrendReport[];
  coverage: Coverage[];
  stats: {
    posts: number;
    comments: number;
    bodyPresent: number;
    commentPartialPosts: number;
    communities: string[];
    asOf: string;
  };
}
const findings = ref<IngredientFinding[]>([]),
  plans = ref<DiscoveryPlan[]>([]),
  snapshots = ref<Snapshot[]>([]);
const busy = ref(false),
  error = ref(''),
  search = ref(''),
  open = ref(false),
  selected = ref<IngredientFinding>(),
  reportId = ref('');
const plan = computed(() =>
  plans.value.find(
    (p) =>
      p.kind === 'ingredients' &&
      p.market === (state.market === 'ALL' ? 'US' : state.market),
  ),
);
const reports = computed(() =>
  snapshots.value
    .flatMap((s) => s.reports)
    .toSorted((a, b) => b.asOf.localeCompare(a.asOf)),
);
const report = computed(() =>
  reports.value.find((r) => r.id === reportId.value),
);
const coverage = computed(() => snapshots.value.flatMap((s) => s.coverage));
const stats = computed(() =>
  snapshots.value.reduce(
    (r, s) => ({
      posts: r.posts + s.stats.posts,
      comments: r.comments + s.stats.comments,
      bodyPresent: r.bodyPresent + s.stats.bodyPresent,
      commentPartialPosts: r.commentPartialPosts + s.stats.commentPartialPosts,
    }),
    { posts: 0, comments: 0, bodyPresent: 0, commentPartialPosts: 0 },
  ),
);
const rows = computed(() =>
  (report.value?.findings || findings.value)
    .filter(
      (r) =>
        (state.market === 'ALL' || r.market === state.market) &&
        `${r.name} ${r.summary}`
          .toLowerCase()
          .includes(search.value.toLowerCase()),
    )
    .toSorted(
      (a, b) =>
        (b.current?.mentionCount || 0) - (a.current?.mentionCount || 0) ||
        b.lastSeenAt.localeCompare(a.lastSeenAt),
    ),
);
const commentGaps = computed(
  () =>
    report.value?.commentCoverage.filter(
      (c) => !c.countsMatch || c.pending || c.blocked,
    ).length || 0,
);
async function load() {
  busy.value = true;
  const market = state.market;
  try {
    const [snapshot, ...trend] = await Promise.all([
      cloudRequest<{
        ingredients: IngredientFinding[];
        plans: DiscoveryPlan[];
      }>('server_discovery_snapshot'),
      ...(market === 'ALL' ? ['US', 'MX', 'VN'] : [market]).map((m) =>
        cloudRequest<Snapshot>('server_discovery_trend_snapshot', {
          market: m,
        }),
      ),
    ]);
    if (market !== state.market) return;
    findings.value = snapshot.ingredients;
    plans.value = snapshot.plans;
    snapshots.value = trend;
    if (!reports.value.some((r) => r.id === reportId.value))
      reportId.value = reports.value[0]?.id || '';
    error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '成分风向读取失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => void load());
watch(
  () => state.market,
  () => void load(),
);
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false,
      })
    : '尚未采集';
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="成分风向"
      description="每天积累社区帖子与重点评论，每周发现值得关注的成分讨论。"
    >
      <Button :loading="busy" @click="load">刷新</Button
      ><Button type="primary" @click="open = true">采集与分析设置</Button>
    </PageHeader>
    <Alert v-if="error" :message="error" type="error" show-icon />
    <section class="hci-panel">
      <div class="trend-stats">
        <span
          >近7天归档 <strong>{{ stats.posts }}</strong> 帖</span
        ><span
          >已采评论 <strong>{{ stats.comments }}</strong> 条</span
        ><span
          >有文字正文 <strong>{{ stats.bodyPresent }}</strong> 帖</span
        >
      </div>
      <p class="hci-subtle">
        采集平台：Reddit；渠道：ScrapeCreators。数量为本系统已取得的内容，评论仅覆盖重点回访帖子；研究归属市场不代表作者所在地。
      </p>
      <div
        v-for="(item, i) in coverage"
        :key="`${item.monitorId}-${item.community}-${i}`"
        class="trend-coverage"
      >
        <Tag :color="item.blocked ? 'red' : item.partial ? 'orange' : 'green'"
          >r/{{ item.community }} ·
          {{
            item.blocked
              ? '请求待确认'
              : item.partial
                ? '仍有待续内容'
                : '列表已到采集边界'
          }}</Tag
        >
        <span class="hci-subtle"
          >最近完整覆盖至 {{ date(item.coveredThrough) }}</span
        >
      </div>
      <Alert
        v-if="stats.commentPartialPosts"
        type="warning"
        show-icon
        :message="`${stats.commentPartialPosts}个回访帖子评论存在缺口或待续内容；已取得的评论会保留。`"
      />
      <p v-if="!coverage.length" class="hci-subtle">
        尚未采集。保存监控后按计划运行，也可在设置中立即采集。
      </p>
    </section>
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="搜索成分或讨论"
          style="max-width: 280px"
        />
        <Select
          v-model:value="reportId"
          style="min-width: 260px"
          :options="[
            { value: '', label: '全部历史成分' },
            ...reports.map((r) => ({
              value: r.id,
              label: `${r.market} · 截至${date(r.asOf)}的周分析`,
            })),
          ]"
        />
      </div>
      <template v-if="report">
        <p>
          分析窗口：{{ date(report.window.start) }} —
          {{ date(report.window.end) }} · 已分析 {{ report.recordCount }} 段资料
        </p>
        <Alert
          v-if="
            !report.postCoverageReady || report.omittedRecords || commentGaps
          "
          type="warning"
          show-icon
          :message="`覆盖说明：${!report.postCoverageReady ? '社区列表尚未完整覆盖；' : ''}${report.omittedRecords ? `${report.omittedRecords}段资料未纳入；` : ''}${commentGaps ? `${commentGaps}个回访帖评论未对齐或尚待续采。` : ''}`"
        />
        <p class="hci-subtle">
          讨论数量代表已采样本。{{
            report.comparisonReady
              ? '当前与前一周的样本数量可供比较，不能推及平台总体热度。'
              : '历史基线不足，暂不判断周度升温。'
          }}
        </p>
      </template>
      <Table
        size="small"
        row-key="id"
        :data-source="rows"
        :loading="busy"
        :pagination="{ pageSize: 20 }"
        :scroll="{ x: 1050 }"
        :columns="[
          { key: 'name', title: '成分', width: 170 },
          { dataIndex: 'summary', title: '讨论摘要' },
          { key: 'current', title: '本期原文 / 评论', width: 135 },
          { key: 'authors', title: '独立作者', width: 90 },
          { key: 'change', title: '较前期样本', width: 110 },
          { key: 'first', title: '系统首次发现', width: 130 },
          { key: 'actions', title: '证据', width: 80 },
        ]"
      >
        <template #emptyText
          ><Empty
            :description="
              report
                ? '本期未提取到有原文支持的成分'
                : '尚无分析结果，可先采集再分析最近一周'
            "
        /></template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'name'"
            ><strong>{{ record.name }}</strong>
            <div v-if="record.firstSeenInSystem">
              <Tag>首次入库</Tag>
            </div></template
          >
          <template v-else-if="column.key === 'current'">{{
            record.current
              ? `${record.current.postCount} / ${record.current.commentCount}`
              : '未按周统计'
          }}</template>
          <template v-else-if="column.key === 'authors'">{{
            record.current?.authorCount ?? '未记录'
          }}</template>
          <template v-else-if="column.key === 'change'">{{
            record.observedChange === null ||
            record.observedChange === undefined
              ? '待积累'
              : `${record.observedChange > 0 ? '+' : ''}${record.observedChange}`
          }}</template>
          <template v-else-if="column.key === 'first'">{{
            record.firstSeenAt.slice(0, 10)
          }}</template>
          <Button
            v-else-if="column.key === 'actions'"
            size="small"
            @click="selected = record as IngredientFinding"
            >原文</Button
          >
        </template>
      </Table>
      <p class="hci-subtle">
        首次入库表示本系统第一次记录，不等于市场新成分；使用体验与负面反馈均为用户讨论，不代表已证实疗效。
      </p>
    </section>
    <Modal v-model:open="open" title="成分风向设置" :width="760" :footer="null">
      <DiscoveryPlanForm
        v-if="open"
        kind="ingredients"
        :plan="plan"
        scheduled
        @saved="
          open = false;
          load();
        "
        @submitted="open = false"
      />
    </Modal>
    <Drawer
      :open="Boolean(selected)"
      :title="selected?.name"
      width="min(720px,100vw)"
      @close="selected = undefined"
    >
      <p>{{ selected?.summary }}</p>
      <article
        v-for="mention in selected?.mentions"
        :key="mention.id"
        class="ingredient-mention"
      >
        <a :href="mention.url" target="_blank" rel="noopener noreferrer"
          >{{
            mention.community ? `r/${mention.community}` : mention.platform
          }}
          · {{ mention.type === 'comment' ? '评论' : '帖子' }} ·
          {{ date(mention.publishedAt) }}</a
        >
        <blockquote>{{ mention.quote }}</blockquote>
      </article>
    </Drawer>
  </main>
</template>
<style scoped>
.trend-stats {
  display: flex;
  gap: 28px;
  flex-wrap: wrap;
  font-size: 14px;
  margin-bottom: 12px;
}
.trend-stats strong {
  font-size: 22px;
  margin: 0 5px;
}
.trend-coverage {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0;
}
.ingredient-mention {
  padding: 16px 0;
  border-bottom: 1px solid #e5e7eb;
  overflow-wrap: anywhere;
}
.ingredient-mention blockquote {
  margin: 10px 0;
  white-space: pre-wrap;
}
</style>
