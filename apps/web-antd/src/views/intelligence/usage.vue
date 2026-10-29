<script setup lang="ts">
import PageHeader from './components/PageHeader.vue';
import SourceConfiguration from './components/SourceConfiguration.vue';
import SourceUsageDashboard from './components/SourceUsageDashboard.vue';
import { serverMode } from './session';
</script>
<template><main class="hci-page"><PageHeader title="资源消耗" description="来源额度、已确认扣费与采集消耗明细。" :show-market="false"><RouterLink to="/settings">配置数据源连接</RouterLink></PageHeader><SourceUsageDashboard v-if="serverMode"><template #configuration="{ sourceId }"><SourceConfiguration :source-id="sourceId" /></template></SourceUsageDashboard><p v-else class="hci-evidence">请登录服务器版查看来源消耗。</p></main></template>
