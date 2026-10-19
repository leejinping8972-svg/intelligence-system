<script setup lang="ts">
import { ref } from 'vue';

import { Button, Drawer } from 'ant-design-vue';

import PublicContentPanel from './PublicContentPanel.vue';
defineProps<{
  query: string;
  market: string;
  keywordIds?: string[];
  productIds?: string[];
}>();
const open = ref(false);
</script>
<template>
  <Button size="small" @click="open = true">找公共内容</Button>
  <Drawer
    :open="open"
    title="搜索视频与文章"
    width="min(1200px, 96vw)"
    destroy-on-close
    @close="open = false"
  >
    <PublicContentPanel
      v-if="open"
      :initial-query="query"
      :initial-market="market"
      :keyword-ids="keywordIds"
      :product-ids="productIds"
      open-search-on-mount
    />
  </Drawer>
</template>
