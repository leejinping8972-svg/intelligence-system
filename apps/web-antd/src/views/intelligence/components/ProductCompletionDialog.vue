<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Alert, Button, Modal } from 'ant-design-vue';

import {
  cloudRequest,
  cloudWorkspace,
  syncCloudWorkspace,
} from '../cloud-workspace';
import { serverMode } from '../session';
const props = defineProps<{
  productIds: string[];
  compact?: boolean;
  total?: number;
  resolveProductIds?: () => Promise<string[]>;
}>();
const resolvedIds = ref<string[]>();
const resolutionFailed = ref(false);
const productIds = computed(() => resolvedIds.value || props.productIds);
const busy = ref(false);
const error = ref('');
const open = ref(false);
const router = useRouter();
let requestId = '';
const plan = ref<{
  total: number;
  sorftime: number;
  public: number;
  unsupported: number;
  estimatedRequests: number;
  defaultMaxRequests: number;
}>();
async function submit() {
  if (busy.value || resolutionFailed.value) return;
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    requestId ||= crypto.randomUUID();
    const result = await cloudRequest<{ jobId: string }>(
      'server_complete_platform_products',
      {
        requestId,
        productIds: [...productIds.value],
      },
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
  plan.value = undefined;
  resolvedIds.value = undefined;
  resolutionFailed.value = false;
  busy.value = true;
  try {
    if (props.resolveProductIds)
      resolvedIds.value = await props.resolveProductIds();
    plan.value = await cloudRequest('server_preview_product_enrichment', {
      productIds: [...productIds.value],
    });
    requestId = '';
    open.value = true;
  } catch (cause) {
    resolutionFailed.value = true;
    error.value = (cause as Error).message;
    open.value = true;
  } finally {
    busy.value = false;
  }
}
import CollectionEstimate from './CollectionEstimate.vue';
</script>
<template>
  <Button
    :type="compact ? 'link' : 'primary'"
    :disabled="!serverMode || !cloudWorkspace.ready || productIds.length === 0"
    :loading="busy"
    @click="begin"
  >
    {{
      compact ? '补全此商品' : `补全商品数据（${total ?? productIds.length}）`
    }}
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
      {{ productIds.length }}
      件商品。批量入口包括当前筛选的全部记录，不限当前页；不重新搜索商品。
    </p>
    <p>
      其中 {{ plan?.sorftime ?? 0 }} 件通过 Sorftime 查询详情、图片/属性及当前
      ASIN 月销量、排名和评论数历史，
      {{ plan?.public ?? 0 }} 件通过精确官网商品链接核验公开上架日期和累计已售。
      已保存的有效结果与缓存优先复用。
    </p>
    <Alert
      type="info"
      show-icon
      message="逐件补齐所选商品，保留来源和未补全原因。"
    />
    <p
      v-if="(plan?.unsupported ?? 0) > 0"
      class="hci-subtle"
      style="margin-top: 12px"
    >
      另有
      {{ plan?.unsupported ?? 0 }}
      件缺少可核验的官网商品链接或平台标识，将逐件记录原因。
    </p>
    <p class="hci-subtle" style="margin-top: 12px">
      官网未披露的上架时间或销量显示“未公开”；累计已售与月销量分别展示，均保留来源。
    </p>
    <Alert
      v-if="error"
      type="error"
      :message="error"
      style="margin-top: 12px"
    />
    <CollectionEstimate
      v-if="open"
      :input="{
        kind: 'platform_products',
        mode: 'enrich',
        productIds,
      }"
    />
  </Modal>
</template>
