<script setup lang="ts">
import type { Product } from '../data';

import { computed } from 'vue';

import { productSellerName } from '../../../../../../server/product-seller.mjs';
import ProductText from './ProductText.vue';

const props = defineProps<{ product: Product }>();
const seller = computed(() => productSellerName(props.product));
const isAmazon = computed(
  () => props.product.sourcePlatform?.trim().toLowerCase() === 'amazon',
);
</script>

<template>
  <div class="product-merchant">
    <div v-if="isAmazon || seller" class="product-merchant-line">
      <span class="product-merchant-label">卖家：</span
      ><span>{{ seller || '未返回' }}</span>
    </div>
    <div class="product-merchant-line">
      <span class="product-merchant-label">品牌：</span
      ><ProductText :text="product.brand" :translated="product.brandZh" />
    </div>
  </div>
</template>

<style scoped>
.product-merchant {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  font-weight: 400;
}
.product-merchant-line {
  display: flex;
  align-items: baseline;
  gap: 2px;
  overflow-wrap: anywhere;
}
.product-merchant-label {
  flex-shrink: 0;
  color: #8c8c8c;
}
</style>
