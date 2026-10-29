<script setup lang="ts">
import AdsSettings from './AdsSettings.vue';
import AnalysisSettings from './AnalysisSettings.vue';
import BraveSettings from './BraveSettings.vue';
import SemrushSettings from './SemrushSettings.vue';
import SiteCollectionSettings from './SiteCollectionSettings.vue';
import SorftimeSettings from './SorftimeSettings.vue';
import WestmonthSettings from './WestmonthSettings.vue';
import YouTubeSettings from './YouTubeSettings.vue';
import { state } from '../data';
defineProps<{ sourceId: string }>();
</script>
<template>
  <SemrushSettings v-if="sourceId === 'semrush'" />
  <SorftimeSettings v-else-if="sourceId === 'sorftime'" :api-url="state.settings.researchApiUrl" :access-key="state.settings.researchAccessKey" />
  <BraveSettings v-else-if="sourceId === 'brave'" />
  <YouTubeSettings v-else-if="sourceId === 'youtube'" />
  <AdsSettings v-else-if="sourceId === 'scrapecreators'" />
  <SiteCollectionSettings v-else-if="sourceId === 'firecrawl' || sourceId === 'official_sites'" />
  <AnalysisSettings v-else-if="sourceId === 'analysis'" />
  <WestmonthSettings v-else-if="sourceId === 'westmonth'" />
  <p v-else class="hci-evidence">此来源无需单独密钥或尚未开放自动接入，请查看来源说明。</p>
</template>
