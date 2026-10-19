<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Alert,
  Button,
  Form,
  InputNumber,
  Modal,
  message,
} from 'ant-design-vue';
import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
const props = defineProps<{ siteIds: string[] }>();
const router = useRouter(),
  open = ref(false),
  busy = ref(false),
  error = ref('');
const form = reactive({
  maxProducts: 100,
  maxRequests: 100,
  maxRequestsPerSite: undefined as number | undefined,
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
    >采集商品{{ siteIds.length > 1 ? `（${siteIds.length}站）` : '' }}</Button
  ><Modal
    v-model:open="open"
    title="采集独立站商品目录与详情"
    :confirm-loading="busy"
    ok-text="提交后台采集"
    cancel-text="取消"
    @ok="submit"
    ><p>{{ names.join('、') }}</p>
    <Form layout="vertical" @change="requestId = ''"
      ><Form.Item label="每站商品上限（1～1000）"
        ><InputNumber
          v-model:value="form.maxProducts"
          :min="1"
          :max="1000" /></Form.Item
      ><Form.Item label="整批网页请求上限（1～2000）"
        ><InputNumber
          v-model:value="form.maxRequests"
          :min="siteIds.length || 1"
          :max="2000"
      /></Form.Item>
      <Form.Item label="单站网页请求上限（留空则按站点数分配）"
        ><InputNumber
          v-model:value="form.maxRequestsPerSite"
          :min="1"
          :max="form.maxRequests"
          :placeholder="
            String(Math.ceil(form.maxRequests / Math.max(1, siteIds.length)))
          " /></Form.Item></Form
    ><Alert
      type="info"
      show-icon
      message="各站轮流采集，限流站点延迟重试，不拖住其他站点。优先读取Shopify公开目录并保存商品图片链接、规格与描述，再采集商品页补充配方和卖点；不下载图片。" />
    <p class="hci-subtle">
      达到上限、反爬或页面无法读取时标记部分完成，不把缺失字段编造为已采集。图片内标签和必须浏览器渲染的内容可能需要后续人工补充。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon
  /></Modal>
</template>
