<script setup lang="ts">
import { onDeactivated, onMounted, onUnmounted, reactive, ref } from 'vue';

import {
  Alert,
  Button,
  Form,
  Input,
  message,
  Switch,
  Tag,
} from 'ant-design-vue';

import { adminRequest, session } from '../session';
const config = reactive({
  configured: false,
  enabled: false,
  status: 'unchecked',
  checkedAt: '',
});
const busy = ref(false);
const token = ref('');
const clear = () => {
  token.value = '';
};
onDeactivated(clear);
onUnmounted(clear);
onMounted(async () => {
  if (session.user?.role === 'admin')
    try {
      Object.assign(
        config,
        await adminRequest('server_westmonth_session_status'),
      );
    } catch {
      message.error('西之月会话状态读取失败');
    }
});
async function act(action: string, remove = false) {
  if (busy.value) return;
  busy.value = true;
  try {
    Object.assign(
      config,
      await adminRequest(
        action,
        action.endsWith('_save')
          ? { enabled: config.enabled, accessToken: token.value, clear: remove }
          : {},
      ),
    );
    clear();
    message.success(
      action.endsWith('_check') ? '会话检测已完成' : '登录会话配置已保存',
    );
  } catch (error) {
    message.error(error instanceof Error ? error.message : '操作失败');
  } finally {
    busy.value = false;
  }
}
const labels: Record<string, string> = {
  unchecked: '尚未检测',
  price_available: '可读取折后价',
  price_unavailable: '接口未返回折后价，请检查账号权限或更新会话',
  check_failed: '会话检测失败，请重新登录后更新',
};
</script>
<template>
  <section class="hci-panel" id="westmonth-session">
    <div class="hci-panel-head">
      <h2>西之月 · 登录会话</h2>
      <Tag>{{ config.configured ? '已加密保存' : '未配置' }}</Tag>
    </div>
    <Alert
      type="info"
      show-icon
      message="自动采集使用登录后的折后价"
      description="请在西之月官网正常登录，将该登录会话的 access_token 填入下方。仅管理员可配置，服务器加密保存且不回显。首次采集、商品补全和每日监控共用此会话；保存不会启动采集。会话过期后需重新登录并更新。"
    />
    <Form layout="vertical" style="margin-top: 16px" @submit.prevent>
      <Form.Item label="允许采集使用此登录会话">
        <Switch
          v-model:checked="config.enabled"
          :disabled="busy || session.user?.role !== 'admin'"
        />
      </Form.Item>
      <Form.Item
        :label="
          config.configured
            ? '登录会话 access_token（留空保留已保存会话）'
            : '登录会话 access_token'
        "
      >
        <Input.Password
          v-model:value="token"
          autocomplete="new-password"
          :maxlength="8192"
          :disabled="busy || session.user?.role !== 'admin'"
          placeholder="请在此填写，无需提供账号密码；请勿发到聊天中"
        />
      </Form.Item>
      <p class="hci-subtle">
        获取方式：官网登录后，在浏览器开发者工具的应用/存储区域复制
        access_token。只复制令牌值，无需整份 Cookie。
      </p>
      <div style="display: flex; flex-wrap: wrap; gap: 8px">
        <Button
          type="primary"
          :loading="busy"
          :disabled="session.user?.role !== 'admin'"
          @click="act('server_westmonth_session_save')"
        >
          保存登录会话
        </Button>
        <Button
          :disabled="
            busy || !config.configured || session.user?.role !== 'admin'
          "
          @click="act('server_westmonth_session_check')"
        >
          检测折后价读取
        </Button>
        <Button
          danger
          :disabled="
            busy || !config.configured || session.user?.role !== 'admin'
          "
          @click="act('server_westmonth_session_save', true)"
        >
          移除会话
        </Button>
      </div>
    </Form>
    <p role="status" class="hci-evidence">
      {{ labels[config.status] || '状态待核对'
      }}{{ config.checkedAt ? ` · ${config.checkedAt}` : '' }}
    </p>
  </section>
</template>
