<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Alert, Button, Form, Input, message, Tag } from 'ant-design-vue';
import { adminRequest, session } from '../session';

const form = reactive({ baseUrl: '', model: '', apiKey: '' });
const configured = ref(false);
const busy = ref(false);
const error = ref('');

async function load() {
  try {
    const result = await adminRequest<{ configured: boolean; baseUrl?: string; model?: string }>('server_concept_seed_status');
    configured.value = result.configured;
    if (result.configured) Object.assign(form, { baseUrl: result.baseUrl, model: result.model });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取失败';
  }
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await adminRequest('server_concept_seed_config', { ...form, requestId: crypto.randomUUID() });
    form.apiKey = '';
    configured.value = true;
    message.success('概念种子词模型配置已保存');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section id="concept-seed-provider" class="hci-panel">
    <div class="hci-panel-head">
      <h2>新建概念 · 百炼种子关键词模型</h2>
      <Tag :color="configured ? 'green' : 'default'">{{ configured ? '已配置' : '未配置' }}</Tag>
    </div>
    <p class="hci-subtle">用于新建概念第一步的方向描述建议，目标响应时间约 3～5 秒。填写百炼兼容 Chat Completions 地址、模型名称和 Key；超时不会自动重试。</p>
    <Form v-if="session.user?.role === 'admin'" :model="form" layout="vertical" @finish="save">
      <div class="hci-form-grid">
        <Form.Item label="接口地址" name="baseUrl" :rules="[{ required: true, message: '请输入接口地址' }]">
          <Input v-model:value="form.baseUrl" placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" autocomplete="off" />
        </Form.Item>
        <Form.Item label="模型名称" name="model" :rules="[{ required: true, message: '请输入模型名称' }]">
          <Input v-model:value="form.model" placeholder="例如 qwen-turbo" autocomplete="off" />
        </Form.Item>
        <Form.Item label="API Key">
          <Input.Password v-model:value="form.apiKey" placeholder="留空保留已保存的 Key" autocomplete="new-password" />
        </Form.Item>
      </div>
      <Button html-type="submit" type="primary" :loading="busy" :disabled="!form.baseUrl || !form.model || (!configured && !form.apiKey)">保存概念模型配置</Button>
    </Form>
    <Alert v-if="error" :message="error" type="error" show-icon />
  </section>
</template>
