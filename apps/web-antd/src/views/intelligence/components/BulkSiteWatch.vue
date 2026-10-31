<script setup lang="ts">
import type { WatchSnapshot } from '../competitor-monitor';

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
import { state } from '../data';
import { serverMode, session } from '../session';
import CompactTags from './CompactTags.vue';

const props = defineProps<{ siteIds: string[] }>();
const open = ref(false);
const busy = ref(false);
const loading = ref(false);
const loaded = ref(false);
const errorMessage = ref('');
const targets = ref<WatchSnapshot['targets']>([]);
const frozenIds = ref<string[]>([]);
const names = computed(() =>
  frozenIds.value.map(
    (id) => state.sites.find((site) => site.id === id)?.brand || id,
  ),
);
const known = computed(
  () =>
    new Set(
      targets.value
        .filter((item) => item.kind === 'site')
        .map((item) => item.siteId),
    ),
);
const additions = computed(
  () => frozenIds.value.filter((id) => !known.value.has(id)).length,
);
const remaining = computed(() => Math.max(0, 100 - targets.value.length));
const form = reactive({ enabled: false, hour: 8, maxPages: 10 });
async function begin() {
  form.enabled = false;
  frozenIds.value = [...new Set(props.siteIds)];
  open.value = true;
  loaded.value = false;
  loading.value = true;
  errorMessage.value = '';
  try {
    const snapshot = await cloudRequest<WatchSnapshot>(
      'server_competitor_snapshot',
    );
    targets.value = snapshot.targets;
    loaded.value = true;
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : '监控名额读取失败';
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (busy.value || !loaded.value || additions.value > remaining.value) return;
  busy.value = true;
  errorMessage.value = '';
  try {
    await syncCloudWorkspace();
    const result = await cloudRequest<{ created: number; preserved: number }>(
      'server_competitor_batch_save',
      { siteIds: frozenIds.value, ...form },
    );
    message.success(
      `已新增${result.created}个监控，保留${result.preserved}个已有监控设置`,
    );
    open.value = false;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败';
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <Button
    :disabled="!siteIds.length || !serverMode || session.user?.role !== 'admin'"
    @click="begin"
  >
    批量加入上新监控（{{ siteIds.length }}）
  </Button>
  <Modal
    v-model:open="open"
    title="批量加入独立站上新监控"
    width="min(720px, 100vw)"
    :confirm-loading="busy"
    :ok-button-props="{ disabled: loading || !loaded || additions > remaining }"
    :mask-closable="!busy"
    :closable="!busy"
    ok-text="保存监控设置"
    cancel-text="取消"
    @ok="save"
  >
    <p>
      所选 {{ frozenIds.length }} 家 · 新增 {{ loaded ? additions : '—' }} 家 ·
      剩余名额 {{ loaded ? remaining : '—' }}
    </p>
    <CompactTags :items="names" label="本批独立站" />
    <Alert
      v-if="additions > remaining && loaded"
      type="warning"
      show-icon
      :message="`当前最多还能新增${remaining}个监控，请缩小选择范围。未提交任何变更。`"
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
          默认仅添加暂停的监控</span>
      </Form.Item>
    </Form>
    <p class="hci-subtle">
      新监控按各站点所属市场保存；已有监控（含暂停对象和广告主关联）保持原设置。{{
        additions
      }}
      个新对象的每渠道页面上限合计
      {{ additions * form.maxPages }}
      页，实际按需执行。启用后由后台调度，首次完整扫描建立基线；不等于实际发布日期。
    </p>
    <Alert
      v-if="errorMessage"
      :message="errorMessage"
      type="error"
      show-icon
      role="alert"
    />
  </Modal>
</template>
