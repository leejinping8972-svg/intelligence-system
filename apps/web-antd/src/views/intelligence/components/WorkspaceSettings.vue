<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Button, Form, Input, message, Modal } from 'ant-design-vue';
import { clearCloudKeywords } from '../cloud-workspace';
import { audit, clearWorkspaceResults, defaultBranding, state } from '../data';

const draft = reactive({ ...state.branding });
const logoInput = ref<HTMLInputElement>();
const resetOpen = ref(false);
const resetBusy = ref(false);
function save() {
  const names = {
    appName: draft.appName.trim(), workspaceName: draft.workspaceName.trim(),
    businessName: draft.businessName.trim(), environmentLabel: draft.environmentLabel.trim(),
  };
  if (Object.values(names).some(value => !value)) return void message.error('配置名称不能为空');
  Object.assign(state.branding, draft, names);
  audit('更新基础配置', `${names.appName} / ${names.workspaceName}`, 'ALL');
  message.success('基础配置已更新');
}
function resetBranding() {
  Object.assign(draft, defaultBranding);
  Object.assign(state.branding, defaultBranding);
  audit('恢复默认品牌配置', defaultBranding.appName, 'ALL');
}
function handleLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 512 * 1024) {
    return void message.error('请选择512KB以内的PNG、JPG或WebP图片');
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => { draft.logo = String(reader.result); });
  reader.addEventListener('error', () => message.error('图片读取失败'));
  reader.readAsDataURL(file);
}
async function resetResults() {
  resetBusy.value = true;
  try {
    await clearCloudKeywords();
    clearWorkspaceResults();
    resetOpen.value = false;
    message.success('云端关键词及本机结果已清空，基础配置已保留');
  } catch (error) {
    message.error(error instanceof Error ? error.message : '清除失败');
  } finally { resetBusy.value = false; }
}
</script>
<template>
  <section class="hci-panel">
    <div class="hci-panel-head"><h2>基础配置</h2></div>
    <div class="hci-branding-layout">
      <div class="hci-brand-preview">
        <div class="hci-brand-lockup"><img :src="draft.logo" alt="Logo预览" /><div><strong>{{ draft.appName }}</strong><span>{{ draft.businessName }}</span></div></div>
        <input ref="logoInput" class="hci-file-input" type="file" accept="image/png,image/jpeg,image/webp" aria-label="上传Logo" @change="handleLogo" />
        <Button @click="logoInput?.click()">更换Logo</Button>
      </div>
      <Form layout="vertical" class="hci-brand-form" @finish="save">
        <div class="hci-form-grid">
          <Form.Item label="后台名称"><Input v-model:value="draft.appName" :maxlength="20" /></Form.Item>
          <Form.Item label="工作区名称"><Input v-model:value="draft.workspaceName" :maxlength="20" /></Form.Item>
          <Form.Item label="业务名称"><Input v-model:value="draft.businessName" :maxlength="30" /></Form.Item>
          <Form.Item label="环境标识"><Input v-model:value="draft.environmentLabel" :maxlength="12" /></Form.Item>
        </div>
        <div class="hci-brand-actions"><Button type="primary" html-type="submit">保存基础配置</Button><Button @click="resetBranding">恢复默认</Button></div>
      </Form>
    </div>
  </section>
  <section class="hci-panel">
    <div class="hci-panel-head"><h2>工作区结果管理</h2><Button danger @click="resetOpen = true">清空全部结果数据</Button></div>
  </section>
  <Modal v-model:open="resetOpen" title="清空云端关键词及本机全部结果数据？" :confirm-loading="resetBusy" ok-text="确认清空" cancel-text="保留数据" @ok="resetResults">
    <p>这会清除云端关键词、趋势和关键词任务，以及本机的独立站、商品、广告、审核、监控、导入历史和操作记录。请先取消正在运行的任务并导出需要的数据。基础配置及密钥配置会保留。</p>
  </Modal>
</template>
