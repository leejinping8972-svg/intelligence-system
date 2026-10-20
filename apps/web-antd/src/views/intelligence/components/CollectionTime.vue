<script setup lang="ts">
import { collectionTimeLabel } from '../resource-metadata';
defineProps<{ at?: string }>();
</script>
<template>
  <time v-if="at" :datetime="at" title="采集时间 · 北京时间">{{
    collectionTimeLabel(at)
  }}</time>
  <span v-else class="hci-subtle">未记录</span>
</template>
