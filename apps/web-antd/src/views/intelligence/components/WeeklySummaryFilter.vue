<script setup lang="ts">
import { computed } from 'vue';

import { Button, Tag } from 'ant-design-vue';

const props = defineProps<{ week: string; onlyNew: boolean; kind: 'ads' | 'products' }>();
defineEmits<{ clear: [] }>();
const end = computed(() => {
  const at = Date.parse(props.week);
  return Number.isFinite(at) ? new Date(at + 6 * 86_400_000).toISOString().slice(0, 10) : '';
});
const label = computed(() => props.kind === 'products' ? props.onlyNew ? '新品' : '新发现产品' : props.onlyNew ? '新广告' : '新发现广告');
</script>

<template>
  <div v-if="week" class="weekly-filter" role="status">
    <Tag color="blue">每周汇总：{{ label }}</Tag>
    <span>首次发现周：{{ week }} ～ {{ end }}（北京时间）</span>
    <span v-if="onlyNew">首次抓取时 {{ kind === 'products' ? '上架' : '开始投放' }}不超过 7 天</span>
    <Button type="link" @click="$emit('clear')">清除周汇总筛选</Button>
  </div>
</template>

<style scoped>
.weekly-filter { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
</style>
