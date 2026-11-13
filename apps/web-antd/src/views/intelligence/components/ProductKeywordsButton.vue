<script setup lang="ts">
import { ref } from 'vue';

import { Button, message, Modal, Tooltip } from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { serverMode, session } from '../session';

const props = defineProps<{ ids: string[] }>();
const busy = ref(false);
function begin() {
  if (busy.value) return;
  const ids = [...props.ids];
  Modal.confirm({
    title: `提取关键词并补齐指标（${ids.length}件商品）`,
    content: '从已保存的商品原文提取候选词，去重入库并关联商品，补齐月搜索量、KD、CPC等搜索指标。新采集商品会自动执行此流程；本次补做历史商品，跳过趋势采集。模型和搜索指标使用已配置渠道并按其规则计费，已完成结果与有效缓存会复用。',
    okText: '提交后台处理',
    onOk: async () => {
      busy.value = true;
      try {
        const result = await cloudRequest<{ accepted: number; reused: number }>('server_product_keywords_submit', { ids });
        message.success(`已受理${result.accepted}件商品；${result.reused}件复用已有任务，进度见监控与任务`);
        await syncCloudWorkspace();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '提交失败，请重试');
      } finally { busy.value = false; }
    },
  });
}
</script>
<template>
  <Tooltip :title="!ids.length ? '先勾选需要补做的商品；新采集商品会自动处理' : ids.length > 100 ? '每次最多处理100件商品' : '提取候选词、关联商品并补齐搜索指标，跳过趋势采集'">
    <span>
      <Button :loading="busy" :disabled="busy || !serverMode || session.user?.role !== 'admin' || !ids.length || ids.length > 100" @click="begin">
        提取关键词 / 补齐指标
      </Button>
    </span>
  </Tooltip>
</template>
