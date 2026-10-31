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

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Switch,
  Table,
} from 'ant-design-vue';

import { cloudRequest, cloudWorkspace } from '../cloud-workspace';
import { loadSocialTrends, socialTrends } from '../keyword-social-trends';
import { session } from '../session';

const props = defineProps<{ ids: string[]; visibleIds?: string[] }>();
const acknowledged = ref(false);
const busy = ref(false);
const loaded = ref(false);
const open = ref(false);
const run = ref<TrendSnapshot['run']>(null);
const requiresReview = ref(false);
const plan = reactive<TrendPlan>({
  comparisonVersion: 2,
  enabled: false,
  time: '09:00',
  sources: ['google', 'tiktok', 'instagram', 'facebook'],
  markets: ['US', 'MX', 'VN'],
  maxPages: 11,
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
        plan.enabled ? '已保存入选关键词每日趋势计划' : '每日趋势计划已暂停',
      );
    }
    await refresh();
  } catch (e) {
    message.error(e instanceof Error ? e.message : '趋势操作失败');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button :disabled="!cloudWorkspace.ready" @click="show">
    趋势采集 / 每日监测
  </Button>
  <Modal
    v-model:open="open"
    title="四平台关键词趋势"
    :width="850"
    :footer="null"
    :mask-closable="!busy"
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
      message="统一周期：本周、本月、近3个月、近6个月"
      description="直接回查前后期历史：本周对上周同期，本月查两个月，近3个月查六个月，近6个月查一年。社媒按真实发布时间统计内容样本，以日均发布量计算环比；历史取全后立即出结果，取不全则说明缺口。Google保留相对搜索热度口径。"
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
        确认使用已配置ScrapeCreators额度
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
      <Button
        :loading="busy"
        :disabled="
          !admin ||
          !loaded ||
          (plan.enabled && !acknowledged) ||
          !plan.sources.length ||
          !plan.markets.length
        "
        @click="submit('save')"
      >
        保存每日计划
      </Button>
    </Form>
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
    <p v-else class="hci-subtle">
      今天尚无趋势采集任务。浏览和刷新只读取已存数据。
    </p>
  </Modal>
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
