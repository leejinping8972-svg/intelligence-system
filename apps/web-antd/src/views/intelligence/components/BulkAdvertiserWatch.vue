<script setup lang="ts">
import type { AdvertiserRow } from '../advertisers';

import { computed, reactive, ref } from 'vue';

import {
  Alert,
  Button,
  Form,
  InputNumber,
  message,
  Modal,
  Switch,
} from 'ant-design-vue';

import { cloudRequest, syncCloudWorkspace } from '../cloud-workspace';
import {
  competitorWorkspace,
  refreshCompetitorWorkspace,
} from '../competitor-workspace';
import { serverMode, session } from '../session';
import CompactTags from './CompactTags.vue';

const props = defineProps<{ advertisers: AdvertiserRow[] }>();
const busy = ref(false);
  const error = ref('');
  const loading = ref(false);
  const open = ref(false);
const frozen = ref<AdvertiserRow[]>([]);
const ready = ref(false);
const form = reactive({ enabled: false, hour: 8, maxPages: 10 });
const known = computed(
  () =>
    new Set(
      competitorWorkspace.targets
        .filter((t) => t.kind === 'advertiser')
        .map((t) => `${t.market}:${t.pageId}`),
    ),
);
const additions = computed(
  () => frozen.value.filter((a) => !known.value.has(a.id)).length,
);
const remaining = computed(() =>
  Math.max(0, 100 - competitorWorkspace.targets.length),
);
async function begin() {
  frozen.value = structuredClone(
    props.advertisers.map((a) => ({
      ...a,
      adIds: [...a.adIds],
      siteIds: [...a.siteIds],
      domains: [...a.domains],
    })),
  );
  form.enabled = false;
  error.value = '';
  open.value = true;
  loading.value = true;
  ready.value = false;
  await refreshCompetitorWorkspace();
  loading.value = false;
  if (competitorWorkspace.error) error.value = competitorWorkspace.error;
  else ready.value = true;
}
async function save() {
  if (
    busy.value ||
    loading.value ||
    !ready.value ||
    additions.value > remaining.value
  )
    return;
  busy.value = true;
  error.value = '';
  try {
    await syncCloudWorkspace();
    const result = await cloudRequest<{ created: number; preserved: number }>(
      'server_competitor_advertiser_batch_save',
      { adIds: frozen.value.map((a) => a.adId), ...form },
    );
    await refreshCompetitorWorkspace(true);
    message.success(
      `已新增${result.created}个广告主监控，保留${result.preserved}个已有设置`,
    );
    open.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '批量保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :disabled="
      !advertisers.length || !serverMode || session.user?.role !== 'admin'
    "
    @click="begin"
    >
批量加入广告主监控（{{ advertisers.length }}）
</Button>
  <Modal
    v-model:open="open"
    title="批量加入广告主监控"
    width="min(720px, 100vw)"
    :confirm-loading="busy"
    :mask-closable="!busy"
    :closable="!busy"
    :ok-button-props="{ disabled: loading || !ready || additions > remaining }"
    ok-text="保存监控设置"
    cancel-text="取消"
    @ok="save"
  >
    <p>
      已选{{ frozen.length }}个广告主 · 新增{{ loading ? '—' : additions }}个 ·
      保留{{ loading ? '—' : frozen.length - additions }}个 · 剩余名额{{
        loading ? '—' : remaining
      }}
    </p>
    <CompactTags
      :items="frozen.map((a) => `${a.name} · ${a.market} · ${a.pageId}`)"
      label="本批广告主"
    />
    <Alert v-if="error" type="error" :message="error" role="alert" show-icon />
    <Alert
      v-if="!loading && additions > remaining"
      type="warning"
      :message="`当前仅剩${remaining}个名额，请缩小选择范围；本次不会部分提交。`"
      show-icon
    />
    <Form layout="vertical" class="hci-detail-section">
<div class="hci-form-grid">
        <Form.Item label="每日更新时间（北京时间）">
<InputNumber
            v-model:value="form.hour"
            :min="0"
            :max="23"
            :precision="0"
/>
</Form.Item>
<Form.Item label="每渠道页面上限"><InputNumber v-model:value="form.maxPages" :min="1" :max="100" :precision="0" /></Form.Item>
      </div>
      <Form.Item label="启用自动检查">
<Switch v-model:checked="form.enabled" /><span class="hci-subtle">
          默认添加为暂停状态</span>
</Form.Item>
</Form>
    <p class="hci-subtle">
      按市场和Page
      ID去重，新对象仅监控新广告；已有监控的启停、预算和站点关联保持原设置。新对象的每渠道页面上限合计{{
        additions * form.maxPages
      }}次，启用后由后台调度并消耗广告源额度，首次完整扫描建立基线。
    </p>
  </Modal>
</template>
