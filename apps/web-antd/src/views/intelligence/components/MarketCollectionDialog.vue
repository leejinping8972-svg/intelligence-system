<script setup lang="ts">
import type { Keyword } from '../data';

import { computed, onUnmounted, reactive, ref, watch } from 'vue';

import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Tag,
} from 'ant-design-vue';

import { cloudRequest } from '../cloud-workspace';
import { marketOptions, state } from '../data';
import MonitorConfigPanel from './MonitorConfigPanel.vue';

interface RunStage {
  key: string;
  label: string;
  status: string;
  message?: string;
}
interface CollectionRun {
  id: string;
  status: string;
  startedAt: string;
  message?: string;
  stages: RunStage[];
}
interface Plan {
  market: string;
  language: string;
  seeds: string[];
  keywordIds: string[];
  sources: Record<string, boolean>;
  budgets: Record<string, number>;
}

const props = defineProps<{ embedded?: boolean }>();
const emit = defineEmits<{ submitted: []; saved: [] }>();
const open = ref(Boolean(props.embedded));
const busy = ref(false);
const error = ref('');
const runs = ref<CollectionRun[]>([]);
const readiness = ref({ scrapeCreators: false, analysisModel: false });
const form = reactive({
  market: 'VN',
  seedsText: 'collagen\nprobiotic\nmagnesium\nvitamin\nomega 3',
  keywordIds: [] as string[],
  sources: {
    tiktokShop: true,
    tiktokContent: true,
    tiktokComments: true,
    metaActiveAds: true,
    independentSites: true,
  },
  budgets: {
    maxProducts: 1000,
    perKeyword: 50,
    maxAdsPerKeyword: 100,
    adPages: 5,
    maxContentQueries: 10,
    contentPerQuery: 50,
    commentVideos: 20,
    commentPages: 3,
    siteProducts: 500,
    siteDetailProducts: 100,
  },
});
const keywordOptions = computed(() =>
  state.keywords
    .filter(
      (item: Keyword) =>
        item.market === form.market && item.reviewStatus === 'selected',
    )
    .map((item: Keyword) => ({ label: item.term, value: item.id })),
);
function stageColor(status: string) {
  if (status === 'completed') return 'green';
  if (status === 'failed' || status === 'partial') return 'orange';
  return status === 'running' ? 'blue' : 'default';
}
let timer: ReturnType<typeof setTimeout> | undefined;
let loadVersion = 0;
function applyPlan(plan: Plan) {
  form.market = plan.market;
  form.seedsText = plan.seeds.join('\n');
  form.keywordIds = plan.keywordIds;
  Object.assign(form.sources, plan.sources);
  Object.assign(form.budgets, plan.budgets);
}
async function load(loadPlan = true) {
  if (!open.value) return;
  if (timer) clearTimeout(timer);
  const version = ++loadVersion;
  const market = form.market;
  busy.value = true;
  try {
    const result = await cloudRequest<{
      plan: Plan;
      readiness: typeof readiness.value;
      runs: CollectionRun[];
    }>('server_market_collection_status', { market });
    if (version !== loadVersion || market !== form.market || !open.value)
      return;
    if (loadPlan) applyPlan(result.plan);
    readiness.value = result.readiness;
    runs.value = result.runs;
    error.value = '';
  } catch (error_) {
    error.value = error_ instanceof Error ? error_.message : '读取失败';
  } finally {
    busy.value = false;
    if (
      open.value &&
      runs.value.some((run) => ['queued', 'running'].includes(run.status))
    )
      timer = setTimeout(() => void load(false), 5000);
  }
}
watch(open, (value) => {
  if (timer) clearTimeout(timer);
  if (!value) loadVersion++;
  if (value) void load();
}, { immediate: true });
watch(
  () => form.market,
  () => {
    form.keywordIds = [];
    if (open.value) void load();
  },
);
const payload = () => ({
  market: form.market,
  seeds: form.seedsText
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean),
  keywordIds: form.keywordIds,
  sources: { ...form.sources },
  budgets: { ...form.budgets },
});
async function save(run = false) {
  busy.value = true;
  try {
    await cloudRequest('server_market_collection_save', { plan: payload() });
    if (run) {
      await cloudRequest('server_market_collection_run', { plan: payload() });
      message.success('国家市场采集计划已启动');
      emit('submitted');
    } else message.success('采集计划已保存');
    await load();
    emit('saved');
  } catch (error_) {
    message.error(error_ instanceof Error ? error_.message : '保存失败');
  } finally {
    busy.value = false;
  }
}
async function cancel(run: CollectionRun) {
  busy.value = true;
  try {
    await cloudRequest('server_market_collection_cancel', { runId: run.id });
    message.success('采集计划已取消，已保存数据不会删除');
    await load();
  } catch (error_) {
    message.error(error_ instanceof Error ? error_.message : '取消失败');
  } finally {
    busy.value = false;
  }
}
onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
import CollectionEstimate from './CollectionEstimate.vue';
</script>
<template>
  <Button v-if="!embedded" @click="open = true">国家市场采集计划</Button>
  <MonitorConfigPanel
    :embedded="embedded"
    v-model:open="open"
    title="国家市场数据采集"
    width="900px"
    :footer="null"
  >
    <Alert v-if="error" type="error" :message="error" show-icon />
    <Alert
      v-if="!readiness.scrapeCreators"
      type="warning"
      message="ScrapeCreators 尚未配置，TikTok Shop、TikTok内容/评论和Meta广告阶段会失败。"
      show-icon
    />
    <Form layout="vertical" class="collection-form">
      <div class="collection-grid">
        <Form.Item label="国家市场" required>
          <Select
            v-model:value="form.market"
            :options="marketOptions.filter((item) => item.value !== 'ALL')"
          />
        </Form.Item>
        <Form.Item label="关联已入选关键词" required>
          <Select
            v-model:value="form.keywordIds"
            mode="multiple"
            show-search
            :options="keywordOptions"
            placeholder="Meta广告按这些关键词抓取"
          />
        </Form.Item>
      </div>
      <Form.Item label="商品/内容种子词（每行一个，最多100个）" required>
        <Input.TextArea v-model:value="form.seedsText" :rows="5" />
      </Form.Item>
      <Form.Item label="数据来源">
        <div class="source-options">
          <Checkbox v-model:checked="form.sources.tiktokShop">
            TikTok Shop商品
          </Checkbox>
          <Checkbox v-model:checked="form.sources.tiktokContent">
            商品相关TikTok内容
          </Checkbox>
          <Checkbox v-model:checked="form.sources.tiktokComments">
            重点内容评论
          </Checkbox>
          <Checkbox v-model:checked="form.sources.metaActiveAds">
            Meta正在投放广告
          </Checkbox>
          <Checkbox v-model:checked="form.sources.independentSites">
            落地独立站商品
          </Checkbox>
        </div>
      </Form.Item>
      <details>
        <summary>采集预算与限制</summary>
        <div class="budget-grid">
          <Form.Item label="TikTok商品总上限">
            <InputNumber
              v-model:value="form.budgets.maxProducts"
              :min="1"
              :max="1000"
            />
          </Form.Item>
          <Form.Item label="单词商品上限">
            <InputNumber
              v-model:value="form.budgets.perKeyword"
              :min="1"
              :max="100"
            />
          </Form.Item>

          <Form.Item label="单词广告上限">
            <InputNumber
              v-model:value="form.budgets.maxAdsPerKeyword"
              :min="1"
              :max="100"
            />
          </Form.Item>
          <Form.Item label="广告页数">
            <InputNumber
              v-model:value="form.budgets.adPages"
              :min="1"
              :max="10"
            />
          </Form.Item>

          <Form.Item label="内容检索词上限">
            <InputNumber
              v-model:value="form.budgets.maxContentQueries"
              :min="1"
              :max="20"
            />
          </Form.Item>
          <Form.Item label="每词内容上限">
            <InputNumber
              v-model:value="form.budgets.contentPerQuery"
              :min="5"
              :max="100"
            />
          </Form.Item>
          <Form.Item label="评论视频上限">
            <InputNumber
              v-model:value="form.budgets.commentVideos"
              :min="0"
              :max="20"
            />
          </Form.Item>
          <Form.Item label="评论页数">
            <InputNumber
              v-model:value="form.budgets.commentPages"
              :min="1"
              :max="10"
            />
          </Form.Item>
          <Form.Item label="独立站商品上限">
            <InputNumber
              v-model:value="form.budgets.siteProducts"
              :min="1"
              :max="1000"
            />
          </Form.Item>

        </div>
        <p class="hci-subtle">
          1000是单次任务保存商品的硬上限；广告按关键词限制在100条，避免少数宽泛词吞掉请求；TikTok评论只取互动内容的最多20个视频，作为定性样本。
        </p>
      </details>
      <div class="collection-actions">
        <Button :loading="busy" @click="save(false)">保存计划</Button>
        <Button type="primary" :loading="busy" @click="save(true)">
          保存并立即采集
        </Button>
      </div>
    </Form>
    <section v-if="runs.length" class="run-list">
      <h3>最近运行</h3>
      <Button size="small" :loading="busy" @click="load(false)">
        刷新运行状态
      </Button>
      <div v-for="run in runs" :key="run.id" class="run-card">
        <p>
          <b>{{ new Date(run.startedAt).toLocaleString('zh-CN') }}</b> ·
          <Tag :color="stageColor(run.status)">{{ run.status }}</Tag>
        </p>
        <div>
          <Tag
            v-for="stage in run.stages"
            :key="stage.key"
            :color="stageColor(stage.status)"
            :title="stage.message"
          >
            {{ stage.label }} · {{ stage.status }}
          </Tag>
        </div>
        <Button
          v-if="['queued', 'running'].includes(run.status)"
          danger
          size="small"
          :loading="busy"
          @click="cancel(run)"
        >
          取消本轮
        </Button>
        <p v-if="run.message" class="hci-subtle">{{ run.message }}</p>
      </div>
    </section>
    <CollectionEstimate
      v-if="open"
      :input="{ kind: 'market_collection', ...payload() }"
    />
  </MonitorConfigPanel>
</template>
<style scoped>
.collection-grid {
  display: grid;
  grid-template-columns: 180px 1fr;
  gap: 12px;
}

.source-options {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 18px;
}

.budget-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0 12px;
  margin-top: 14px;
}

.budget-grid :deep(.ant-input-number) {
  width: 100%;
}

.collection-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 18px;
}

.run-list {
  padding-top: 14px;
  margin-top: 22px;
  border-top: 1px solid var(--ant-color-border, #eee);
}

.run-card {
  padding: 10px 0;
  border-bottom: 1px solid #eee;
}

@media (max-width: 720px) {
  .collection-grid,
  .budget-grid {
    grid-template-columns: 1fr;
  }
}
</style>
