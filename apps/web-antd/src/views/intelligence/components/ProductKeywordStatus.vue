<script setup lang="ts">
import type { Product } from '../data';
defineProps<{ product: Product }>();
const labels: Record<string, string> = {
  queued: '关键词待提取', running: '关键词处理中', completed: '关键词指标已处理',
  partial: '关键词信息部分完成', failed: '关键词处理失败', empty: '未提取到合适关键词',
  cancelled: '关键词任务已取消', stale: '商品资料已更新，请补做关键词',
};
</script>
<template>
  <p v-if="product.keywordDerivation" class="hci-subtle" :title="product.keywordDerivation.message" role="status">
    {{ labels[product.keywordDerivation.status] || '关键词状态待确认' }}
  </p>
</template>
