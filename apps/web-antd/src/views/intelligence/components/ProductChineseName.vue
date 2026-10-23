<script setup lang="ts">
import { computed } from 'vue';

import { productChineseName } from '../../../../../../server/product-names.mjs';

const props = defineProps<{
  product: { title: string; titleZh?: string; brand?: string };
}>();
const name = computed(() => productChineseName(props.product));
</script>

<template>
  <p class="product-chinese-reference" :class="{ 'is-pending': !name }">
    {{ name ? `中文参考：${name}` : '中文参考待补充' }}
  </p>
</template>

<style scoped>
.product-chinese-reference {
  min-width: 0;
  margin: 4px 0;
  color: var(--hci-ink);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
  white-space: normal;
}
.product-chinese-reference.is-pending {
  color: var(--hci-muted);
}
</style>
