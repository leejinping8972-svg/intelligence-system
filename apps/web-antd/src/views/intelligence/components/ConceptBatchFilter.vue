<script setup lang="ts">
import {Button, Tag} from 'ant-design-vue';
defineProps<{batch: string; day: string}>();
defineEmits<{clear: []}>();
</script>
<template>
  <div v-if="batch" class="concept-filter" role="status">
    <Tag color="blue">采集批次：{{ batch }}</Tag>
    <span v-if="day">首次发现日期：{{ day }}（北京时间）</span>
    <Button type="link" @click="$emit('clear')">清除批次筛选</Button>
  </div>
</template>
<style scoped>
.concept-filter { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin:12px 0; }
</style>
