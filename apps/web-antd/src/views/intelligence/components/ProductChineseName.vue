<script setup lang="ts">
import { computed } from 'vue';

import { productChineseName } from '../../../../../../server/product-names.mjs';
import ProductText from './ProductText.vue';

const props = defineProps<{
  product: { title: string; titleZh?: string; brand?: string };
}>();
const name = computed(() => productChineseName(props.product));
</script>

<template>
  <ProductText :text="product.title" :translated="name" />
</template>
