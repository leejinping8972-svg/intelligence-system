<script setup lang="ts">
import { computed, onUnmounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

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
  Tag,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { session } from '../session';

interface Plan {
  enabled: boolean;
  time: string;
  markets: string[];
  providers: string[];
  maxPages: number;
  maxAds: number;
  perKeyword: number;
  semrushUnitBudget: number;
}
interface Run {
  day: string;
  selectedCount: number;
  reserved: { ads: number; products: number; semrush: number };
  work: Array<{
    requestId: string;
    term: string;
    market: string;
    kind: string;
    status: string;
    reason: string;
    jobId?: string;
  }>;
}
interface Snapshot {
  plan: Plan;
  selectedCount: number;
  runs: Run[];
}
const router = useRouter();
const busy = ref(false);
const error = ref('');
const loaded = ref(false);
const loading = ref(false);
const open = ref(false);
const acknowledged = ref(false);
const selectedCount = ref(0);
const runs = ref<Run[]>([]);
const form = reactive<Plan>({
  enabled: false,
  time: '09:00',
  markets: ['US', 'MX', 'VN'],
  providers: ['sorftime', 'semrush'],
  maxPages: 1,
  maxAds: 20,
  perKeyword: 10,
  semrushUnitBudget: 0,
});
const canEdit = computed(() => session.user?.role === 'admin');
const statusLabel: Record<string, string> = {
  pending: '等待排队',
  queued: '已排队',
  running: '采集中',
  completed: '已完成',
  partial: '部分完成',
  failed: '失败',
  skipped: '未执行',
  cancelled: '已取消',
};
const columns = [
  { title: '关键词', dataIndex: 'term', width: 180 },
  { title: '市场', dataIndex: 'market', width: 70 },
  { title: '采集', key: 'kind', width: 80 },
  { title: '状态', key: 'status', width: 100 },
  { title: '说明 / 任务', key: 'reason', width: 300 },
];
let timer: ReturnType<typeof setInterval> | undefined;
async function load(reset = false) {
  if (loading.value) return;
  loading.value = true;
  try {
    const value = await cloudRequest<Snapshot>('server_daily_discovery_status');
    if (reset) {
      Object.assign(form, value.plan);
      acknowledged.value = false;
    }
    selectedCount.value = value.selectedCount;
    runs.value = value.runs;
    loaded.value = true;
    if (reset) error.value = '';
  } catch (e) {
    error.value = e instanceof Error ? e.message : '计划读取失败';
  } finally {
    loading.value = false;
  }
}
async function begin() {
  open.value = true;
  loaded.value = false;
  await syncCloudWorkspace();
  await load(true);
  timer ||= setInterval(() => {
    if (open.value) void load();
  }, 15_000);
}
function close() {
  open.value = false;
  clearInterval(timer);
  timer = undefined;
}
onUnmounted(() => clearInterval(timer));
async function save() {
  if (busy.value) return;
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.time) ||
    !form.markets.length ||
    !form.providers.length
  ) {
    error.value = '请选择执行时间、市场和商品来源';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await cloudRequest<Snapshot>('server_daily_discovery_save', {
      plan: { ...form, budgetAcknowledged: acknowledged.value },
    });
    Object.assign(form, result.plan);
    runs.value = result.runs;
    selectedCount.value = result.selectedCount;
    acknowledged.value = false;
    message.success(
      form.enabled
        ? '每日计划已保存，结果将同步到广告、商品库和新品雷达'
        : '每日计划已暂停，已经排队的任务继续执行',
    );
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button @click="begin">每日发现计划</Button>
  <Modal
    :open="open"
    title="每日按入选关键词发现广告与商品"
    :width="900"
    :body-style="{ maxHeight: '70vh', overflowY: 'auto' }"
    @cancel="close"
  >
    <Alert v-if="error" type="error" :message="error" show-icon role="alert" />
    <p class="hci-subtle">
      北京时间每天执行；自动读取所选市场的全部入选词，不受当前页面勾选、搜索或分页影响。当前计划范围有
      {{ selectedCount }} 个入选词。
    </p>
    <Form layout="vertical" :disabled="!canEdit || !loaded || busy">
      <div class="daily-fields">
        <Form.Item label="启用每日采集">
          <Switch v-model:checked="form.enabled" aria-label="启用每日采集" />
        </Form.Item>
        <Form.Item label="执行时间（北京时间）">
          <Input
            v-model:value="form.time"
            type="time"
            aria-label="执行时间（北京时间）"
          />
        </Form.Item>
        <Form.Item label="覆盖市场" html-for="daily-markets">
          <Select
            id="daily-markets"
            v-model:value="form.markets"
            mode="multiple"
            aria-label="覆盖市场"
            :options="[
              { label: '美国', value: 'US' },
              { label: '墨西哥', value: 'MX' },
              { label: '越南', value: 'VN' },
            ]"
          />
        </Form.Item>
        <Form.Item label="商品来源" html-for="daily-providers">
          <Select
            id="daily-providers"
            v-model:value="form.providers"
            mode="multiple"
            aria-label="商品来源"
            :options="[
              { label: 'Sorftime / Amazon（美国、墨西哥）', value: 'sorftime' },
              { label: 'Semrush / Google Shopping', value: 'semrush' },
            ]"
          />
        </Form.Item>


        <Form.Item label="每词广告页数">
          <InputNumber
            v-model:value="form.maxPages"
            :min="1"
            :max="10"
            aria-label="每词广告页数"
          />
        </Form.Item>
        <Form.Item label="每词广告条数上限">
          <InputNumber
            v-model:value="form.maxAds"
            :min="1"
            :max="100"
            aria-label="每词广告条数上限"
          />
        </Form.Item>
        <Form.Item label="每词每来源商品条数上限">
          <InputNumber
            v-model:value="form.perKeyword"
            :min="1"
            :max="100"
            aria-label="每词每来源商品条数上限"
          />
        </Form.Item>
      </div>
      <Alert
        type="info"
        show-icon
        message="每日只做广告和商品发现，保留来源与新旧判断；商品详情/销量趋势通过商品库另行补全。"
        description="按每词商品数、广告数与页数执行，每日轮换词序。越南自动排除Sorftime。当天已开始的批次使用启动时的设置，修改从下一批生效；暂停会停止尚未排队的步骤。错过时间则当日恢复后执行一次，不补跑往日。"
      />
      <Form.Item v-if="form.enabled" style="margin-top: 16px">
        <Checkbox v-model:checked="acknowledged">
          我确认每日自动采集会消耗已配置来源的额度，并按所选数量与页数运行
        </Checkbox>
      </Form.Item>
    </Form>
    <p v-if="!canEdit" class="hci-subtle">仅管理员可以修改每日计划。</p>
    <template #footer>
      <div class="daily-actions">
        <Button @click="close">关闭</Button>
        <Button :loading="loading" @click="load()">刷新执行记录</Button>
        <Button
          v-if="canEdit"
          type="primary"
          :loading="busy"
          :disabled="!loaded || (form.enabled && !acknowledged)"
          @click="save"
        >
          保存计划
        </Button>
      </div>
    </template>
    <h3>最近7次每日执行记录</h3>
    <section v-for="run in runs" :key="run.day" class="daily-run">
      <strong>{{ run.day }} · {{ run.selectedCount }} 个入选词</strong>
      <p class="hci-subtle">
        预计来源用量：广告 {{ run.reserved.ads }} 次 / 商品
        {{ run.reserved.products }} 次 / Semrush
        {{ run.reserved.semrush }} units；已完成
        {{ run.work.filter((e) => e.status === 'completed').length }} 项，未执行
        {{ run.work.filter((e) => e.status === 'skipped').length }} 项。
      </p>
      <Table
        :columns="columns"
        :data-source="run.work"
        row-key="requestId"
        size="small"
        :scroll="{ x: 730 }"
        :pagination="{ pageSize: 5, hideOnSinglePage: true }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'kind'">
            {{ record.kind === 'ads' ? '广告' : '商品' }}
          </template>
          <template v-if="column.key === 'status'">
            <Tag
              :color="
                record.status === 'completed'
                  ? 'green'
                  : record.status === 'failed'
                    ? 'red'
                    : 'default'
              "
            >
              {{ statusLabel[record.status] || record.status }}
            </Tag>
          </template>
          <template v-if="column.key === 'reason'">
            {{ record.reason }}
            <Button
              v-if="record.jobId"
              type="link"
              size="small"
              @click="
                close();
                router.push({ path: '/monitor', query: { job: record.jobId } });
              "
            >
              查看任务
            </Button>
          </template>
        </template>
      </Table>
    </section>
    <p v-if="!runs.length" class="hci-subtle">
      尚无每日执行记录。计划启用后由服务器运行，关闭页面也会继续。
    </p>
  </Modal>
</template>
<style scoped>
.daily-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 20px;
}

.daily-fields :deep(.ant-input-number) {
  width: 100%;
}

.daily-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: flex-end;
  margin: 0;
}

.daily-run {
  padding: 14px 0;
  border-top: 1px solid #e5e7eb;
}

@media (max-width: 600px) {
  .daily-fields {
    grid-template-columns: 1fr;
  }
}
</style>
