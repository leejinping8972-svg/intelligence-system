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
  maxProducts: 100,
  maxRequests: 100,
  maxRequestsPerSite: undefined as number | undefined,
  maxBrowserPages: 5,
  maxPaidRequests: 0,
});
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : '提交失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :disabled="!siteIds.length || siteIds.length > 100"
    @click="
      open = true;
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
      message="各站轮流采集，429先冷却整个站点。公开目录和站点地图优先，动态商品页按预算使用浏览器；托管备用需要管理员先在设置中启用，再为本任务设置大于0的上限。"
/>
    <p class="hci-subtle">
      目录、详情、浏览器与托管各计一次页面采集，均受整批和单站上限约束；浏览器每页最多读取12个必要文本资源，不下载商品图片。托管尝试可能消耗平台积分，上限是请求次数，不是美元或积分保证；响应未知时不自动重放。图片内标签仍需人工核验。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon />
</Modal>
</template>
