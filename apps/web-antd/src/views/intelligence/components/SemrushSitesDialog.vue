<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  message,
} from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { markets, state } from '../data';
import { serverMode } from '../session';

const props = defineProps<{ terms?: string[] }>();
const router = useRouter();
const open = ref(false),
  busy = ref(false),
  error = ref('');
const form = reactive({
  terms: '',
  market: 'US',
  perPage: 20,
  maxPages: 3,
  maxSites: 200,
  semrushUnitLimit: 2000,
});
const count = computed(
  () =>
    new Set(
      form.terms
        .split(/\r?\n/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ).size,
);
let requestId = '',
  signature = '';
function show() {
  form.terms = (props.terms || []).join('\n');
  form.market = state.market === 'ALL' ? 'US' : state.market;
  error.value = '';
  open.value = true;
  requestId = '';
  signature = '';
}
async function submit() {
  if (!count.value || count.value > 100) {
    error.value = '请输入1～100个关键词，每行一个';
    return;
  }
  const snapshot = JSON.stringify(form);
  if (signature !== snapshot) {
    signature = snapshot;
    requestId = crypto.randomUUID();
  }
  busy.value = true;
  error.value = '';
  try {
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_semrush_sites',
      { ...JSON.parse(snapshot), requestId },
    );
    open.value = false;
    message.success('Semrush独立站发现任务已提交');
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button :disabled="!serverMode" @click="show">Semrush 独立站采集</Button>
  <Modal
    v-model:open="open"
    title="Semrush付费流量独立站发现"
    :width="640"
    :confirm-loading="busy"
    :closable="!busy"
    :mask-closable="!busy"
    :cancel-button-props="{ disabled: busy }"
    ok-text="提交采集"
    @ok="submit"
  >
    <Form layout="vertical">
      <Form.Item label="关键词"
        ><Input.TextArea
          v-model:value="form.terms"
          :rows="5"
          placeholder="每行一个关键词"
      /></Form.Item>
      <Form.Item label="目标市场"
        ><Select
          v-model:value="form.market"
          :options="markets.map((m) => ({ value: m.code, label: m.name }))"
      /></Form.Item>
      <div class="semrush-site-limits">
        <Form.Item label="每页广告主条数"
          ><InputNumber
            v-model:value="form.perPage"
            :min="1"
            :max="100"
            :precision="0"
        /></Form.Item>
        <Form.Item label="每词最多页数"
          ><InputNumber
            v-model:value="form.maxPages"
            :min="1"
            :max="10"
            :precision="0"
        /></Form.Item>
        <Form.Item label="去重站点上限"
          ><InputNumber
            v-model:value="form.maxSites"
            :min="1"
            :max="1000"
            :precision="0"
        /></Form.Item>
        <Form.Item label="Semrush积分上限"
          ><InputNumber
            v-model:value="form.semrushUnitLimit"
            :min="20"
            :max="100000"
            :precision="0"
        /></Form.Item>
      </div>
      <p class="hci-subtle">
        {{ count }} 个关键词 · 最多
        {{
          Math.min(
            count * form.perPage * form.maxPages * 20,
            form.semrushUnitLimit,
          )
        }}
        API units
      </p>
      <Alert
        type="info"
        show-icon
        message="来源：Semrush付费搜索广告主。仅保存广告记录与站点线索；电商类型、实际流量和成交待核验。"
      />
      <Alert
        v-if="error"
        type="error"
        show-icon
        :message="error"
        style="margin-top: 12px"
      />
    </Form>
  </Modal>
</template>
<style scoped>
.semrush-site-limits {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.semrush-site-limits :deep(.ant-input-number) {
  width: 100%;
}
</style>
