<script setup lang="ts">
import type {
  DiscoveryCapabilities,
  DiscoveryKind,
  DiscoveryPlan,
} from '../discovery-monitors';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Select,
  Switch,
} from 'ant-design-vue';
import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import { defaultDiscoveryPlan, discoveryLabels } from '../discovery-monitors';
import { serverMode, session } from '../session';

const props = defineProps<{
  kind?: DiscoveryKind;
  scheduled?: boolean;
  plan?: DiscoveryPlan;
}>();
const emit = defineEmits<{ saved: []; submitted: [id: string] }>();
const router = useRouter();
const initial = defaultDiscoveryPlan(
  props.kind,
  state.market === 'ALL' ? 'US' : state.market,
);
const form = reactive({ ...initial, topics: String(initial.topics) });
const busy = ref(false),
  loading = ref(false),
  error = ref('');
const capabilities = ref<DiscoveryCapabilities>();
const canEdit = computed(() => serverMode && session.user?.role === 'admin');
const channelOptions = computed(() =>
  form.kind === 'ingredients'
    ? (capabilities.value?.social || []).map((s) => ({
        label: s.id === 'reddit' ? 'Reddit' : 'Quora',
        value: s.id,
        disabled: !s.supported,
      }))
    : (capabilities.value?.channels || [])
        .filter((s) => form.kind !== 'fbm_new' || s.id === 'amazon')
        .map((s) => ({ label: s.name, value: s.id })),
);
let requestId = '',
  requestSignature = '';
