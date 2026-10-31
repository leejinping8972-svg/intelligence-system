<script setup lang="ts">
import { Drawer, Modal } from 'ant-design-vue';

defineOptions({ inheritAttrs: false });
defineProps<{
  embedded?: boolean;
  drawer?: boolean;
  open: boolean;
  title: string;
  width?: number | string;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();
</script>
<template>
  <div v-if="embedded" class="monitor-config">
    <slot></slot>
    <div v-if="$slots.footer" class="hci-toolbar"><slot name="footer"></slot></div>
  </div>
  <component
    :is="drawer ? Drawer : Modal"
    v-else
    v-bind="$attrs"
    :open="open"
    :title="title"
    :width="width"
    :footer="null"
    @update:open="emit('update:open', $event)"
    @close="emit('update:open', false)"
    @cancel="emit('update:open', false)"
  >
    <slot></slot>
    <template v-if="$slots.footer" #footer><slot name="footer"></slot></template>
  </component>
</template>
