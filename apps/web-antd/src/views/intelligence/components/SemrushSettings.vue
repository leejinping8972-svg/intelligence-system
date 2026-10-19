<script setup lang="ts">
import { onDeactivated, onMounted, onUnmounted, ref } from 'vue';

import { Alert, Button, Form, Input, message, Tag } from 'ant-design-vue';

import { adminRequest, session } from '../session';

interface Connection {
  configured: boolean;
  ready: boolean;
  endpoint?: string;
  checkedAt?: string;
  toolCount?: number;
  message: string;
}
const apiKey = ref('');
const busy = ref(false);
const status = ref<Connection>({
  configured: false,
  ready: false,
  message: '接入组件已安装。请填写 Semrush API Key，加密保存后检测连接。',
});
async function load() {
  try {
    status.value = await adminRequest<Connection>('server_semrush_status');
  } catch (error) {
    status.value.message =
      error instanceof Error ? error.message : '读取接入状态失败';
  }
}
async function configure(save: boolean) {
  busy.value = true;
  try {
    status.value = await adminRequest<Connection>(
      save ? 'server_semrush_config' : 'server_semrush_status',
      save ? { apiKey: apiKey.value } : { verify: true },
      90_000,
    );
    if (save) {
      apiKey.value = '';
      message.success('Key 已加密保存，请检测连接');
    } else if (status.value.ready)
      message.success('MCP 握手及关键词工具发现通过');
    else message.warning(status.value.message);
  } catch (error) {
    const text = error instanceof Error ? error.message : '配置或检测失败';
    status.value = { ...status.value, ready: false, message: text };
    message.error(text);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
onDeactivated(() => {
  apiKey.value = '';
});
onUnmounted(() => {
  apiKey.value = '';
});
</script>

<template>
  <section id="semrush-provider" class="hci-panel">
    <div class="hci-panel-head">
      <h2>关键词分析数据 · Semrush MCP</h2>
      <Tag
        :color="
          status.ready ? 'green' : status.configured ? 'orange' : 'default'
        "
      >
        {{
          status.ready
            ? '上次检测已连接'
            : status.configured
              ? '已配置 · 待检测或未通过'
              : '待填写 Key'
        }}
      </Tag>
    </div>
    <p class="hci-subtle">
      通过 Semrush 官方远程 MCP 连接，无需在电脑安装软件。API Key
      只在服务器加密保存，不写入代码，也不保存在浏览器长期存储。
    </p>
    <Form layout="vertical" @submit.prevent>
      <Form.Item
        label="Semrush API Key（支持官方 v4 Key，需具备 MCP 权限）"
        html-for="semrush-api-key"
      >
        <Input.Password
          id="semrush-api-key"
          v-model:value="apiKey"
          :maxlength="4096"
          :disabled="busy || session.user?.role !== 'admin'"
          autocomplete="new-password"
          placeholder="仅粘贴 Key 本身；已有配置时留空，不覆盖原 Key"
        />
      </Form.Item>
      <div class="hci-toolbar">
        <Button
          type="primary"
          :loading="busy"
          :disabled="busy || !apiKey.trim() || session.user?.role !== 'admin'"
          @click="configure(true)"
        >
          加密保存到服务器
        </Button>
        <Button
          :loading="busy"
          :disabled="
            busy || !status.configured || session.user?.role !== 'admin'
          "
          @click="configure(false)"
        >
          检测 MCP 连接
        </Button>
        <a
          class="hci-link"
          href="https://developer.semrush.com/api/v3/introduction/semrush-mcp/"
          target="_blank"
          rel="noopener noreferrer"
          >官方接入说明</a
        >
      </div>
    </Form>
    <p class="hci-evidence" role="status">{{ status.message }}</p>
    <p v-if="status.checkedAt" class="hci-subtle">
      上次检测：{{
        new Date(status.checkedAt).toLocaleString('zh-CN', { hour12: false })
      }}<span v-if="status.toolCount !== undefined">
        · 发现 {{ status.toolCount }} 个工具</span
      >
    </p>
    <Alert
      type="info"
      show-icon
      message="连接检测与数据查询分开"
      description="检测仅完成身份握手和工具发现，不执行关键词报告。勾选新建研究中的 Semrush 后，会扩词、补充月搜索量、自然搜索KD和意图，再结合 Google Trends 评分；旧关键词可勾选后点击「一键补齐数据并重评」。保存 Key 或检测通过本身不会启动查询。数据报告仍消耗 API units，5 万额度不等于 5 万次查询；有效期及权限以账户或提供方说明为准。"
    />
    <p class="hci-subtle" style="margin-top: 12px">
      固定连接官方地址 https://mcp.semrush.com/v2/mcp，不向其他地址转发
      Key。如提供方指定了其他 MCP
      地址，请先核对授权。数据是否返回由该词在目标国家的收录情况及账户权限决定；缺项不会伪造为0。
    </p>
  </section>
</template>
