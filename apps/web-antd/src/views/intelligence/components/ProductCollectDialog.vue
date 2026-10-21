<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import {
  Alert,
  Button,
  Form,
  InputNumber,
  message,
  Modal,
  Select,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import { session } from '../session';
const props = defineProps<{ siteIds: string[] }>();
const busy = ref(false);
  const error = ref('');
  const open = ref(false);
  const router = useRouter();
const form = reactive({
  profile: 'explore',
  maxProducts: 30,
  maxDetailProducts: 10,
  maxRequests: 20,
  maxRequestsPerSite: 20,
  maxBrowserPages: 1,
  maxPaidRequests: 0,
});
function applyProfile(profile: string) {
  const count = Math.max(1, props.siteIds.length);
  if (profile === 'deep')
    Object.assign(form, {
      maxProducts: 100,
      maxDetailProducts: 100,
      maxRequests: Math.min(2000, 120 * count),
      maxRequestsPerSite: 120,
      maxBrowserPages: Math.min(50, 3 * count),
    });
  else
    Object.assign(form, {
      maxProducts: 30,
      maxDetailProducts: 10,
      maxRequests: 20 * count,
      maxRequestsPerSite: 20,
      maxBrowserPages: Math.min(50, count),
    });
}
const names = computed(() =>
  state.sites.filter((s) => props.siteIds.includes(s.id)).map((s) => s.brand),
);
let requestId = '';
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const r = await cloudRequest<{ jobId: string }>('server_submit_products', {
      siteIds: props.siteIds,
      ...form,
      requestId,
    });
    requestId = '';
    open.value = false;
    message.success('商品目录与详情采集已提交后台');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: r.jobId } });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :disabled="!siteIds.length || siteIds.length > 20"
    @click="
      open = true;
          applyProfile(form.profile);
      error = '';
      requestId = '';
    "
    >
采集商品{{ siteIds.length > 1 ? `（${siteIds.length}站）` : '' }}
</Button><Modal
    v-model:open="open"
    title="采集独立站商品目录与详情"
    :confirm-loading="busy"
    ok-text="提交后台采集"
    cancel-text="取消"
    @ok="submit"
    >
<p>{{ names.join('、') }}</p>
    <Form layout="vertical" @change="requestId = ''">
      <Form.Item label="采集模式">
        <Select
          v-model:value="form.profile"
          :options="[
            { label: '探索采集 · 先覆盖、少量详情', value: 'explore' },
            { label: '深度采集 · 更多目录与详情', value: 'deep' },
          ]"
          @change="(value) => applyProfile(String(value))"
        />
      </Form.Item>
<Form.Item label="每站商品上限（1～1000）">
<InputNumber
          v-model:value="form.maxProducts"
          :min="1"
          :max="1000"
/>
</Form.Item><Form.Item label="整批网页请求上限（1～2000）">
<InputNumber
          v-model:value="form.maxRequests"
          :min="siteIds.length || 1"
          :max="2000"
      />
</Form.Item>
      <Form.Item label="每站商品详情目标">
        <InputNumber
          v-model:value="form.maxDetailProducts"
          :min="0"
          :max="form.maxProducts"
        />
      </Form.Item>
      <Form.Item label="单站网页请求上限（留空则按站点数分配）">
<InputNumber
          v-model:value="form.maxRequestsPerSite"
          :min="1"
          :max="form.maxRequests"
          :placeholder="
            String(Math.ceil(form.maxRequests / Math.max(1, siteIds.length)))
          "
      />
</Form.Item>
      <Form.Item label="整批浏览器渲染上限（0关闭，最多50页）">
<InputNumber v-model:value="form.maxBrowserPages" :min="0" :max="50" />
</Form.Item>
      <Form.Item label="整批Firecrawl托管备用上限（默认0，不调用）">
<InputNumber
          v-model:value="form.maxPaidRequests"
          :min="0"
          :max="100"
          :disabled="session.user?.role !== 'admin'"
      />
</Form.Item>
</Form><Alert
      type="info"
      show-icon
      :message="`${form.profile === 'deep' ? '深度' : '探索'}模式：各站轮流采集，目录发现达到商品上限后仍继续完成已排队的 ${form.maxDetailProducts} 个详情目标。429先冷却整个站点；动态页按预算使用浏览器。`"
/>
    <p class="hci-subtle">
      每批最多20站；目录、详情、浏览器与托管各计一次页面采集，均受整批和单站上限约束。浏览器每页最多读取24个必要文本资源、正文10MB，单页45秒，不下载商品图片。托管尝试可能消耗平台积分；响应未知时不自动重放。图片内标签仍需人工核验。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon />
</Modal>
</template>
