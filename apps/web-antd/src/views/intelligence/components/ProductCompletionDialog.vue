<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Alert, Button, InputNumber, Modal } from 'ant-design-vue';

import {
  cloudRequest,
  cloudWorkspace,
  syncCloudWorkspace,
} from '../cloud-workspace';
import { state } from '../data';
import { serverMode } from '../session';
const props = defineProps<{ productIds: string[]; compact?: boolean; total?: number; resolveProductIds?: () => Promise<string[]> }>();
const resolvedIds = ref<string[]>();
const resolutionFailed = ref(false);
const productIds = computed(() => resolvedIds.value || props.productIds);
const busy = ref(false);
const error = ref('');
const open = ref(false);
const maxRequests = ref(1);
const router = useRouter();
let requestId = '';
const supported = computed(
  () =>
    state.products.filter(
      (p) =>
        productIds.value.includes(p.id) &&
        p.sourceProvider === 'Sorftime' &&
        /^[A-Z0-9]{10}$/.test(p.sourceProductId || '') &&
        ['MX', 'US'].includes(p.market),
    ).length,
);
async function submit() {
  if (busy.value || resolutionFailed.value) return;
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_complete_platform_products',
      { requestId, productIds: [...productIds.value], maxRequests: maxRequests.value },
    );
    await syncCloudWorkspace();
    open.value = false;
    requestId = '';
    await router.push({ path: '/monitor', query: { job: result.jobId } });
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
async function begin() {
  if (busy.value) return;
  error.value = '';
  resolvedIds.value = undefined;
  resolutionFailed.value = false;
  busy.value = true;
  try {
    if (props.resolveProductIds) resolvedIds.value = await props.resolveProductIds();
    maxRequests.value = Math.max(1, supported.value * 5);
    requestId = '';
    open.value = true;
  } catch (cause) { resolutionFailed.value = true; error.value = (cause as Error).message; open.value = true; }
  finally { busy.value = false; }
}
</script>
<template>
  <Button
    :type="compact ? 'link' : 'primary'"
    :disabled="!serverMode || !cloudWorkspace.ready || productIds.length === 0"
    :loading="busy"
    @click="begin"
  >
    {{ compact ? '补全此商品' : `补全商品数据（${total ?? productIds.length}）` }}
  </Button>
  <Modal
    v-model:open="open"
    title="补全已抓取商品的数据"
    ok-text="提交补全任务"
    :confirm-loading="busy"
    :ok-button-props="{ disabled: resolutionFailed }"
    :closable="!busy"
    :mask-closable="!busy"
    @ok="submit"
  >
    <p>
      本次覆盖
      {{
        productIds.length
      }}
      件商品。批量入口包括当前筛选的全部记录，不限当前页；不重新搜索商品。
    </p>
    <p>
      其中 {{ supported }} 件可通过 Sorftime 查询详情、图片/属性、当前 ASIN
      月销量、大类排名和评论数历史，完整执行最多约
      {{
        supported * 5
      }}
      次数据请求。有效结果与缓存优先复用；失败、取消或空历史可以再次补全。
    </p>
    <label for="completion-request-limit">本任务共用请求上限</label>
    <InputNumber
      id="completion-request-limit"
      v-model:value="maxRequests"
      :min="1"
      :max="100000"
      style="display: block; width: 100%; margin: 8px 0 12px"
    />
    <Alert
      type="info"
      show-icon
      :message="`详情、属性和历史共用 ${maxRequests} 次请求预算；预算耗尽后保留部分完成状态和未补全原因。可在监控与任务中取消。消耗已配置平台的现有额度，不自动购买额度。`"
    />
    <p
      v-if="supported < productIds.length"
      class="hci-subtle"
      style="margin-top: 12px"
    >
      另有
      {{
        productIds.length - supported
      }}
      件缺少可核验平台标识，或来源未提供商品历史接口，将逐件记录原因；不将同名
      Amazon 商品或关键词趋势冒充其销量。
    </p>
    <Alert
      v-if="error"
      type="error"
      :message="error"
      style="margin-top: 12px"
    />
  </Modal>
</template>
