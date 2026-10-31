<script setup lang="ts">
import type { DiscoveryKind } from '../discovery-monitors';

import { computed, ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';

import { Button, Form, message, Modal, Select, Switch } from 'ant-design-vue';

import { monitorProduct, state } from '../data';
import CompetitorWatchPanel from './CompetitorWatchPanel.vue';
import DailyDiscoveryPlan from './DailyDiscoveryPlan.vue';
import DiscoveryPlanForm from './DiscoveryPlanForm.vue';
import KeywordTrendsControl from './KeywordTrendsControl.vue';
import MarketCollectionDialog from './MarketCollectionDialog.vue';
import SemrushHotwordsSidebar from './SemrushHotwordsSidebar.vue';
const emit = defineEmits<{ saved: [] }>();
const Plus = createIconifyIcon('lucide:plus');
const kind = ref('fbm_new');
  const open = ref(false);
  const product = ref<string>();
const frequency = ref('每周');
const enabled = ref(true);
function saved() {
  open.value = false;
  emit('saved');
}
function saveProduct() {
  if (!product.value) return;
  monitorProduct(product.value);
  const monitor = state.monitors.find((m) => m.productId === product.value);
  if (monitor) Object.assign(monitor, { frequency: frequency.value, enabled: enabled.value });
  message.success('商品监控已保存');
  saved();
}
const discoveryKind = computed(() =>
  ['fbm_new', 'ingredients', 'regular_new'].includes(kind.value)
    ? (kind.value as DiscoveryKind)
    : undefined,
);
const options = [
  { value: 'fbm_new', label: '每周监控1 · FBM新品' },
  { value: 'regular_new', label: '每周监控2 · 常规新品' },
  { value: 'ingredients', label: '成分研究' },
  { value: 'site', label: '独立站上新与变化' },
  { value: 'advertiser', label: '广告主素材变化' },
  { value: 'daily', label: '每日关键词商品与广告发现' },
  { value: 'hotwords', label: 'Semrush热门词' },
  { value: 'trends', label: '关键词与社交趋势' },
  { value: 'market', label: '国家市场采集计划' },
  { value: 'product', label: '商品监控' },
];
</script>
<template>
  <Button type="primary" @click="open = true">
<template #icon><Plus /></template>新建监控
</Button>
  <Modal
    v-model:open="open"
    title="新建监控"
    :width="720"
    :footer="null"
    destroy-on-close
    :body-style="{ maxHeight: '72vh', overflowY: 'auto' }"
  >
    <Select
      v-model:value="kind"
      :options="options"
      aria-label="监控类型"
      style="width: 100%; margin-bottom: 20px"
    />
    <DiscoveryPlanForm
      v-if="discoveryKind"
      :key="discoveryKind"
      :kind="discoveryKind"
      scheduled
      @saved="
        open = false;
        emit('saved');
      "
      @submitted="open = false"
    />
    <CompetitorWatchPanel
      v-else-if="kind === 'site' || kind === 'advertiser'"
      :key="kind"
      :kind="kind"
      embedded
      @saved="
        open = false;
        emit('saved');
      "
    />
    <DailyDiscoveryPlan v-else-if="kind === 'daily'" embedded @saved="saved" />
    <SemrushHotwordsSidebar v-else-if="kind === 'hotwords'" embedded @saved="saved" />
    <KeywordTrendsControl v-else-if="kind === 'trends'" :ids="[]" embedded @saved="saved" />
    <MarketCollectionDialog v-else-if="kind === 'market'" embedded @saved="saved" />
    <Form v-else-if="kind === 'product'" layout="vertical" @finish="saveProduct">
      <Form.Item label="监控商品">
<Select
        v-model:value="product"
        show-search
        option-filter-prop="label"
        :options="state.products.filter((p) => state.market === 'ALL' || p.market === state.market).map((p) => ({ value: p.id, label: p.title }))"
        aria-label="监控商品"
        style="width: 100%"
/></Form.Item>
      <Form.Item label="监控周期"><Select v-model:value="frequency" :options="['每天', '每两天', '每周'].map((value) => ({ value, label: value }))" /></Form.Item>
      <Form.Item label="启用监控"><Switch v-model:checked="enabled" /></Form.Item>
      <Button type="primary" html-type="submit" :disabled="!product">保存监控</Button>
    </Form>
  </Modal>
</template>
