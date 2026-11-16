<script setup lang="ts">
defineProps<{ error?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <main class="session-entry-status" :aria-busy="!error">
    <template v-if="error">
      <p role="alert">{{ error }}</p>
      <button type="button" @click="$emit('retry')">重新连接</button>
    </template>
    <p v-else role="status">正在进入工作区…</p>
  </main>
</template>

<style scoped>
.session-entry-status {
  box-sizing: border-box;
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #f4f7f9;
  color: #667085;
  font: 14px/1.6 system-ui, sans-serif;
  text-align: center;
}
button {
  padding: 8px 16px;
  border: 1px solid #2563ff;
  border-radius: 6px;
  background: #2563ff;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid #2563ff;
  outline-offset: 2px;
}
</style>
