<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Alert, Button, Input, message, Tag } from 'ant-design-vue';
import { adminRequest, session } from '../session';
const key = ref(''),
  busy = ref(false),
  error = ref('');
const status = ref<{
  configured?: boolean;
  ready?: boolean;
  message?: string;
  creditsRemaining?: number;
}>({});
async function action(save = false, verify = false) {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    status.value = await adminRequest(
      save ? 'server_ads_config' : 'server_ads_status',
      save ? { apiKey: key.value } : { verify },
      70000,
    );
    if (save) {
      key.value = '';
      message.success('Meta / TikTok 数据接口密钥已加密保存');
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '请求失败';
  } finally {
    busy.value = false;
  }
}
onMounted(() => action());
</script>
<template>
  <section class="hci-panel" id="ads-provider">
    <div class="hci-panel-head">
      <h2>Meta / TikTok 数据源 · ScrapeCreators</h2>
      <Tag :color="status.ready ? 'green' : 'default'">{{
        status.ready ? '连接正常' : status.configured ? '已配置' : '未配置'
      }}</Tag>
    </div>
    <template v-if="session.user?.role === 'admin'">
      <label for="ads-api-key">API Key</label>
      <Input.Password
        id="ads-api-key"
        v-model:value="key"
        autocomplete="off"
        placeholder="填写 ScrapeCreators API Key，留空保留原配置"
        :maxlength="4096"
      />
      <div class="hci-toolbar">
        <Button :disabled="!key.trim()" :loading="busy" @click="action(true)"
          >加密保存</Button
        ><Button
          :disabled="!status.configured"
          :loading="busy"
          @click="action(false, true)"
          >检测连接（约1 credit）</Button
        ><a href="https://scrapecreators.com" target="_blank" rel="noreferrer"
          >获取 API Key</a
        ><span v-if="status.creditsRemaining !== undefined"
          >剩余额度 {{ status.creditsRemaining }}</span
        >
      </div>
    </template>
    <Alert v-if="error" :message="error" type="error" show-icon />
    <p class="hci-subtle">
      {{
        status.message ||
        '使用 Meta 广告库与 TikTok Shop 数据；广告观察和平台商品采集共用服务器加密保存的密钥。'
      }}
    </p>
  </section>
</template>
