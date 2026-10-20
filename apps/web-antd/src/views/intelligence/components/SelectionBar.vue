<script setup lang="ts">
import { Button } from 'ant-design-vue';
defineProps<{ count: number; total: number; busy?: boolean }>();
defineEmits<{ all: []; clear: [] }>();
</script>
<template>
  <div class="hci-selection-bar">
    <span>已选 <b>{{ count }}</b> / {{ total }} 条</span>
    <Button size="small" :disabled="!total || busy" @click="$emit('all')">
      全选筛选结果
    </Button>
    <Button size="small" :disabled="!count || busy" @click="$emit('clear')">
      清空选择
    </Button>
    <span class="hci-subtle">覆盖全部分页</span>
    <slot></slot>
  </div>
</template>
