<script lang="ts" setup>
import { computed } from 'vue';

import { useAntdDesignTokens } from '@vben/hooks';
import { preferences, usePreferences } from '@vben/preferences';

import { App, ConfigProvider, theme } from 'ant-design-vue';

import { antdLocale } from '#/locales';

defineOptions({ name: 'App' });

const { isDark } = usePreferences();
const { tokens } = useAntdDesignTokens();

function transformCellText({ text }: { text: unknown }) {
  if (text === null || text === undefined) return '—';
  if (typeof text === 'string' && !text.trim()) return '—';
  if (Array.isArray(text) && text.length === 0) return '—';
  return text;
}

const tokenTheme = computed(() => {
  const algorithm = isDark.value
    ? [theme.darkAlgorithm]
    : [theme.defaultAlgorithm];

  // antd 紧凑模式算法
  if (preferences.app.compact) {
    algorithm.push(theme.compactAlgorithm);
  }

  return {
    algorithm,
    token: { ...tokens, fontFamily: '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif' },
  };
});
</script>

<template>
  <ConfigProvider
    :locale="antdLocale"
    :theme="tokenTheme"
    :transform-cell-text="transformCellText"
  >
    <App>
      <RouterView />
    </App>
  </ConfigProvider>
</template>
