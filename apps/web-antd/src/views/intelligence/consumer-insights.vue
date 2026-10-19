<script setup lang="ts">
import type { Market } from './data';
import type {
  ResearchEvidence,
  ResearchReport as Report,
} from './research-reports';
import {
  computed,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  message,
} from 'ant-design-vue';
import PageHeader from './components/PageHeader.vue';
import ResearchReport from './components/ResearchReport.vue';
import { cloudRequest, syncCloudWorkspace } from './cloud-workspace';
import { marketName, state } from './data';
import { serverMode } from './session';
import { cachedReport, readReport, saveReport } from './report-details';
const route = useRoute(),
  router = useRouter();
const reports = ref<Report[]>([]),
  error = ref(''),
  busy = ref(false),
  open = ref(false),
  search = ref(''),
  reviewFilter = ref('ALL'),
  selected = ref<Report>(),
  evidence = ref<ResearchEvidence[]>([]),
  detailBusy = ref(false),
  detailRefreshing = ref(false),
  modelReady = ref(false);
const form = reactive({
  title: '',
  market: (state.market === 'ALL' ? 'US' : state.market) as Market,
  sourceKind: 'reddit_search',
  query: '',
  urls: '',
  keywordIds: [] as string[],
  siteIds: [] as string[],
  productIds: [] as string[],
  maxPages: 2,
  maxRequests: 10,
  limit: 200,
  analyze: false,
});
const marketOptions = [
  { label: '美国 · US', value: 'US' },
  { label: '墨西哥 · MX', value: 'MX' },
  { label: '越南 · VN', value: 'VN' },
];
const rows = computed(() =>
  reports.value.filter(
    (r) =>
      r.kind !== 'ad_analysis' &&
      (state.market === 'ALL' || r.market === state.market) &&
      r.title.toLowerCase().includes(search.value.toLowerCase()) &&
      (reviewFilter.value === 'ALL' ||
        (r.reviewStatus || 'pending') === reviewFilter.value),
  ),
);
watch(
  () => state.market,
  () => {
    selected.value = undefined;
    detailToken++;
  },
);
const asReport = (r: Record<string, any>) => r as unknown as Report;
let loading: Promise<void> | undefined;
function load() {
  if (!loading)
    loading = loadReports().finally(() => {
      loading = undefined;
    });
  return loading;
}
async function loadReports() {
  if (!serverMode) return;
  try {
    const data = await cloudRequest<{ reports: Report[] }>(
      'server_insight_snapshot',
      { summary: true },
    );
    reports.value = data.reports;
    error.value = '';
    const current = data.reports.find((r) => r.id === selected.value?.id);
    if (current && current.revision !== selected.value?.revision)
      await details(current);
    if (route.query.report && !selected.value) {
      const r = data.reports.find((r) => r.id === route.query.report);
      if (r) await details(r);
    }
    stop();
    if (
      active &&
      rows.value.some((r) => ['queued', 'running'].includes(r.status))
    )
      timer = setTimeout(() => void load(), 10000);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  }
}
let timer: ReturnType<typeof setTimeout> | undefined;
let active = true;
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
onMounted(async () => {
  await load();
  try {
    modelReady.value = (
      await cloudRequest<{ configured: boolean }>('server_analysis_status')
    ).configured;
  } catch {}
});
onActivated(() => {
  active = true;
  void load();
});
onDeactivated(() => {
  active = false;
  stop();
});
onUnmounted(() => {
  active = false;
  stop();
  detailToken++;
});
let detailToken = 0;
async function details(r: Report, force = false) {
  const token = ++detailToken;
  const cached = cachedReport(r.id);
  const keepCurrent = selected.value?.id === r.id && !detailBusy.value;
  if (cached) {
    selected.value = cached.report;
    evidence.value = cached.evidence;
  } else if (!keepCurrent) {
    selected.value = r;
    evidence.value = [];
  }
  detailBusy.value = !cached && !keepCurrent;
  detailRefreshing.value = true;
  try {
    const data = await readReport(r, force);
    if (token === detailToken) {
      selected.value = data.report;
      evidence.value = data.evidence;
      reports.value = reports.value.map((r) =>
        r.id === data.report.id ? data.report : r,
      );
    }
  } catch (e) {
    if (token === detailToken)
      message.error(
        e instanceof Error ? e.message : '读取失败，已保留当前报告',
      );
  } finally {
    if (token === detailToken) {
      detailBusy.value = false;
      detailRefreshing.value = false;
    }
  }
}
function reviewed(report: Report) {
  if (selected.value?.id !== report.id) return;
  detailToken++;
  detailRefreshing.value = false;
  selected.value = report;
  saveReport({ report, evidence: evidence.value });
  reports.value = reports.value.map((r) => (r.id === report.id ? report : r));
}
function closeDetails() {
  selected.value = undefined;
  detailToken++;
  if (route.query.report)
    void router.replace({ query: { ...route.query, report: undefined } });
}
let requestId = '';
function begin() {
  requestId = '';
  error.value = '';
  form.market = state.market === 'ALL' ? 'US' : state.market;
  form.keywordIds =
    typeof route.query.keywordId === 'string' ? [route.query.keywordId] : [];
  form.siteIds = typeof route.query.site === 'string' ? [route.query.site] : [];
  form.productIds =
    typeof route.query.product === 'string' ? [route.query.product] : [];
  form.query =
    state.keywords.find((k) => form.keywordIds.includes(k.id))?.term || '';
  form.title = '';
  open.value = true;
}
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const r = await cloudRequest<{ jobId: string }>('server_submit_insight', {
      ...form,
      title: form.title || form.query || '公开评论研究',
      kind: 'consumer_research',
      requestId,
    });
    requestId = '';
    open.value = false;
    message.success('需求研究已提交后台，可离开页面');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: r.jobId } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
