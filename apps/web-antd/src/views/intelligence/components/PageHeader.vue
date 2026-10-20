<script setup lang="ts">
import { cloudWorkspace, startCloudSync } from '../cloud-workspace';
import { state, storageError } from '../data';
import { serverMode } from '../session';
import MarketSwitcher from './MarketSwitcher.vue';
withDefaults(
  defineProps<{ title: string; description: string; showMarket?: boolean }>(),
  { showMarket: true },
);
startCloudSync();
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
</template>
