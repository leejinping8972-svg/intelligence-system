<script setup lang="ts">
import { useRoute } from 'vue-router';
import PageHeader from './components/PageHeader.vue';
import SourceConnections from './components/SourceConnections.vue';
import WorkspaceSettings from './components/WorkspaceSettings.vue';
const route = useRoute();
</script>
<template>
  <main class="hci-page">
    <PageHeader title="数据源与设置" description="" :show-market="false" mode="paged" />
    <WorkspaceSettings v-if="route.path === '/workspace-settings'" />
    <SourceConnections v-else />
  </main>
</template>
