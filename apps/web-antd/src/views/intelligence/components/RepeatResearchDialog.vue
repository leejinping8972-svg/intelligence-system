<script setup lang="ts">
import { computed, onActivated, onDeactivated, ref, toRaw, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  Alert,
  Checkbox,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import CollectionEstimate from './CollectionEstimate.vue';
const route = useRoute();
const router = useRouter();
const busy = ref(false);
const error = ref('');
const open = ref(false);
type ResearchDraft = {
  kind: string;
  path: string;
  action: string;
  input: Record<string, any>;
  previous: {
    title: string;
    keywords: { term: string }[];
    products: number;
    evidence: number;
    status: string;
  };
};
const draft = ref<ResearchDraft>();
const form = ref<Record<string, any>>({});
const budgetConfirmed = ref(false);
const textFields = computed(() =>
  [
    ['seeds', '种子关键词'],
    ['terms', '查询关键词'],
    ['urls', '原来源链接'],
    ['query', '查询内容'],
    ['researchFocus', '研究重点'],
    ['title', '研究名称'],
  ].filter(([key]) => form.value[key!] !== undefined),
);
const numberFields = computed(() =>
  Object.entries({
    limit: '结果上限',
    depth: '扩词深度',
    maxRequests: '请求上限',
    maxPages: '翻页上限',
    maxProducts: '商品上限',
    maxDetailProducts: '详情上限',
    maxRequestsPerSite: '每站请求上限',
    maxAds: '每词广告上限',
    maxSites: '每词站点上限',
    maxBrowserPages: '浏览器页数上限',
    maxPaidRequests: '托管备用上限',
  }).filter(([key]) => typeof form.value[key] === 'number'),
);
const identityLists = computed(() =>
  ['siteIds', 'keywordIds', 'productIds', 'adIds', 'existingRecords'].filter(
    (key) => Array.isArray(form.value[key]),
  ),
);
let requestId = '';
let seq = 0;
const active = ref(true);
onActivated(() => {
  active.value = true;
});
onDeactivated(() => {
  active.value = false;
  open.value = false;
  seq++;
});
watch(
  () => [route.query.reResearch, active.value] as const,
  async ([id, isActive]) => {
    const current = ++seq;
    if (!isActive || typeof id !== 'string') {
      open.value = false;
      return;
    }
    draft.value = undefined;
    form.value = {};
    error.value = '';
    open.value = true;
    try {
      const result = await cloudRequest<ResearchDraft>('server_task_research', {
        jobId: id,
      });
      if (current !== seq || result.path !== route.path) return;
      draft.value = result;
      form.value = structuredClone(result.input);
      budgetConfirmed.value = false;
      if (Array.isArray(form.value.seeds))
        form.value.seeds = form.value.seeds.join('\n');
      requestId = '';
      error.value = '';
      open.value = true;
    } catch (e) {
      error.value = e instanceof Error ? e.message : '原参数读取失败';
      open.value = true;
    }
  },
  { immediate: true },
);
async function close() {
  open.value = false;
  const query = { ...route.query };
  delete query.reResearch;
  await router.replace({ query });
}
async function submit() {
  if (busy.value || !draft.value?.action) return;
  if (
    form.value.socialTrends?.sources?.length &&
    !form.value.socialTrends.budgetAcknowledged
  ) {
    error.value = '请重新确认本次社媒来源预算';
    return;
  }
  if (
    (form.value.plan?.budget?.requests > 0 ||
      form.value.budget?.requests > 0) &&
    !budgetConfirmed.value
  ) {
    error.value = '请确认本次沿用的来源预算';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    const input = structuredClone(toRaw(form.value));
    if (typeof input.seeds === 'string')
      input.seeds = input.seeds
        .split(/[\n,，]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
    requestId ||= crypto.randomUUID();
    const response = await cloudRequest<{
      jobId?: string;
      id?: string;
      receiptId?: string;
    }>(
      draft.value.action,
      draft.value.action === 'server_submit'
        ? { requestId, input }
        : { requestId, ...input },
    );
    message.success(
      form.value.resourceCategories
        ? '类目查询已完成，原研究数据保留'
        : '新任务已排队，原研究数据保留',
    );
    open.value = false;
    requestId = '';
    await syncCloudWorkspace();
    await router.push({
      path: '/monitor',
      query: {
        tab: 'tasks',
        job: response.jobId || response.id || response.receiptId,
      },
    });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Modal
    :open="open"
    title="重新研究 · 已带入上次参数"
    :width="760"
    :confirm-loading="busy"
    :mask-closable="!busy"
    :ok-text="form.resourceCategories ? '查询真实类目' : '提交新任务并排队'"
    @ok="submit"
    @cancel="close"
  >
    <template v-if="draft">
      <Alert
        type="info"
        :message="`原任务：${draft.previous.title || draft.kind}`"
        :description="`已保存商品 ${draft.previous.products} 件、证据 ${
          draft.previous.evidence
        } 条。原结果继续保留，新任务按本次配置执行。`"
        show-icon
      />
      <p v-if="draft.previous.keywords.length">
        上次研究关键词：{{
          draft.previous.keywords.map((r) => r.term).join('、')
        }}
      </p>
      <Alert
        v-if="form.resourceCategories"
        type="info"
        message="类目查询会在确认预算后立即执行，完成后打开该查询记录。"
        show-icon
        style="margin-top: 12px"
      />
      <Form
        layout="vertical"
        style="margin-top: 16px"
        :disabled="busy"
        @change="requestId = ''"
      >
        <Form.Item v-for="[key, label] in textFields" :key="key" :label="label">
          <Input.TextArea
            v-model:value="form[key!]"
            :rows="key === 'seeds' || key === 'urls' ? 4 : 2"
          />
        </Form.Item>
        <Form.Item v-if="form.markets && !form.market" label="目标市场">
          <Checkbox.Group
            v-model:value="form.markets"
            :options="[
              { label: '美国', value: 'US' },
              { label: '墨西哥', value: 'MX' },
              { label: '越南', value: 'VN' },
            ]"
          />
        </Form.Item>
        <Form.Item v-else-if="form.market" label="目标市场">
          <Select
            v-model:value="form.market"
            :options="[
              { label: '美国', value: 'US' },
              { label: '墨西哥', value: 'MX' },
              { label: '越南', value: 'VN' },
            ]"
          />
        </Form.Item>
        <div class="repeat-fields">
          <Form.Item
            v-for="[key, label] in numberFields"
            :key="key"
            :label="label"
          >
            <InputNumber v-model:value="form[key]" :min="0" />
          </Form.Item>
        </div>
        <p v-for="key in identityLists" :key="key" class="hci-subtle">
          已带入上次选择：{{ form[key].length }} 项（{{
            key === 'siteIds'
              ? '站点'
              : key === 'adIds'
                ? '广告'
                : key === 'productIds'
                  ? '商品'
                  : '关键词'
          }}）
        </p>
        <Form.Item
          v-if="draft.kind === 'keyword_research' && form.sources"
          label="找词来源"
        >
          <Checkbox.Group
            v-model:value="form.sources"
            :options="[
              { label: 'Google联想', value: 'google_autocomplete' },
              { label: 'Amazon联想', value: 'amazon_autocomplete' },
              { label: 'Semrush', value: 'semrush' },
              { label: 'Sorftime', value: 'sorftime' },
            ]"
          />
        </Form.Item>
        <Checkbox
          v-if="form.socialTrends?.sources?.length"
          v-model:checked="form.socialTrends.budgetAcknowledged"
        >
          确认本次
          {{ form.socialTrends.sources.join(' / ') }} 趋势采集预算（最多
          {{ form.socialTrends.maxRequests }} 请求）
        </Checkbox>
      </Form>
      <div v-if="form.plan" class="hci-evidence">
        <b>{{ form.plan.title }}</b>
        <p>
          {{ form.plan.startDate }} 至 {{ form.plan.endDate }} ·
          {{ form.plan.researchQuestion }}
        </p>
        <p v-for="group in form.plan.groups" :key="group.id">
          {{ group.label }} · {{ group.minAge }}–{{ group.maxAge }}岁 ·
          {{ group.lifeStage }} · {{ group.familyRole }}
        </p>
      </div>
      <p v-if="form.resourceDiscovery" class="hci-evidence">
        来源路径：{{ form.routeId }} · {{ form.mode }} ·
        {{ form.category?.path?.join(' / ') || form.websiteDomain }}
      </p>
      <Checkbox
        v-if="form.plan?.budget?.requests > 0 || form.budget?.requests > 0"
        v-model:checked="budgetConfirmed"
      >
        确认沿用本次来源预算：{{ form.plan?.budget || form.budget }}
      </Checkbox>
      <CollectionEstimate
        v-if="open"
        :input="{
          ...form,
          kind: draft.kind,
          seeds:
            typeof form.seeds === 'string'
              ? form.seeds.split('\n')
              : form.seeds,
        }"
      />
    </template>
    <Alert v-if="error" type="error" :message="error" show-icon />
  </Modal>
</template>
<style scoped>
.repeat-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0 16px;
}
</style>
