<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Tag,
} from 'ant-design-vue';
import { adminRequest, session } from '../session';
import { persistAnalysisConfig } from '../analysis-config';
const form = reactive({ baseUrl: '', model: '', apiKey: '', maxTokens: 2000 });
const configured = ref(false),
  busy = ref(false),
  error = ref('');
async function load() {
  try {
    const s = await adminRequest<{
      configured: boolean;
      baseUrl?: string;
      model?: string;
      maxTokens?: number;
    }>('server_analysis_status');
    configured.value = s.configured;
    if (s.configured)
      Object.assign(form, {
        baseUrl: s.baseUrl,
        model: s.model,
        maxTokens: s.maxTokens,
      });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  }
}
async function save() {
  busy.value = true;
  error.value = '';
  try {
    await persistAnalysisConfig({ ...form }, adminRequest, crypto.randomUUID());
    form.apiKey = '';
    configured.value = true;
    message.success('模型配置已加密保存');
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section id="analysis-provider" class="hci-panel">
    <div class="hci-panel-head">
      <h2>研究语义分析 · 模型接口（可选）</h2>
      <Tag :color="configured ? 'green' : 'default'">{{
        configured ? '已配置' : '未配置'
      }}</Tag>
    </div>
    <p class="hci-subtle">
      ScrapeCreators Key 用于采集，不是通用模型 Key。此处支持兼容 Chat
      Completions 的 HTTPS 接口；不配置仍可查看原始证据和主题统计。
    </p>
    <Form
      v-if="session.user?.role === 'admin'"
      :model="form"
      layout="vertical"
      @finish="save"
    >
      <div class="hci-form-grid">
        <Form.Item
          label="接口基础地址或完整 chat/completions 地址"
          name="baseUrl"
          :rules="[{ required: true, message: '请输入接口地址' }]"
          ><Input
            v-model:value="form.baseUrl"
            placeholder="https://服务商域名/v1"
            autocomplete="off"
        /></Form.Item>
        <Form.Item
          label="模型名称"
          name="model"
          :rules="[{ required: true, message: '请输入模型名称' }]"
          ><Input
            v-model:value="form.model"
            placeholder="填写服务商提供的模型 ID"
            autocomplete="off"
        /></Form.Item>
        <Form.Item label="模型 API Key"
          ><Input.Password
            v-model:value="form.apiKey"
            placeholder="留空保留已保存的密钥"
            autocomplete="new-password"
        /></Form.Item>
        <Form.Item label="单次报告输出上限（tokens）"
          ><InputNumber v-model:value="form.maxTokens" :min="500" :max="4000"
        /></Form.Item>
      </div>
      <Button
        html-type="submit"
        type="primary"
        :loading="busy"
        :disabled="
          !form.baseUrl || !form.model || (!configured && !form.apiKey)
        "
        >加密保存模型配置</Button
      >
    </Form>
    <Alert v-if="error" :message="error" type="error" show-icon />
    <p class="hci-subtle">
      仅在手动选择生成报告时调用，单份报告最多分析80条文本样本；报告显示实际样本量和服务商返回的
      token 用量。模型费用另计，不自动购买额度。
    </p>
  </section>
</template>
