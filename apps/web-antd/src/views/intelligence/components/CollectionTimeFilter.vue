<script setup lang="ts">
import { DatePicker, Segmented } from 'ant-design-vue';
import { recentListingRange } from '../../../../../../server/product-listing.mjs';
const model = defineModel<string[]>({ required: true });
function quick(value: string | number) {
  model.value = Number(value) ? recentListingRange(Number(value)) : [];
}
function selected() {
  if (!model.value.length) return 0;
  return (
    [1, 7, 30, 90, 180].find(
      (days) => recentListingRange(days).join() === model.value.join(),
    ) ?? -1
  );
}
</script>
<template>
  <div class="hci-toolbar collection-time-filter">
    <span>采集时间（北京时间）</span>
    <DatePicker.RangePicker
      :value="model.length === 2 ? [model[0]!, model[1]!] : undefined"
      value-format="YYYY-MM-DD"
      :placeholder="['开始日期', '结束日期']"
      aria-label="采集日期范围"
      @change="
        (_dates, values) =>
          (model = values?.[0] && values?.[1] ? [values[0], values[1]] : [])
      "
    />
    <Segmented
      :value="selected()"
      :options="[
        { value: 0, label: '全部' },
        { value: 1, label: '今天' },
        ...[7, 30, 90, 180].map((value) => ({ value, label: `近${value}天` })),
      ]"
      aria-label="采集时间快捷筛选"
      @change="quick"
    />
  </div>
</template>
<style scoped>
.collection-time-filter {
  flex-wrap: wrap;
  margin: 8px 0;
}
.collection-time-filter :deep(.ant-picker-range) {
  max-width: 100%;
}
</style>
