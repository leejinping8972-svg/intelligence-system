<script setup lang="ts">
import { ref } from 'vue';
import { Button, message, Modal } from 'ant-design-vue';
import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { serverMode, session } from '../session';
const props = defineProps<{
  kind: 'products' | 'sites' | 'ads';
  ids: string[];
}>();
const busy = ref(false);
function begin() {
  const requestId = crypto.randomUUID();
  Modal.confirm({
    title: `AI重新分析所选资料（${props.ids.length}）`,
    content: '依据已保存的来源原文重新整理字段。费用由已配置的AI服务商计收。',
    okText: '提交分析',
    onOk: async () => {
      busy.value = true;
      try {
        const result = await cloudRequest<{ queued: number }>(
          'server_source_fields_submit',
          { kind: props.kind, ids: props.ids, requestId },
        );
        message.success(`已提交${result.queued}条分析任务`);
        await syncCloudWorkspace();
      } catch (error) {
        message.error(error instanceof Error ? error.message : '提交失败');
      } finally {
        busy.value = false;
      }
    },
  });
}
</script>
<template>
  <Button
    :loading="busy"
    :disabled="
      !serverMode ||
      session.user?.role !== 'admin' ||
      !ids.length ||
      ids.length > 100
    "
    @click="begin"
    >AI整理字段</Button
  >
</template>
