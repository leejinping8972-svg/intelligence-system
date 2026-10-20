<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  watch,
} from 'vue';

import { Tag } from 'ant-design-vue';

const props = withDefaults(
  defineProps<{ items: string[]; color?: string; label?: string }>(),
  { label: '标签', color: undefined },
);
const expanded = ref(false);
const overflowing = ref(false);
const content = ref<HTMLElement>();
const id = useId();
const items = computed(() => [...new Set(props.items.filter(Boolean))]);
let observer: ResizeObserver | undefined;
function measure() {
  if (!expanded.value && content.value)
    overflowing.value =
      content.value.scrollHeight > content.value.clientHeight + 1 ||
      [...content.value.children].some(
        (child) => child.scrollWidth > child.clientWidth + 1,
      );
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure);
    if (content.value) observer.observe(content.value);
  }
  measure();
});
watch(items, async () => {
  expanded.value = false;
  await nextTick();
  measure();
});
watch(expanded, async () => {
  await nextTick();
  measure();
});
onBeforeUnmount(() => observer?.disconnect());
</script>
<template>
  <div class="hci-tag-summary" :class="{ 'is-expanded': expanded }">
    <div
      :id="id"
      ref="content"
      class="hci-tag-summary-content"
      :aria-label="label"
    >
      <Tag v-for="item in items" :key="item" :color="color">{{ item }}</Tag>
      <span v-if="!items.length" class="hci-subtle">—</span>
    </div>
    <button
      v-if="overflowing || expanded"
      type="button"
      class="hci-tag-disclosure"
      :aria-expanded="expanded"
      :aria-controls="id"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收起' : `展开全部（${items.length}）` }}
    </button>
  </div>
</template>
