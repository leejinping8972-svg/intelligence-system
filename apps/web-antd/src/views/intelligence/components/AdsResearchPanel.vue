<script setup lang="ts">
import type { Ad } from '../data';
import type {
  ResearchEvidence,
  ResearchReport as Report,
} from '../research-reports';
import {
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
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Table,
  Tag,
  message,
} from 'ant-design-vue';
import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import { serverMode } from '../session';
import { reportStatus } from '../report-document';
import { cachedReport, readReport, saveReport } from '../report-details';
import ResearchReport from './ResearchReport.vue';
import AdReportPrompt from './AdReportPrompt.vue';
const props = defineProps<{ ads: Ad[] }>(),
  router = useRouter(),
  route = useRoute();
const open = ref(false),
  busy = ref(false),
  listBusy = ref(false),
  detailBusy = ref(false),
  detailRefreshing = ref(false),
  error = ref(''),
  adIds = ref<string[]>([]),
  reports = ref<Report[]>([]),
  selected = ref<Report>(),
  evidence = ref<ResearchEvidence[]>([]),
  modelReady = ref(false),
  reusing = ref<Report>(),
  downloadId = ref('');
const list = reactive({
  search: '',
  status: 'ALL',
  page: 1,
  pageSize: 10,
  total: 0,
});
const form = reactive({
  title: '广告策略决策报告',
  analyze: false,
  fetchTranscript: false,
  maxRequests: 10,
  researchFocus: '',
});
let requestId = '',
  listToken = 0,
  detailToken = 0,
  timer: ReturnType<typeof setTimeout> | undefined,
  searchTimer: ReturnType<typeof setTimeout> | undefined,
  active = true;
