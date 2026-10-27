<script setup lang="ts">
import type { FormInstance } from 'ant-design-vue';

import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { IconifyIcon } from '@vben/icons';

import { Alert, Button, Form, Input, Modal, Select, Switch } from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import { state } from '../data';
import { serverMode } from '../session';

interface Result { siteId: string; jobId: string; reused: boolean; brand: string; domain: string }
const emit = defineEmits<{ saved: [] }>();
const router = useRouter();
const busy = ref(false);
const error = ref('');
const open = ref(false);
const result = ref<Result>();
const formRef = ref<FormInstance>();
const form = reactive({ url: '', market: '', brand: '', collectProducts: true, profile: 'explore' });
let requestId = '';
watch(form, () => { requestId = ''; error.value = ''; });
function show() {
  Object.assign(form, { url: '', market: state.market === 'ALL' ? '' : state.market, brand: '', collectProducts: true, profile: 'explore' });
  error.value = '';
  result.value = undefined;
  requestId = '';
  open.value = true;
}
async function submit() {
  if (busy.value || result.value) return;
  try { await formRef.value?.validate(); } catch { return; }
  busy.value = true;
  error.value = '';
  try {
    requestId ||= crypto.randomUUID();
    result.value = await cloudRequest<Result>('server_manual_site_add', { ...form, requestId });
    emit('saved');
    await syncCloudWorkspace().catch(() => {});
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '添加失败'; }
  finally { busy.value = false; }
}
async function view(path: string, query: Record<string, string>) {
  open.value = false;
  state.market = form.market as 'MX' | 'US' | 'VN';
  await router.push({ path, query });
}
</script>
<template>
  <Button :disabled="!serverMode" @click="show">
    <template #icon><IconifyIcon icon="lucide:plus" /></template>
    手动添加独立站
  </Button>
  <Modal v-model:open="open" title="手动添加独立站" :width="520" :closable="!busy" :mask-closable="!busy" :keyboard="!busy">
    <Form v-if="!result" ref="formRef" :model="form" layout="vertical" :disabled="busy" @finish="submit">
      <Form.Item label="独立站网址" name="url" :rules="[{ required: true, whitespace: true, message: '请填写独立站网址' }]">
        <Input v-model:value="form.url" placeholder="https://www.example.com" :maxlength="2000" autocomplete="url" />
      </Form.Item>
      <Form.Item label="归档市场" name="market" :rules="[{ required: true, message: '请选择归档市场' }]">
        <Select v-model:value="form.market" :options="[{ label: '美国', value: 'US' }, { label: '墨西哥', value: 'MX' }, { label: '越南', value: 'VN' }]" />
      </Form.Item>
      <Form.Item label="品牌名称（选填）" name="brand">
        <Input v-model:value="form.brand" :maxlength="120" />
      </Form.Item>
      <Form.Item label="同时采集商品">
        <Switch v-model:checked="form.collectProducts" />
      </Form.Item>
      <Form.Item v-if="form.collectProducts" label="商品采集范围">
        <Select v-model:value="form.profile" :options="[{ label: '探索：最多30件，10件详情', value: 'explore' }, { label: '深度：最多100件，100件详情', value: 'deep' }]" />
      </Form.Item>
    </Form>
    <Alert v-if="result" type="success" show-icon :message="`${result.reused ? '已更新已有站点' : '已添加'}：${result.brand}`" :description="result.jobId ? '商品采集任务已提交，结果尚待获取。' : result.domain" />
    <Alert v-if="error" type="error" show-icon :message="error" />
    <template #footer>
      <Button v-if="!result" :disabled="busy" @click="open = false">取消</Button>
      <Button v-if="!result" type="primary" :loading="busy" @click="submit">获取信息并添加</Button>
      <Button v-if="result" @click="view('/sites', { site: result.siteId })">查看独立站</Button>
      <Button v-if="result?.jobId" type="primary" @click="view('/monitor', { job: result.jobId })">查看商品任务</Button>
    </template>
  </Modal>
</template>
