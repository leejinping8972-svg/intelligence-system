<script setup lang="ts">
import type { DiscoveryKind } from '../discovery-monitors';
import { computed, ref } from 'vue';
import { createIconifyIcon } from '@vben/icons';
import { Button, Modal, Select } from 'ant-design-vue';
import { state } from '../data';
import CompetitorWatchPanel from './CompetitorWatchPanel.vue';
import DailyDiscoveryPlan from './DailyDiscoveryPlan.vue';
import DiscoveryPlanForm from './DiscoveryPlanForm.vue';
import KeywordTrendsControl from './KeywordTrendsControl.vue';
import MarketCollectionDialog from './MarketCollectionDialog.vue';
import ProductDrawer from './ProductDrawer.vue';
import SemrushHotwordsSidebar from './SemrushHotwordsSidebar.vue';
const emit = defineEmits<{ saved: [] }>();
const Plus = createIconifyIcon('lucide:plus');
const open = ref(false),
  kind = ref('fbm_new'),
  product = ref<string>();
const discoveryKind = computed(() =>
  ['fbm_new', 'regular_new', 'ingredients'].includes(kind.value)
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
  <Button type="primary" @click="open = true"
    ><template #icon><Plus /></template>新建监控</Button
  >
  <Modal
    v-model:open="open"
    title="新建监控"
    :width="720"
    :footer="null"
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
    />
    <DailyDiscoveryPlan v-else-if="kind === 'daily'" />
    <SemrushHotwordsSidebar v-else-if="kind === 'hotwords'" />
    <KeywordTrendsControl v-else-if="kind === 'trends'" :ids="[]" />
    <MarketCollectionDialog v-else-if="kind === 'market'" />
    <template v-else-if="kind === 'product'"
      ><Select
        v-model:value="product"
        show-search
        option-filter-prop="label"
        :options="state.products.map((p) => ({ value: p.id, label: p.title }))"
        aria-label="监控商品"
        style="width: 100%" /><ProductDrawer
        :id="product"
        @close="product = undefined"
    /></template>
  </Modal>
</template>
