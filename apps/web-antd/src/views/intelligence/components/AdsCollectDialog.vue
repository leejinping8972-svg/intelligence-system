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
  Tooltip,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import CollectionEstimate from './CollectionEstimate.vue';
const props = defineProps<{
  keywordIds: string[];
  disabled?: boolean;
  disabledReason?: string;
  compact?: boolean;
}>();
const busy = ref(false);
const error = ref('');
const open = ref(false);
const router = useRouter();
const form = reactive({
  maxPages: 3,
  maxAds: 100,
  maxSites: 10,
  siteSearchPages: 1,
  maxRequests: 3,
  adStatus: 'ACTIVE',
  includeSearchSites: true,
});
const names = computed(() =>
  state.keywords
    .filter((k) => props.keywordIds.includes(k.id))
    .map((k) => k.term),
);
const disabledMessage = computed(
  () =>
    props.disabledReason ||
    (props.disabled
      ? '正在同步工作区，请稍后再试'
      : !props.keywordIds.length
        ? '请先勾选要采集的关键词'
        : props.keywordIds.length > 100
          ? '每次最多选择100个关键词'
          : ''),
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
    message.success('广告与Brave独立站双渠道采集已提交后台');
    await syncCloudWorkspace();
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '任务提交失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Tooltip :title="disabledMessage || undefined" :trigger="['hover', 'focus']">
    <span
      style="display: inline-flex"
      :tabindex="disabledMessage ? 0 : undefined"
      :aria-label="disabledMessage || undefined"
    >
      <Button
        :type="compact ? 'link' : 'default'"
        :disabled="Boolean(disabledMessage)"
        @click="
          open = true;
          error = '';
          requestId = '';
        "
      >
        {{
          compact
            ? '采集广告与独立站'
            : `采集广告与独立站（${keywordIds.length}/100）`
        }}
      </Button>
    </span>
  </Tooltip>
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
      同一批关键词先通过 Brave Search 搜索官网，再通过 ScrapeCreators
      获取广告与落地页。两路分别执行官网电商核验，按市场与域名合并，保留搜索链接和广告证据。一条渠道失败时另一条继续；双来源不等于商品、销量已验证。
    </p>
    <Form layout="vertical" @change="requestId = ''">
      <div class="hci-form-grid">
        <Form.Item label="每词广告查询页数">
          <InputNumber v-model:value="form.maxPages" :min="1" :max="10" />
        </Form.Item>
        <Form.Item label="每词广告数量上限">
          <InputNumber v-model:value="form.maxAds" :min="1" :max="100" />
        </Form.Item>
        <Form.Item label="每路每词站点上限">
          <InputNumber v-model:value="form.maxSites" :min="1" :max="20" />
        </Form.Item>
        <Form.Item label="Brave 每词搜索页数">
          <InputNumber v-model:value="form.siteSearchPages" :min="1" :max="3" />
        </Form.Item>
        <Form.Item label="本任务广告请求上限">
          <InputNumber v-model:value="form.maxRequests" :min="1" :max="1000" />
        </Form.Item>
      </div>
      <Form.Item label="广告状态">
        <Select
          v-model:value="form.adStatus"
          :options="[
            { label: '正在投放', value: 'ACTIVE' },
            { label: '全部', value: 'ALL' },
            { label: '已停止', value: 'INACTIVE' },
          ]"
        />
      </Form.Item>
    </Form>
    <CollectionEstimate
      v-if="open"
      :input="{ kind: 'ads', keywordIds, ...form }"
    />
    <Alert
      type="info"
      show-icon
      :message="`最多 ${Math.min(form.maxRequests, keywordIds.length * form.maxPages)} 次广告查询，另有 ${keywordIds.length * form.siteSearchPages} 页 Brave 搜索（含官网核验）；两路每词各最多 ${form.maxSites} 家站点，合并后去重。使用现有服务额度，站点评分优先复用 Semrush 缓存。`"
    />
    <p class="hci-subtle">
      提交后由服务器执行，关闭浏览器不影响任务。不会自动购买额度。
    </p>
    <Alert v-if="error" :message="error" type="error" show-icon />
  </Modal>
</template>