async function analyze(r: Report) {
  if (busy.value) return;
  busy.value = true;
  try {
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_insight',
      {
        kind: 'evidence_analysis',
        market: r.market,
        reportId: r.id,
        requestId: crypto.randomUUID(),
      },
    );
    message.success('已提交已有证据的语义分析，不重复采集');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (e) {
    message.error(e instanceof Error ? e.message : '提交失败');
  } finally {
    busy.value = false;
  }
}
function collectPostComments() {
  const urls = [
    ...new Set(
      evidence.value
        .filter((e) => e.platform === 'Reddit' && e.kind === 'post')
        .map((e) => e.url),
    ),
  ].slice(0, 20);
  if (!urls.length) return;
  const r = selected.value;
  begin();
  form.sourceKind = 'reddit_comments';
  form.urls = urls.join('\n');
  form.market = r!.market;
  form.title = `${r!.title} · 评论`;
  form.keywordIds = r!.keywordIds || [];
  form.siteIds = r!.siteIds || [];
  form.productIds = r!.productIds || [];
  selected.value = undefined;
}
</script>
<template>
  <main class="hci-page">
    <PageHeader
      title="消费者需求洞察"
      description="从公开讨论中找到购买疑问、使用顾虑和产品改进线索，保留每条结论的证据。"
      ><Button @click="router.push('/settings')">数据源配置</Button
      ><Button type="primary" :disabled="!serverMode" @click="begin"
        >新建需求研究</Button
      ></PageHeader
    >
    <Alert
      v-if="!serverMode"
      type="info"
      show-icon
      message="此模块需要登录服务器版，采集和分析在后台执行。"
    />
    <Alert v-if="error && !open" :message="error" type="error" show-icon />
    <section class="hci-panel">
      <div class="hci-toolbar">
        <Input.Search
          v-model:value="search"
          placeholder="检索研究主题"
          allow-clear
        /><Select
          v-model:value="reviewFilter"
          :options="[
            { label: '全部人工状态', value: 'ALL' },
            { label: '待审阅', value: 'pending' },
            { label: '已入选', value: 'selected' },
            { label: '已排除', value: 'excluded' },
          ]"
        /><Button @click="load">刷新</Button
        ><span class="hci-subtle"
          >{{ rows.length }} 份研究 · 当前市场
          {{ marketName(state.market) }}</span
        >
      </div>
      <Empty
        v-if="!rows.length"
        description="暂无研究；可输入关键词发现 Reddit 讨论，或提交公开帖子、视频链接采集评论。"
      />
      <Table
        v-else
        :data-source="rows"
        row-key="id"
        :columns="[
          { title: '研究主题', key: 'title' },
          { title: '证据范围', key: 'scope' },
          { title: '状态', key: 'status' },
          { title: '操作', key: 'action' },
        ]"
        :pagination="{
          defaultPageSize: 10,
          showSizeChanger: true,
          pageSizeOptions: ['10', '20', '50', '100'],
        }"
        :scroll="{ x: 780 }"
        ><template #bodyCell="{ column, record }"
          ><template v-if="column.key === 'title'"
            ><strong>{{ record.title }}</strong>
            <p class="hci-subtle">
              {{ marketName(record.market) }} ·
              {{ new Date(record.createdAt).toLocaleString() }}
            </p></template
          ><template v-else-if="column.key === 'scope'"
            >{{ record.evidenceIds.length }} 条原文 ·
            {{
              record.sourceCount ?? record.statistics?.sourceCount ?? 0
            }}
            个页面
            <p class="hci-subtle">
              {{
                record.confidence || record.statistics?.confidence || '尚未统计'
              }}
            </p></template
          ><template v-else-if="column.key === 'status'"
            ><Tag>{{
              record.status === 'completed'
                ? '范围内采集结束'
                : record.status === 'cancelled'
                  ? '已取消'
                  : record.status === 'running'
                    ? '处理中'
                    : '部分完成'
            }}</Tag
            ><Tag>{{
              record.hasModelAnalysis || record.modelAnalysis
                ? '已有模型分析'
                : '证据与统计'
            }}</Tag></template
          ><template v-else
            ><Button size="small" @click="details(asReport(record))"
              >查看报告</Button
            ><Button
              size="small"
              :disabled="!modelReady || !record.evidenceIds.length || busy"
              @click="analyze(asReport(record))"
              >语义分析</Button
            ></template
          ></template
        ></Table
      >
    </section>
    <Drawer
      :open="!!selected"
      title="消费者需求 · 证据与决策"
      :width="960"
      @close="closeDetails"
      ><p v-if="detailBusy" role="status">正在读取原始证据…</p>
      <template v-else-if="selected"
        ><Button
          v-if="
            evidence.some((e) => e.kind === 'post' && e.platform === 'Reddit')
          "
          @click="collectPostComments"
          >继续采集这些讨论的评论（最多20个帖子）</Button
        ><ResearchReport
          :report="selected"
          :evidence="evidence"
          :refreshing="detailRefreshing"
          @reviewed="reviewed"
          @refresh="details(selected, true)" /></template
    ></Drawer>
    <Modal
      v-model:open="open"
      title="新建消费者需求研究"
      :width="760"
      :confirm-loading="busy"
      ok-text="提交后台研究"
      cancel-text="取消"
      @ok="submit"
      ><Form layout="vertical" @change="requestId = ''">
        <Form.Item label="研究主题"
          ><Input
            v-model:value="form.title"
            placeholder="例如：肌酸软糖的购买顾虑"
            :maxlength="160"
        /></Form.Item>
        <div class="hci-form-grid">
          <Form.Item label="目标研究市场"
            ><Select
              v-model:value="form.market"
              :options="marketOptions"
              @change="
                form.keywordIds = [];
                form.siteIds = [];
                form.productIds = [];
              " /></Form.Item
          ><Form.Item label="公开数据来源"
            ><Select
              v-model:value="form.sourceKind"
              :options="[
                { label: 'Reddit · 关键词发现讨论帖', value: 'reddit_search' },
                { label: 'Reddit · 指定帖子评论', value: 'reddit_comments' },
                { label: 'YouTube · 指定视频评论', value: 'youtube_comments' },
                { label: 'TikTok · 指定视频评论', value: 'tiktok_comments' },
              ]"
          /></Form.Item>
        </div>
        <Form.Item
          v-if="form.sourceKind === 'reddit_search'"
          label="研究关键词（使用目标语言）"
          ><Input
            v-model:value="form.query"
            placeholder="例如 creatine gummies"
            :maxlength="300" /></Form.Item
        ><Form.Item
          v-else
          label="公开原帖 / 视频 HTTPS 链接，每行一条，最多20条"
          ><Input.TextArea
            v-model:value="form.urls"
            :rows="4"
            placeholder="填写所选平台的原始帖子或视频链接；广告库 ID 不能代替原帖"
        /></Form.Item>
        <Form.Item label="关联关键词"
          ><Select
            v-model:value="form.keywordIds"
            mode="multiple"
            show-search
            option-filter-prop="label"
            :options="
              state.keywords
                .filter((k) => k.market === form.market)
                .map((k) => ({ value: k.id, label: k.term }))
            "
        /></Form.Item>
        <div class="hci-form-grid">
          <Form.Item label="关联独立站"
            ><Select
              v-model:value="form.siteIds"
              mode="multiple"
              show-search
              option-filter-prop="label"
              :options="
                state.sites
                  .filter((s) => s.market === form.market)
                  .map((s) => ({ value: s.id, label: s.brand }))
              " /></Form.Item
          ><Form.Item label="关联商品"
            ><Select
              v-model:value="form.productIds"
              mode="multiple"
              show-search
              option-filter-prop="label"
              :options="
                state.products
                  .filter((p) => p.market === form.market)
                  .map((p) => ({ value: p.id, label: p.title }))
              " /></Form.Item
          ><Form.Item label="每个来源页数上限"
            ><InputNumber
              v-model:value="form.maxPages"
              :min="1"
              :max="10" /></Form.Item
          ><Form.Item label="任务请求上限"
            ><InputNumber
              v-model:value="form.maxRequests"
              :min="1"
              :max="100" /></Form.Item
          ><Form.Item label="去重证据条数上限"
            ><InputNumber v-model:value="form.limit" :min="1" :max="1000"
          /></Form.Item>
        </div>
        <Checkbox v-model:checked="form.analyze" :disabled="!modelReady"
          >采集后生成模型分析报告（另外消耗模型额度）</Checkbox
        >
        <p class="hci-subtle">
          最多 {{ form.maxRequests }} 次 ScrapeCreators
          请求，以实际扣费回报为准。仅保存公开文本及来源链接；目标国家不代表评论者实际所在地。达到上限时明确标记部分完成。
        </p>
        <Alert
          v-if="!modelReady"
          type="info"
          show-icon
          message="尚未配置语义模型；本次仍可采集、统计主题并导出证据，稍后可对已有证据生成分析。"
        /><Alert v-if="error" :message="error" type="error" show-icon /> </Form
    ></Modal>
  </main>
</template>
