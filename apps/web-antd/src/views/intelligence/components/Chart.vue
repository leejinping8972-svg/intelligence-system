<script setup lang="ts">
import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';

import { echarts } from '@vben/plugins/echarts';
import { usePreferences } from '@vben/preferences';
const props = withDefaults(
  defineProps<{
    ariaLabel?: string;
    map?: boolean;
    options: Record<string, any>;
  }>(),
  { ariaLabel: '数据图表', map: false },
);
const emit = defineEmits<{ select: [name: string] }>();
const el = ref<HTMLDivElement>();
const error = ref('');
const { isDark } = usePreferences();
let chart: ReturnType<typeof echarts.init> | undefined;
let observer: ResizeObserver | undefined;
let disposed = false;
async function render() {
  if (!el.value || disposed) return;
  if (props.map && !echarts.getMap('hci-world')) {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}maps/world.geo.json`,
      );
      if (!response.ok) throw new Error('map');
      const geo = await response.json();
      geo.features = geo.features
        .filter((f: any) => f.properties.ADMIN !== 'Antarctica')
        .map((f: any) => ({
          ...f,
          properties: {
            ...f.properties,
            name:
              f.properties.ADMIN === 'United States of America'
                ? 'United States'
                : f.properties.ADMIN,
          },
        }));
      echarts.registerMap('hci-world', geo);
    } catch {
      error.value = '地图加载失败，可使用下方国家列表切换市场。';
      return;
    }
  }
  if (disposed || !el.value) return;
  chart?.dispose();
  chart = echarts.init(el.value, isDark.value ? 'dark' : undefined);
  chart.setOption({
    ...props.options,
    backgroundColor: 'transparent',
    animation: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  chart.on('click', (p) => emit('select', p.name));
}
onMounted(() => {
  render();
  observer = new ResizeObserver(() => chart?.resize());
  if (el.value) observer.observe(el.value);
});
watch(() => [props.options, isDark.value], render, { deep: true });
onActivated(() => nextTick(() => chart?.resize()));
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  chart?.dispose();
});
</script>
<template>
  <div v-if="error" class="hci-empty">{{ error }}</div>
  <div ref="el" class="hci-chart" role="img" :aria-label="ariaLabel"></div>
</template>
