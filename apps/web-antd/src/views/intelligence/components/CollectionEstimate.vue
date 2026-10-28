<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';

import { cloudRequest } from '../cloud-workspace';
const props = defineProps<{ input: Record<string, unknown> }>();
const result = ref<{
  minSeconds: number;
  maxSeconds: number;
  estimatedCalls: number;
  ahead: number;
  basis: string;
  note: string;
}>();
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
watch(
  () => props.input,
  (value) => {
    clearTimeout(timer);
    result.value = undefined;
    const current = ++sequence;
    timer = setTimeout(async () => {
      try {
        const response = await cloudRequest<NonNullable<typeof result.value>>(
          'server_task_estimate',
          { input: value },
        );
        if (current === sequence) result.value = response;
      } catch {
        if (current === sequence) result.value = undefined;
      }
    }, 450);
  },
  { deep: true, immediate: true },
);
onUnmounted(() => {
  clearTimeout(timer);
  sequence++;
});
const duration = (seconds: number) =>
  seconds < 60
    ? Math.ceil(seconds) + '秒'
    : seconds < 3600
      ? Math.ceil(seconds / 60) + '分钟'
      : (seconds / 3600).toFixed(1) + '小时';
</script>
<template>
  <aside class="estimate" role="status">
    <template v-if="result">
      <strong
        >预计采集耗时：{{ duration(result.minSeconds) }}～{{
          duration(result.maxSeconds)
        }}</strong
      >
      <p>{{ result.basis }}；同类待完成任务 {{ result.ahead }} 项。</p>
      <small>{{ result.note }}</small>
    </template>
    <template v-else>
      预计耗时正在读取；提交后可在任务详情查看实际进度。限流和排队等待会增加耗时。
    </template>
  </aside>
</template>
<style scoped>
.estimate {
  padding: 12px 16px;
  margin: 16px 0;
  font-size: 13px;
  color: #334155;
  background: #f0f7ff;
  border-radius: 8px;
}

.estimate p {
  margin: 5px 0;
}

.estimate small {
  line-height: 1.7;
}
</style>
