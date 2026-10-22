<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { cloudWorkspace, setWorkspaceReadMode, startCloudSync } from '../cloud-workspace';
import { state, storageError } from '../data';
import { serverMode } from '../session';
import MarketSwitcher from './MarketSwitcher.vue';
const props = withDefaults(
  defineProps<{ title: string; description: string; showMarket?: boolean; mode?: 'legacy' | 'paged' | 'tasks' }>(),
  { showMarket: true },
);
const route = useRoute();
watch(() => [route.path, props.mode] as const, ([path, mode]) => {
  const page = path.split('/').filter(Boolean).at(-1);
  setWorkspaceReadMode(mode || (page === 'monitor' ? 'tasks' : ['overview', 'research', 'selected-keywords', 'products', 'sites', 'ads', 'settings'].includes(page || '') ? 'paged' : 'legacy'));
  startCloudSync();
}, { immediate: true });
</script>
<template>
  <div class="hci-page-head">
    <div class="hci-page-scope">
      <h1>{{ title }}</h1>
      <MarketSwitcher v-if="showMarket !== false" />
    </div>
    <div class="hci-head-actions">
      <slot></slot>
    </div>
  </div>
  <div v-if="storageError.value" class="hci-demo-note">
    {{ storageError.value }}
  </div>
  <div
    v-if="!serverMode && !state.settings.researchAccessKey"
    class="hci-demo-note"
  >
    首次访问服务器：请在「数据源与设置」填写原研究访问码，再开始使用云端业务数据。
    <RouterLink to="/settings">前往设置</RouterLink>
  </div>
  <div v-else-if="cloudWorkspace.error" class="hci-demo-note" role="alert">
    云端保存尚未成功：{{ cloudWorkspace.error }}。本机缓存仍保留。
  </div>
  <div
    v-else-if="cloudWorkspace.syncing && !cloudWorkspace.ready"
    class="hci-demo-note"
    role="status"
    aria-live="polite"
  >
    正在读取最新数据；如有上次成功内容会继续显示，不会先清空再刷新。
  </div>
</template>
