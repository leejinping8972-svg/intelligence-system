<script setup lang="ts">
import type { ScoreFilter } from '../resource-list';

import { computed } from 'vue';

import { InputNumber, Select } from 'ant-design-vue';

const props = defineProps<{ label: string }>();
const model = defineModel<ScoreFilter>({ required: true });
const invalid = computed(
  () =>
    model.value.status !== 'unscored' &&
    model.value.min !== null &&
    model.value.max !== null &&
    model.value.min > model.value.max,
);
function update(key: 'max' | 'min', value: unknown) {
  model.value = {
    ...model.value,
    [key]: typeof value === 'number' ? value : null,
  };
}
</script>
<template>
  <div class="hci-score-filter" :aria-label="`${props.label}评分区间`">
    <span>评分</span>
    <InputNumber
      :value="model.min ?? undefined"
      :min="0"
      :max="100"
      :precision="0"
      :disabled="model.status === 'unscored'"
      placeholder="最低"
      :aria-label="`${label}最低评分`"
      @change="update('min', $event)"
    />
    <span>—</span>
    <InputNumber
      :value="model.max ?? undefined"
      :min="0"
      :max="100"
      :precision="0"
      :disabled="model.status === 'unscored'"
      placeholder="最高"
      :aria-label="`${label}最高评分`"
      @change="update('max', $event)"
    />
    <Select
      :value="model.status"
      :aria-label="`${label}评分状态`"
      :options="[
        { label: '全部评分', value: 'all' },
        { label: '已有评分', value: 'scored' },
        { label: '尚未评分', value: 'unscored' },
      ]"
      @change="model = { ...model, status: $event as ScoreFilter['status'] }"
    />
    <span v-if="invalid" class="hci-filter-error" role="alert">最低分不能高于最高分</span>
  </div>
</template>
