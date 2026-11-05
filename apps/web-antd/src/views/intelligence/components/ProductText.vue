<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ text?: string; translated?: string }>();
const primary = computed(
  () => props.translated?.trim() || props.text?.trim() || '未返回',
);
</script>
<template>
  <span class="product-bilingual">
    <span class="product-text-primary" :title="primary">{{ primary }}</span>
    <span
      v-if="text && translated && text.trim() !== translated.trim()"
      class="product-text-original"
      :title="text"
      >{{ text }}</span
    >
  </span>
</template>
<style scoped>
.product-bilingual {
  display: block;
  min-width: 0;
  font-size: inherit;
  text-align: left;
}
.product-text-primary,
.product-text-original {
  display: -webkit-box;
  overflow: hidden;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.5;
}
.product-text-original {
  margin-top: 2px;
  color: var(--hci-muted, #8a94a3);
  font-size: calc(1em - 2px);
  font-weight: 400;
}
</style>
