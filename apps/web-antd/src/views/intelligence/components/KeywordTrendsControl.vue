<script setup lang="ts">
import type { TrendPlan, TrendSnapshot } from '../keyword-social-trends';

import {
  computed,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Switch,
  Table,
} from 'ant-design-vue';

import { cloudRequest, cloudWorkspace } from '../cloud-workspace';
import { loadSocialTrends, socialTrends } from '../keyword-social-trends';
import { session } from '../session';
import MonitorConfigPanel from './MonitorConfigPanel.vue';

const props = defineProps<{ ids: string[]; visibleIds?: string[]; embedded?: boolean }>();
const emit = defineEmits<{ saved: [] }>();
const router = useRouter();
const relatedRun = ref<TrendSnapshot['relatedRun']>(null);
const relatedLabels: Record<string, string> = { products: '关联商品', ads: '关联广告', sites: '独立站' };
const marketLabels: Record<string, string> = { US: '美国', MX: '墨西哥', VN: '越南' };
const acknowledged = ref(false);
const busy = ref(false);
const loaded = ref(false);
const open = ref(Boolean(props.embedded));
const run = ref<TrendSnapshot['run']>(null);
const requiresReview = ref(false);
const plan = reactive<TrendPlan>({
  comparisonVersion: 2,
  enabled: false,
  time: '09:00',
  sources: ['google', 'tiktok', 'instagram', 'facebook'],
  markets: ['US', 'MX', 'VN'],
  maxPages: 11,
  relatedSources: [],
  productProviders: ['sorftime', 'semrush'],
  relatedProducts: 10,
  relatedAdPages: 1,
  relatedAds: 20,
  relatedSites: 5,
});
const sources = [
  { label: '谷歌趋势', value: 'google' },
  { label: 'TK趋势', value: 'tiktok' },
  { label: 'INS趋势', value: 'instagram' },
  { label: 'FB趋势', value: 'facebook' },
];
const sourceLabels = Object.fromEntries(sources.map((s) => [s.value, s.label]));
const admin = computed(() => session.user?.role === 'admin');
const searchPages = computed(
  () =>
    props.ids.length *
    plan.sources.reduce(
      (n, s) =>
        n +
        (s === 'google'
          ? 0
          : Math.min(plan.maxPages, s === 'instagram' ? 11 : 100)),
      0,
    ),
);
const statusLabels: Record<string, string> = {
  pending: '等待采集',
  submitted: '已进入Google队列',
  queued: '后台排队',
  running: '采集中',
  cancelled: '已取消',
  awaiting_review: '待审核',
  completed: '已采集',
  partial: '历史覆盖不足',
  skipped: '未执行',
  failed: '采集失败',
  unknown: '结果待核对',
};
let timer: ReturnType<typeof setInterval> | undefined;
let active = false;
async function refresh(reset = false) {
  if (!cloudWorkspace.ready) return;
  try {
    const value = await loadSocialTrends(props.visibleIds);
    run.value = value.run;
    relatedRun.value = value.relatedRun || null;
    requiresReview.value = value.requiresPlanReview === true;
    if (reset || !loaded.value) {
      Object.assign(plan, value.plan);
      acknowledged.value = false;
    }
    loaded.value = true;
  } catch {
    /* Shared state keeps the last successful summary and visible error. */
  }
}
function activate() {
  active = true;
  void refresh();
  if (!timer)
    timer = setInterval(() => {
      if (!busy.value) void refresh();
    }, 30_000);
}
function deactivate() {
  active = false;
  clearInterval(timer);
  timer = undefined;
}
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onUnmounted(deactivate);
watch(() => props.visibleIds?.join(','), () => { if (active) void refresh(); });
watch(
  () => cloudWorkspace.ready,
  (ready) => {
    if (ready && active) void refresh();
  },
);
async function show() {
  open.value = true;
  await refresh(true);
}
async function submit(kind: 'collect' | 'save') {
  busy.value = true;
  try {
    if (kind === 'collect') {
      await cloudRequest('server_keyword_trends_collect', {
        keywordIds: props.ids,
        plan: { ...plan },
        budgetAcknowledged: acknowledged.value,
      });
      message.success('已提交后台；本日相同来源和周期不会重复采集');
    } else {
      await cloudRequest('server_keyword_trends_save', {
        plan: { ...plan, budgetAcknowledged: acknowledged.value },
      });
      message.success(
        plan.enabled ? '已保存入选关键词每日监测计划' : '每日监测计划已暂停',
      );
    }
    await refresh();
    if (kind === 'save') emit('saved');
  } catch (e) {
    message.error(e instanceof Error ? e.message : '趋势操作失败');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button v-if="!embedded" :disabled="!cloudWorkspace.ready" @click="show">
    趋势采集 / 每日监测
  </Button>
  <MonitorConfigPanel
    :embedded="embedded"
    v-model:open="open"
    title="关键词趋势与每日监测"
    :width="850"
    :footer="null"
    :mask-closable="!busy"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
  >
    <Alert
      v-if="socialTrends.error"
      type="error"
      show-icon
      :message="socialTrends.error"
    />
    <Alert
      type="info"
      show-icon
      message="第二步：趋势分析 / 每日监测（谷歌、TK、INS、FB）"
      description="关键词拓展完成后在此采集四平台趋势。统一周期：本周、本月、近3个月、近6个月；社媒按真实发布时间统计日均发布量环比；Google 保留相对搜索热度口径。"
    />
    <Alert
      v-if="requiresReview"
      type="warning"
      show-icon
      message="旧版每日计划不再自动执行，请确认历史回查预算并保存新方案。旧请求不会重放。"
    />
    <Form layout="vertical" class="trend-plan-form">
      <Form.Item label="采集来源">
        <Select
          v-model:value="plan.sources"
          mode="multiple"
          :options="sources"
          :disabled="!admin || busy"
        />
      </Form.Item>
      <div class="trend-plan-grid">

        <Form.Item label="每个来源回查最多页数（INS最多11页）">
          <InputNumber
            v-model:value="plan.maxPages"
            :min="1"
            :max="100"
            :disabled="!admin || busy"
          />
        </Form.Item>
      </div>
      <p class="hci-subtle">
        当前勾选 {{ ids.length }} 个词，按所选来源最多安排
        {{ searchPages }}
        页社媒搜索结果。Google进入原趋势队列；INS/FB为公开样本。达到页数上限后，可增加页数重新提交，从新分页续查。INS接口最多11页。
      </p>
      <Checkbox v-if="admin" v-model:checked="acknowledged">
        确认使用所选采集来源及商品资料整理所需的已配置额度
      </Checkbox>
      <div class="hci-toolbar trend-plan-actions">
        <Button
          type="primary"
          :loading="busy"
          :disabled="
            !admin ||
            !loaded ||
            !ids.length ||
            ids.length > 100 ||
            !plan.sources.length ||
            !acknowledged
          "
          @click="submit('collect')"
        >
          采集勾选关键词（{{ ids.length }}）
        </Button>
        <Button :loading="socialTrends.loading" @click="refresh()">
          刷新结果
        </Button>
        <span class="hci-subtle">每批最多100个词，本日同一检索自动去重</span>
      </div>
      <div class="trend-plan-grid">
        <Form.Item label="入选关键词每日监测">
          <Switch
            v-model:checked="plan.enabled"
            :disabled="!admin || busy"
            checked-children="启用"
            un-checked-children="暂停"
          />
        </Form.Item>
        <Form.Item label="每天执行时间（北京时间）">
          <Input
            v-model:value="plan.time"
            type="time"
            :disabled="!admin || busy"
          />
        </Form.Item>
      </div>
      <Form.Item label="每日监测市场">
        <Select
          v-model:value="plan.markets"
          mode="multiple"
          :disabled="!admin || busy"
          :options="[
            { label: '美国', value: 'US' },
            { label: '墨西哥', value: 'MX' },
            { label: '越南', value: 'VN' },
          ]"
        />
      </Form.Item>
      <Form.Item label="每日关联采集">
        <Checkbox.Group
          v-model:value="plan.relatedSources"
          :disabled="!admin || busy"
          :options="[
            { label: '关联商品', value: 'products' },
            { label: '关联广告', value: 'ads' },
            { label: '独立站', value: 'sites' },
          ]"
        />
      </Form.Item>
      <template v-if="plan.relatedSources.includes('products')">
        <Form.Item label="每日商品来源">
          <Select
            v-model:value="plan.productProviders"
            mode="multiple"
            :disabled="!admin || busy"
            :options="[
              { label: 'Amazon · Sorftime（美国、墨西哥）', value: 'sorftime' },
              { label: 'Google Shopping · Semrush', value: 'semrush' },
              { label: 'TikTok Shop · ScrapeCreators', value: 'tiktok_shop' },
            ]"
          />
        </Form.Item>
        <Form.Item label="每词每来源商品上限">
          <InputNumber v-model:value="plan.relatedProducts" :min="1" :max="100" :disabled="!admin || busy" />
        </Form.Item>
      </template>
      <div v-if="plan.relatedSources.includes('ads')" class="trend-plan-grid">
        <Form.Item label="每词广告查询页数">
          <InputNumber v-model:value="plan.relatedAdPages" :min="1" :max="10" :disabled="!admin || busy" />
        </Form.Item>
        <Form.Item label="每词广告数量上限">
          <InputNumber v-model:value="plan.relatedAds" :min="1" :max="100" :disabled="!admin || busy" />
        </Form.Item>
      </div>
      <Form.Item v-if="plan.relatedSources.includes('ads') || plan.relatedSources.includes('sites')" label="每词每路独立站上限">
        <InputNumber v-model:value="plan.relatedSites" :min="1" :max="10" :disabled="!admin || busy" />
      </Form.Item>
      <p class="hci-subtle">
        每日按以上市场的全部已入选关键词执行，与表格勾选无关。广告采集正在投放的广告及落地站，独立站通过 Brave 搜索与官网核验；结果关联回原关键词。
        商品来源按市场支持范围执行，TikTok 非美国覆盖可能有限。数量均为上限，商品资料整理可能使用模型额度。
        新增关联采集需勾选并保存；当日范围首次执行后固定，后续配置次日生效。未提交的历史步骤跨日跳过。
      </p>
      <Button
        :loading="busy"
        :disabled="
          !admin ||
          !loaded ||
          (plan.relatedSources.includes('products') && !plan.productProviders.length) ||
          (plan.enabled && !acknowledged) ||
          !plan.sources.length ||
          !plan.markets.length
        "
        @click="submit('save')"
      >
        保存每日计划
      </Button>
    </Form>
    <template v-if="relatedRun">
      <p>{{ relatedRun.day }} 关联采集：{{ relatedRun.selectedCount }} 个入选词，共 {{ relatedRun.total }} 项，待提交 {{ relatedRun.pending }} 项。</p>
      <Table
        :data-source="relatedRun.work"
        row-key="key"
        size="small"
        :pagination="{ pageSize: 5 }"
        :scroll="{ x: 700 }"
        :columns="[
          { title: '关键词 / 市场', key: 'keyword', width: 180 },
          { title: '采集类型', key: 'kind', width: 100 },
          { title: '状态', key: 'status', width: 95 },
          { title: '说明 / 任务', key: 'details', width: 300 },
        ]"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'keyword'">{{ record.term }} · {{ marketLabels[record.market] || record.market }}</template>
          <template v-else-if="column.key === 'kind'">{{ relatedLabels[record.kind] }}</template>
          <template v-else-if="column.key === 'status'">{{ record.status === 'partial' ? '部分完成' : statusLabels[record.status] || record.status }}</template>
          <template v-else-if="column.key === 'details'">
            {{ record.reason }}
            <Button v-if="record.jobId" type="link" size="small" @click="router.push({ path: '/monitor', query: { job: record.jobId } })">查看任务</Button>
          </template>
        </template>
      </Table>
    </template>
    <p v-if="run">
      {{ run.day }}：共 {{ run.total }} 个检索步骤，待执行
      {{ run.pending }}，已预留/尝试 {{ run.usedRequests }} 次社媒请求。
    </p>
    <Table
      v-if="run"
      :data-source="run.work"
      row-key="key"
      size="small"
      :pagination="{ pageSize: 5 }"
      :scroll="{ x: 700 }"
      :columns="[
        { title: '关键词', dataIndex: 'term', width: 160 },
        { title: '来源', key: 'source', width: 90 },
        { title: '状态', key: 'status', width: 125 },
        { title: '说明', dataIndex: 'reason', width: 300 },
      ]"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'source'">
          {{ sourceLabels[record.source] }}
        </template>
        <template v-else-if="column.key === 'status'">
          {{ statusLabels[record.status] || record.status }}
        </template>
      </template>
    </Table>
    <p v-else-if="!relatedRun" class="hci-subtle">
      今天尚无趋势采集任务。浏览和刷新只读取已存数据。
    </p>
  </MonitorConfigPanel>
</template>
<style scoped>
.trend-plan-form {
  margin-top: 16px;
}

.trend-plan-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.trend-plan-actions {
  margin: 12px 0;
}

@media (width <= 600px) {
  .trend-plan-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
