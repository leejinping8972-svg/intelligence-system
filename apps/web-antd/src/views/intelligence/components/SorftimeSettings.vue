<script setup lang="ts">
import { onDeactivated, onMounted, onUnmounted, ref } from 'vue';

import { Button, Form, Input, message, Tag } from 'ant-design-vue';

import { audit } from '../data';
import { adminRequest, serverMode } from '../session';
import { keywordSourceStatus, saveSorftimeConfiguration } from '../site-discovery';

const props = defineProps<{ apiUrl: string; accessKey: string }>();
const emit = defineEmits<{ status: [value: string] }>();
const token = ref('');
const busy = ref(false);
const status = ref('尚未检测');
const detail = ref('');
const clear = () => { token.value = ''; };
onDeactivated(clear);
onUnmounted(clear);
async function configure(save = false, verify = true) {
  if (!serverMode && (!props.apiUrl || !props.accessKey)) {
    message.warning('请先填写研究服务地址与访问码');
    return;
  }
  busy.value = true;
  try {
    if (save) {
      const result = serverMode
        ? await adminRequest<{ message: string }>('keyword_sources_config', { sorftimeToken: token.value })
        : await saveSorftimeConfiguration(props.apiUrl, props.accessKey, token.value);
      token.value = '';
      status.value = '已配置 · 待检测';
      detail.value = result.message;
      audit('配置 Sorftime MCP', '密钥已加密保存，不记录密钥内容', 'ALL');
      message.success('Token 已加密保存');
    } else {
      const result = serverMode
        ? await adminRequest<Awaited<ReturnType<typeof keywordSourceStatus>>>('keyword_sources_status', { verify })
        : await keywordSourceStatus(props.apiUrl, props.accessKey, verify);
      status.value = result.sorftime.ready ? '连接正常' : result.sorftime.configured ? '已配置 · 待检测或未通过' : '待配置';
      detail.value = result.sorftime.message;
    }
    emit('status', status.value);
  } catch (error) {
    detail.value = error instanceof Error ? error.message : '配置读取失败';
    message.error(detail.value);
  } finally { busy.value = false; }
}
onMounted(() => { if (serverMode || props.apiUrl && props.accessKey) void configure(false, false); });
</script>
<template>
  <section id="keyword-providers">
    <div class="hci-panel-head"><h2>Sorftime MCP</h2><Tag>{{ status }}</Tag></div>
    <Form layout="vertical" @submit.prevent>
      <Form.Item label="Sorftime MCP ACCESS TOKEN">
        <Input.Password v-model:value="token" aria-label="Sorftime MCP ACCESS TOKEN" autocomplete="new-password" :maxlength="4096" placeholder="填写新 Token，留空保留已有配置" />
      </Form.Item>
      <div class="hci-toolbar"><Button type="primary" :loading="busy" :disabled="!token.trim() || busy" @click="configure(true)">加密保存</Button><Button :loading="busy" @click="configure(false)">检测连接</Button><a href="https://open.sorftime.com/mcp" target="_blank" rel="noopener noreferrer">Sorftime MCP</a></div>
    </Form>
    <p v-if="detail" class="hci-evidence" role="status">{{ detail }}</p>
    <p class="hci-subtle">美国、墨西哥 Amazon 数据；越南不跨国替代。连接检测只验证接入权限，不查询业务报告。</p>
  </section>
</template>