function stop() {
  if (timer) clearTimeout(timer);
  timer = undefined;
}
async function load() {
  if (!serverMode) return;
  const token = ++listToken;
  listBusy.value = !reports.value.length;
  try {
    const data = await cloudRequest<{ reports: Report[]; total: number }>(
      'server_insight_snapshot',
      { paginated: true, kind: 'ad', market: state.market, ...list },
    );
    if (token !== listToken) return;
    reports.value = data.reports;
    list.total = data.total;
    error.value = '';
    const current = data.reports.find((r) => r.id === selected.value?.id);
    if (current && current.revision !== selected.value?.revision)
      await details(current);
    if (route.query.report && !selected.value)
      await details(
        data.reports.find((r) => r.id === route.query.report) ||
          ({ id: String(route.query.report) } as Report),
      );
    stop();
    if (
      active &&
      reports.value.some((r) => ['queued', 'running'].includes(r.status))
    )
      timer = setTimeout(() => void load(), 10000);
  } catch (e) {
    if (token === listToken)
      error.value = e instanceof Error ? e.message : '报告列表读取失败';
  } finally {
    if (token === listToken) listBusy.value = false;
  }
}
async function checkModel() {
  try {
    modelReady.value = (
      await cloudRequest<{ configured: boolean }>('server_analysis_status')
    ).configured;
  } catch {
    modelReady.value = false;
  }
}
onMounted(async () => {
  await Promise.all([load(), checkModel()]);
});
let firstActivation = true;
onActivated(() => {
  active = true;
  if (firstActivation) {
    firstActivation = false;
    return;
  }
  void load();
});
onDeactivated(() => {
  active = false;
  stop();
});
onUnmounted(() => {
  active = false;
  stop();
  if (searchTimer) clearTimeout(searchTimer);
  listToken++;
  detailToken++;
});
watch(() => state.market, () => {
  listToken++;
  selected.value = undefined;
  evidence.value = [];
  reports.value = [];
  list.total = 0;
  adIds.value = [];
  reusing.value = undefined;
  open.value = false;
  detailToken++;
  detailBusy.value = false;
  detailRefreshing.value = false;
});
watch(
  () => [state.market, list.status],
  () => {
    list.page = 1;
    void load();
  },
);
watch(
  () => list.search,
  () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      list.page = 1;
      void load();
    }, 350);
  },
);
async function begin(ids?: string[]) {
  await checkModel();
  adIds.value = ids || props.ads.slice(0, 30).map((a) => a.id);
  reusing.value = undefined;
  requestId = '';
  error.value = '';
  form.title = '广告策略决策报告';
  form.analyze = modelReady.value;
  form.fetchTranscript = false;
  form.researchFocus = '';
  open.value = true;
}
async function reanalyze(report: Report) {
  await checkModel();
  if (!modelReady.value) {
    message.warning('请先在数据源与设置配置分析模型');
    return;
  }
  reusing.value = report;
  requestId = '';
  error.value = '';
  form.title = `${report.title} · 重新分析`.slice(0, 160);
  form.researchFocus = '';
  form.analyze = true;
  form.fetchTranscript = false;
  open.value = true;
}
defineExpose({ begin });
async function submit() {
  if (busy.value) return;
  const ads = props.ads.filter((a) => adIds.value.includes(a.id));
  if (
    !reusing.value &&
    (!ads.length || ads.length !== adIds.value.length || ads.length > 100)
  ) {
    error.value = '请选择1～100条当前列表中的广告';
    return;
  }
  if (!reusing.value && new Set(ads.map((a) => a.market)).size !== 1) {
    error.value = '请先选择单一国家市场，避免混合不同市场的广告证据';
    return;
  }
  if (!form.title.trim()) {
    error.value = '请输入报告名称';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    if (!reusing.value) await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_insight',
      {
        ...form,
        kind: reusing.value ? 'evidence_analysis' : 'ad_analysis',
        ...(reusing.value
          ? { reportId: reusing.value.id, market: reusing.value.market }
          : { market: ads[0]!.market, adIds: adIds.value }),
        requestId,
      },
    );
    requestId = '';
    open.value = false;
    message.success('报告已提交后台，完成后可在广告报告列表查看与下载');
    await load();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
async function getDetails(report: Report) {
  return readReport(report);
}
async function details(report: Report, force = false) {
  const token = ++detailToken;
  const cached = cachedReport(report.id);
  const keepCurrent = selected.value?.id === report.id && !detailBusy.value;
  if (cached) {
    selected.value = cached.report;
    evidence.value = cached.evidence;
  } else if (!keepCurrent) {
    selected.value = report;
    evidence.value = [];
  }
  detailBusy.value = !cached && !keepCurrent;
  detailRefreshing.value = true;
  try {
    const data = await readReport(report, force);
    if (token === detailToken) {
      selected.value = data.report;
      evidence.value = data.evidence;
      reports.value = reports.value.map((r) =>
        r.id === data.report.id ? { ...r, ...data.report } : r,
      );
    }
  } catch (e) {
    if (token === detailToken) {
      if (!cached && !keepCurrent) selected.value = undefined;
      message.error(
        e instanceof Error ? e.message : '读取失败，已保留当前报告',
      );
    }
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
async function download(report: Report) {
  downloadId.value = report.id;
  try {
    const data = await getDetails(report);
    if (['queued', 'running'].includes(data.report.status)) {
      message.info('报告尚未完成，请稍后下载');
      return;
    }
    const { downloadReport } = await import('../report-docx');
    await downloadReport(data.report, data.evidence);
  } catch (e) {
    message.error(e instanceof Error ? e.message : '下载失败');
  } finally {
    downloadId.value = '';
  }
}
function closeDetails() {
  detailToken++;
  selected.value = undefined;
  if (route.query.report)
    void router.replace({ query: { ...route.query, report: undefined } });
}
const asReport = (r: Record<string, any>) => r as Report;
const isActive = (r: Report) => ['queued', 'running'].includes(r.status);
</script>
<template>
  <section class="hci-panel">
    <div class="hci-panel-head">
      <div>
        <h2>广告分析报告</h2>
        <p class="hci-subtle">
          从样本证据形成品牌对比、创意拆解、差异化机会与测试计划。每份报告独立保存，可下载完整文档。
        </p>
      </div>
      <div class="hci-toolbar">
        <AdReportPrompt /><Button
          type="primary"
          :disabled="!serverMode || !ads.length"
          @click="begin()"
          >生成广告分析报告</Button
        >
      </div>
    </div>
    <div class="hci-toolbar">
      <Input.Search
        v-model:value="list.search"
        placeholder="搜索报告名称或编号"
        allow-clear
      /><Select
        v-model:value="list.status"
        :options="[
          { label: '全部报告状态', value: 'ALL' },
          { label: '排队中', value: 'queued' },
          { label: '生成中', value: 'running' },
          { label: '已完成', value: 'completed' },
          { label: '部分完成', value: 'partial' },
          { label: '已取消', value: 'cancelled' },
        ]"
      /><Button :loading="listBusy" @click="load">刷新报告列表</Button
      ><span class="hci-toolbar-end hci-subtle"
        >共 {{ list.total }} 份报告</span
      >
    </div>
    <Alert v-if="error && !open" :message="error" type="error" show-icon />
    <Table
      :data-source="reports"
      :loading="listBusy"
      row-key="id"
      :scroll="{ x: 1000 }"
      :columns="[
        { title: '报告名称', key: 'title', width: 260 },
        { title: '市场 / 状态', key: 'status', width: 160 },
        { title: '证据与分析', key: 'analysis', width: 180 },
        { title: '创建时间', key: 'time', width: 175 },
        { title: '操作', key: 'actions', width: 255 },
      ]"
      :pagination="{
        current: list.page,
        pageSize: list.pageSize,
        total: list.total,
        showSizeChanger: true,
        pageSizeOptions: ['10', '20', '50'],
        showTotal: (n: number) => `共 ${n} 份报告`,
        onChange: (page: number, size: number) => {
          list.page = page;
          list.pageSize = size;
          load();
        },
      }"
    >
      <template #emptyText
        >暂无广告分析报告，选择现有广告生成第一份报告</template
      >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'title'"
          ><Button
            type="link"
            class="report-title-link"
            @click="details(asReport(record))"
            >{{ record.title }}</Button
          >
          <p class="hci-subtle">
            {{ record.parentReportId ? '复用历史证据' : '所选广告分析' }} ·
            {{ String(record.id).slice(0, 8) }}
          </p></template
        >
        <template v-else-if="column.key === 'status'"
          ><Tag>{{ record.market }}</Tag
          ><Tag
            :color="
              record.status === 'completed'
                ? 'green'
                : record.status === 'partial'
                  ? 'orange'
                  : 'blue'
            "
            >{{ reportStatus(record.status) }}</Tag
          ></template
        >
        <template v-else-if="column.key === 'analysis'"
          ><p>
            {{ record.evidenceIds?.length || 0 }} 条证据 ·
            {{ record.hasModelAnalysis ? '模型策略报告' : '证据统计' }}
          </p>
          <p class="hci-subtle">
            {{ record.modelName || '未生成模型分析'
            }}<span v-if="record.promptVersion">
              · {{ record.promptVersion }}</span
            >
          </p></template
        >
        <span v-else-if="column.key === 'time'">{{
          new Date(record.createdAt).toLocaleString('zh-CN')
        }}</span>
        <div v-else class="report-actions">
          <Button size="small" @click="details(asReport(record))"
            >查看报告</Button
          ><Button
            size="small"
            :disabled="isActive(asReport(record))"
            :loading="downloadId === record.id"
            @click="download(asReport(record))"
            >下载 Word</Button
          ><Button
            size="small"
            :disabled="
              isActive(asReport(record)) || !record.evidenceIds?.length
            "
            @click="reanalyze(asReport(record))"
            >重新分析</Button
          >
        </div>
      </template>
    </Table>
    <Modal
      v-model:open="open"
      :title="reusing ? '基于已有证据重新分析' : '生成广告分析报告'"
      :width="740"
      ok-text="提交后台分析"
      cancel-text="取消"
      :confirm-loading="busy"
      @ok="submit"
    >
      <Form layout="vertical" @change="requestId = ''">
        <Form.Item label="报告名称"
          ><Input v-model:value="form.title" :maxlength="160"
        /></Form.Item>
        <Alert
          v-if="reusing"
          type="info"
          show-icon
          :message="`复用此报告已保存的 ${reusing.evidenceIds.length} 条证据，使用提交时的提示词生成新报告；不会重新采集广告或转写视频。`"
        />
        <Form.Item v-else label="选择广告（同一市场，最多100条）"
          ><Select
            v-model:value="adIds"
            mode="multiple"
            :max-tag-count="3"
            show-search
            option-filter-prop="label"
            :options="
              ads.map((a) => ({
                label: `${a.brand} · ${a.market} · ${a.headline || a.archiveId || a.id}`,
                value: a.id,
              }))
            "
        /></Form.Item>
        <Form.Item label="本次研究重点"
          ><Input.TextArea
            v-model:value="form.researchFocus"
            :rows="3"
            :maxlength="2000"
            show-count
            placeholder="例如：针对美国女性健身用户，比较软糖与粉剂的购买阻碍，提出两组可测试的开场文案。"
        /></Form.Item>
        <template v-if="!reusing"
          ><Checkbox v-model:checked="form.fetchTranscript"
            >补充所选视频广告转写（消耗 ScrapeCreators 额度）</Checkbox
          ><Form.Item v-if="form.fetchTranscript" label="转写请求上限"
            ><InputNumber v-model:value="form.maxRequests" :min="1" :max="100"
          /></Form.Item>
          <p class="hci-subtle">
            不启用长视频额外付费转写。缺少转写时不编造视频口播或画面。
          </p>
          <Checkbox v-model:checked="form.analyze" :disabled="!modelReady"
            >生成模型策略分析（使用已配置模型，另计模型费用）</Checkbox
          ></template
        >
        <Alert
          v-if="!modelReady"
          type="info"
          message="尚未配置分析模型，本次只能整理证据与规则主题。请在数据源与设置配置模型后生成策略分析。"
          show-icon
        />
        <Alert v-if="error" :message="error" type="error" show-icon />
      </Form>
    </Modal>
    <Drawer
      :open="!!selected"
      title="广告分析报告"
      :width="1050"
      @close="closeDetails"
      ><p v-if="detailBusy">正在读取完整报告…</p>
      <ResearchReport
        v-else-if="selected"
        :report="selected"
        :evidence="evidence"
        :refreshing="detailRefreshing"
        @reviewed="reviewed"
        @refresh="details(selected, true)"
    /></Drawer>
  </section>
</template>
<style scoped>
.report-title-link {
  white-space: normal;
  text-align: left;
  height: auto;
  padding: 0;
  font-weight: 600;
}
.report-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