watch(
  () => props.plan,
  (plan) => {
    if (plan)
      Object.assign(form, plan, {
        topics: Array.isArray(plan.topics)
          ? plan.topics.join('\n')
          : plan.topics,
      });
  },
  { immediate: true },
);
watch(
  () => props.kind,
  (kind) => {
    if (kind && !props.plan) {
      const next = defaultDiscoveryPlan(kind, form.market);
      Object.assign(form, next, { topics: String(next.topics) });
    }
  },
);
watch(
  () => form.kind,
  () => {
    form.channels =
      form.kind === 'ingredients' ? ['reddit', 'quora'] : ['amazon'];
  },
);
const selectedChannels = computed(() =>
  (capabilities.value?.channels || []).filter(
    (c) => form.kind !== 'ingredients' && form.channels.includes(c.id),
  ),
);
watch(
  [selectedChannels, () => form.market],
  () => {
    form.sourceMarkets ||= {};
    for (const channel of selectedChannels.value) {
      const markets = channel.markets?.length
        ? channel.markets
        : [channel.sourceMarket || form.market];
      if (!markets.includes(form.sourceMarkets[channel.id] || ''))
        form.sourceMarkets[channel.id] = markets.includes(form.market)
          ? form.market
          : channel.sourceMarket ||
            (markets.includes('US')
              ? 'US'
              : markets.includes('VN')
                ? 'VN'
                : markets[0]!);
    }
  },
  { immediate: true },
);
async function load() {
  loading.value = true;
  try {
    capabilities.value = await cloudRequest<DiscoveryCapabilities>(
      'server_discovery_capabilities',
    );
    if (!props.plan && form.kind === 'regular_new')
      form.channels = capabilities.value.channels.map((c) => c.id);
    error.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '来源渠道读取失败';
  } finally {
    loading.value = false;
  }
}
onMounted(() => {
  if (serverMode) void load();
});
async function submit(save: boolean) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    if (!form.channels.length) throw new Error('请选择至少一个来源渠道');
    const payload = {
      ...form,
      topics: Array.isArray(form.topics) ? form.topics.join('\n') : form.topics,
    };
    const signature = JSON.stringify(payload);
    if (signature !== requestSignature) {
      requestSignature = signature;
      requestId = crypto.randomUUID();
    }
    if (save) {
      await cloudRequest('server_discovery_save', {
        id: form.id,
        plan: payload,
      });
      message.success('监控已保存');
      emit('saved');
    } else {
      const result = await cloudRequest<{ jobId: string }>(
        'server_discovery_submit',
        { requestId, plan: payload },
      );
      message.success('已提交后台');
      emit('submitted', result.jobId);
      await syncCloudWorkspace();
      await router.push({
        path: '/monitor',
        query: { tab: 'tasks', job: result.jobId },
      });
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Form
    layout="vertical"
    :model="form"
    class="discovery-form"
    @finish="submit(Boolean(scheduled))"
  >
    <Alert v-if="error" :message="error" type="error" show-icon />
    <div class="discovery-grid">
      <Form.Item label="类型"
        ><Select
          v-model:value="form.kind"
          :disabled="Boolean(kind)"
          :options="
            Object.entries(discoveryLabels).map(([value, label]) => ({
              value,
              label,
            }))
          "
      /></Form.Item>
      <Form.Item label="市场"
        ><Select
          v-model:value="form.market"
          :options="[
            { value: 'US', label: '美国' },
            { value: 'MX', label: '墨西哥' },
            { value: 'VN', label: '越南' },
          ]"
      /></Form.Item>
    </div>
    <Form.Item label="渠道"
      ><Select
        v-model:value="form.channels"
        mode="multiple"
        :loading="loading"
        :options="channelOptions"
        :disabled="busy"
      /><Button type="link" size="small" :loading="loading" @click="load"
        >刷新渠道</Button
      ></Form.Item
    >
    <div v-if="selectedChannels.length" class="discovery-grid">
      <Form.Item
        v-for="channel in selectedChannels"
        :key="channel.id"
        :label="`${channel.name} 来源站点`"
        ><Select
          v-model:value="form.sourceMarkets![channel.id]"
          :options="
            (channel.markets?.length
              ? channel.markets
              : [channel.sourceMarket || form.market]
            ).map((value) => ({ value, label: value }))
          "
      /></Form.Item>
    </div>
    <Form.Item :label="form.kind === 'ingredients' ? '研究话题' : '保健品话题'"
      ><Input.TextArea v-model:value="form.topics" :rows="3" :maxlength="2000"
    /></Form.Item>
    <div class="discovery-grid">
      <Form.Item
        :label="form.kind === 'ingredients' ? '讨论时间范围' : '上架时间'"
        ><Select
          v-model:value="form.days"
          :options="
            (form.kind === 'ingredients'
              ? [1, 7, 30, 60, 90]
              : [7, 30, 60, 90]
            ).map((value) => ({ value, label: `近${value}天` }))
          "
      /></Form.Item>

      <Form.Item
        :label="form.kind === 'ingredients' ? '最多讨论数' : '最多商品数'"
        ><InputNumber v-model:value="form.maxProducts" :min="1" :max="500"
      /></Form.Item>
      <Form.Item label="每话题最多页数"
        ><InputNumber v-model:value="form.maxPages" :min="1" :max="10"
      /></Form.Item>
      <Form.Item
        v-if="form.kind === 'ingredients'"
        label="最多帖子评论／问题回答"
        ><InputNumber v-model:value="form.maxDetails" :min="0" :max="20"
      /></Form.Item>
    </div>
    <template v-if="scheduled">
      <div class="discovery-grid">
        <Form.Item label="定时周期"
          ><Select
            v-model:value="form.frequency"
            :options="[
              { value: 'daily', label: '每天' },
              { value: 'weekly', label: '每周' },
              { value: 'monthly', label: '每月' },
            ]"
        /></Form.Item>
        <Form.Item label="执行时间（北京时间）"
          ><Input v-model:value="form.time" type="time"
        /></Form.Item>
        <Form.Item v-if="form.frequency === 'weekly'" label="执行日期"
          ><Select
            v-model:value="form.weekday"
            :options="
              ['周日', '周一', '周二', '周三', '周四', '周五', '周六'].map(
                (label, value) => ({ label, value }),
              )
            "
        /></Form.Item>
        <Form.Item v-if="form.frequency === 'monthly'" label="每月日期"
          ><InputNumber v-model:value="form.monthDay" :min="1" :max="28"
        /></Form.Item>
      </div>
      <Form.Item label="启用监控"
        ><Switch v-model:checked="form.enabled"
      /></Form.Item>
    </template>
    <div class="hci-toolbar">
      <Button
        type="primary"
        html-type="submit"
        :loading="busy"
        :disabled="!canEdit || !capabilities"
        >{{ scheduled ? '保存监控' : '抓取新上架商品' }}</Button
      ><Button
        v-if="scheduled"
        :disabled="!canEdit || !capabilities"
        :loading="busy"
        @click="submit(false)"
        >立即运行一次</Button
      >
    </div>
  </Form>
</template>
<style scoped>
.discovery-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.discovery-form :deep(.ant-input-number) {
  width: 100%;
}
.discovery-form :deep(.ant-alert) {
  margin-bottom: 16px;
}
@media (max-width: 600px) {
  .discovery-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
