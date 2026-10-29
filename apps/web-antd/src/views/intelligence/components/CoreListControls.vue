<script setup lang="ts">
import { Button, Segmented, message } from 'ant-design-vue';
import { onMounted, ref } from 'vue';
import { loadCoreRates, coreListContext } from '../core-list-context';
import type { CoreKind, CorePeriod } from '../core-list-metrics';
const props = defineProps<{ kind: CoreKind }>();
const preset = defineModel<string>('preset', { default: 'original' });
const period = defineModel<CorePeriod>('period', { default: 30 });
const busy = ref(false);
onMounted(() => {
  if (props.kind === 'products') void loadCoreRates();
});
async function refreshRates() {
  busy.value = true;
  try {
    await loadCoreRates(true);
    message.success('美元对比汇率已更新');
  } catch (e) {
    message.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="hci-toolbar core-list-controls">
    <div class="core-control-group">
      <span>列预设</span
      ><Segmented
        v-model:value="preset"
        aria-label="列预设"
        :options="[
          { value: 'original', label: '原有列' },
          { value: 'decision', label: '决策概览' },
          { value: 'evidence', label: '数据证据' },
        ]"
      />
    </div>
    <template v-if="kind === 'products' || kind === 'keywords'"
      ><div class="core-control-group">
        <span>统计周期</span
        ><Segmented
          v-model:value="period"
          aria-label="列表统计周期"
          :options="[30, 90, 180, 365].map((d) => ({ value: d, label: `近${d}天` }))"
        /></div
    ></template>
    <template v-if="kind === 'products'"
      ><Button
        :loading="busy"
        title="每日最多1次免费公开汇率请求"
        @click="refreshRates"
        >更新美元汇率</Button
      ><span v-if="coreListContext.fx" class="hci-subtle"
        >汇率日 {{ coreListContext.fx.date }} ·
        <a
          href="https://www.exchangerate-api.com"
          target="_blank"
          rel="noreferrer"
          >ExchangeRate-API</a
        ></span
      ></template
    >
    <slot />
  </div>
</template>
<style scoped>
.core-list-controls {
  margin: 12px 0;
  flex-wrap: wrap;
}
.core-control-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}
.core-control-group > span {
  font-size: 12px;
  color: #687078;
}
</style>
