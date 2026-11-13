<script setup lang="ts">
import type { Keyword } from '../data';
defineProps<{ evidence: Keyword['productKeywordEvidence'] }>();
</script>
<template>
  <details v-if="evidence?.length" class="hci-panel" style="margin-block: 12px">
    <summary>商品提词依据（{{ evidence.length }}条）</summary>
    <p class="hci-subtle">这些词提取自商品原文，属于研究候选词；搜索指标由独立来源返回。</p>
    <blockquote v-for="item in evidence" :key="`${item.productId}:${item.fingerprint}:${item.sourceId}`">
      <p>{{ item.quote }}</p>
      <small class="hci-subtle">来源商品：{{ item.productTitle || item.productId }}</small>
      <p v-if="/^https?:\/\//i.test(item.url)"><a :href="item.url" target="_blank" rel="noopener noreferrer">查看商品原文</a></p>
    </blockquote>
  </details>
</template>
