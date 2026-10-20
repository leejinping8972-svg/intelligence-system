<script setup lang="ts">
import { onDeactivated, onMounted, onUnmounted, reactive, ref } from 'vue';

import { Alert, Button, Form, Input, message, Switch } from 'ant-design-vue';

import { adminRequest, session } from '../session';
const config = reactive({
  browserEnabled: true,
  paidEnabled: false,
  configured: false,
  message: '正在读取配置',
});
const apiKey = ref('');
  const busy = ref(false);
onMounted(async () => {
  try {
    Object.assign(config, await adminRequest('server_site_fetch_status'));
  } catch {
    config.message = '读取采集备用配置失败，请刷新后重试';
  }
});
const clear = () => {
  apiKey.value = '';
};
onDeactivated(clear);
onUnmounted(clear);
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    Object.assign(
      config,
      await adminRequest('server_site_fetch_config', {
        browserEnabled: config.browserEnabled,
        paidEnabled: config.paidEnabled,
        apiKey: apiKey.value,
      }),
    );
    apiKey.value = '';
    message.success('采集策略已保存，未调用托管服务');
  } catch (e) {
    message.error(e instanceof Error ? e.message : '保存失败');
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <section id="site-fetch-provider" class="hci-panel">
    <div class="hci-panel-head"><h2>独立站商品采集 · 备用策略</h2></div>
    <Form layout="vertical" @submit.prevent>
      <Form.Item label="动态页面使用服务器浏览器（无第三方接口费用）">
<Switch
          v-model:checked="config.browserEnabled"
          :disabled="busy || session.user?.role !== 'admin'"
      />
</Form.Item>
      <Form.Item label="允许Firecrawl托管备用（消耗平台额度，默认关闭）">
<Switch
          v-model:checked="config.paidEnabled"
          :disabled="busy || session.user?.role !== 'admin'"
      />
</Form.Item>
      <Form.Item
        :label="`Firecrawl API Key${config.configured ? ' · 已保存，留空保留' : ''}`"
        html-for="site-firecrawl-key"
      >
        <Input.Password
          id="site-firecrawl-key"
          v-model:value="apiKey"
          :disabled="busy || session.user?.role !== 'admin'"
          :maxlength="210"
          autocomplete="new-password"
          placeholder="仅填写fc-开头的Key；服务器加密保存，不回显"
        />
      </Form.Item>
      <Button
        type="primary"
        :loading="busy"
        :disabled="busy || session.user?.role !== 'admin'"
        @click="save"
        >
保存采集策略
</Button>
    </Form>
    <p class="hci-evidence" role="status">{{ config.message }}</p>
    <Alert
      type="info"
      show-icon
      message="优先免费采集，付费需要双重启用"
      description="先读取公开目录与商品页，429按网站要求冷却，不立即换入口继续请求。动态页渲染占用服务器资源，运行环境不可用会记录原因。只有本页启用托管备用，且管理员提交任务时设置大于0的备用次数，才会请求Firecrawl。保存不做收费检测，不会自动购买额度或恢复历史失败任务。"
    />
  </section>
</template>
