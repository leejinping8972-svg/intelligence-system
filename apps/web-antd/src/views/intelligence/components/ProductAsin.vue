<script setup lang="ts">
import type { Product } from '../data';

import { computed } from 'vue';

import {
  productAmazonUrl,
  productAsin,
} from '../../../../../../server/product-asin.mjs';

const props = defineProps<{
  product: Pick<Product, 'asin' | 'sourcePlatform' | 'sourceProductId'> &
    Partial<
      Pick<Product, 'sourceMarket' | 'market' | 'sourceUrl' | 'evidenceUrl'>
    >;
}>();
const isAmazon = computed(
  () => props.product.sourcePlatform?.trim().toLowerCase() === 'amazon',
);
const asin = computed(() => productAsin(props.product));
const amazonUrl = computed(() => productAmazonUrl(props.product));
</script>

<template>
  <span v-if="isAmazon" class="product-asin"
    >ASIN：<a
      v-if="amazonUrl"
      :href="amazonUrl"
      target="_blank"
      rel="noopener noreferrer"
      :aria-label="`在亚马逊查看 ${asin}`"
      @click.stop
      >{{ asin }} ↗</a
    ><template v-else>{{ asin || '未返回' }}</template></span
  >
</template>

<style scoped>
.product-asin {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  white-space: nowrap;
}
.product-asin a {
  color: #1677ff;
}
.product-asin a:hover {
  text-decoration: underline;
}
</style>
