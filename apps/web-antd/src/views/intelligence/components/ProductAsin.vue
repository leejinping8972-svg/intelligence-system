<script setup lang="ts">
import type { Product } from '../data';

import { computed } from 'vue';

import { productAsin } from '../../../../../../server/product-asin.mjs';

const props = defineProps<{
  product: Pick<Product, 'asin' | 'sourcePlatform' | 'sourceProductId'>;
}>();
const isAmazon = computed(
  () => props.product.sourcePlatform?.trim().toLowerCase() === 'amazon',
);
const asin = computed(() => productAsin(props.product));
</script>

<template>
  <span v-if="isAmazon" class="product-asin">ASIN：{{ asin || '未返回' }}</span>
</template>

<style scoped>
.product-asin {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}
</style>
