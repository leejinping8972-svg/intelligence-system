<script setup lang="ts">
import { ref } from 'vue';

import { SvgDownloadIcon } from '@vben/icons';

import { Alert, Button, Tag } from 'ant-design-vue';

import { adminRequest, session } from '../session';

const busy = ref(false);
const exportError = ref('');
async function exportDirectory() {
  busy.value = true;
  exportError.value = '';
  try {
    const result = await adminRequest('auth_identity_directory');
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'identity-directory.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    exportError.value = error instanceof Error ? error.message : '导出失败';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="hci-panel">
    <div class="hci-panel-head">
      <h2>统一身份登录</h2>
      <Tag color="green">已启用</Tag>
    </div>
    <Alert
      v-if="exportError"
      :message="exportError"
      type="error"
      show-icon
      role="alert"
    />
    <Button
      v-if="session.user?.role === 'admin'"
      :loading="busy"
      @click="exportDirectory"
    >
      <template #icon><SvgDownloadIcon class="mr-1 size-4" /></template>
      导出迁移账号目录
    </Button>
  </section>
</template>
