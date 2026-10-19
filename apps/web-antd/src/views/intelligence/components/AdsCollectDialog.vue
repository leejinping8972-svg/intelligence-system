<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
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
const props = defineProps<{
  keywordIds: string[];
  disabled?: boolean;
  compact?: boolean;
}>();
const router = useRouter(),
  open = ref(false),
  busy = ref(false),
  error = ref('');
const form = reactive({
  maxPages: 3,
  maxAds: 100,
  maxSites: 10,
  maxRequests: 3,
  adStatus: 'ACTIVE',
});
const names = computed(() =>
  state.keywords
    .filter((k) => props.keywordIds.includes(k.id))
    .map((k) => k.term),
);
let requestId = '';
watch(
  [() => props.keywordIds.join(','), () => form.maxPages],
  () => {
    form.maxRequests = Math.min(
      1000,
      Math.max(1, props.keywordIds.length * form.maxPages),
    );
    requestId = '';
  },
  { immediate: true },
);
async function submit() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_submit_market',
      { requestId, kind: 'ads', keywordIds: [...props.keywordIds], ...form },
    );
    requestId = '';
    open.value = false;
    message.success('广告与广告落地站的采集已提交后台');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '任务提交失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :type="compact ? 'link' : 'default'"
    :disabled="disabled || !keywordIds.length || keywordIds.length > 100"
    @click="
      open = true;
      error = '';
      requestId = '';
    "
  >
    {{
      compact
        ? '采集广告与站点'
        : `采集广告与独立站（${keywordIds.length}/100）`
    }}
  </Button>
  <Modal
    v-model:open="open"
    title="从入选关键词采集广告与独立站"
    ok-text="提交后台采集"
    cancel-text="取消"
    :confirm-loading="busy"
    :closable="!busy"
    :mask-closable="!busy"
    @ok="submit"
  >
    <p>已选 {{ keywordIds.length }} 个词：{{ names.join('、') }}</p>
    <p class="hci-subtle">
      按这些关键词搜索Meta广告，保存素材与文案，并核验广告落地页、关联独立站。与“搜索采集独立站”的结果合并去重。
    </p>
    <Form layout="vertical" @change="requestId = ''"
      ><div class="hci-form-grid">
        <Form.Item label="每词广告查询页数"
          ><InputNumber v-model:value="form.maxPages" :min="1" :max="10"
        /></Form.Item>
        <Form.Item label="每词广告数量上限"
          ><InputNumber v-model:value="form.maxAds" :min="1" :max="100"
        /></Form.Item>
        <Form.Item label="每词验证站点上限"
          ><InputNumber v-model:value="form.maxSites" :min="1" :max="20"
        /></Form.Item>
        <Form.Item label="本任务广告请求上限"
          ><InputNumber v-model:value="form.maxRequests" :min="1" :max="1000"
        /></Form.Item>
      </div>
      <Form.Item label="广告状态"
        ><Select
          v-model:value="form.adStatus"
          :options="[
            { label: '正在投放', value: 'ACTIVE' },
            { label: '全部', value: 'ALL' },
            { label: '已停止', value: 'INACTIVE' },
          ]" /></Form.Item
    ></Form>
    <Alert
      type="info"
      show-icon
      :message="`最多 ${Math.min(form.maxRequests, keywordIds.length * form.maxPages)} 次广告查询，使用现有ScrapeCreators额度；站点评分优先复用Semrush缓存。`"
    />
    <p class="hci-subtle">
      提交后由服务器执行，关闭浏览器不影响任务。不会自动购买额度。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon />
  </Modal>
</template>
