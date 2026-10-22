<script setup lang="ts">
import { Alert, Button } from 'ant-design-vue';
defineProps<{ error: string; loading?: boolean }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <Alert v-if="error" type="error" :message="error" show-icon style="margin-bottom:12px">
    <template #action><Button size="small" :loading="loading" @click="$emit('retry')">重试</Button></template>
  </Alert>
</template>
