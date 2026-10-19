<script setup lang="ts">
import { onDeactivated, onMounted, onUnmounted, ref } from 'vue';
import { Alert, Button, Form, Input, message, Tag } from 'ant-design-vue';
import { adminRequest, session } from '../session';

interface Connection {
  configured: boolean;
  ready: boolean;
  checkedAt?: string;
  message: string;
}
const apiKey = ref('');
const busy = ref(false);
const error = ref('');
const status = ref<Connection>({
  configured: false,
  ready: false,
  message: '正在读取配置状态…',
});
function validate() {
  error.value =
    apiKey.value.trim() && !/^[A-Za-z0-9_-]{20,256}$/.test(apiKey.value.trim())
      ? '请粘贴 API Key 本身，不要填写网址或 OAuth 凭据'
      : '';
  return !error.value;
}
async function load() {
  try {
    status.value = await adminRequest<Connection>('server_youtube_status');
  } catch {
    status.value.message = '读取 YouTube 配置失败，请刷新重试';
  }
}
async function configure(save: boolean) {
  if (busy.value || (save && (!apiKey.value.trim() || !validate()))) return;
  busy.value = true;
  try {
    status.value = await adminRequest<Connection>(
      save ? 'server_youtube_config' : 'server_youtube_status',
      save ? { apiKey: apiKey.value.trim() } : { verify: true },
    );
    if (save) {
      apiKey.value = '';
      message.success('YouTube Key 已加密保存，请检测连接');
    } else if (status.value.ready) message.success('YouTube 连接检测通过');
    else message.warning(status.value.message);
  } catch (e) {
    status.value = {
      ...status.value,
      ready: false,
      message: e instanceof Error ? e.message : '配置或检测失败',
    };
    message.error(status.value.message);
  } finally {
    busy.value = false;
  }
}
onMounted(load);
const clear = () => {
  apiKey.value = '';
  error.value = '';
};
onDeactivated(clear);
onUnmounted(clear);
</script>

<template>
  <section id="youtube-provider" class="hci-panel">
    <div class="hci-panel-head">
      <h2>公开视频情报 · YouTube Data API</h2>
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
      用于公共情报源的视频发现与公开播放量、点赞量等传播信号。Key
      仅在服务器加密保存，不回显，也不写入浏览器长期存储。
    </p>
    <Form layout="vertical" @submit.prevent>
      <Form.Item
        label="YouTube Data API v3 · API Key"
        html-for="youtube-api-key"
        :validate-status="error ? 'error' : undefined"
        :help="error || undefined"
      >
        <Input.Password
          id="youtube-api-key"
          v-model:value="apiKey"
          :maxlength="256"
          :disabled="busy || session.user?.role !== 'admin'"
          autocomplete="new-password"
          placeholder="粘贴 Google Cloud API Key；留空不会覆盖已有配置"
          @blur="validate"
        />
      </Form.Item>
      <div class="hci-toolbar">
        <Button
          type="primary"
          :loading="busy"
          :disabled="busy || !apiKey.trim() || session.user?.role !== 'admin'"
          @click="configure(true)"
          >加密保存到服务器</Button
        >
        <Button
          :loading="busy"
          :disabled="
            busy || !status.configured || session.user?.role !== 'admin'
          "
          @click="configure(false)"
          >检测连接</Button
        >
        <a
          class="hci-link"
          href="https://console.cloud.google.com/apis/credentials"
          target="_blank"
          rel="noopener noreferrer"
          >获取 Google Cloud Key</a
        >
      </div>
    </Form>
    <p class="hci-evidence" role="status">{{ status.message }}</p>
    <p v-if="status.checkedAt" class="hci-subtle">
      上次检测：{{
        new Date(status.checkedAt).toLocaleString('zh-CN', { hour12: false })
      }}
    </p>
    <Alert
      type="info"
      show-icon
      message="保存与检测不会启动批量采集"
      description="请先在 Key 所属项目启用 YouTube Data API v3，并将 API 权限限制到该服务。检测只请求一次视频分类接口，会消耗少量免费配额；每日公共情报采集自动读取已保存的 Key，结果在「公共情报源」查看。配额耗尽会受限，不会自动购买额度。"
    />
    <p v-if="session.user?.role !== 'admin'" class="hci-subtle">
      仅管理员可以修改密钥和检测连接。
    </p>
  </section>
</template>
