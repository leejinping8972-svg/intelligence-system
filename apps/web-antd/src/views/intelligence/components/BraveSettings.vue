<script setup lang="ts">
import { onUnmounted, ref } from 'vue';

import { Button, Form, Input, message } from 'ant-design-vue';

import { adminRequest } from '../session';
const key = ref('');
const busy = ref(false);
onUnmounted(() => {
  key.value = '';
});
async function save() {
  busy.value = true;
  try {
    await adminRequest('server_source_credential_save', {
      sourceId: 'brave',
      apiKey: key.value,
    });
    key.value = '';
    message.success('Brave Key 已加密保存');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Form layout="vertical" @submit.prevent>
    <Form.Item label="Brave Search API Key">
<Input.Password
        v-model:value="key"
        autocomplete="new-password"
        :maxlength="4096"
        placeholder="填写新 Key，留空保留原配置"
    />
</Form.Item>
    <Button type="primary" :loading="busy" :disabled="!key.trim()" @click="save">
加密保存
</Button>
  </Form>
</template>
