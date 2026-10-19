<script setup lang="ts">
import { ref } from 'vue';
import { Alert, Button, Input, Modal, Tag, message } from 'ant-design-vue';
import { cloudRequest } from '../cloud-workspace';
import { session } from '../session';
import type { ReportPrompt } from '../research-reports';
const open = ref(false),
  loading = ref(false),
  saving = ref(false),
  draft = ref(''),
  error = ref('');
const config = ref<
  ReportPrompt & { defaultText: string; legacyText: string }
>();
async function load() {
  loading.value = true;
  error.value = '';
  try {
    config.value = await cloudRequest('server_ad_report_prompt');
    draft.value = config.value!.text;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '读取失败';
  } finally {
    loading.value = false;
  }
}
async function begin() {
  open.value = true;
  await load();
}
async function save() {
  if (!config.value) return;
  saving.value = true;
  error.value = '';
  try {
    config.value = await cloudRequest('server_ad_report_prompt_save', {
      text: draft.value,
      version: config.value.version,
    });
    draft.value = config.value!.text;
    message.success('提示词已保存，仅影响之后提交的新报告');
    open.value = false;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <Button @click="begin">分析提示词与数据说明</Button>
  <Modal
    v-model:open="open"
    title="广告报告提示词"
    :width="900"
    :footer="null"
    :mask-closable="!saving"
  >
    <Alert
      type="info"
      show-icon
      message="输入来自所选广告的标题、文案、已有转写、品牌及采集元数据。没有视频画面、落地页正文或真实投放绩效；模型不会自动补采这些数据。"
    />
    <p class="hci-subtle" style="margin-top: 12px">
      模板控制研究方向，证据引用与输出结构由系统固定。每个任务在提交时保留提示词快照，修改不会改变历史报告或正在执行的任务。
    </p>
    <template v-if="config"
      ><Tag>当前版本 {{ config.version }}</Tag
      ><Tag>{{ config.updatedBy }}</Tag>
      <label for="ad-report-prompt-text" class="prompt-label"
        >研究分析提示词</label
      >
      <Input.TextArea
        id="ad-report-prompt-text"
        v-model:value="draft"
        :rows="16"
        :maxlength="12000"
        show-count
        :readonly="session.user?.role !== 'admin'"
      />
      <details v-if="config.systemContract" style="margin: 20px 0">
        <summary>查看固定输出与证据引用规则</summary>
        <p class="prompt-old">{{ config.systemContract }}</p>
      </details>
      <details style="margin: 20px 0">
        <summary>查看旧版提示词</summary>
        <p class="prompt-old">{{ config.legacyText }}</p>
      </details>
    </template>
    <Alert v-if="error" type="error" :message="error" show-icon />
    <div class="hci-toolbar" style="margin-top: 20px">
      <Button
        v-if="session.user?.role === 'admin'"
        :disabled="!config || loading || saving"
        @click="draft = config!.defaultText"
        >填入新版默认模板</Button
      ><Button :loading="loading" :disabled="saving" @click="load"
        >重新读取</Button
      ><Button @click="open = false">关闭</Button
      ><Button
        v-if="session.user?.role === 'admin'"
        type="primary"
        :loading="saving"
        :disabled="
          !config ||
          loading ||
          draft.trim().length < 100 ||
          draft === config.text
        "
        @click="save"
        >保存提示词</Button
      >
    </div>
  </Modal>
</template>
<style scoped>
.prompt-label {
  display: block;
  margin: 18px 0 8px;
  font-weight: 600;
}
.prompt-old {
  white-space: pre-wrap;
  margin-top: 12px;
  line-height: 1.7;
}
</style>
